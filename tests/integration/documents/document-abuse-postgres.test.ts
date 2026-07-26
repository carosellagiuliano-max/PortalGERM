import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import {
  createDocumentUploadIntent,
  uploadDocumentIntentBody,
} from "@/lib/documents/vault-service";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";
import {
  chunks,
  createDocumentVaultHarness,
  seedVaultCandidate,
} from "@/tests/fixtures/document-vault";

describe("Phase 21 document abuse and load boundaries", () => {
  let harness: Awaited<ReturnType<typeof createDocumentVaultHarness>>;

  beforeAll(async () => {
    harness = await createDocumentVaultHarness("phase21_document_abuse");
  }, 120_000);

  afterAll(async () => {
    await harness.dispose();
  });

  it("collapses 100 parallel intent attempts to one active CV upload", async () => {
    const candidate = await seedVaultCandidate(harness);
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        createDocumentUploadIntent(
          {
            actorUserId: candidate.userId,
            filename: "parallel.pdf",
            declaredMimeType: "application/pdf",
            expectedSizeBytes: 64,
            idempotencyKey: `parallel-${index}-${randomUUID()}`,
            correlationId: randomUUID(),
          },
          harness.dependencies,
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.ok && result.code === "UPLOAD_CONFLICT",
      ),
    ).toHaveLength(99);
    expect(
      await harness.database.documentUploadIntent.count({
        where: {
          actorUserId: candidate.userId,
          status: { in: ["CREATED", "UPLOADING", "UPLOADED"] },
        },
      }),
    ).toBe(1);
    expect(
      await harness.database.documentVersion.count({
        where: { candidateProfileId: candidate.profileId },
      }),
    ).toBe(1);
  }, 120_000);

  it("rejects declared and streamed oversize before CLEAN or a readable object exists", async () => {
    const candidate = await seedVaultCandidate(harness);
    await expect(
      createDocumentUploadIntent(
        {
          actorUserId: candidate.userId,
          filename: "too-large.pdf",
          declaredMimeType: "application/pdf",
          expectedSizeBytes: 5 * 1024 * 1024 + 1,
          idempotencyKey: `oversize-${randomUUID()}`,
          correlationId: randomUUID(),
        },
        harness.dependencies,
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_UPLOAD",
      detailCode: "FILE_TOO_LARGE",
    });

    const intent = await createDocumentUploadIntent(
      {
        actorUserId: candidate.userId,
        filename: "extra-byte.pdf",
        declaredMimeType: "application/pdf",
        expectedSizeBytes: 16,
        idempotencyKey: `extra-${randomUUID()}`,
        correlationId: randomUUID(),
      },
      harness.dependencies,
    );
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    const actual = Buffer.alloc(17, 0x41);
    await expect(
      uploadDocumentIntentBody(
        {
          actorUserId: candidate.userId,
          intentId: intent.intentId,
          body: chunks(actual, 4),
          declaredContentLength: 16,
          correlationId: randomUUID(),
        },
        harness.dependencies,
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "UPLOAD_REJECTED",
      detailCode: "STREAM_TOO_LARGE",
    });
    const version = await harness.database.documentVersion.findUniqueOrThrow({
      where: { id: intent.documentVersionId },
      select: { objectKey: true, status: true },
    });
    expect(version.status).toBe("UPLOADING");
    expect(await harness.objectStore.headObject(version.objectKey)).toBeNull();
    expect(
      await harness.database.documentReadGrant.count({
        where: { documentVersionId: intent.documentVersionId },
      }),
    ).toBe(0);
  }, 120_000);

  it("atomically throttles upload and read velocities and writes only redacted denial metadata", async () => {
    const candidate = await seedVaultCandidate(harness);
    const now = new Date("2026-07-26T14:00:00.000Z");
    const request = {
      sourceIp: "198.51.100.21",
      correlationId: randomUUID(),
    };
    const runtime = {
      database: harness.database,
      environment: harness.environment,
    };
    const uploads = await Promise.all(
      Array.from({ length: 100 }, () =>
        consumeRequestRateLimit(
          "DOCUMENT_UPLOAD_INTENT",
          { userId: candidate.userId },
          request,
          now,
          runtime,
        ),
      ),
    );
    expect(uploads.filter((decision) => decision.allowed)).toHaveLength(30);
    expect(uploads.filter((decision) => !decision.allowed)).toHaveLength(70);
    const uploadDenial = uploads.find((decision) => !decision.allowed);
    expect(uploadDenial).toMatchObject({
      allowed: false,
      status: 429,
      audit: {
        preset: "DOCUMENT_UPLOAD_INTENT",
        scope: "USER",
      },
    });
    if (uploadDenial?.allowed !== false) return;

    await recordRateLimitDenial(
      uploadDenial.audit,
      {
        actorKind: "USER",
        actorUserId: candidate.userId,
        capability: "CANDIDATE_DOCUMENT_UPLOAD",
        targetId: candidate.userId,
        targetType: "USER",
      },
      {
        database: harness.database,
        environment: harness.environment,
        request,
        now,
      },
    );
    const audit = await harness.database.auditLog.findFirstOrThrow({
      where: {
        actorUserId: candidate.userId,
        action: "RATE_LIMITED",
        capability: "CANDIDATE_DOCUMENT_UPLOAD",
      },
      select: { metadata: true, reasonCode: true, ipHash: true },
    });
    expect(audit).toMatchObject({
      metadata: {
        preset: "DOCUMENT_UPLOAD_INTENT",
        scope: "USER",
      },
      reasonCode: "RATE_LIMITED",
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(
      /filename|bytes|objectKey|signedUrl/iu,
    );
    expect(audit.ipHash).toMatch(/^[A-Za-z0-9._-]+:[a-f0-9]{64}$/u);

    const reads = await Promise.all(
      Array.from({ length: 61 }, () =>
        consumeRequestRateLimit(
          "DOCUMENT_READ_GRANT",
          { userId: candidate.userId },
          { ...request, sourceIp: "198.51.100.22" },
          now,
          runtime,
        ),
      ),
    );
    expect(reads.filter((decision) => decision.allowed)).toHaveLength(60);
    expect(reads.filter((decision) => !decision.allowed)).toHaveLength(1);
  }, 120_000);
});
