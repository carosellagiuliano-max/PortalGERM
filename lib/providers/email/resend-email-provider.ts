import "server-only";

import type { SecretHandle } from "@/lib/config/env-schema";
import { normalizedEmailSchema } from "@/lib/validation/common";

import {
  EmailDeliveryFailure,
  type EmailDeliveryProvider,
  type EmailDeliveryRequest,
} from "./email-delivery-provider";

const DEFAULT_ENDPOINT = "https://api.resend.com/emails";
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class ResendSandboxEmailProvider implements EmailDeliveryProvider {
  readonly providerClass = "resend-sandbox-v1";
  readonly #apiKey: SecretHandle<"EMAIL_PROVIDER_API_KEY">;
  readonly #endpoint: string;
  readonly #fetch: FetchLike;
  readonly #from: string;

  constructor(input: Readonly<{
    apiKey: SecretHandle<"EMAIL_PROVIDER_API_KEY"> | undefined;
    from: string | undefined;
    fetch?: FetchLike;
    endpoint?: string;
  }>) {
    if (input.apiKey === undefined || input.from === undefined) {
      throw new EmailDeliveryFailure(
        "CONFIGURATION",
        "RESEND_SANDBOX_CONFIG_MISSING",
      );
    }
    if (!isSafeEndpoint(input.endpoint ?? DEFAULT_ENDPOINT)) {
      throw new EmailDeliveryFailure(
        "CONFIGURATION",
        "RESEND_ENDPOINT_INVALID",
      );
    }
    this.#apiKey = input.apiKey;
    this.#from = input.from;
    this.#fetch = input.fetch ?? fetch;
    this.#endpoint = input.endpoint ?? DEFAULT_ENDPOINT;
  }

  async deliver(input: EmailDeliveryRequest) {
    const recipient = normalizedEmailSchema.safeParse(input.to);
    if (
      !recipient.success ||
      !recipient.data.endsWith("@resend.dev") ||
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
            "User-Agent": "SwissTalentHub/phase20-sandbox",
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
            "PERMANENT",
            "PROVIDER_RECEIPT_INVALID",
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
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        throw new EmailDeliveryFailure("TIMEOUT", "PROVIDER_TIMEOUT");
      }
      throw new EmailDeliveryFailure("TRANSIENT", "NETWORK_FAILURE");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function classifyResendFailure(
  status: number,
  payload: Readonly<Record<string, unknown>>,
) {
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
    status === 429 ||
    status >= 500 ||
    (status === 409 && providerCode === "concurrent_idempotent_requests")
  ) {
    return new EmailDeliveryFailure("TRANSIENT", safeCode);
  }
  return new EmailDeliveryFailure("PERMANENT", safeCode);
}

async function readResponsePayload(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  try {
    const payload: unknown = await response.json();
    return payload !== null && typeof payload === "object"
      ? (payload as Readonly<Record<string, unknown>>)
      : Object.freeze({}) as Readonly<Record<string, unknown>>;
  } catch {
    return Object.freeze({}) as Readonly<Record<string, unknown>>;
  }
}

function isSafeEndpoint(value: string) {
  try {
    const endpoint = new URL(value);
    return (
      endpoint.protocol === "https:" &&
      endpoint.username === "" &&
      endpoint.password === "" &&
      endpoint.pathname.endsWith("/emails")
    );
  } catch {
    return false;
  }
}
