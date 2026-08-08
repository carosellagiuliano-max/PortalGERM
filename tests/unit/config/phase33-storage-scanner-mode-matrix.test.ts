import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  parseEnvironment,
} from "@/lib/config/env-schema";
import { resolveDocumentRuntime } from "@/lib/documents/runtime-policy";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";
import { createPrivacyExportObjectStore } from "@/lib/providers/storage/privacy-export-storage";
import { createValidEnvironment } from "@/tests/fixtures/environment";

const CONTRACT_STORAGE = Object.freeze({
  DOCUMENT_VAULT_WRITES: "true",
  DOCUMENT_CLEAN_READS: "true",
  DOCUMENT_RECONCILIATION: "command",
  DOCUMENT_VAULT_COHORT: "test",
  DOCUMENT_STORAGE_MODE: "s3_contract",
  DOCUMENT_SCANNER_MODE: "clamav_contract",
  DOCUMENT_STORAGE_ENDPOINT: "http://object-store:9000",
  DOCUMENT_STORAGE_BUCKET: "phase33-documents",
  DOCUMENT_STORAGE_FORCE_PATH_STYLE: "true",
  DOCUMENT_STORAGE_SSE: "aes256",
  DOCUMENT_STORAGE_ENCRYPTION_VERSION: "phase33-sse-v1",
  DOCUMENT_STORAGE_SECRET_VERSION: "phase33-minio-v1",
  DOCUMENT_STORAGE_REGION: "ch-contract-1",
  DOCUMENT_STORAGE_ACCESS_KEY_ID: "phase33-contract",
  DOCUMENT_STORAGE_SECRET_ACCESS_KEY: "phase33-contract-secret",
  DOCUMENT_SCANNER_HOST: "scanner",
  DOCUMENT_SCANNER_PORT: "3310",
  DOCUMENT_SCANNER_TLS: "false",
  DOCUMENT_SCANNER_SECRET_VERSION: "phase33-clamav-v1",
  PRIVACY_EXPORT_STORAGE_MODE: "s3_contract",
  PRIVACY_EXPORT_STORAGE_BUCKET: "phase33-privacy",
  PRIVACY_EXPORT_STORAGE_REGION: "ch-contract-1",
} as const);

const LIVE_STORAGE = Object.freeze({
  APP_ENV: "production",
  NODE_ENV: "production",
  APP_URL: "https://swisstalenthub.example",
  DATABASE_URL:
    "postgresql://app:staging-only@db.example.ch:5432/swisstalenthub?schema=public&sslmode=require",
  TEST_DATABASE_URL: undefined,
  TRUSTED_PROXY_HOPS: "2",
  NOTIFICATION_OUTBOX_PRODUCERS: "true",
  DOCUMENT_VAULT_WRITES: "true",
  DOCUMENT_CLEAN_READS: "true",
  DOCUMENT_RECONCILIATION: "command",
  DOCUMENT_VAULT_COHORT: "live",
  DOCUMENT_STORAGE_MODE: "s3_live",
  DOCUMENT_SCANNER_MODE: "clamav_live",
  DOCUMENT_STORAGE_ENDPOINT: "https://objects.example.ch",
  DOCUMENT_STORAGE_BUCKET: "sth-live-documents",
  DOCUMENT_STORAGE_FORCE_PATH_STYLE: "false",
  DOCUMENT_STORAGE_SSE: "aws_kms",
  DOCUMENT_STORAGE_KMS_KEY_ID:
    "arn:aws:kms:eu-central-2:123456789012:key/00000000-0000-4000-8000-000000000001",
  DOCUMENT_STORAGE_ENCRYPTION_VERSION: "kms-v1",
  DOCUMENT_STORAGE_SECRET_VERSION: "s3-v1",
  DOCUMENT_STORAGE_REGION: "eu-central-2",
  DOCUMENT_STORAGE_ACCESS_KEY_ID: "live-access-key",
  DOCUMENT_STORAGE_SECRET_ACCESS_KEY: "live-secret-key-material",
  DOCUMENT_SCANNER_HOST: "clamav.example.ch",
  DOCUMENT_SCANNER_PORT: "3310",
  DOCUMENT_SCANNER_TLS: "true",
  DOCUMENT_SCANNER_SECRET_VERSION: "clamav-tls-v1",
} as const);

describe("Phase-33 object-storage and malware-scanner mode matrix", () => {
  it("accepts only the isolated contract topology and keeps credentials opaque", () => {
    const environment = parseEnvironment(
      createValidEnvironment({
        APP_ENV: "ci",
        NODE_ENV: "production",
        APP_URL: "https://localhost:3443",
        DATABASE_URL:
          "postgresql://ci:ci-only@127.0.0.1:5432/swisstalenthub_ci?schema=public",
        ...CONTRACT_STORAGE,
      }),
    );

    expect(resolveDocumentRuntime(environment)).toMatchObject({
      available: true,
      mode: "CONTRACT_ONLY",
    });
    expect(createDocumentObjectStore(environment).providerClass).toBe(
      "s3-contract-v1",
    );
    expect(createDocumentMalwareScanner(environment).providerClass).toBe(
      "clamav-contract-v1",
    );
    expect(createPrivacyExportObjectStore(environment).providerClass).toBe(
      "privacy-export-s3-contract-v1",
    );
    expect("DOCUMENT_STORAGE_ACCESS_KEY_ID" in environment).toBe(false);
    expect(JSON.stringify(environment)).not.toContain(
      "phase33-contract-secret",
    );
  });

  it("rejects a contract adapter outside the exact internal topology", () => {
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          APP_ENV: "ci",
          NODE_ENV: "production",
          APP_URL: "https://localhost:3443",
          ...CONTRACT_STORAGE,
          DOCUMENT_STORAGE_ENDPOINT: "https://objects.example.ch",
        }),
      ),
    ).toThrow(EnvironmentValidationError);

    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          APP_ENV: "ci",
          NODE_ENV: "production",
          APP_URL: "https://localhost:3443",
          ...CONTRACT_STORAGE,
          DOCUMENT_SCANNER_TLS: "true",
        }),
      ),
    ).toThrow(EnvironmentValidationError);
  });

  it("accepts TLS/KMS live providers but never filesystem or sandbox fallbacks", () => {
    const environment = parseEnvironment(createValidEnvironment(LIVE_STORAGE));

    expect(resolveDocumentRuntime(environment)).toMatchObject({
      available: true,
      mode: "LIVE",
    });
    expect(createDocumentObjectStore(environment).providerClass).toBe(
      "s3-live-v1",
    );
    expect(createDocumentMalwareScanner(environment).providerClass).toBe(
      "clamav-live-v1",
    );

    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          ...LIVE_STORAGE,
          DOCUMENT_STORAGE_ENDPOINT: "http://objects.example.ch",
        }),
      ),
    ).toThrow(EnvironmentValidationError);
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          ...LIVE_STORAGE,
          DOCUMENT_STORAGE_MODE: "filesystem_sandbox",
          DOCUMENT_SCANNER_MODE: "sandbox",
          DOCUMENT_STORAGE_ROOT: "C:\\sth-vault",
          DOCUMENT_STORAGE_KEYS: "",
        }),
      ),
    ).toThrow(EnvironmentValidationError);
  });
});
