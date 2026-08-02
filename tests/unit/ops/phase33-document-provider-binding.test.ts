import { describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import {
  documentObjectStoreActivationBinding,
  documentScannerActivationBinding,
} from "@/lib/documents/provider-activation-binding";
import {
  resolveProviderActivation,
  type ProviderActivationRecord,
} from "@/lib/ops/provider-activation-policy";
import { createValidEnvironment } from "@/tests/fixtures/environment";

const NOW = new Date("2026-08-01T20:00:00.000Z");

describe("Phase-33 document provider runtime-ledger binding", () => {
  it("binds S3 and ClamAV contract adapters to mode, secret version and safe config", () => {
    const environment = contractEnvironment();
    const bindings = [
      documentObjectStoreActivationBinding(environment),
      documentScannerActivationBinding(environment),
    ];

    for (const binding of bindings) {
      expect(binding).not.toBeNull();
      expect(binding!.expectedMode).toBe("ALLOWLIST");
      expect(binding!.expectedSecretVersionRef).toMatch(/^phase33-/u);
      expect(binding!.expectedConfigurationDigest).toMatch(/^[a-f0-9]{64}$/u);

      const activation = record(binding!);
      expect(
        resolveProviderActivation({
          activation,
          adapterKey: binding!.adapterKey,
          adapterVersion: "v1",
          environment: "ci",
          expectedConfigurationDigest:
            binding!.expectedConfigurationDigest,
          expectedMode: binding!.expectedMode,
          expectedSecretVersionRef:
            binding!.expectedSecretVersionRef,
          now: NOW,
          useCase: binding!.useCase,
        }),
      ).toMatchObject({ active: true });
      expect(
        resolveProviderActivation({
          activation,
          adapterKey: binding!.adapterKey,
          adapterVersion: "v1",
          environment: "ci",
          expectedConfigurationDigest: "f".repeat(64),
          expectedMode: binding!.expectedMode,
          expectedSecretVersionRef:
            binding!.expectedSecretVersionRef,
          now: NOW,
          useCase: binding!.useCase,
        }),
      ).toEqual({ active: false, reason: "CONFIGURATION_MISMATCH" });
      expect(
        resolveProviderActivation({
          activation,
          adapterKey: binding!.adapterKey,
          adapterVersion: "v1",
          environment: "ci",
          expectedConfigurationDigest:
            binding!.expectedConfigurationDigest,
          expectedMode: binding!.expectedMode,
          expectedSecretVersionRef: "rotated-without-ledger-update",
          now: NOW,
          useCase: binding!.useCase,
        }),
      ).toEqual({ active: false, reason: "SECRET_VERSION_MISMATCH" });
    }
  });
});

function contractEnvironment() {
  return parseEnvironment(
    createValidEnvironment({
      APP_ENV: "ci",
      NODE_ENV: "production",
      APP_URL: "https://localhost:3443",
      DATABASE_URL:
        "postgresql://ci:ci-only@127.0.0.1:5432/swisstalenthub_ci?schema=public",
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
    }),
  );
}

function record(
  binding: NonNullable<
    ReturnType<typeof documentObjectStoreActivationBinding>
  >,
): ProviderActivationRecord {
  return {
    adapterKey: binding.adapterKey,
    adapterVersion: "v1",
    approvalRef: "approval:phase33-contract",
    configurationDigest: binding.expectedConfigurationDigest,
    contractRef: "contract:phase33-contract",
    dpaRef: "dpa:phase33-contract",
    effectiveAt: NOW,
    environment: "ci",
    evidenceDigest: "a".repeat(64),
    expiresAt: null,
    health: "HEALTHY",
    healthCheckedAt: NOW,
    killSwitchEngaged: false,
    mode: binding.expectedMode,
    owner: "Security / Documents",
    quotaUnits: 1_000,
    region: binding.region,
    revokedAt: null,
    runbookRef: "codex-plan/runbooks/provider-activation.md",
    secretVersionRef: binding.expectedSecretVersionRef ?? null,
    sustainableCapacity: 1_000,
    unitCostMicros: 1n,
    unitCostSource: "contract:phase33",
    useCase: binding.useCase,
  };
}
