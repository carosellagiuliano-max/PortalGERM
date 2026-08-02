import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  parseEnvironment,
} from "@/lib/config/env-schema";
import { createEmailDeliveryProvider } from "@/lib/providers/email/delivery-composition";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { ResendLiveEmailProvider } from "@/lib/providers/email/resend-email-provider";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";

const EMAIL_CONFIGURATION = {
  EMAIL_PROVIDER_API_KEY: "re_phase33_provider_key",
  RESEND_WEBHOOK_SECRET: "whsec_phase33_webhook_key",
  RESEND_SECRET_VERSION: "phase33-v1",
  RESEND_WEBHOOK_SECRET_VERSION: "phase33-webhook-v1",
  EMAIL_FROM: "SwissTalentHub <notifications@example.ch>",
  NOTIFICATION_OUTBOX_PRODUCERS: "true",
  NOTIFICATION_DISPATCH: "command",
  NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(8)}`,
} as const;

describe("Phase-33 e-mail provider mode matrix", () => {
  it("accepts the isolated contract adapter only in a production-built CI runtime", () => {
    const environment = parseEnvironment(
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
        ...EMAIL_CONFIGURATION,
      }),
    );

    expect(createEmailDeliveryProvider(environment).providerClass).toBe(
      "resend-contract-v1",
    );
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          EMAIL_PROVIDER_MODE: "resend_contract",
          EMAIL_PROVIDER_CONTRACT_ENDPOINT: "https://api.resend.com/emails",
          ...EMAIL_CONFIGURATION,
        }),
      ),
    ).toThrow(EnvironmentValidationError);
  });

  it("rejects sandbox in production and accepts a fixed-endpoint live adapter", () => {
    const productionBase = {
      APP_ENV: "production",
      NODE_ENV: "production",
      APP_URL: "https://swisstalenthub.example",
      TRUSTED_PROXY_HOPS: "2",
      TEST_DATABASE_URL: undefined,
      ...EMAIL_CONFIGURATION,
    } as const;

    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          ...productionBase,
          EMAIL_PROVIDER_MODE: "resend_sandbox",
        }),
      ),
    ).toThrow(EnvironmentValidationError);

    const live = parseEnvironment(
      createValidEnvironment({
        ...productionBase,
        EMAIL_PROVIDER_MODE: "resend_live",
      }),
    );
    expect(createEmailDeliveryProvider(live).providerClass).toBe(
      "resend-live-v1",
    );
    expect(
      new ResendLiveEmailProvider({
        apiKey: live.secrets.emailProvider,
        from: live.EMAIL_FROM,
        fetch: async () => new Response(JSON.stringify({ id: "receipt" })),
      }).providerClass,
    ).toBe("resend-live-v1");
  });

  it("never accepts a contract endpoint or secret without its exact mode", () => {
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          EMAIL_PROVIDER_CONTRACT_ENDPOINT:
            "http://provider-contract:8080/resend/emails",
        }),
      ),
    ).toThrow(EnvironmentValidationError);
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          EMAIL_PROVIDER_MODE: "resend_live",
          EMAIL_PROVIDER_API_KEY: "not-a-provider-key",
          RESEND_WEBHOOK_SECRET: "whsec_phase33_webhook_key",
          RESEND_SECRET_VERSION: "phase33-v1",
          RESEND_WEBHOOK_SECRET_VERSION: "phase33-webhook-v1",
          EMAIL_FROM: "notifications@example.ch",
        }),
      ),
    ).toThrow(EnvironmentValidationError);
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          EMAIL_PROVIDER_MODE: "resend_sandbox",
          EMAIL_PROVIDER_API_KEY: "re_phase33_sandbox_key",
          EMAIL_FROM: "sandbox@resend.dev",
          NOTIFICATION_OUTBOX_PRODUCERS: "true",
          NOTIFICATION_DISPATCH: "command",
          NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(9)}`,
        }),
      ),
    ).toThrow(EnvironmentValidationError);
  });

  it("requires the webhook secret and its independent version as an exact pair", () => {
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          EMAIL_PROVIDER_MODE: "resend_sandbox",
          ...EMAIL_CONFIGURATION,
          RESEND_WEBHOOK_SECRET_VERSION: undefined,
        }),
      ),
    ).toThrow(EnvironmentValidationError);
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          EMAIL_PROVIDER_MODE: "resend_sandbox",
          ...EMAIL_CONFIGURATION,
          RESEND_WEBHOOK_SECRET: undefined,
        }),
      ),
    ).toThrow(EnvironmentValidationError);
  });

  it.each(["resend_contract", "resend_sandbox", "resend_live"] as const)(
    "rejects %s unless delivery is durable and dispatcher-driven",
    (mode) => {
      const modeConfiguration =
        mode === "resend_contract"
          ? {
              APP_ENV: "ci" as const,
              NODE_ENV: "production" as const,
              DATABASE_URL:
                "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub_ci?schema=public",
              TEST_DATABASE_URL:
                "postgresql://test:test-only@127.0.0.1:5435/swisstalenthub_test?schema=public",
              EMAIL_PROVIDER_CONTRACT_ENDPOINT:
                "http://provider-contract:8080/resend/emails",
            }
          : mode === "resend_live"
            ? {
                APP_ENV: "production" as const,
                NODE_ENV: "production" as const,
                APP_URL: "https://swisstalenthub.example",
                TRUSTED_PROXY_HOPS: "2",
                TEST_DATABASE_URL: undefined,
              }
            : {};

      expect(() =>
        parseEnvironment(
          createValidEnvironment({
            ...modeConfiguration,
            ...EMAIL_CONFIGURATION,
            EMAIL_PROVIDER_MODE: mode,
            NOTIFICATION_OUTBOX_PRODUCERS: "false",
          }),
        ),
      ).toThrow(EnvironmentValidationError);
      expect(() =>
        parseEnvironment(
          createValidEnvironment({
            ...modeConfiguration,
            ...EMAIL_CONFIGURATION,
            EMAIL_PROVIDER_MODE: mode,
            NOTIFICATION_DISPATCH: "paused",
          }),
        ),
      ).toThrow(EnvironmentValidationError);
    },
  );

  it("binds every Resend use case to mode, secret version and safe configuration", () => {
    const contract = parseEnvironment(
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
        ...EMAIL_CONFIGURATION,
      }),
    );
    const transactional = emailProviderActivationBinding(
      contract,
      "email.transactional",
    );
    const jobAlert = emailProviderActivationBinding(
      contract,
      "email.job-alert",
    );
    const deliveryEvents = emailProviderActivationBinding(
      contract,
      "email.delivery-events",
    );

    expect(transactional).toMatchObject({
      adapterKey: "resend_contract",
      expectedMode: "ALLOWLIST",
      expectedSecretVersionRef: "phase33-v1",
    });
    expect(deliveryEvents).toMatchObject({
      adapterKey: "resend_contract",
      expectedMode: "ALLOWLIST",
      expectedSecretVersionRef: "phase33-webhook-v1",
    });
    expect(jobAlert?.expectedConfigurationDigest).not.toBe(
      transactional?.expectedConfigurationDigest,
    );
    expect(deliveryEvents?.expectedConfigurationDigest).not.toBe(
      transactional?.expectedConfigurationDigest,
    );

    const changedSender = parseEnvironment(
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
        ...EMAIL_CONFIGURATION,
        EMAIL_FROM: "SwissTalentHub <changed@phase33.invalid>",
      }),
    );
    expect(
      emailProviderActivationBinding(changedSender, "email.transactional")
        ?.expectedConfigurationDigest,
    ).not.toBe(transactional?.expectedConfigurationDigest);

    const apiRotated = parseEnvironment(
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
        ...EMAIL_CONFIGURATION,
        RESEND_SECRET_VERSION: "phase33-v2",
      }),
    );
    const webhookRotated = parseEnvironment(
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
        ...EMAIL_CONFIGURATION,
        RESEND_WEBHOOK_SECRET_VERSION: "phase33-webhook-v2",
      }),
    );

    expect(
      emailProviderActivationBinding(apiRotated, "email.delivery-events"),
    ).toEqual(deliveryEvents);
    expect(
      emailProviderActivationBinding(apiRotated, "email.transactional")
        ?.expectedSecretVersionRef,
    ).toBe("phase33-v2");
    expect(
      emailProviderActivationBinding(webhookRotated, "email.transactional"),
    ).toEqual(transactional);
    expect(
      emailProviderActivationBinding(webhookRotated, "email.delivery-events")
        ?.expectedSecretVersionRef,
    ).toBe("phase33-webhook-v2");
  });
});
