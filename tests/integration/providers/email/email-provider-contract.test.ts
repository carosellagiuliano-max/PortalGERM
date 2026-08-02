import { describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import { legacyV1NotificationRecipientHashForRead } from "@/lib/notifications/outbox";
import {
  EmailDeliveryFailure,
  type EmailDeliveryRequest,
} from "@/lib/providers/email/email-delivery-provider";
import { createEmailDeliveryProvider } from "@/lib/providers/email/delivery-composition";
import { ResendSandboxEmailProvider } from "@/lib/providers/email/resend-email-provider";
import { parseResendDeliveryEvent } from "@/lib/providers/email/resend-event";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";

const request: EmailDeliveryRequest = Object.freeze({
  to: "delivered@resend.dev",
  templateKey: "identity_verification",
  subject: "E-Mail-Adresse bei SwissTalentHub bestätigen",
  text: "Provider contract",
  templateData: Object.freeze({}),
  idempotencyKey: "phase20-provider-contract-1",
  timeoutMilliseconds: 250,
});

describe("Phase 20 real e-mail provider contract", () => {
  it("selects one explicit provider class without a real-to-mock fallback", async () => {
    const sandboxEnvironment = contractEnvironment();
    expect(createEmailDeliveryProvider(sandboxEnvironment).providerClass).toBe(
      "resend-sandbox-v1",
    );

    const disabledEnvironment = parseEnvironment(createValidEnvironment());
    const disabled = createEmailDeliveryProvider(disabledEnvironment);
    expect(disabled.providerClass).toBe("disabled-v1");
    await expect(disabled.deliver(request)).rejects.toMatchObject({
      kind: "CONFIGURATION",
      code: "PROVIDER_DISABLED",
    });
  });

  it("uses the stable Idempotency-Key and returns the redacted receipt", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "Idempotency-Key": request.idempotencyKey,
        "User-Agent": "SwissTalentHub/phase20-sandbox",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        to: ["delivered@resend.dev"],
        subject: request.subject,
      });
      return response(200, { id: "provider-receipt-1" });
    });
    const provider = createProvider(fetchMock);

    await expect(provider.deliver(request)).resolves.toEqual({
      providerClass: "resend-sandbox-v1",
      providerReceipt: "provider-receipt-1",
      accepted: true,
    });
    await expect(provider.deliver(request)).resolves.toMatchObject({
      providerReceipt: "provider-receipt-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, "rate_limit_exceeded", "TRANSIENT"],
    [500, "internal_error", "TIMEOUT"],
    [422, "validation_error", "PERMANENT"],
    [409, "concurrent_idempotent_requests", "TIMEOUT"],
    [409, "invalid_idempotent_request", "PERMANENT"],
  ] as const)(
    "classifies HTTP %s / %s as %s",
    async (status, name, expectedKind) => {
      const provider = createProvider(async () => response(status, { name }));
      await expect(provider.deliver(request)).rejects.toMatchObject({
        name: "EmailDeliveryFailure",
        kind: expectedKind,
      });
    },
  );

  it("classifies bounded aborts and network ambiguity as timeout", async () => {
    const timeoutProvider = createProvider(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    await expect(
      timeoutProvider.deliver({ ...request, timeoutMilliseconds: 100 }),
    ).rejects.toMatchObject({ kind: "TIMEOUT", code: "PROVIDER_TIMEOUT" });

    const networkProvider = createProvider(async () => {
      throw new TypeError("network unavailable");
    });
    await expect(networkProvider.deliver(request)).rejects.toMatchObject({
      kind: "TIMEOUT",
      code: "PROVIDER_OUTCOME_UNKNOWN",
    });
  });

  it("fails closed for missing config and classifies malformed success receipts as ambiguous", async () => {
    expect(
      () =>
        new ResendSandboxEmailProvider({
          apiKey: undefined,
          from: undefined,
        }),
    ).toThrowError(EmailDeliveryFailure);
    const provider = createProvider(async () => response(200, {}));
    await expect(provider.deliver(request)).rejects.toMatchObject({
      kind: "TIMEOUT",
      code: "PROVIDER_OUTCOME_UNKNOWN",
    });
    await expect(
      provider.deliver({ ...request, to: "real-person@example.com" }),
    ).rejects.toMatchObject({
      kind: "PERMANENT",
      code: "REQUEST_INVALID",
    });
  });

  it("treats declared and streamed oversized 2xx bodies as ambiguous outcomes", async () => {
    const declared = createProvider(
      async () =>
        new Response('{"id":"already-accepted"}', {
          status: 200,
          headers: { "content-length": "70000" },
        }),
    );
    await expect(declared.deliver(request)).rejects.toMatchObject({
      kind: "TIMEOUT",
      code: "PROVIDER_OUTCOME_UNKNOWN",
    });

    const streamed = createProvider(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(40_000));
          controller.enqueue(new Uint8Array(40_000));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    await expect(streamed.deliver(request)).rejects.toMatchObject({
      kind: "TIMEOUT",
      code: "PROVIDER_OUTCOME_UNKNOWN",
    });
  });

  it("reduces bounce/suppression events to receipt and recipient hashes", () => {
    const keyring =
      contractEnvironment().secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS;
    const parsed = parseResendDeliveryEvent(
      {
        type: "email.bounced",
        created_at: "2026-07-26T12:00:00.000Z",
        data: {
          email_id: "email-1",
          to: ["bounced@resend.dev"],
          bounce: { type: "Permanent" },
        },
      },
      keyring,
    );
    expect(parsed).toMatchObject({
      kind: "BOUNCED",
      providerReceipt: "email-1",
    });
    expect(parsed?.recipientHashes[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed?.recipientHashes).not.toContain(
      legacyV1NotificationRecipientHashForRead("bounced@resend.dev"),
    );
    expect(JSON.stringify(parsed)).not.toContain("bounced@resend.dev");
    expect(
      parseResendDeliveryEvent({ type: "email.bounced" }, keyring),
    ).toBeNull();
  });
});

function createProvider(
  fetchImplementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  const environment = contractEnvironment();
  return new ResendSandboxEmailProvider({
    apiKey: environment.secrets.emailProvider,
    from: environment.EMAIL_FROM,
    fetch: fetchImplementation,
  });
}

function contractEnvironment() {
  return parseEnvironment(
    createValidEnvironment({
      EMAIL_PROVIDER_MODE: "resend_sandbox",
      EMAIL_PROVIDER_API_KEY: "re_phase20_contract_only",
      RESEND_SECRET_VERSION: "phase33-email-contract-v1",
      EMAIL_FROM: "SwissTalentHub <sandbox@resend.dev>",
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      NOTIFICATION_DISPATCH: "command",
      NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(9)}`,
    }),
  );
}

function response(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
