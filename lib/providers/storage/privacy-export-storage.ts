import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  DisabledDocumentObjectStore,
  LocalEncryptedDocumentObjectStore,
} from "@/lib/providers/storage/local-encrypted-object-store";

export const PRIVACY_EXPORT_STORAGE_POLICY_V1 = Object.freeze({
  maximumBytes: 64 * 1024 * 1024,
  maximumChunkBytes: 1024 * 1024,
  streamTimeoutMilliseconds: 5 * 60 * 1_000,
  artifactTtlMilliseconds: 15 * 60 * 1_000,
  objectKeyPattern:
    /^privacy-export\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
});

export function createPrivacyExportObjectStore(
  environment: ServerEnvironment,
) {
  if (
    environment.PRIVACY_EXPORT_STORAGE_MODE !== "filesystem_sandbox" ||
    environment.PRIVACY_EXPORT_STORAGE_ROOT === undefined
  ) {
    return new DisabledDocumentObjectStore();
  }
  return new LocalEncryptedDocumentObjectStore({
    root: environment.PRIVACY_EXPORT_STORAGE_ROOT,
    storageRegion: environment.PRIVACY_EXPORT_STORAGE_REGION,
    keyring: environment.secrets.keyrings.PRIVACY_EXPORT_KEYS,
    maximumBytes: PRIVACY_EXPORT_STORAGE_POLICY_V1.maximumBytes,
    maximumChunkBytes: PRIVACY_EXPORT_STORAGE_POLICY_V1.maximumChunkBytes,
    streamTimeoutMilliseconds:
      PRIVACY_EXPORT_STORAGE_POLICY_V1.streamTimeoutMilliseconds,
    objectKeyPattern: PRIVACY_EXPORT_STORAGE_POLICY_V1.objectKeyPattern,
    providerClass: "privacy-export-filesystem-encrypted-sandbox-v1",
  });
}
