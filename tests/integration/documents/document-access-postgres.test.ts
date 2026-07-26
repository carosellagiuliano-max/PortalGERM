import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  consumeDocumentReadGrant,
  issueDocumentReadGrant,
  revokeDocumentReadGrant,
} from "@/lib/documents/vault-service";
import {
  createDocumentVaultHarness,
  seedVaultApplication,
  seedVaultCandidate,
  uploadCleanCandidateCv,
} from "@/tests/fixtures/document-vault";

describe("Phase 21 single-object document access", () => {
  let harness: Awaited<ReturnType<typeof createDocumentVaultHarness>>;

  beforeAll(async () => {
    harness = await createDocumentVaultHarness("phase21_document_access");
  }, 120_000);

  afterAll(async () => {
    await harness.dispose();
  });

  it("allows the candidate exactly one verified read and rejects token replay", async () => {
    const candidate = await seedVaultCandidate(harness);
    const bytes = Buffer.from("%PDF-1.4\ncandidate-read\n%%EOF", "utf8");
    const document = await uploadCleanCandidateCv(harness, candidate, { bytes });
    const grant = await issueDocumentReadGrant(
      {
        actorUserId: candidate.userId,
        documentVersionId: document.documentVersionId,
        correlationId: randomUUID(),
      },
      harness.dependencies,
    );
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;

    const first = await consumeDocumentReadGrant(
      {
        actorUserId: candidate.userId,
        token: grant.token,
        correlationId: randomUUID(),
      },
      harness.dependencies,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await collect(first.body)).toEqual(bytes);
    expect(first.sizeBytes).toBe(bytes.length);

    await expect(
      consumeDocumentReadGrant(
        {
          actorUserId: candidate.userId,
          token: grant.token,
          correlationId: randomUUID(),
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  }, 120_000);

  it("allows the owning company but hides foreign application/version pairs", async () => {
    const candidate = await seedVaultCandidate(harness);
    const document = await uploadCleanCandidateCv(harness, candidate);
    const application = await seedVaultApplication(harness, {
      candidate,
      document,
    });
    const ownerGrant = await issueDocumentReadGrant(
      {
        actorUserId: application.employerUserId,
        documentVersionId: document.documentVersionId,
        applicationId: application.applicationId,
        companyId: application.companyId,
        membershipId: application.membershipId,
        correlationId: randomUUID(),
      },
      harness.dependencies,
    );
    expect(ownerGrant.ok).toBe(true);

    const foreignCandidate = await seedVaultCandidate(harness);
    const foreignDocument = await uploadCleanCandidateCv(
      harness,
      foreignCandidate,
    );
    const foreignApplication = await seedVaultApplication(harness, {
      candidate: foreignCandidate,
      document: foreignDocument,
    });
    await expect(
      issueDocumentReadGrant(
        {
          actorUserId: application.employerUserId,
          documentVersionId: document.documentVersionId,
          applicationId: foreignApplication.applicationId,
          companyId: application.companyId,
          membershipId: application.membershipId,
          correlationId: randomUUID(),
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  }, 120_000);

  it("requires a live recruiter assignment at issue and consume time", async () => {
    const candidate = await seedVaultCandidate(harness);
    const document = await uploadCleanCandidateCv(harness, candidate);
    const application = await seedVaultApplication(harness, {
      candidate,
      document,
      employerRole: "RECRUITER",
      assignment: false,
    });
    const input = {
      actorUserId: application.employerUserId,
      documentVersionId: document.documentVersionId,
      applicationId: application.applicationId,
      companyId: application.companyId,
      membershipId: application.membershipId,
      correlationId: randomUUID(),
    };
    await expect(
      issueDocumentReadGrant(input, harness.dependencies),
    ).resolves.toEqual({ ok: false, code: "NOT_AUTHORIZED" });

    const now = new Date();
    const assignment = await harness.database.jobAssignment.create({
      data: {
        membershipId: application.membershipId,
        companyId: application.companyId,
        jobId: application.jobId,
        userId: application.employerUserId,
        role: "PIPELINE",
        status: "ACTIVE",
        assignedByUserId: application.employerUserId,
        validFrom: now,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    const grant = await issueDocumentReadGrant(
      { ...input, correlationId: randomUUID() },
      harness.dependencies,
    );
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;

    await harness.database.jobAssignment.update({
      where: { id: assignment.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await expect(
      consumeDocumentReadGrant(
        {
          actorUserId: application.employerUserId,
          token: grant.token,
          correlationId: randomUUID(),
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "GRANT_REVOKED" });
  }, 120_000);

  it("rechecks membership, user status, expiry and explicit revocation before provider read", async () => {
    const candidate = await seedVaultCandidate(harness);
    const document = await uploadCleanCandidateCv(harness, candidate);
    const application = await seedVaultApplication(harness, {
      candidate,
      document,
    });
    const base = {
      actorUserId: application.employerUserId,
      documentVersionId: document.documentVersionId,
      applicationId: application.applicationId,
      companyId: application.companyId,
      membershipId: application.membershipId,
    };
    const issuedAt = new Date("2026-07-26T12:00:00.000Z");
    const expiring = await issueDocumentReadGrant(
      { ...base, correlationId: randomUUID() },
      { ...harness.dependencies, now: issuedAt },
    );
    expect(expiring.ok).toBe(true);
    if (!expiring.ok) return;
    await expect(
      consumeDocumentReadGrant(
        {
          actorUserId: application.employerUserId,
          token: expiring.token,
          correlationId: randomUUID(),
        },
        {
          ...harness.dependencies,
          now: new Date(issuedAt.getTime() + 61_000),
        },
      ),
    ).resolves.toEqual({ ok: false, code: "GRANT_EXPIRED" });

    const revoked = await issueDocumentReadGrant(
      { ...base, correlationId: randomUUID() },
      harness.dependencies,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    await expect(
      revokeDocumentReadGrant(
        {
          actorUserId: application.employerUserId,
          grantId: revoked.grantId,
        },
        harness.database,
      ),
    ).resolves.toBe("REVOKED");
    await expect(
      consumeDocumentReadGrant(
        {
          actorUserId: application.employerUserId,
          token: revoked.token,
          correlationId: randomUUID(),
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "GRANT_REVOKED" });

    const stale = await issueDocumentReadGrant(
      { ...base, correlationId: randomUUID() },
      harness.dependencies,
    );
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    const backupOwnerId = randomUUID();
    const backupOwnerEmail = `backup-${backupOwnerId.slice(0, 8)}@phase21.example.test`;
    await harness.database.user.create({
      data: {
        id: backupOwnerId,
        email: backupOwnerEmail,
        emailNormalized: backupOwnerEmail,
        role: "EMPLOYER",
        status: "ACTIVE",
        dataProvenance: "TEST",
        emailVerifiedAt: new Date(),
        identityAssurance: "VERIFIED_EMAIL",
        updatedAt: new Date(),
      },
    });
    await harness.database.companyMembership.create({
      data: {
        companyId: application.companyId,
        userId: backupOwnerId,
        role: "OWNER",
        status: "ACTIVE",
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await harness.database.companyMembership.update({
      where: { id: application.membershipId },
      data: { status: "SUSPENDED", updatedAt: new Date() },
    });
    await expect(
      consumeDocumentReadGrant(
        {
          actorUserId: application.employerUserId,
          token: stale.token,
          correlationId: randomUUID(),
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "GRANT_REVOKED" });
  }, 120_000);

  it("keeps bulk access fail-closed until the Phase 25 step-up contract exists", async () => {
    const candidate = await seedVaultCandidate(harness);
    const document = await uploadCleanCandidateCv(harness, candidate);
    const environment = {
      ...harness.environment,
      DOCUMENT_BULK_ACCESS: true,
    };
    await expect(
      issueDocumentReadGrant(
        {
          actorUserId: candidate.userId,
          documentVersionId: document.documentVersionId,
          correlationId: randomUUID(),
        },
        { ...harness.dependencies, environment },
      ),
    ).rejects.toThrow(/Phase-25 step-up gate/u);
  }, 120_000);
});

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
