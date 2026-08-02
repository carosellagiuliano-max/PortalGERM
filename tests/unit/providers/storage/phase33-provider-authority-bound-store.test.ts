import { describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { ProviderActivationRecord } from "@/lib/ops/provider-activation-policy";
import type { DocumentObjectStore } from "@/lib/providers/storage/document-object-store";
import { bindObjectStoreToProviderAuthority } from "@/lib/providers/storage/provider-authority-bound-object-store";
import { privacyExportStoreActivationBinding } from "@/lib/privacy/provider-activation-binding";
import { createValidEnvironment } from "@/tests/fixtures/environment";

const NOW = new Date("2026-08-01T21:00:00.000Z");

describe("Phase-33 object-store provider authority", () => {
  it("does no ledger I/O at composition time and blocks every transport call without an exact current activation", async () => {
    const environment = parseEnvironment(
      createValidEnvironment({
        PRIVACY_EXPORT_KEYS: `privacy-v1:${Buffer.alloc(32, 12).toString("base64")}`,
        PRIVACY_EXPORT_STORAGE_MODE: "filesystem_sandbox",
        PRIVACY_EXPORT_STORAGE_ROOT: "C:/phase33/privacy",
      }),
    );
    const binding = privacyExportStoreActivationBinding(environment);
    if (binding === null) throw new Error("Expected privacy binding");
    let activation: ProviderActivationRecord | null = record(binding);
    const findFirst = vi.fn(async () => activation);
    const delegateHead = vi.fn(async () => null);
    const delegate = disabledDelegate(delegateHead);
    const store = bindObjectStoreToProviderAuthority({
      binding,
      database: {
        providerActivation: { findFirst },
      } as unknown as DatabaseClient,
      delegate,
      environment,
      now: () => NOW,
    });

    expect(findFirst).not.toHaveBeenCalled();
    await expect(store.headObject("privacy-export/test")).resolves.toBeNull();
    expect(delegateHead).toHaveBeenCalledTimes(1);

    for (const invalid of [
      { ...record(binding), revokedAt: NOW },
      { ...record(binding), configurationDigest: "f".repeat(64) },
      { ...record(binding), secretVersionRef: "builtin:wrong:v1" },
      null,
    ]) {
      activation = invalid;
      await expect(
        store.headObject("privacy-export/test"),
      ).rejects.toMatchObject({ code: "PROVIDER_DISABLED" });
      expect(delegateHead).toHaveBeenCalledTimes(1);
    }
  });
});

function record(
  binding: NonNullable<ReturnType<typeof privacyExportStoreActivationBinding>>,
): ProviderActivationRecord {
  return {
    adapterKey: binding.adapterKey,
    adapterVersion: binding.adapterVersion,
    approvalRef: "approval:phase33-test",
    configurationDigest: binding.expectedConfigurationDigest,
    contractRef: "contract:phase33-test",
    dpaRef: "dpa:phase33-test",
    effectiveAt: NOW,
    environment: "local",
    evidenceDigest: "a".repeat(64),
    expiresAt: null,
    health: "HEALTHY",
    healthCheckedAt: NOW,
    killSwitchEngaged: false,
    mode: binding.expectedMode,
    owner: "Privacy / Platform",
    quotaUnits: 1_000,
    region: "local-test",
    revokedAt: null,
    runbookRef: "codex-plan/runbooks/provider-activation.md",
    secretVersionRef: binding.expectedSecretVersionRef,
    sustainableCapacity: 1_000,
    unitCostMicros: 0n,
    unitCostSource: "fixture:phase33",
    useCase: binding.useCase,
  };
}

function disabledDelegate(
  headObject: DocumentObjectStore["headObject"],
): DocumentObjectStore {
  return {
    providerClass: "phase33-test",
    storageRegion: "local-test",
    putQuarantined: vi.fn(async () => {
      throw new Error("not used");
    }),
    headObject,
    openVerifiedRead: vi.fn(async () => null),
    listObjects: vi.fn(async () => []),
    deleteObject: vi.fn(async () => "MISSING" as const),
  };
}
