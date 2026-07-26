import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDocumentUploadIntent,
  finalizeDocumentUploadIntent,
  scanDocumentVersion,
  uploadDocumentIntentBody,
} from "@/lib/documents/vault-service";
import {
  chunks,
  createDocumentVaultHarness,
  seedVaultCandidate,
} from "@/tests/fixtures/document-vault";

describe("Phase 21 document vault PostgreSQL races", () => {
  let harness: Awaited<ReturnType<typeof createDocumentVaultHarness>>;
  let candidate: Awaited<ReturnType<typeof seedVaultCandidate>>;

  beforeAll(async () => {
    harness = await createDocumentVaultHarness("phase21_vault_races");
    candidate = await seedVaultCandidate(harness);
  }, 120_000);

  afterAll(async () => {
    await harness.dispose();
  });

  it("deduplicates 20 parallel intents, finalizers and scanners to one version and one scan attempt", async () => {
    const bytes = Buffer.from("%PDF-1.4\nrace-contract\n%%EOF", "utf8");
    const idempotencyKey = `race-${randomUUID()}`;
    const intents = await Promise.all(
      Array.from({ length: 20 }, () =>
        createDocumentUploadIntent(
          {
            actorUserId: candidate.userId,
            filename: "race-cv.pdf",
            declaredMimeType: "application/pdf",
            expectedSizeBytes: bytes.length,
            idempotencyKey,
            correlationId: randomUUID(),
          },
          harness.dependencies,
        ),
      ),
    );
    const committed = intents.filter(
      (result): result is Extract<typeof result, { ok: true }> => result.ok,
    );
    expect(committed.length).toBeGreaterThan(0);
    expect(new Set(committed.map((result) => result.intentId))).toHaveLength(1);
    const intent = committed[0]!;
    expect(await harness.database.documentUploadIntent.count()).toBe(1);
    expect(await harness.database.documentVersion.count()).toBe(1);

    const uploads = await Promise.all(
      Array.from({ length: 10 }, () =>
        uploadDocumentIntentBody(
          {
            actorUserId: candidate.userId,
            intentId: intent.intentId,
            body: chunks(bytes, 3),
            declaredContentLength: bytes.length,
            correlationId: randomUUID(),
          },
          harness.dependencies,
        ),
      ),
    );
    expect(uploads.some((result) => result.ok)).toBe(true);
    const persistedIntent =
      await harness.database.documentUploadIntent.findUniqueOrThrow({
        where: { id: intent.intentId },
        select: { status: true },
      });
    expect(persistedIntent.status).toBe("UPLOADED");

    const finalizers = await Promise.all(
      Array.from({ length: 10 }, () =>
        finalizeDocumentUploadIntent(
          { actorUserId: candidate.userId, intentId: intent.intentId },
          harness.dependencies,
        ),
      ),
    );
    expect(finalizers.every((result) => result.ok)).toBe(true);
    expect(
      await harness.database.documentUploadIntent.findUniqueOrThrow({
        where: { id: intent.intentId },
        select: { status: true },
      }),
    ).toEqual({ status: "FINALIZED" });

    const scans = await Promise.all(
      Array.from({ length: 20 }, () =>
        scanDocumentVersion(
          {
            actorUserId: candidate.userId,
            documentVersionId: intent.documentVersionId,
            correlationId: randomUUID(),
          },
          harness.dependencies,
        ),
      ),
    );
    expect(
      scans.filter(
        (result) => result.ok && result.status === "CLEAN",
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      await harness.database.documentScanAttempt.count({
        where: { documentVersionId: intent.documentVersionId },
      }),
    ).toBe(1);
    expect(
      await harness.database.documentVersion.findUniqueOrThrow({
        where: { id: intent.documentVersionId },
        select: { status: true },
      }),
    ).toEqual({ status: "CLEAN" });
  }, 120_000);

  it("rejects a forbidden CLEAN to QUARANTINED state regression at the database boundary", async () => {
    const version = await harness.database.documentVersion.findFirstOrThrow({
      where: { status: "CLEAN" },
      select: { id: true },
    });
    await expect(
      harness.database.documentVersion.update({
        where: { id: version.id },
        data: { status: "QUARANTINED", scanCompletedAt: null },
      }),
    ).rejects.toThrow(/invalid document lifecycle transition/u);
  });
});
