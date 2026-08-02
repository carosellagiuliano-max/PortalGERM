import type { ServerEnvironment } from "@/lib/config/env-schema";

export type DocumentRuntimeDecision =
  | Readonly<{
      available: true;
      mode: "SANDBOX" | "CONTRACT_ONLY" | "LIVE";
      writes: boolean;
      cleanReads: boolean;
      reconciliation: "disabled" | "dry_run" | "command";
    }>
  | Readonly<{
      available: false;
      mode: "DISABLED";
      code: "DOCUMENT_VAULT_UNAVAILABLE";
    }>;

export function resolveDocumentRuntime(
  environment: ServerEnvironment,
): DocumentRuntimeDecision {
  if (
    (environment.APP_ENV === "local" || environment.APP_ENV === "ci") &&
    environment.DOCUMENT_STORAGE_MODE === "filesystem_sandbox" &&
    environment.DOCUMENT_SCANNER_MODE === "sandbox" &&
    environment.DOCUMENT_VAULT_COHORT === "test" &&
    environment.DOCUMENT_STORAGE_ROOT !== undefined &&
    environment.secrets.keyrings.DOCUMENT_STORAGE_KEYS.length > 0
  ) {
    return available(environment, "SANDBOX");
  }
  if (
    environment.APP_ENV === "ci" &&
    environment.NODE_ENV === "production" &&
    environment.DOCUMENT_STORAGE_MODE === "s3_contract" &&
    environment.DOCUMENT_SCANNER_MODE === "clamav_contract" &&
    environment.DOCUMENT_VAULT_COHORT === "test" &&
    hasExternalProviderConfiguration(environment)
  ) {
    return available(environment, "CONTRACT_ONLY");
  }
  if (
    environment.APP_ENV === "production" &&
    environment.NODE_ENV === "production" &&
    environment.DOCUMENT_STORAGE_MODE === "s3_live" &&
    environment.DOCUMENT_SCANNER_MODE === "clamav_live" &&
    environment.DOCUMENT_VAULT_COHORT === "live" &&
    environment.DOCUMENT_SCANNER_TLS &&
    hasExternalProviderConfiguration(environment)
  ) {
    return available(environment, "LIVE");
  }
  return Object.freeze({
    available: false,
    mode: "DISABLED",
    code: "DOCUMENT_VAULT_UNAVAILABLE",
  });
}

export function isDocumentDataProvenanceAllowed(
  environment: ServerEnvironment,
  provenance: "LIVE" | "DEMO" | "TEST",
): boolean {
  const runtime = resolveDocumentRuntime(environment);
  if (!runtime.available) return false;
  return runtime.mode === "LIVE"
    ? provenance === "LIVE"
    : provenance === "DEMO" || provenance === "TEST";
}

export function assertDocumentBulkAccessDisabled(
  environment: ServerEnvironment,
): void {
  if (environment.DOCUMENT_BULK_ACCESS) {
    throw new Error("Document bulk access requires the Phase-25 step-up gate.");
  }
}

function available(
  environment: ServerEnvironment,
  mode: "SANDBOX" | "CONTRACT_ONLY" | "LIVE",
): DocumentRuntimeDecision {
  return Object.freeze({
    available: true,
    mode,
    writes: environment.DOCUMENT_VAULT_WRITES,
    cleanReads: environment.DOCUMENT_CLEAN_READS,
    reconciliation: environment.DOCUMENT_RECONCILIATION,
  });
}

function hasExternalProviderConfiguration(
  environment: ServerEnvironment,
): boolean {
  return (
    environment.DOCUMENT_STORAGE_ENDPOINT !== undefined &&
    environment.DOCUMENT_STORAGE_BUCKET !== undefined &&
    environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION !== undefined &&
    environment.DOCUMENT_STORAGE_SECRET_VERSION !== undefined &&
    environment.DOCUMENT_SCANNER_HOST !== undefined &&
    environment.DOCUMENT_SCANNER_SECRET_VERSION !== undefined &&
    environment.secrets.documentStorageAccessKeyId !== undefined &&
    environment.secrets.documentStorageSecretAccessKey !== undefined
  );
}
