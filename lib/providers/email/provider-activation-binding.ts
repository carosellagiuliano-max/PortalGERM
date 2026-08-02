import { createHash } from "node:crypto";

import type { ServerEnvironment } from "@/lib/config/env-schema";

import { RESEND_LIVE_ENDPOINT } from "./resend-email-provider";

export type EmailProviderActivationUseCase =
  "email.transactional" | "email.job-alert" | "email.delivery-events";

export type EmailProviderActivationBinding = Readonly<{
  adapterKey:
    "local_mock" | "resend_contract" | "resend_sandbox" | "resend_live";
  adapterVersion: "v1";
  expectedConfigurationDigest: string;
  expectedMode: "SANDBOX" | "ALLOWLIST" | "LIVE";
  expectedSecretVersionRef: string;
  useCase: EmailProviderActivationUseCase;
}>;

/**
 * Resolves the non-secret runtime identity that a ProviderActivation row must
 * match. The digest deliberately contains no API key, webhook secret, raw
 * mailbox or recipient data. Secret rotation is bound separately by version.
 */
export function emailProviderActivationBinding(
  environment: ServerEnvironment,
  useCase: EmailProviderActivationUseCase,
): EmailProviderActivationBinding | null {
  const adapterKey = environment.EMAIL_PROVIDER_MODE;
  if (adapterKey === "disabled") return null;

  if (adapterKey === "local_mock") {
    if (useCase === "email.delivery-events") return null;
    return binding({
      adapterKey,
      adapterVersion: "v1",
      expectedConfigurationDigest: configurationDigest({
        adapterKey,
        adapterVersion: "v1",
        providerClass: "local_mock",
        useCase,
      }),
      expectedMode: "SANDBOX",
      expectedSecretVersionRef: "builtin:local-mock-mailbox:v1",
      useCase,
    });
  }

  const secretVersion = environment.RESEND_SECRET_VERSION;
  if (secretVersion === undefined) return null;
  const mode =
    adapterKey === "resend_contract"
      ? "ALLOWLIST"
      : adapterKey === "resend_sandbox"
        ? "SANDBOX"
        : "LIVE";
  const endpoint =
    adapterKey === "resend_contract"
      ? environment.EMAIL_PROVIDER_CONTRACT_ENDPOINT
      : RESEND_LIVE_ENDPOINT;
  if (endpoint === undefined) return null;

  if (useCase === "email.delivery-events") {
    if (
      environment.secrets.resendWebhook === undefined ||
      environment.RESEND_WEBHOOK_SECRET_VERSION === undefined
    ) {
      return null;
    }
    return binding({
      adapterKey,
      adapterVersion: "v1",
      expectedConfigurationDigest: configurationDigest({
        adapterKey,
        adapterVersion: "v1",
        eventContract: "resend-svix-v1",
        providerEndpoint: endpoint,
        useCase,
      }),
      expectedMode: mode,
      expectedSecretVersionRef:
        environment.RESEND_WEBHOOK_SECRET_VERSION,
      useCase,
    });
  }

  if (environment.EMAIL_FROM === undefined) return null;
  return binding({
    adapterKey,
    adapterVersion: "v1",
    expectedConfigurationDigest: configurationDigest({
      adapterKey,
      adapterVersion: "v1",
      fromDigest: createHash("sha256")
        .update(environment.EMAIL_FROM.trim().toLowerCase(), "utf8")
        .digest("hex"),
      providerEndpoint: endpoint,
      useCase,
    }),
    expectedMode: mode,
    expectedSecretVersionRef: secretVersion,
    useCase,
  });
}

function binding(
  value: EmailProviderActivationBinding,
): EmailProviderActivationBinding {
  return Object.freeze(value);
}

function configurationDigest(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      ),
      "utf8",
    )
    .digest("hex");
}
