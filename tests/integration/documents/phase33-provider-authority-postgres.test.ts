import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createDocumentUploadIntent,
  uploadDocumentIntentBody,
} from "@/lib/documents/vault-service";
import type { DocumentObjectStore } from "@/lib/providers/storage/document-object-store";
import {
  createDocumentVaultHarness,
  seedVaultCandidate,
} from "@/tests/fixtures/document-vault";

let harness: Awaited<ReturnType<typeof createDocumentVaultHarness>>;

beforeAll(async () => {
  harness = await createDocumentVaultHarness("phase33_provider_authority");
}, 600_000);

afterAll(async () => {
  await harness?.dispose();
});

describe.sequential("Phase-33 document provider authority", () => {
  it("checks exact persisted authority after ownership and before any object-store call", async () => {
    const candidate = await seedVaultCandidate(harness);
    const bytes = Buffer.from("%PDF-1.4\nphase33-ledger\n%%EOF", "utf8");
    const intent = await createDocumentUploadIntent(
      {
        actorUserId: candidate.userId,
        filename: "provider-authority.pdf",
        declaredMimeType: "application/pdf",
        expectedSizeBytes: bytes.length,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
      },
      harness.dependencies,
    );
    if (!intent.ok) throw new Error(intent.code);

    const putQuarantined = vi.fn((input) =>
      harness.objectStore.putQuarantined(input),
    );
    const headObject = vi.fn((key: string) =>
      harness.objectStore.headObject(key),
    );
    const guardedStore: DocumentObjectStore = {
      providerClass: harness.objectStore.providerClass,
      storageRegion: harness.objectStore.storageRegion,
      putQuarantined,
      headObject,
      openVerifiedRead: (key) => harness.objectStore.openVerifiedRead(key),
      listObjects: (input) => harness.objectStore.listObjects(input),
      deleteObject: (key, expected) =>
        harness.objectStore.deleteObject(key, expected),
    };
    const activation =
      await harness.database.providerActivation.findFirstOrThrow({
        where: {
          environment: harness.environment.APP_ENV,
          useCase: "documents.object-store",
        },
      });
    const revokeCurrent = async (reasonCode: string) => {
      const current = await harness.database.providerActivation.findFirst({
        where: {
          environment: harness.environment.APP_ENV,
          useCase: "documents.object-store",
          revokedAt: null,
        },
      });
      if (current === null) return;
      const revokedAt = new Date(
        Math.max(Date.now(), current.effectiveAt?.getTime() ?? 0),
      );
      await harness.database.providerActivation.update({
        where: { id: current.id },
        data: {
          killSwitchEngaged: true,
          revokedAt,
          revokeReasonCode: reasonCode,
        },
      });
    };
    const installReplacement = async (
      overrides: Readonly<{
        adapterKey?: string;
        configurationDigest?: string;
        secretVersionRef?: string | null;
      }> = {},
    ) => {
      await revokeCurrent("TEST_SUPERSEDED");
      const effectiveAt = new Date(
        Math.max(Date.now(), activation.effectiveAt?.getTime() ?? 0),
      );
      return harness.database.providerActivation.create({
        data: {
          environment: activation.environment,
          useCase: activation.useCase,
          adapterKey: overrides.adapterKey ?? activation.adapterKey,
          adapterVersion: activation.adapterVersion,
          mode: activation.mode,
          configurationDigest:
            overrides.configurationDigest ?? activation.configurationDigest,
          secretVersionRef:
            overrides.secretVersionRef === undefined
              ? activation.secretVersionRef
              : overrides.secretVersionRef,
          region: activation.region,
          dpaRef: activation.dpaRef,
          contractRef: activation.contractRef,
          approvalRef: activation.approvalRef,
          evidenceDigest: activation.evidenceDigest,
          owner: activation.owner,
          runbookRef: activation.runbookRef,
          health: activation.health,
          healthCheckedAt: effectiveAt,
          quotaUnits: activation.quotaUnits,
          sustainableCapacity: activation.sustainableCapacity,
          unitCostMicros: activation.unitCostMicros,
          unitCostSource: activation.unitCostSource,
          killSwitchEngaged: false,
          effectiveAt,
          expiresAt: activation.expiresAt,
        },
      });
    };
    const expectUnavailable = async () => {
      await expect(
        uploadDocumentIntentBody(
          {
            actorUserId: candidate.userId,
            intentId: intent.intentId,
            body: chunks(bytes),
            declaredContentLength: bytes.length,
            correlationId: randomUUID(),
          },
          { ...harness.dependencies, objectStore: guardedStore },
        ),
      ).resolves.toEqual({
        ok: false,
        code: "DOCUMENT_VAULT_UNAVAILABLE",
      });
      expect(putQuarantined).not.toHaveBeenCalled();
      expect(headObject).not.toHaveBeenCalled();
    };

    await revokeCurrent("TEST_REVOKED");
    await expectUnavailable();

    await installReplacement({ configurationDigest: "f".repeat(64) });
    await expectUnavailable();

    await installReplacement({
      secretVersionRef: "builtin:wrong-version:v1",
    });
    await expectUnavailable();

    await installReplacement({ adapterKey: "wrong-adapter" });
    await expectUnavailable();

    await installReplacement();
    await expect(
      uploadDocumentIntentBody(
        {
          actorUserId: candidate.userId,
          intentId: intent.intentId,
          body: chunks(bytes),
          declaredContentLength: bytes.length,
          correlationId: randomUUID(),
        },
        { ...harness.dependencies, objectStore: guardedStore },
      ),
    ).resolves.toMatchObject({ ok: true, status: "QUARANTINED" });
    expect(putQuarantined).toHaveBeenCalledTimes(1);
  });
});

async function* chunks(bytes: Uint8Array) {
  yield bytes;
}
