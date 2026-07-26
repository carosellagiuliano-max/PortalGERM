import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  DisabledDocumentObjectStore,
  LocalEncryptedDocumentObjectStore,
} from "@/lib/providers/storage/local-encrypted-object-store";
import {
  DisabledMalwareScanner,
  SandboxMalwareScanner,
  type MalwareScanner,
} from "@/lib/providers/storage/malware-scanner";

export function createDocumentObjectStore(environment: ServerEnvironment) {
  if (
    environment.DOCUMENT_STORAGE_MODE !== "filesystem_sandbox" ||
    environment.DOCUMENT_STORAGE_ROOT === undefined
  ) {
    return new DisabledDocumentObjectStore();
  }
  return new LocalEncryptedDocumentObjectStore({
    root: environment.DOCUMENT_STORAGE_ROOT,
    storageRegion: environment.DOCUMENT_STORAGE_REGION,
    keyring: environment.secrets.keyrings.DOCUMENT_STORAGE_KEYS,
  });
}

export function createDocumentMalwareScanner(
  environment: ServerEnvironment,
): MalwareScanner {
  return environment.DOCUMENT_SCANNER_MODE === "sandbox"
    ? new SandboxMalwareScanner()
    : new DisabledMalwareScanner();
}
