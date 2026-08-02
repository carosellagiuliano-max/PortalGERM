import type { ServerEnvironment } from "@/lib/config/env-schema";
import { ClamAvMalwareScanner } from "@/lib/providers/storage/clamav-malware-scanner";
import {
  DisabledDocumentObjectStore,
  LocalEncryptedDocumentObjectStore,
} from "@/lib/providers/storage/local-encrypted-object-store";
import {
  DisabledMalwareScanner,
  SandboxMalwareScanner,
  type MalwareScanner,
} from "@/lib/providers/storage/malware-scanner";
import { S3DocumentObjectStore } from "@/lib/providers/storage/s3-document-object-store";

export function createDocumentObjectStore(environment: ServerEnvironment) {
  if (environment.DOCUMENT_STORAGE_MODE === "filesystem_sandbox") {
    if (environment.DOCUMENT_STORAGE_ROOT === undefined) {
      return new DisabledDocumentObjectStore();
    }
    return new LocalEncryptedDocumentObjectStore({
      root: environment.DOCUMENT_STORAGE_ROOT,
      storageRegion: environment.DOCUMENT_STORAGE_REGION,
      keyring: environment.secrets.keyrings.DOCUMENT_STORAGE_KEYS,
    });
  }
  if (
    environment.DOCUMENT_STORAGE_MODE !== "s3_contract" &&
    environment.DOCUMENT_STORAGE_MODE !== "s3_live"
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
    environment.DOCUMENT_STORAGE_BUCKET === undefined ||
    environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION === undefined
  ) {
    return new DisabledDocumentObjectStore();
  }
  return new S3DocumentObjectStore({
    accessKeyId,
    bucket: environment.DOCUMENT_STORAGE_BUCKET,
    endpoint: environment.DOCUMENT_STORAGE_ENDPOINT,
    encryptionKeyVersion: environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION,
    forcePathStyle: environment.DOCUMENT_STORAGE_FORCE_PATH_STYLE,
    ...(environment.DOCUMENT_STORAGE_KMS_KEY_ID === undefined
      ? {}
      : { kmsKeyId: environment.DOCUMENT_STORAGE_KMS_KEY_ID }),
    namespace: "document-vault",
    providerClass:
      environment.DOCUMENT_STORAGE_MODE === "s3_contract"
        ? "s3-contract-v1"
        : "s3-live-v1",
    region: environment.DOCUMENT_STORAGE_REGION,
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

export function createDocumentMalwareScanner(
  environment: ServerEnvironment,
): MalwareScanner {
  if (environment.DOCUMENT_SCANNER_MODE === "sandbox") {
    return new SandboxMalwareScanner();
  }
  if (
    (environment.DOCUMENT_SCANNER_MODE === "clamav_contract" ||
      environment.DOCUMENT_SCANNER_MODE === "clamav_live") &&
    environment.DOCUMENT_SCANNER_HOST !== undefined
  ) {
    return new ClamAvMalwareScanner({
      host: environment.DOCUMENT_SCANNER_HOST,
      port: environment.DOCUMENT_SCANNER_PORT,
      providerClass:
        environment.DOCUMENT_SCANNER_MODE === "clamav_contract"
          ? "clamav-contract-v1"
          : "clamav-live-v1",
      tls: environment.DOCUMENT_SCANNER_TLS,
    });
  }
  return new DisabledMalwareScanner();
}

export function getDocumentStorageEncryptionVersion(
  environment: ServerEnvironment,
): string | null {
  if (environment.DOCUMENT_STORAGE_MODE === "filesystem_sandbox") {
    return environment.secrets.keyrings.DOCUMENT_STORAGE_KEYS[0]?.version ?? null;
  }
  if (
    environment.DOCUMENT_STORAGE_MODE === "s3_contract" ||
    environment.DOCUMENT_STORAGE_MODE === "s3_live"
  ) {
    return environment.DOCUMENT_STORAGE_ENCRYPTION_VERSION ?? null;
  }
  return null;
}
