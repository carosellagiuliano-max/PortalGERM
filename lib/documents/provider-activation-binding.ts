import { createHash } from "node:crypto";

import type { ServerEnvironment } from "@/lib/config/env-schema";

export type DocumentProviderActivationBinding = Readonly<{
  adapterKey: string;
  adapterVersion: "v1";
  expectedConfigurationDigest: string;
  expectedMode: "SANDBOX" | "ALLOWLIST" | "LIVE";
  expectedSecretVersionRef: string;
  region: string;
  useCase: "documents.object-store" | "documents.malware-scan";
}>;

export function documentObjectStoreActivationBinding(
  environment: ServerEnvironment,
): DocumentProviderActivationBinding | null {
  const useCase = "documents.object-store" as const;
  switch (environment.DOCUMENT_STORAGE_MODE) {
    case "disabled":
      return null;
    case "filesystem_sandbox": {
      const adapterKey = "filesystem_sandbox";
      return binding({
        adapterKey,
        adapterVersion: "v1",
        expectedConfigurationDigest: legacyConfigurationDigest({
          adapterKey,
          region: environment.DOCUMENT_STORAGE_REGION,
          useCase,
        }),
        expectedMode: "SANDBOX",
        expectedSecretVersionRef: "builtin:filesystem-sandbox:v1",
        region: environment.DOCUMENT_STORAGE_REGION,
        useCase,
      });
    }
    case "s3_contract":
    case "s3_live": {
      const secretVersion = environment.DOCUMENT_STORAGE_SECRET_VERSION;
      if (
        secretVersion === undefined ||
        environment.DOCUMENT_STORAGE_ENDPOINT === undefined ||
        environment.DOCUMENT_STORAGE_BUCKET === undefined ||
        environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION === undefined
      ) {
        return null;
      }
      const adapterKey = environment.DOCUMENT_STORAGE_MODE;
      return binding({
        adapterKey,
        adapterVersion: "v1",
        expectedConfigurationDigest: configurationDigest({
          adapterKey,
          adapterVersion: "v1",
          bucket: environment.DOCUMENT_STORAGE_BUCKET,
          encryptionVersion: environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION,
          endpoint: environment.DOCUMENT_STORAGE_ENDPOINT,
          forcePathStyle: environment.DOCUMENT_STORAGE_FORCE_PATH_STYLE,
          kmsKeyId: environment.DOCUMENT_STORAGE_KMS_KEY_ID ?? null,
          region: environment.DOCUMENT_STORAGE_REGION,
          serverSideEncryption: environment.DOCUMENT_STORAGE_SSE,
          useCase,
        }),
        expectedMode: adapterKey === "s3_contract" ? "ALLOWLIST" : "LIVE",
        expectedSecretVersionRef: secretVersion,
        region: environment.DOCUMENT_STORAGE_REGION,
        useCase,
      });
    }
  }
}

export function documentScannerActivationBinding(
  environment: ServerEnvironment,
): DocumentProviderActivationBinding | null {
  const useCase = "documents.malware-scan" as const;
  switch (environment.DOCUMENT_SCANNER_MODE) {
    case "disabled":
      return null;
    case "sandbox": {
      const adapterKey = "deterministic_sandbox";
      return binding({
        adapterKey,
        adapterVersion: "v1",
        expectedConfigurationDigest: legacyConfigurationDigest({
          adapterKey,
          region: environment.DOCUMENT_STORAGE_REGION,
          useCase,
        }),
        expectedMode: "SANDBOX",
        expectedSecretVersionRef: "builtin:deterministic-scanner:v1",
        region: environment.DOCUMENT_STORAGE_REGION,
        useCase,
      });
    }
    case "clamav_contract":
    case "clamav_live": {
      const secretVersion = environment.DOCUMENT_SCANNER_SECRET_VERSION;
      if (
        secretVersion === undefined ||
        environment.DOCUMENT_SCANNER_HOST === undefined
      ) {
        return null;
      }
      const adapterKey = environment.DOCUMENT_SCANNER_MODE;
      return binding({
        adapterKey,
        adapterVersion: "v1",
        expectedConfigurationDigest: configurationDigest({
          adapterKey,
          adapterVersion: "v1",
          host: environment.DOCUMENT_SCANNER_HOST,
          port: environment.DOCUMENT_SCANNER_PORT,
          region: environment.DOCUMENT_STORAGE_REGION,
          tls: environment.DOCUMENT_SCANNER_TLS,
          useCase,
        }),
        expectedMode: adapterKey === "clamav_contract" ? "ALLOWLIST" : "LIVE",
        expectedSecretVersionRef: secretVersion,
        region: environment.DOCUMENT_STORAGE_REGION,
        useCase,
      });
    }
  }
}

function binding(
  value: DocumentProviderActivationBinding,
): DocumentProviderActivationBinding {
  return Object.freeze(value);
}

function legacyConfigurationDigest(
  input: Readonly<{
    adapterKey: string;
    region: string;
    useCase: string;
  }>,
): string {
  return configurationDigest({
    adapterKey: input.adapterKey,
    adapterVersion: "v1",
    region: input.region,
    useCase: input.useCase,
  });
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
