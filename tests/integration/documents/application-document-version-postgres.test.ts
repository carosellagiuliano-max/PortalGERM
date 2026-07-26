import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDocumentUploadIntent,
  finalizeDocumentUploadIntent,
  uploadDocumentIntentBody,
} from "@/lib/documents/vault-service";
import {
  chunks,
  createDocumentVaultHarness,
  seedVaultApplication,
  seedVaultCandidate,
  uploadCleanCandidateCv,
} from "@/tests/fixtures/document-vault";

describe("Phase 21 immutable application document version", () => {
  let harness: Awaited<ReturnType<typeof createDocumentVaultHarness>>;
  let candidate: Awaited<ReturnType<typeof seedVaultCandidate>>;

  beforeAll(async () => {
    harness = await createDocumentVaultHarness("phase21_application_version");
    candidate = await seedVaultCandidate(harness);
  }, 120_000);

  afterAll(async () => {
    await harness.dispose();
  });

  it("keeps a submitted application on v1 after the profile CV is replaced by v2", async () => {
    const v1 = await uploadCleanCandidateCv(harness, candidate, {
      filename: "cv-v1.pdf",
      bytes: Buffer.from("%PDF-1.4\nimmutable-v1\n%%EOF"),
    });
    const application = await seedVaultApplication(harness, {
      candidate,
      document: v1,
    });
    const before =
      await harness.database.applicationSubmissionDocument.findFirstOrThrow({
        where: { applicationId: application.applicationId },
        select: {
          documentVersionId: true,
          storageKeyHash: true,
          safeFilenameSnapshot: true,
        },
      });
    expect(before.documentVersionId).toBe(v1.documentVersionId);

    const v2 = await uploadCleanCandidateCv(harness, candidate, {
      filename: "cv-v2.pdf",
      bytes: Buffer.from("%PDF-1.4\nimmutable-v2\n%%EOF"),
    });
    const after =
      await harness.database.applicationSubmissionDocument.findFirstOrThrow({
        where: { applicationId: application.applicationId },
        select: {
          documentVersionId: true,
          storageKeyHash: true,
          safeFilenameSnapshot: true,
        },
      });
    expect(after).toEqual(before);
    expect(v2.documentVersionId).not.toBe(v1.documentVersionId);
    expect(
      await harness.database.documentVersion.findUniqueOrThrow({
        where: { id: v1.documentVersionId },
        select: { status: true },
      }),
    ).toEqual({ status: "REPLACED" });
    expect(
      await harness.database.document.findFirstOrThrow({
        where: { candidateProfileId: candidate.profileId, purpose: "CV" },
        select: { currentVersionId: true },
      }),
    ).toEqual({ currentVersionId: v2.documentVersionId });
    expect(
      await harness.database.candidateDocumentMetadata.findMany({
        where: { candidateProfileId: candidate.profileId },
        orderBy: { createdAt: "asc" },
        select: { documentVersionId: true, status: true, storageKind: true },
      }),
    ).toEqual([
      {
        documentVersionId: v1.documentVersionId,
        status: "REMOVED",
        storageKind: "VAULT_ENCRYPTED",
      },
      {
        documentVersionId: v2.documentVersionId,
        status: "ACTIVE",
        storageKind: "VAULT_ENCRYPTED",
      },
    ]);
  }, 120_000);

  it("does not project quarantined bytes as an active selectable CV", async () => {
    const bytes = Buffer.from("%PDF-1.4\nstill-quarantined\n%%EOF");
    const intent = await createDocumentUploadIntent(
      {
        actorUserId: candidate.userId,
        filename: "pending.pdf",
        declaredMimeType: "application/pdf",
        expectedSizeBytes: bytes.length,
        idempotencyKey: `pending-${randomUUID()}`,
        correlationId: randomUUID(),
      },
      harness.dependencies,
    );
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    await expect(
      uploadDocumentIntentBody(
        {
          actorUserId: candidate.userId,
          intentId: intent.intentId,
          body: chunks(bytes, 4),
          declaredContentLength: bytes.length,
          correlationId: randomUUID(),
        },
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ ok: true, status: "QUARANTINED" });
    await expect(
      finalizeDocumentUploadIntent(
        { actorUserId: candidate.userId, intentId: intent.intentId },
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(
      await harness.database.candidateDocumentMetadata.findUnique({
        where: { documentVersionId: intent.documentVersionId },
      }),
    ).toBeNull();
    expect(
      await harness.database.documentVersion.findUniqueOrThrow({
        where: { id: intent.documentVersionId },
        select: { status: true },
      }),
    ).toEqual({ status: "QUARANTINED" });
  });
});
