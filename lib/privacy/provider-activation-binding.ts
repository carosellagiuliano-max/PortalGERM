import { createHash } from "node:crypto";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { ObjectStoreProviderAuthorityBinding } from "@/lib/providers/storage/provider-authority-bound-object-store";

export function privacyExportStoreActivationBinding(
  environment: ServerEnvironment,
): ObjectStoreProviderAuthorityBinding | null {
  const useCase = "privacy.export-store";
  const adapterVersion = "v1";
  if (environment.PRIVACY_EXPORT_STORAGE_MODE === "disabled") return null;
  if (environment.PRIVACY_EXPORT_STORAGE_MODE === "filesystem_sandbox") {
    const adapterKey = "filesystem_sandbox";
    return Object.freeze({
      adapterKey,
      adapterVersion,
      expectedConfigurationDigest: digest({
        adapterKey,
        adapterVersion,
        region: environment.PRIVACY_EXPORT_STORAGE_REGION,
        useCase,
      }),
      expectedMode: "SANDBOX" as const,
      expectedSecretVersionRef: "builtin:privacy-export-filesystem:v1",
      useCase,
    });
  }
  const secretVersion = environment.DOCUMENT_STORAGE_SECRET_VERSION;
  if (
    secretVersion === undefined ||
    environment.DOCUMENT_STORAGE_ENDPOINT === undefined ||
    environment.PRIVACY_EXPORT_STORAGE_BUCKET === undefined ||
    environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION === undefined
  ) {
    return null;
  }
  const adapterKey = environment.PRIVACY_EXPORT_STORAGE_MODE;
  return Object.freeze({
    adapterKey,
    adapterVersion,
    expectedConfigurationDigest: digest({
      adapterKey,
      adapterVersion,
      bucket: environment.PRIVACY_EXPORT_STORAGE_BUCKET,
      encryptionVersion: environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION,
      endpoint: environment.DOCUMENT_STORAGE_ENDPOINT,
      forcePathStyle: environment.DOCUMENT_STORAGE_FORCE_PATH_STYLE,
      kmsKeyId: environment.DOCUMENT_STORAGE_KMS_KEY_ID ?? null,
      region: environment.PRIVACY_EXPORT_STORAGE_REGION,
      serverSideEncryption: environment.DOCUMENT_STORAGE_SSE,
      useCase,
    }),
    expectedMode: adapterKey === "s3_contract" ? "ALLOWLIST" : "LIVE",
    expectedSecretVersionRef: secretVersion,
    useCase,
  });
}

function digest(value: Record<string, unknown>) {
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
