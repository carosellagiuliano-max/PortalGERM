import type { ServerEnvironment } from "@/lib/config/env-schema";

export type DocumentRuntimeDecision =
  | Readonly<{
      available: true;
      mode: "SANDBOX";
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
    (environment.APP_ENV !== "local" && environment.APP_ENV !== "ci") ||
    environment.DOCUMENT_STORAGE_MODE !== "filesystem_sandbox" ||
    environment.DOCUMENT_SCANNER_MODE !== "sandbox" ||
    environment.DOCUMENT_VAULT_COHORT !== "test" ||
    environment.DOCUMENT_STORAGE_ROOT === undefined ||
    environment.secrets.keyrings.DOCUMENT_STORAGE_KEYS.length === 0
  ) {
    return Object.freeze({
      available: false,
      mode: "DISABLED",
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  return Object.freeze({
    available: true,
    mode: "SANDBOX",
    writes: environment.DOCUMENT_VAULT_WRITES,
    cleanReads: environment.DOCUMENT_CLEAN_READS,
    reconciliation: environment.DOCUMENT_RECONCILIATION,
  });
}

export function assertDocumentBulkAccessDisabled(
  environment: ServerEnvironment,
): void {
  if (environment.DOCUMENT_BULK_ACCESS) {
    throw new Error("Document bulk access requires the Phase-25 step-up gate.");
  }
}
