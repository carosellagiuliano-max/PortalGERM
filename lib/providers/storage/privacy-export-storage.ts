import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  DisabledDocumentObjectStore,
  LocalEncryptedDocumentObjectStore,
} from "@/lib/providers/storage/local-encrypted-object-store";
import { S3DocumentObjectStore } from "@/lib/providers/storage/s3-document-object-store";

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
  if (environment.PRIVACY_EXPORT_STORAGE_MODE === "filesystem_sandbox") {
    if (environment.PRIVACY_EXPORT_STORAGE_ROOT === undefined) {
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
  if (
    environment.PRIVACY_EXPORT_STORAGE_MODE !== "s3_contract" &&
    environment.PRIVACY_EXPORT_STORAGE_MODE !== "s3_live"
  ) {
    return new DisabledDocumentObjectStore();
  }
  const accessKeyId = environment.secrets.documentStorageAccessKeyId;
  const secretAccessKey =
    environment.secrets.documentStorageSecretAccessKey;
  if (
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    environment.DOCUMENT_STORAGE_ENDPOINT === undefined ||
    environment.PRIVACY_EXPORT_STORAGE_BUCKET === undefined ||
    environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION === undefined
  ) {
    return new DisabledDocumentObjectStore();
  }
  return new S3DocumentObjectStore({
    accessKeyId,
    bucket: environment.PRIVACY_EXPORT_STORAGE_BUCKET,
    endpoint: environment.DOCUMENT_STORAGE_ENDPOINT,
    encryptionKeyVersion: environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION,
    forcePathStyle: environment.DOCUMENT_STORAGE_FORCE_PATH_STYLE,
    ...(environment.DOCUMENT_STORAGE_KMS_KEY_ID === undefined
      ? {}
      : { kmsKeyId: environment.DOCUMENT_STORAGE_KMS_KEY_ID }),
    maximumBytes: PRIVACY_EXPORT_STORAGE_POLICY_V1.maximumBytes,
    maximumChunkBytes: PRIVACY_EXPORT_STORAGE_POLICY_V1.maximumChunkBytes,
    requestTimeoutMilliseconds:
      PRIVACY_EXPORT_STORAGE_POLICY_V1.streamTimeoutMilliseconds,
    namespace: "privacy-export",
    objectKeyPattern: PRIVACY_EXPORT_STORAGE_POLICY_V1.objectKeyPattern,
    providerClass:
      environment.PRIVACY_EXPORT_STORAGE_MODE === "s3_contract"
        ? "privacy-export-s3-contract-v1"
        : "privacy-export-s3-live-v1",
    region: environment.PRIVACY_EXPORT_STORAGE_REGION,
    secretAccessKey,
    ...(environment.secrets.documentStorageSessionToken === undefined
      ? {}
      : {
          sessionToken:
            environment.secrets.documentStorageSessionToken,
        }),
    serverSideEncryption:
      environment.DOCUMENT_STORAGE_SSE === "aws_kms" ? "aws:kms" : "AES256",
  });
}
