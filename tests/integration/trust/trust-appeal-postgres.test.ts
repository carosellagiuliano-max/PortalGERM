import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
} from "@/lib/auth/assurance/step-up-service";
import {
  COMPANY_TRUST_POLICY_V2,
  companyTrustEvidenceDigest,
} from "@/lib/companies/verification/policy-v2";
import { recordAndDecideRiskSignal } from "@/lib/security/risk/risk-service";
import {
  assignTrustSafetyCase,
  decideTrustSafetyAppeal,
  decideTrustSafetyCase,
  getTrustSafetyCase,
  submitTrustSafetyAppeal,
} from "@/lib/trust-safety/case-service";
import {
  createPhase25SecurityFixture,
  type Phase25Actor,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";
import {
  createPhase25TrustCompany,
  trustAdminDependencies,
} from "@/tests/fixtures/phase25-trust";

describe("Phase 25 false-positive appeal and restore", () => {
  let fixture: Phase25SecurityFixture;

  beforeAll(async () => {
    fixture = await createPhase25SecurityFixture("phase25_trust_appeal");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("permits one safe appeal and only an independent stepped-up approver can restore", async () => {
    const scenario = await createPhase25TrustCompany(fixture);
    const secretReference = `incident-secret:${crypto.randomUUID()}`;
    const signal = await recordAndDecideRiskSignal(
      {
        kind: "COMPROMISED_COMPANY",
        subjectType: "COMPANY",
        subjectId: scenario.company.id,
        companyId: scenario.company.id,
        source: "INCIDENT_CONFIRMED",
        observedCount: 1,
        evidenceReference: secretReference,
        idempotencyKey: `appeal-fixture:${crypto.randomUUID()}`,
      },
      {
        database: fixture.database,
        correlationId: crypto.randomUUID(),
        mode: "observe",
        now: fixture.now,
      },
    );
    if (!signal.ok || signal.value.caseId === null) {
      throw new Error("Expected trust case.");
    }
    await assignTrustSafetyCase(
      {
        caseId: signal.value.caseId,
        assigneeUserId: fixture.trustReviewer.userId,
        expectedVersion: 1,
        reasonCode: "FALSE_POSITIVE_REVIEW",
      },
      trustAdminDependencies(fixture, fixture.trustReviewer),
    );
    const holdGrant = await issueTrustGrant(
      fixture,
      fixture.trustReviewer,
      "TRUST_HOLD",
      scenario.company.id,
      signal.value.caseId,
    );
    const held = await decideTrustSafetyCase(
      {
        caseId: signal.value.caseId,
        expectedVersion: 2,
        decision: "HOLD",
        reasonCode: "MANUAL_REVIEW_HOLD",
        safeNote:
          "Die Sichtbarkeit wurde während einer unabhängigen Sicherheitsprüfung pausiert.",
        stepUpEvidenceId: holdGrant.evidenceId,
        stepUpGrantToken: holdGrant.grantToken,
      },
      trustAdminDependencies(fixture, fixture.trustReviewer),
    );
    expect(held.ok).toBe(true);

    const appealed = await submitTrustSafetyAppeal(
      {
        caseId: signal.value.caseId,
        safeStatement:
          "Wir haben den Vorfall geprüft und bitten mit aktualisierten Nachweisen um erneute Prüfung.",
      },
      {
        database: fixture.database,
        actorUserId: fixture.employer.userId,
        correlationId: crypto.randomUUID(),
        now: new Date(fixture.now.getTime() + 1_000),
      },
    );
    expect(appealed.ok).toBe(true);
    if (!appealed.ok) return;
    expect(
      await submitTrustSafetyAppeal(
        {
          caseId: signal.value.caseId,
          safeStatement:
            "Ein zweiter paralleler Rechtsbehelf darf nicht angelegt werden.",
        },
        {
          database: fixture.database,
          actorUserId: fixture.employer.userId,
          correlationId: crypto.randomUUID(),
          now: new Date(fixture.now.getTime() + 2_000),
        },
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });

    const selfGrant = await issueTrustGrant(
      fixture,
      fixture.trustReviewer,
      "TRUST_APPEAL_REJECT",
      scenario.company.id,
      signal.value.caseId,
    );
    expect(
      await decideTrustSafetyAppeal(
        {
          appealId: appealed.value.appealId,
          decision: "REJECT",
          reasonCode: "CASE_OWNER_SELF_DECISION",
          expectedCaseVersion: 4,
          stepUpEvidenceId: selfGrant.evidenceId,
          stepUpGrantToken: selfGrant.grantToken,
        },
        trustAdminDependencies(fixture, fixture.trustReviewer),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });

    const reverifiedAt = new Date(fixture.now.getTime() + 3_000);
    await createFreshStrongTrust(
      fixture,
      scenario.company.id,
      scenario.verification.id,
      reverifiedAt,
    );
    const restoreAt = new Date(reverifiedAt.getTime() + 1_000);
    const restoreGrant = await issueTrustGrant(
      fixture,
      fixture.trustApprover,
      "TRUST_APPEAL_APPROVE",
      scenario.company.id,
      signal.value.caseId,
      restoreAt,
    );
    const restored = await decideTrustSafetyAppeal(
      {
        appealId: appealed.value.appealId,
        decision: "APPROVE",
        reasonCode: "REVERIFICATION_CONFIRMED",
        expectedCaseVersion: 4,
        stepUpEvidenceId: restoreGrant.evidenceId,
        stepUpGrantToken: restoreGrant.grantToken,
      },
      trustAdminDependencies(fixture, fixture.trustApprover, restoreAt),
    );
    expect(restored.ok).toBe(true);

    const [company, job, trustCase, ownerSession, safeDto] = await Promise.all([
      fixture.database.company.findUniqueOrThrow({
        where: { id: scenario.company.id },
      }),
      fixture.database.job.findUniqueOrThrow({
        where: { id: scenario.job.id },
      }),
      fixture.database.trustSafetyCase.findUniqueOrThrow({
        where: { id: signal.value.caseId },
      }),
      fixture.database.session.findUniqueOrThrow({
        where: { id: fixture.employer.sessionId },
      }),
      getTrustSafetyCase(
        signal.value.caseId,
        trustAdminDependencies(fixture, fixture.trustReviewer),
      ),
    ]);
    expect(company.status).toBe("ACTIVE");
    expect(job.status).toBe("PUBLISHED");
    expect(trustCase.status).toBe("RESOLVED");
    expect(ownerSession.revokedAt).not.toBeNull();
    expect(JSON.stringify(safeDto)).not.toContain(secretReference);
    expect(JSON.stringify(safeDto)).not.toContain("evidenceDigest");
  });
});

async function issueTrustGrant(
  fixture: Phase25SecurityFixture,
  actor: Phase25Actor,
  action: string,
  tenantId: string,
  resourceId: string,
  now = fixture.now,
) {
  const dependencies = fixture.stepUpDependencies(actor, now);
  const challenge = await beginStepUpChallenge(
    {
      purpose: "TRUST_SAFETY",
      action,
      tenantId,
      resourceId,
    },
    dependencies,
  );
  if (!challenge.ok) throw new Error(challenge.code);
  const grant = await completeStepUpChallenge(
    {
      challengeId: challenge.value.challengeId,
      challengeToken: challenge.value.challengeToken,
    },
    dependencies,
  );
  if (!grant.ok) throw new Error(grant.code);
  return grant.value;
}

async function createFreshStrongTrust(
  fixture: Phase25SecurityFixture,
  companyId: string,
  supersedesRequestId: string,
  verifiedAt: Date,
) {
  const validTo = new Date(verifiedAt.getTime() + 180 * 86_400_000);
  const request = await fixture.database.companyVerificationRequest.create({
    data: {
      companyId,
      requestedByUserId: fixture.employer.userId,
      supersedesRequestId,
      assignedReviewerUserId: fixture.trustReviewer.userId,
      status: "VERIFIED",
      riskLevel: "NORMAL",
      policyVersion: COMPANY_TRUST_POLICY_V2.version,
      priority: 80,
      assignedAt: verifiedAt,
      reviewStartedAt: verifiedAt,
      reviewDueAt: new Date(verifiedAt.getTime() + 3 * 86_400_000),
      decidedAt: verifiedAt,
      createdAt: verifiedAt,
    },
  });
  const challenge = await fixture.database.companyDomainChallenge.create({
    data: {
      verificationRequestId: request.id,
      companyId,
      issuedByUserId: fixture.employer.userId,
      domain: "phase25.example",
      tokenHash: hash(`phase25-trust-token:${request.id}`),
      proofDigest: hash(`phase25-trust-proof:${request.id}`),
      status: "VERIFIED",
      issuedAt: verifiedAt,
      expiresAt: validTo,
      verifiedAt,
      createdAt: verifiedAt,
    },
  });
  const [uidEvidence, domainEvidence] = await Promise.all([
    fixture.database.companyVerificationEvidence.create({
      data: {
        verificationRequestId: request.id,
        companyId,
        createdByUserId: fixture.employer.userId,
        type: "UID_REGISTER",
        scope: "COMPANY_IDENTITY",
        status: "VALID",
        source: "phase25_regression_fixture",
        providerKey: "deterministic_sandbox",
        normalizedIdentifier: "CHE-111.222.333",
        responseDigest: hash(`phase25-uid:${request.id}`),
        checkedAt: verifiedAt,
        validFrom: verifiedAt,
        validTo,
        createdAt: verifiedAt,
      },
    }),
    fixture.database.companyVerificationEvidence.create({
      data: {
        verificationRequestId: request.id,
        companyId,
        createdByUserId: fixture.employer.userId,
        domainChallengeId: challenge.id,
        type: "DOMAIN_CHALLENGE",
        scope: "COMPANY_IDENTITY",
        status: "VALID",
        source: "phase25_regression_fixture",
        providerKey: "deterministic_sandbox",
        normalizedIdentifier: "phase25.example",
        responseDigest: hash(`phase25-domain:${request.id}`),
        checkedAt: verifiedAt,
        validFrom: verifiedAt,
        validTo,
        createdAt: verifiedAt,
      },
    }),
  ]);
  const evidenceDigest = companyTrustEvidenceDigest([
    {
      type: uidEvidence.type,
      responseDigest: uidEvidence.responseDigest,
      validTo: uidEvidence.validTo,
    },
    {
      type: domainEvidence.type,
      responseDigest: domainEvidence.responseDigest,
      validTo: domainEvidence.validTo,
    },
  ]);
  const decision = await fixture.database.companyVerificationDecision.create({
    data: {
      verificationRequestId: request.id,
      companyId,
      decidedByUserId: fixture.trustReviewer.userId,
      kind: "APPROVED",
      scope: "COMPANY_IDENTITY",
      riskLevel: "NORMAL",
      policyVersion: COMPANY_TRUST_POLICY_V2.version,
      reasonCode: "REVERIFICATION_CONFIRMED",
      evidenceDigest,
      idempotencyKey: `phase25-regression:${randomUUID()}`,
      validFrom: verifiedAt,
      validTo,
      decidedAt: verifiedAt,
      createdAt: verifiedAt,
    },
  });
  await fixture.database.companyTrustProjection.upsert({
    where: {
      companyId_scope: {
        companyId,
        scope: "COMPANY_IDENTITY",
      },
    },
    create: {
      companyId,
      verificationRequestId: request.id,
      decisionId: decision.id,
      scope: "COMPANY_IDENTITY",
      level: "STRONG",
      status: "ACTIVE",
      riskState: "CLEAR",
      policyVersion: COMPANY_TRUST_POLICY_V2.version,
      evidenceDigest,
      reasonCode: "REVERIFICATION_CONFIRMED",
      verifiedAt,
      expiresAt: validTo,
      changedAt: verifiedAt,
      createdAt: verifiedAt,
    },
    update: {
      verificationRequestId: request.id,
      decisionId: decision.id,
      level: "STRONG",
      status: "ACTIVE",
      riskState: "CLEAR",
      policyVersion: COMPANY_TRUST_POLICY_V2.version,
      evidenceDigest,
      reasonCode: "REVERIFICATION_CONFIRMED",
      verifiedAt,
      expiresAt: validTo,
      changedAt: verifiedAt,
      version: { increment: 1 },
    },
  });
}

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
