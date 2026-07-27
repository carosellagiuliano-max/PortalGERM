import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
} from "@/lib/auth/assurance/step-up-service";
import { recordAndDecideRiskSignal } from "@/lib/security/risk/risk-service";
import {
  assignTrustSafetyCase,
  decideTrustSafetyCase,
} from "@/lib/trust-safety/case-service";
import {
  createPhase25SecurityFixture,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";
import {
  createPhase25TrustCompany,
  trustAdminDependencies,
} from "@/tests/fixtures/phase25-trust";

describe("Phase 25 compromised-company rapid revoke", () => {
  let fixture: Phase25SecurityFixture;

  beforeAll(async () => {
    fixture = await createPhase25SecurityFixture(
      "phase25_compromised_company",
    );
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("keeps an unconfirmed signal observe-only", async () => {
    const scenario = await createPhase25TrustCompany(fixture);
    const result = await recordAndDecideRiskSignal(
      {
        kind: "COMPROMISED_COMPANY",
        subjectType: "COMPANY",
        subjectId: scenario.company.id,
        companyId: scenario.company.id,
        source: "TRUST_REVIEW",
        observedCount: 1,
        evidenceReference: `incident-review:${crypto.randomUUID()}`,
        idempotencyKey: `incident-review:${crypto.randomUUID()}`,
      },
      {
        database: fixture.database,
        correlationId: crypto.randomUUID(),
        mode: "observe",
        now: fixture.now,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      decision: "REVIEW",
      caseStatus: "OPEN",
    });
    expect(
      await fixture.database.company.findUniqueOrThrow({
        where: { id: scenario.company.id },
      }),
    ).toMatchObject({ status: "ACTIVE" });
  });

  it("requires assigned human review and action-bound step-up before cross-domain revoke", async () => {
    const scenario = await createPhase25TrustCompany(fixture);
    const signal = await recordAndDecideRiskSignal(
      {
        kind: "COMPROMISED_COMPANY",
        subjectType: "COMPANY",
        subjectId: scenario.company.id,
        companyId: scenario.company.id,
        source: "INCIDENT_CONFIRMED",
        observedCount: 1,
        evidenceReference: `incident-confirmed:${crypto.randomUUID()}`,
        idempotencyKey: `incident-confirmed:${crypto.randomUUID()}`,
      },
      {
        database: fixture.database,
        correlationId: crypto.randomUUID(),
        mode: "observe",
        recordedByUserId: fixture.trustReviewer.userId,
        now: fixture.now,
      },
    );
    expect(signal.ok).toBe(true);
    if (!signal.ok || signal.value.caseId === null) return;
    const assigned = await assignTrustSafetyCase(
      {
        caseId: signal.value.caseId,
        assigneeUserId: fixture.trustReviewer.userId,
        expectedVersion: 1,
        reasonCode: "INCIDENT_TRIAGE",
      },
      trustAdminDependencies(fixture, fixture.trustReviewer),
    );
    expect(assigned).toEqual({
      ok: true,
      value: { caseId: signal.value.caseId, version: 2 },
    });

    const grant = await issueTrustGrant(
      fixture,
      "TRUST_REVOKE",
      scenario.company.id,
      signal.value.caseId,
    );
    const revoked = await decideTrustSafetyCase(
      {
        caseId: signal.value.caseId,
        expectedVersion: 2,
        decision: "REVOKE",
        reasonCode: "COMPANY_COMPROMISE_CONFIRMED",
        safeNote:
          "Die Firma wurde nach bestätigtem Sicherheitsvorfall vorläufig gesperrt.",
        stepUpEvidenceId: grant.evidenceId,
        stepUpGrantToken: grant.grantToken,
      },
      trustAdminDependencies(fixture, fixture.trustReviewer),
    );
    expect(revoked).toEqual({
      ok: true,
      value: { caseId: signal.value.caseId, version: 3 },
    });

    const [company, job, verification, session, trustCase, effects] =
      await Promise.all([
        fixture.database.company.findUniqueOrThrow({
          where: { id: scenario.company.id },
        }),
        fixture.database.job.findUniqueOrThrow({
          where: { id: scenario.job.id },
        }),
        fixture.database.companyVerificationRequest.findUniqueOrThrow({
          where: { id: scenario.verification.id },
        }),
        fixture.database.session.findUniqueOrThrow({
          where: { id: fixture.employer.sessionId },
        }),
        fixture.database.trustSafetyCase.findUniqueOrThrow({
          where: { id: signal.value.caseId },
        }),
        fixture.database.trustSafetyContainmentEffect.findMany({
          where: { trustSafetyCaseId: signal.value.caseId },
        }),
      ]);
    expect(company.status).toBe("SUSPENDED");
    expect(job.status).toBe("PAUSED");
    expect(verification.status).toBe("REVOKED");
    expect(session.revokedAt).toEqual(fixture.now);
    expect(trustCase.status).toBe("REVOKED");
    expect(effects.map(({ effectScope }) => effectScope)).toEqual(
      expect.arrayContaining([
        "COMPANY_STATUS",
        "PUBLIC_JOB",
        "SESSION",
        "COMPANY_VERIFICATION",
      ]),
    );
  });
});

async function issueTrustGrant(
  fixture: Phase25SecurityFixture,
  action: string,
  tenantId: string,
  resourceId: string,
) {
  const dependencies = fixture.stepUpDependencies(fixture.trustReviewer);
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
