// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import {
  RESEND_MAXIMUM_RESPONSE_BYTES,
  ResendContractEmailProvider,
  ResendLiveEmailProvider,
} from "@/lib/providers/email/resend-email-provider";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";

const request = Object.freeze({
  to: "candidate@example.ch",
  templateKey: "registration_welcome" as const,
  subject: "Willkommen",
  text: "Willkommen bei SwissTalentHub.",
  templateData: Object.freeze({}),
  idempotencyKey: "phase33-live-email-1",
  timeoutMilliseconds: 500,
});

describe("Phase-33 Resend contract/live separation", () => {
  it("executes live code with a fixed endpoint and no recipient sandbox", async () => {
    const environment = liveEnvironment();
    const fetchMock = vi.fn(async (target: string | URL | Request) => {
      expect(String(target)).toBe("https://api.resend.com/emails");
      return new Response(JSON.stringify({ id: "email_live_receipt" }), {
        status: 200,
      });
    });
    const provider = new ResendLiveEmailProvider({
      apiKey: environment.secrets.emailProvider,
      from: environment.EMAIL_FROM,
      fetch: fetchMock,
    });

    await expect(provider.deliver(request)).resolves.toMatchObject({
      accepted: true,
      providerClass: "resend-live-v1",
      providerReceipt: "email_live_receipt",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the HTTP contract endpoint and adapter identity distinct from live", async () => {
    const environment = contractEnvironment();
    const fetchMock = vi.fn(async (target: string | URL | Request) => {
      expect(String(target)).toBe(
        "http://provider-contract:8080/resend/emails",
      );
      return new Response(JSON.stringify({ id: "email_contract_receipt" }), {
        status: 200,
      });
    });
    const provider = new ResendContractEmailProvider({
      apiKey: environment.secrets.emailProvider,
      from: environment.EMAIL_FROM,
      endpoint: environment.EMAIL_PROVIDER_CONTRACT_ENDPOINT,
      fetch: fetchMock,
    });

    await expect(
      provider.deliver({ ...request, to: "candidate@phase33.invalid" }),
    ).resolves.toMatchObject({ providerClass: "resend-contract-v1" });
    expect(provider.providerClass).not.toBe("resend-live-v1");
  });

  it("rejects a declared oversized provider response before buffering it", async () => {
    const environment = liveEnvironment();
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "Content-Length": String(RESEND_MAXIMUM_RESPONSE_BYTES + 1),
          },
        }),
    );
    const provider = new ResendLiveEmailProvider({
      apiKey: environment.secrets.emailProvider,
      from: environment.EMAIL_FROM,
      fetch: fetchMock,
    });

    await expect(provider.deliver(request)).rejects.toMatchObject({
      kind: "TIMEOUT",
      code: "PROVIDER_OUTCOME_UNKNOWN",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([401, 403])(
    "keeps an oversized HTTP %i response operator-recoverable",
    async (status) => {
      const environment = liveEnvironment();
      const provider = new ResendLiveEmailProvider({
        apiKey: environment.secrets.emailProvider,
        from: environment.EMAIL_FROM,
        fetch: vi.fn(
          async () =>
            new Response("{}", {
              status,
              headers: {
                "Content-Length": String(RESEND_MAXIMUM_RESPONSE_BYTES + 1),
              },
            }),
        ),
      });

      await expect(provider.deliver(request)).rejects.toMatchObject({
        kind: "CONFIGURATION",
        code: "PROVIDER_RESPONSE_TOO_LARGE",
      });
    },
  );

  it("stops an oversized chunked response at the byte boundary", async () => {
    const environment = liveEnvironment();
    let cancelled = false;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(RESEND_MAXIMUM_RESPONSE_BYTES));
              controller.enqueue(new Uint8Array([123]));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200 },
        ),
    );
    const provider = new ResendLiveEmailProvider({
      apiKey: environment.secrets.emailProvider,
      from: environment.EMAIL_FROM,
      fetch: fetchMock,
    });

    await expect(provider.deliver(request)).rejects.toMatchObject({
      kind: "TIMEOUT",
      code: "PROVIDER_OUTCOME_UNKNOWN",
    });
    expect(cancelled).toBe(true);
  });

  it("treats HTTP 408 as an unknown provider outcome", async () => {
    const environment = liveEnvironment();
    const provider = new ResendLiveEmailProvider({
      apiKey: environment.secrets.emailProvider,
      from: environment.EMAIL_FROM,
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ name: "request_timeout" }), {
            status: 408,
          }),
      ),
    });

    await expect(provider.deliver(request)).rejects.toMatchObject({
      kind: "TIMEOUT",
      code: "PROVIDER_OUTCOME_UNKNOWN",
    });
  });

  it.each([
    [401, "invalid_api_key", "CONFIGURATION", "INVALID_API_KEY"],
    [403, "restricted_api_key", "CONFIGURATION", "RESTRICTED_API_KEY"],
    [429, "daily_quota_exceeded", "CONFIGURATION", "DAILY_QUOTA_EXCEEDED"],
    [429, "monthly_quota_exceeded", "CONFIGURATION", "MONTHLY_QUOTA_EXCEEDED"],
    [451, "security_error", "CONFIGURATION", "SECURITY_ERROR"],
    [429, "rate_limit_exceeded", "TRANSIENT", "RATE_LIMIT_EXCEEDED"],
    [429, undefined, "TRANSIENT", "HTTP_429"],
    [500, "internal_error", "TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN"],
    [409, "concurrent_idempotent_requests", "TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN"],
    [400, "validation_error", "PERMANENT", "VALIDATION_ERROR"],
    [422, "validation_error", "PERMANENT", "VALIDATION_ERROR"],
  ] as const)(
    "classifies HTTP %i / %s as %s",
    async (status, providerCode, kind, code) => {
      const environment = liveEnvironment();
      const provider = new ResendLiveEmailProvider({
        apiKey: environment.secrets.emailProvider,
        from: environment.EMAIL_FROM,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify(
                providerCode === undefined ? {} : { name: providerCode },
              ),
              { status },
            ),
        ),
      });

      await expect(provider.deliver(request)).rejects.toMatchObject({
        kind,
        code,
      });
    },
  );
});

function liveEnvironment() {
  return parseEnvironment(
    createValidEnvironment({
      APP_ENV: "production",
      NODE_ENV: "production",
      APP_URL: "https://swisstalenthub.example",
      TRUSTED_PROXY_HOPS: "2",
      TEST_DATABASE_URL: undefined,
      EMAIL_PROVIDER_MODE: "resend_live",
      EMAIL_PROVIDER_API_KEY: "re_phase33_live_key",
      RESEND_WEBHOOK_SECRET: "whsec_phase33_live_webhook",
      RESEND_SECRET_VERSION: "phase33-v1",
      RESEND_WEBHOOK_SECRET_VERSION: "phase33-webhook-v1",
      EMAIL_FROM: "SwissTalentHub <notifications@example.ch>",
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      NOTIFICATION_DISPATCH: "command",
      NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(8)}`,
    }),
  );
}

function contractEnvironment() {
  return parseEnvironment(
    createValidEnvironment({
      APP_ENV: "ci",
      NODE_ENV: "production",
      DATABASE_URL:
        "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub_ci?schema=public",
      TEST_DATABASE_URL:
        "postgresql://test:test-only@127.0.0.1:5435/swisstalenthub_test?schema=public",
      EMAIL_PROVIDER_MODE: "resend_contract",
      EMAIL_PROVIDER_CONTRACT_ENDPOINT:
        "http://provider-contract:8080/resend/emails",
      EMAIL_PROVIDER_API_KEY: "re_phase33_contract_key",
      RESEND_WEBHOOK_SECRET: "whsec_phase33_contract_webhook",
      RESEND_SECRET_VERSION: "phase33-v1",
      RESEND_WEBHOOK_SECRET_VERSION: "phase33-webhook-v1",
      EMAIL_FROM: "SwissTalentHub <contract@phase33.invalid>",
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      NOTIFICATION_DISPATCH: "command",
      NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(8)}`,
    }),
  );
}
