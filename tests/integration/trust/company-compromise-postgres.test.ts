import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
} from "@/lib/auth/assurance/step-up-service";
import { evaluateCompanyTrustForCompany } from "@/lib/companies/verification/read-model";
import { recordAndDecideRiskSignal } from "@/lib/security/risk/risk-service";
import {
  assignTrustSafetyCase,
  decideTrustSafetyAppeal,
  decideTrustSafetyCase,
  submitTrustSafetyAppeal,
  type TrustSafetyAdminDependencies,
} from "@/lib/trust-safety/case-service";
import {
  createPhase26CompanyTrustFixture,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";
import type { Phase25Actor } from "@/tests/fixtures/phase25-security";

const ENFORCED_TRUST = Object.freeze({
  policyMode: "enforce" as const,
  strongBadge: true,
  publicEligibility: true,
  rapidRevoke: true,
  legacyDemoCompatibility: false,
});

describe("Phase 26 compromised-company trust contract", () => {
  let fixture: Phase26CompanyTrustFixture;

  beforeAll(async () => {
    fixture = await createPhase26CompanyTrustFixture("company_compromise");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("keeps an unconfirmed signal review-only without removing current trust", async () => {
    await fixture.createStrongTrust({
      companyId: fixture.foreignCompanyId,
      requestedByUserId: fixture.foreignOwner.userId,
    });

    const result = await recordAndDecideRiskSignal(
      {
        kind: "COMPROMISED_COMPANY",
        subjectType: "COMPANY",
        subjectId: fixture.foreignCompanyId,
        companyId: fixture.foreignCompanyId,
        source: "TRUST_REVIEW",
        observedCount: 1,
        evidenceReference: `phase26-review:${randomUUID()}`,
        idempotencyKey: `phase26-review:${randomUUID()}`,
      },
      {
        database: fixture.database,
        correlationId: randomUUID(),
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
    const trust = await readTrust(fixture, fixture.foreignCompanyId);
    expect(trust).toMatchObject({
      current: true,
      strongVerified: true,
      publicEligible: true,
      radarEligible: true,
      reason: "STRONG_CURRENT",
    });
    expect(trust.badge).not.toBeNull();
  });

  it("revokes every public/risky surface and requires fresh strong evidence plus independent approval to restore", async () => {
    const initialTrust = await fixture.createStrongTrust();
    expect(await readTrust(fixture, fixture.companyId)).toMatchObject({
      strongVerified: true,
      publicEligible: true,
      radarEligible: true,
    });

    const signal = await recordAndDecideRiskSignal(
      {
        kind: "COMPROMISED_COMPANY",
        subjectType: "COMPANY",
        subjectId: fixture.companyId,
        companyId: fixture.companyId,
        source: "INCIDENT_CONFIRMED",
        observedCount: 1,
        evidenceReference: `phase26-incident:${randomUUID()}`,
        idempotencyKey: `phase26-incident:${randomUUID()}`,
      },
      {
        database: fixture.database,
        correlationId: randomUUID(),
        mode: "observe",
        recordedByUserId: fixture.reviewer.userId,
        now: fixture.now,
      },
    );
    if (!signal.ok || signal.value.caseId === null) {
      throw new Error("Expected a confirmed compromised-company case.");
    }

    expect(
      await assignTrustSafetyCase(
        {
          caseId: signal.value.caseId,
          assigneeUserId: fixture.reviewer.userId,
          expectedVersion: 1,
          reasonCode: "INCIDENT_TRIAGE",
        },
        trustDependencies(fixture, fixture.reviewer, fixture.now),
      ),
    ).toEqual({
      ok: true,
      value: { caseId: signal.value.caseId, version: 2 },
    });
    const revokeGrant = await issueTrustGrant(
      fixture,
      fixture.reviewer,
      "TRUST_REVOKE",
      fixture.companyId,
      signal.value.caseId,
      fixture.now,
    );
    expect(
      await decideTrustSafetyCase(
        {
          caseId: signal.value.caseId,
          expectedVersion: 2,
          decision: "REVOKE",
          reasonCode: "COMPANY_COMPROMISE_CONFIRMED",
          safeNote:
            "Die Firma wurde nach einem bestätigten Sicherheitsvorfall vorläufig gesperrt.",
          stepUpEvidenceId: revokeGrant.evidenceId,
          stepUpGrantToken: revokeGrant.grantToken,
        },
        trustDependencies(fixture, fixture.reviewer, fixture.now),
      ),
    ).toEqual({
      ok: true,
      value: { caseId: signal.value.caseId, version: 3 },
    });

    const [request, company, ownerSession, trustAfterRevoke, effects] =
      await Promise.all([
        fixture.database.companyVerificationRequest.findUniqueOrThrow({
          where: { id: initialTrust.requestId },
        }),
        fixture.database.company.findUniqueOrThrow({
          where: { id: fixture.companyId },
        }),
        fixture.database.session.findUniqueOrThrow({
          where: { id: fixture.owner.sessionId },
        }),
        readTrust(fixture, fixture.companyId),
        fixture.database.trustSafetyContainmentEffect.findMany({
          where: { trustSafetyCaseId: signal.value.caseId },
          orderBy: { effectScope: "asc" },
        }),
      ]);
    expect(request.status).toBe("REVOKED");
    expect(company.status).toBe("SUSPENDED");
    expect(ownerSession.revokedAt).toEqual(fixture.now);
    expect(trustAfterRevoke).toMatchObject({
      current: false,
      strongVerified: false,
      badge: null,
      publicEligible: false,
      radarEligible: false,
    });
    expect(effects.map(({ effectScope }) => effectScope)).toEqual(
      expect.arrayContaining([
        "COMPANY_STATUS",
        "COMPANY_VERIFICATION",
        "SESSION",
      ]),
    );

    const appealedAt = new Date(fixture.now.getTime() + 1_000);
    const appealed = await submitTrustSafetyAppeal(
      {
        caseId: signal.value.caseId,
        safeStatement:
          "Wir haben den Vorfall eingedämmt und reichen neue Nachweise zur unabhängigen Prüfung ein.",
      },
      {
        database: fixture.database,
        actorUserId: fixture.owner.userId,
        correlationId: randomUUID(),
        now: appealedAt,
      },
    );
    expect(appealed.ok).toBe(true);
    if (!appealed.ok) return;

    const blockedRestoreAt = new Date(fixture.now.getTime() + 2_000);
    const blockedGrant = await issueTrustGrant(
      fixture,
      fixture.approver,
      "TRUST_APPEAL_APPROVE",
      fixture.companyId,
      signal.value.caseId,
      blockedRestoreAt,
    );
    expect(
      await decideTrustSafetyAppeal(
        {
          appealId: appealed.value.appealId,
          decision: "APPROVE",
          reasonCode: "REVERIFICATION_REQUIRED",
          expectedCaseVersion: 4,
          stepUpEvidenceId: blockedGrant.evidenceId,
          stepUpGrantToken: blockedGrant.grantToken,
        },
        trustDependencies(fixture, fixture.approver, blockedRestoreAt),
      ),
    ).toEqual({ ok: false, code: "VERIFICATION_REQUIRED" });

    const reverifiedAt = new Date(fixture.now.getTime() + 60_000);
    await fixture.createStrongTrust({
      supersedesRequestId: initialTrust.requestId,
      verifiedAt: reverifiedAt,
    });
    const restoreAt = new Date(reverifiedAt.getTime() + 1_000);
    const restoreGrant = await issueTrustGrant(
      fixture,
      fixture.approver,
      "TRUST_APPEAL_APPROVE",
      fixture.companyId,
      signal.value.caseId,
      restoreAt,
    );
    expect(
      await decideTrustSafetyAppeal(
        {
          appealId: appealed.value.appealId,
          decision: "APPROVE",
          reasonCode: "REVERIFICATION_CONFIRMED",
          expectedCaseVersion: 4,
          stepUpEvidenceId: restoreGrant.evidenceId,
          stepUpGrantToken: restoreGrant.grantToken,
        },
        trustDependencies(fixture, fixture.approver, restoreAt),
      ),
    ).toEqual({
      ok: true,
      value: {
        appealId: appealed.value.appealId,
        caseId: signal.value.caseId,
      },
    });

    const [restoredCompany, restoredCase, restoredTrust] = await Promise.all([
      fixture.database.company.findUniqueOrThrow({
        where: { id: fixture.companyId },
      }),
      fixture.database.trustSafetyCase.findUniqueOrThrow({
        where: { id: signal.value.caseId },
      }),
      readTrust(fixture, fixture.companyId, restoreAt),
    ]);
    expect(restoredCompany.status).toBe("ACTIVE");
    expect(restoredCase.status).toBe("RESOLVED");
    expect(restoredTrust).toMatchObject({
      current: true,
      strongVerified: true,
      publicEligible: true,
      radarEligible: true,
      reason: "STRONG_CURRENT",
    });
  });
});

async function readTrust(
  fixture: Phase26CompanyTrustFixture,
  companyId: string,
  now = fixture.now,
) {
  return evaluateCompanyTrustForCompany(fixture.database, companyId, {
    now,
    environment: "ci",
    activation: ENFORCED_TRUST,
  });
}

function trustDependencies(
  fixture: Phase26CompanyTrustFixture,
  actor: Phase25Actor,
  now: Date,
): TrustSafetyAdminDependencies {
  return Object.freeze({
    actor: {
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      status: "ACTIVE" as const,
      sessionId: actor.sessionId,
    },
    correlationId: randomUUID(),
    database: fixture.database,
    now,
  });
}

async function issueTrustGrant(
  fixture: Phase26CompanyTrustFixture,
  actor: Phase25Actor,
  action: string,
  tenantId: string,
  resourceId: string,
  now: Date,
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
