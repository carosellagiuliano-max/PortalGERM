import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
  consumeStepUpGrant,
} from "@/lib/auth/assurance/step-up-service";
import {
  createPhase25SecurityFixture,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";

describe("Phase 25 non-admin step-up grants", () => {
  let fixture: Phase25SecurityFixture;

  beforeAll(async () => {
    fixture = await createPhase25SecurityFixture(
      "phase25_non_admin_step_up",
    );
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("binds a fresh grant to actor, session, action, tenant and resource once", async () => {
    const tenant = await fixture.database.company.create({
      data: {
        name: "Phase 25 Step-up Tenant",
        slug: `phase25-step-up-${crypto.randomUUID()}`,
        status: "DRAFT",
      },
    });
    const tenantId = tenant.id;
    const resourceId = crypto.randomUUID();
    const issued = await issueGrant(
      fixture,
      fixture.employer,
      {
        purpose: "EMPLOYER_TEAM",
        action: "TEAM_ROLE_CHANGE",
        tenantId,
        resourceId,
      },
    );

    const wrongTenant = await fixture.database.$transaction((transaction) =>
      consumeStepUpGrant(transaction, {
        ...issued,
        actor: {
          userId: fixture.employer.userId,
          sessionId: fixture.employer.sessionId,
          role: "EMPLOYER",
          status: "ACTIVE",
        },
        purpose: "EMPLOYER_TEAM",
        action: "TEAM_ROLE_CHANGE",
        tenantId: crypto.randomUUID(),
        resourceId,
        correlationId: crypto.randomUUID(),
        now: fixture.now,
      }),
    );
    expect(wrongTenant).toBe(false);

    const consumed = await fixture.database.$transaction((transaction) =>
      consumeStepUpGrant(transaction, {
        ...issued,
        actor: {
          userId: fixture.employer.userId,
          sessionId: fixture.employer.sessionId,
          role: "EMPLOYER",
          status: "ACTIVE",
        },
        purpose: "EMPLOYER_TEAM",
        action: "TEAM_ROLE_CHANGE",
        tenantId,
        resourceId,
        correlationId: crypto.randomUUID(),
        now: fixture.now,
      }),
    );
    expect(consumed).toBe(true);
    expect(
      await fixture.database.$transaction((transaction) =>
        consumeStepUpGrant(transaction, {
          ...issued,
          actor: {
            userId: fixture.employer.userId,
            sessionId: fixture.employer.sessionId,
            role: "EMPLOYER",
            status: "ACTIVE",
          },
          purpose: "EMPLOYER_TEAM",
          action: "TEAM_ROLE_CHANGE",
          tenantId,
          resourceId,
          correlationId: crypto.randomUUID(),
          now: fixture.now,
        }),
      ),
    ).toBe(false);
  });

  it("rejects cross-actor, cross-purpose and stale grants without consuming them", async () => {
    const resourceId = crypto.randomUUID();
    const issued = await issueGrant(
      fixture,
      fixture.candidate,
      {
        purpose: "CANDIDATE_PRIVACY",
        action: "PRIVACY_DELETE",
        resourceId,
      },
    );
    const base = {
      ...issued,
      purpose: "CANDIDATE_PRIVACY",
      action: "PRIVACY_DELETE",
      resourceId,
      correlationId: crypto.randomUUID(),
    };
    expect(
      await fixture.database.$transaction((transaction) =>
        consumeStepUpGrant(transaction, {
          ...base,
          actor: {
            userId: fixture.employer.userId,
            sessionId: fixture.employer.sessionId,
            role: "EMPLOYER",
            status: "ACTIVE",
          },
          now: fixture.now,
        }),
      ),
    ).toBe(false);
    expect(
      await fixture.database.$transaction((transaction) =>
        consumeStepUpGrant(transaction, {
          ...base,
          actor: {
            userId: fixture.candidate.userId,
            sessionId: fixture.candidate.sessionId,
            role: "CANDIDATE",
            status: "ACTIVE",
          },
          purpose: "ACCOUNT_SECURITY",
          action: "LOGIN_EMAIL_CHANGE",
          now: fixture.now,
        }),
      ),
    ).toBe(false);
    expect(
      await fixture.database.$transaction((transaction) =>
        consumeStepUpGrant(transaction, {
          ...base,
          actor: {
            userId: fixture.candidate.userId,
            sessionId: fixture.candidate.sessionId,
            role: "CANDIDATE",
            status: "ACTIVE",
          },
          now: new Date(fixture.now.getTime() + 6 * 60_000),
        }),
      ),
    ).toBe(false);
  });

  it("requires current AAL2 before issuing a grant", async () => {
    await fixture.database.sessionAssurance.updateMany({
      where: { userId: fixture.candidate.userId, revokedAt: null },
      data: { revokedAt: fixture.now },
    });
    const challenge = await beginStepUpChallenge(
      {
        purpose: "CANDIDATE_PRIVACY",
        action: "PRIVACY_EXPORT",
        resourceId: crypto.randomUUID(),
      },
      fixture.stepUpDependencies(fixture.candidate),
    );
    expect(challenge.ok).toBe(true);
    if (!challenge.ok) return;
    expect(
      await completeStepUpChallenge(
        {
          challengeId: challenge.value.challengeId,
          challengeToken: challenge.value.challengeToken,
        },
        fixture.stepUpDependencies(fixture.candidate),
      ),
    ).toEqual({ ok: false, code: "AAL2_REQUIRED" });
  });
});

async function issueGrant(
  fixture: Phase25SecurityFixture,
  actor: Phase25SecurityFixture["candidate"],
  binding: Readonly<{
    purpose: string;
    action: string;
    tenantId?: string;
    resourceId: string;
  }>,
) {
  const challenge = await beginStepUpChallenge(
    binding,
    fixture.stepUpDependencies(actor),
  );
  expect(challenge.ok).toBe(true);
  if (!challenge.ok) throw new Error(challenge.code);
  const completed = await completeStepUpChallenge(
    {
      challengeId: challenge.value.challengeId,
      challengeToken: challenge.value.challengeToken,
    },
    fixture.stepUpDependencies(actor),
  );
  expect(completed.ok).toBe(true);
  if (!completed.ok) throw new Error(completed.code);
  return Object.freeze({
    evidenceId: completed.value.evidenceId,
    grantToken: completed.value.grantToken,
  });
}
