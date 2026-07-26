import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reconcileDocumentObjects } from "@/lib/documents/reconciliation";
import {
  createDocumentUploadIntent,
  requestCandidateDocumentDeletion,
} from "@/lib/documents/vault-service";
import type { DocumentObjectStore } from "@/lib/providers/storage/document-object-store";
import {
  chunks,
  createDocumentVaultHarness,
  seedVaultCandidate,
  uploadCleanCandidateCv,
} from "@/tests/fixtures/document-vault";

describe("Phase 21 object/database reconciliation", () => {
  let harness: Awaited<ReturnType<typeof createDocumentVaultHarness>>;

  beforeAll(async () => {
    harness = await createDocumentVaultHarness("phase21_reconciliation");
  }, 120_000);

  afterAll(async () => {
    await harness.dispose();
  });

  it("classifies the full orphan matrix and records an idempotent, non-destructive command", async () => {
    const candidate = await seedVaultCandidate(harness);
    const consistent = await uploadCleanCandidateCv(harness, candidate, {
      filename: "consistent.pdf",
    });

    const missingObject = await uploadCleanCandidateCv(harness, candidate, {
      filename: "missing-object.pdf",
    });
    const missingVersion =
      await harness.database.documentVersion.findUniqueOrThrow({
        where: { id: missingObject.documentVersionId },
        select: {
          objectKey: true,
          providerObjectVersion: true,
          sha256: true,
        },
      });
    await expect(
      harness.objectStore.deleteObject(missingVersion.objectKey, {
        objectVersion: missingVersion.providerObjectVersion,
        sha256: missingVersion.sha256!,
      }),
    ).resolves.toBe("DELETED");

    const deletePending = await uploadCleanCandidateCv(harness, candidate, {
      filename: "delete-pending.pdf",
    });
    await expect(
      requestCandidateDocumentDeletion(
        {
          actorUserId: candidate.userId,
          documentVersionId: deletePending.documentVersionId,
          correlationId: randomUUID(),
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ ok: true, status: "DELETE_PENDING" });

    const held = await uploadCleanCandidateCv(harness, candidate, {
      filename: "held.pdf",
    });
    await harness.database.documentVersion.update({
      where: { id: held.documentVersionId },
      data: { status: "HELD" },
    });

    const incomplete = await createDocumentUploadIntent(
      {
        actorUserId: candidate.userId,
        filename: "incomplete.pdf",
        declaredMimeType: "application/pdf",
        expectedSizeBytes: 32,
        idempotencyKey: `incomplete-${randomUUID()}`,
        correlationId: randomUUID(),
      },
      harness.dependencies,
    );
    expect(incomplete.ok).toBe(true);
    if (!incomplete.ok) return;

    const orphanKey = `candidate-cv/${randomUUID()}`;
    const orphanBytes = Buffer.from("%PDF-1.4\norphan\n%%EOF", "utf8");
    await harness.objectStore.putQuarantined({
      objectKey: orphanKey,
      objectVersion: randomUUID(),
      expectedSizeBytes: orphanBytes.length,
      body: chunks(orphanBytes, 4),
    });

    const consistentVersion =
      await harness.database.documentVersion.findUniqueOrThrow({
        where: { id: consistent.documentVersionId },
        select: { objectKey: true },
      });
    const consistentHash = createHash("sha256")
      .update(consistentVersion.objectKey)
      .digest("hex");
    const mismatchStore = overrideListObjects(harness.objectStore, {
      async listObjects(input) {
        const inventory = await harness.objectStore.listObjects(input);
        return inventory.map((entry) =>
          entry.objectKeyHash === consistentHash
            ? Object.freeze({ ...entry, sha256: "f".repeat(64) })
            : entry,
        );
      },
    });
    const dependencies = {
      database: harness.database,
      environment: harness.environment,
      objectStore: mismatchStore,
    };

    const dryRun = await reconcileDocumentObjects(
      {
        mode: "dry_run",
        correlationId: randomUUID(),
      },
      dependencies,
    );
    expect(dryRun.ok).toBe(true);
    if (!dryRun.ok) return;
    expect(dryRun.changed).toBe(0);
    expect(await harness.database.objectLifecycleOutcome.count()).toBe(0);
    expect(new Set(dryRun.findings.map((finding) => finding.kind))).toEqual(
      new Set([
        "CHECKSUM_MISMATCH",
        "DB_WITHOUT_OBJECT",
        "DELETE_PENDING",
        "LEGAL_HOLD",
        "INCOMPLETE_UPLOAD",
        "OBJECT_WITHOUT_DB",
      ]),
    );

    const first = await reconcileDocumentObjects(
      {
        mode: "command",
        correlationId: randomUUID(),
      },
      dependencies,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.changed).toBe(first.findings.length);
    expect(first.findings).toEqual(dryRun.findings);
    expect(
      await harness.database.documentUploadIntent.findUniqueOrThrow({
        where: { id: incomplete.intentId },
        select: { status: true, failureCode: true },
      }),
    ).toEqual({
      status: "ABORTED",
      failureCode: "RECONCILED_INCOMPLETE",
    });

    const second = await reconcileDocumentObjects(
      {
        mode: "command",
        correlationId: randomUUID(),
      },
      dependencies,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(0);
    expect(
      await harness.database.objectLifecycleOutcome.count(),
    ).toBe(first.findings.length);
    expect(
      await harness.database.documentVersion.findUniqueOrThrow({
        where: { id: held.documentVersionId },
        select: { status: true },
      }),
    ).toEqual({ status: "HELD" });
    expect(
      await harness.database.documentVersion.findUniqueOrThrow({
        where: { id: deletePending.documentVersionId },
        select: { status: true },
      }),
    ).toEqual({ status: "DELETE_PENDING" });
    expect(await harness.objectStore.headObject(orphanKey)).not.toBeNull();
  }, 120_000);

  it("reports a provider failure without falling back or mutating lifecycle evidence", async () => {
    const before = await harness.database.objectLifecycleOutcome.count();
    const degraded = overrideListObjects(harness.objectStore, {
      async listObjects() {
        throw new Error("synthetic provider timeout");
      },
    });
    await expect(
      reconcileDocumentObjects(
        { mode: "command", correlationId: randomUUID() },
        {
          database: harness.database,
          environment: harness.environment,
          objectStore: degraded,
        },
      ),
    ).resolves.toEqual({ ok: false, code: "PROVIDER_DEGRADED" });
    expect(await harness.database.objectLifecycleOutcome.count()).toBe(before);
  });
});

function overrideListObjects(
  store: DocumentObjectStore,
  override: Pick<DocumentObjectStore, "listObjects">,
): DocumentObjectStore {
  return Object.freeze({
    providerClass: store.providerClass,
    storageRegion: store.storageRegion,
    putQuarantined: (input) => store.putQuarantined(input),
    headObject: (objectKey) => store.headObject(objectKey),
    openVerifiedRead: (objectKey) => store.openVerifiedRead(objectKey),
    listObjects: override.listObjects,
    deleteObject: (objectKey, expected) =>
      store.deleteObject(objectKey, expected),
  });
}
