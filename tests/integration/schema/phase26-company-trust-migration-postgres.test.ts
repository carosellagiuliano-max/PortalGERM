import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPhase26CompanyTrustFixture,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";

let fixture: Phase26CompanyTrustFixture | undefined;

beforeAll(async () => {
  fixture = await createPhase26CompanyTrustFixture("migration");
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe.sequential("Phase 26 company trust migration contract", () => {
  it("installs named constraints, append-only triggers and remains idempotent", async () => {
    const current = fixture!;
    const constraints = await current.database.$queryRaw<
      { name: string }[]
    >`
      SELECT constraint_name AS "name"
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND constraint_name IN (
          'company_verification_evidence_digest_check',
          'company_verification_evidence_validity_check',
          'company_verification_decision_dual_approval_check',
          'company_trust_projection_level_check',
          'document_subject_purpose_check'
        )
      ORDER BY constraint_name
    `;
    expect(constraints.map(({ name }) => name)).toEqual([
      "company_trust_projection_level_check",
      "company_verification_decision_dual_approval_check",
      "company_verification_evidence_digest_check",
      "company_verification_evidence_validity_check",
      "document_subject_purpose_check",
    ]);
    const triggers = await current.database.$queryRaw<{ name: string }[]>`
      SELECT tgname AS "name"
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'phase26_company_verification_check_append_only',
          'phase26_company_verification_decision_append_only',
          'phase26_company_verification_evidence_provenance'
        )
      ORDER BY tgname
    `;
    expect(triggers).toHaveLength(3);

    const request = await current.createPendingRequest();
    await expect(
      current.database.companyVerificationEvidence.create({
        data: {
          id: randomUUID(),
          verificationRequestId: request.id,
          companyId: current.companyId,
          createdByUserId: current.owner.userId,
          type: "UID_REGISTER",
          scope: "COMPANY_IDENTITY",
          status: "VALID",
          source: "invalid_window_fixture",
          responseDigest: "a".repeat(64),
          checkedAt: current.now,
          validFrom: new Date(current.now.getTime() + 1_000),
          validTo: current.now,
        },
      }),
    ).rejects.toThrow();
    expect(
      await current.database.companyVerificationEvidence.count({
        where: { verificationRequestId: request.id },
      }),
    ).toBe(0);

    const before = await modelCounts(current);
    await current.migrated.migrate();
    expect(await modelCounts(current)).toEqual(before);
  }, 120_000);
});

async function modelCounts(current: Phase26CompanyTrustFixture) {
  const [requests, evidence, decisions, projections] = await Promise.all([
    current.database.companyVerificationRequest.count(),
    current.database.companyVerificationEvidence.count(),
    current.database.companyVerificationDecision.count(),
    current.database.companyTrustProjection.count(),
  ]);
  return { requests, evidence, decisions, projections };
}
