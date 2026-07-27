import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
} from "@/lib/auth/assurance/step-up-service";
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

    const restoreGrant = await issueTrustGrant(
      fixture,
      fixture.trustApprover,
      "TRUST_APPEAL_APPROVE",
      scenario.company.id,
      signal.value.caseId,
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
      trustAdminDependencies(fixture, fixture.trustApprover),
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
) {
  const dependencies = fixture.stepUpDependencies(actor);
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
