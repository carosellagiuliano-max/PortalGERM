import "server-only";

import type { SecretHandle } from "@/lib/config/env-schema";
import { normalizedEmailSchema } from "@/lib/validation/common";

import {
  EmailDeliveryFailure,
  type EmailDeliveryProvider,
  type EmailDeliveryRequest,
} from "./email-delivery-provider";

export const RESEND_LIVE_ENDPOINT = "https://api.resend.com/emails";
export const RESEND_MAXIMUM_RESPONSE_BYTES = 64 * 1_024;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ResendRuntimeMode = "contract" | "sandbox" | "live";

export class ResendEmailProvider implements EmailDeliveryProvider {
  readonly providerClass: string;
  readonly #apiKey: SecretHandle<"EMAIL_PROVIDER_API_KEY">;
  readonly #endpoint: string;
  readonly #fetch: FetchLike;
  readonly #from: string;
  readonly #mode: ResendRuntimeMode;

  constructor(
    input: Readonly<{
      apiKey: SecretHandle<"EMAIL_PROVIDER_API_KEY"> | undefined;
      from: string | undefined;
      mode: ResendRuntimeMode;
      fetch?: FetchLike;
      endpoint?: string;
    }>,
  ) {
    if (input.apiKey === undefined || input.from === undefined) {
      throw new EmailDeliveryFailure("CONFIGURATION", "RESEND_CONFIG_MISSING");
    }
    const endpoint = input.endpoint ?? RESEND_LIVE_ENDPOINT;
    if (!isSafeEndpoint(endpoint, input.mode, input.endpoint !== undefined)) {
      throw new EmailDeliveryFailure(
        "CONFIGURATION",
        "RESEND_ENDPOINT_INVALID",
      );
    }
    this.#apiKey = input.apiKey;
    this.#from = input.from;
    this.#fetch = input.fetch ?? fetch;
    this.#endpoint = endpoint;
    this.#mode = input.mode;
    this.providerClass = `resend-${input.mode}-v1`;
  }

  async deliver(input: EmailDeliveryRequest) {
    const recipient = normalizedEmailSchema.safeParse(input.to);
    if (
      !recipient.success ||
      !isAllowedRecipient(recipient.data, this.#mode) ||
      !IDEMPOTENCY_PATTERN.test(input.idempotencyKey) ||
      input.subject.length < 1 ||
      input.subject.length > 200 ||
      input.text.length < 1 ||
      input.text.length > 20_000 ||
      !Number.isInteger(input.timeoutMilliseconds) ||
      input.timeoutMilliseconds < 100 ||
      input.timeoutMilliseconds > 30_000
    ) {
      throw new EmailDeliveryFailure("PERMANENT", "REQUEST_INVALID");
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.timeoutMilliseconds,
    );
    try {
      const response = await this.#apiKey.withValue((apiKey) =>
        this.#fetch(this.#endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": input.idempotencyKey,
            "User-Agent":
              this.#mode === "sandbox"
                ? "SwissTalentHub/phase20-sandbox"
                : `SwissTalentHub/resend-${this.#mode}-v1`,
          },
          body: JSON.stringify({
            from: this.#from,
            to: [recipient.data],
            subject: input.subject,
            text: input.text,
          }),
          signal: controller.signal,
        }),
      );
      const payload = await readResponsePayload(response);
      if (response.ok) {
        const receipt =
          typeof payload.id === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(payload.id)
            ? payload.id
            : undefined;
        if (receipt === undefined) {
          throw new EmailDeliveryFailure(
            // A successful HTTP response may already have accepted the mail.
            // Treat a malformed/missing receipt as an ambiguous outcome so a
            // bounded replay can reuse the exact same provider idempotency key.
            "TIMEOUT",
            "PROVIDER_OUTCOME_UNKNOWN",
          );
        }
        return Object.freeze({
          providerClass: this.providerClass,
          providerReceipt: receipt,
          accepted: true as const,
        });
      }
      throw classifyResendFailure(response.status, payload);
    } catch (error) {
      if (error instanceof EmailDeliveryFailure) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new EmailDeliveryFailure("TIMEOUT", "PROVIDER_TIMEOUT");
      }
      // A transport failure does not prove that Resend rejected the request:
      // the connection may have disappeared after the provider accepted it.
      // Preserve the frozen request/effect id and let the dispatcher perform
      // bounded idempotent retries followed by explicit reconciliation.
      throw new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class ResendSandboxEmailProvider extends ResendEmailProvider {
  constructor(
    input: Omit<ConstructorParameters<typeof ResendEmailProvider>[0], "mode">,
  ) {
    super({ ...input, mode: "sandbox" });
  }
}

export class ResendContractEmailProvider extends ResendEmailProvider {
  constructor(
    input: Omit<ConstructorParameters<typeof ResendEmailProvider>[0], "mode">,
  ) {
    super({ ...input, mode: "contract" });
  }
}

export class ResendLiveEmailProvider extends ResendEmailProvider {
  constructor(
    input: Omit<
      ConstructorParameters<typeof ResendEmailProvider>[0],
      "mode" | "endpoint"
    >,
  ) {
    super({ ...input, mode: "live" });
  }
}

function classifyResendFailure(
  status: number,
  payload: Readonly<Record<string, unknown>>,
) {
  if (status === 408) {
    // The provider may have accepted the request before its HTTP response
    // timed out. The dispatcher must preserve the frozen request and reuse
    // its provider idempotency key instead of treating the outcome as a
    // definitive rejection.
    return new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN");
  }
  const providerCode =
    typeof payload.name === "string"
      ? payload.name
      : typeof payload.code === "string"
        ? payload.code
        : `HTTP_${status}`;
  const safeCode = providerCode
    .toUpperCase()
    .replace(/[^A-Z0-9_]/gu, "_")
    .slice(0, 48);
  if (
    status === 401 ||
    status === 403 ||
    (status === 451 && safeCode === "SECURITY_ERROR") ||
    (status === 429 &&
      (safeCode === "DAILY_QUOTA_EXCEEDED" ||
        safeCode === "MONTHLY_QUOTA_EXCEEDED"))
  ) {
    // Invalid/revoked credentials, provider security holds and exhausted
    // account quotas require operator intervention. Retrying them into a DLQ
    // would create load without making progress, so the dispatcher pauses.
    return new EmailDeliveryFailure("CONFIGURATION", safeCode);
  }
  if (
    status >= 500 ||
    (status === 409 && providerCode === "concurrent_idempotent_requests")
  ) {
    // Both responses can be observed while another provider-side request with
    // the same idempotency key is still resolving. They are therefore not
    // definitive rejections and must never be terminalized as a fresh-send
    // dead letter.
    return new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN");
  }
  if (status === 429) {
    return new EmailDeliveryFailure("TRANSIENT", safeCode);
  }
  return new EmailDeliveryFailure("PERMANENT", safeCode);
}

async function readResponsePayload(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > RESEND_MAXIMUM_RESPONSE_BYTES
  ) {
    if (response.body !== null) {
      await response.body.cancel().catch(() => undefined);
    }
    throw oversizedResponseFailure(response.status);
  }
  try {
    const bytes = await readBoundedResponseBytes(response);
    if (bytes.byteLength === 0) {
      return Object.freeze({}) as Readonly<Record<string, unknown>>;
    }
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return payload !== null && typeof payload === "object"
      ? (payload as Readonly<Record<string, unknown>>)
      : (Object.freeze({}) as Readonly<Record<string, unknown>>);
  } catch (error) {
    if (error instanceof EmailDeliveryFailure) throw error;
    return Object.freeze({}) as Readonly<Record<string, unknown>>;
  }
}

async function readBoundedResponseBytes(response: Response) {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > RESEND_MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw oversizedResponseFailure(response.status);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function oversizedResponseFailure(status: number) {
  if (status >= 200 && status < 300) {
    // The provider may already have accepted the message before returning a
    // malformed/oversized success body. Only an idempotent, bounded replay or
    // later reconciliation can resolve that outcome safely.
    return new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN");
  }
  if (status === 408) {
    return new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN");
  }
  if (status === 401 || status === 403) {
    return new EmailDeliveryFailure(
      "CONFIGURATION",
      "PROVIDER_RESPONSE_TOO_LARGE",
    );
  }
  if (status >= 500) {
    return new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN");
  }
  return new EmailDeliveryFailure(
    status === 429 ? "TRANSIENT" : "PERMANENT",
    "PROVIDER_RESPONSE_TOO_LARGE",
  );
}

function isAllowedRecipient(value: string, mode: ResendRuntimeMode) {
  if (mode === "live") return true;
  return (
    value.endsWith("@resend.dev") ||
    (mode === "contract" && value.endsWith(".invalid"))
  );
}

function isSafeEndpoint(
  value: string,
  mode: ResendRuntimeMode,
  explicitlyConfigured: boolean,
) {
  try {
    const endpoint = new URL(value);
    if (mode === "contract") {
      return (
        explicitlyConfigured &&
        endpoint.protocol === "http:" &&
        endpoint.hostname === "provider-contract" &&
        endpoint.port === "8080" &&
        endpoint.pathname === "/resend/emails" &&
        endpoint.username === "" &&
        endpoint.password === "" &&
        endpoint.search === "" &&
        endpoint.hash === ""
      );
    }
    return (
      endpoint.protocol === "https:" &&
      endpoint.username === "" &&
      endpoint.password === "" &&
      endpoint.pathname.endsWith("/emails") &&
      (mode !== "live" ||
        (!explicitlyConfigured && endpoint.href === RESEND_LIVE_ENDPOINT))
    );
  } catch {
    return false;
  }
}
