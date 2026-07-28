import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acceptCompanyInvitation,
  inspectCompanyInvitation,
} from "@/lib/employer/team";
import {
  createPhase27PersonaFixture,
  type Phase27Actor,
  type Phase27PersonaFixture,
} from "@/tests/fixtures/phase27-persona";

describe.sequential("Phase 27 invitations for an existing identity", () => {
  let fixture: Phase27PersonaFixture;

  beforeAll(async () => {
    fixture = await createPhase27PersonaFixture("invitations");
  }, 120_000);

  afterAll(async () => {
    await fixture.dispose();
  });

  it("creates the employer persona and exact tenant membership once after a bound step-up", async () => {
    const invitation = await fixture.createInvitation({
      companyId: fixture.companyAId,
      inviteeEmail: fixture.candidate.email,
      intendedRole: "VIEWER",
    });
    await expect(
      inspectCompanyInvitation(
        invitation.rawToken,
        fixture.database,
        {
          id: fixture.candidate.userId,
          email: fixture.candidate.email,
          role: fixture.candidate.identityRole,
        },
        fixture.now,
        true,
      ),
    ).resolves.toMatchObject({
      state: "READY",
      invitationId: invitation.invitationId,
      companyId: fixture.companyAId,
      requiresPersonaStepUp: true,
    });

    expect(
      await acceptCompanyInvitation(
        invitation.rawToken,
        userInput(fixture.candidate),
        dependencies(fixture, fixture.candidate),
      ),
    ).toEqual({ ok: false, code: "STEP_UP_REQUIRED" });

    const wrongScope = await fixture.issueGrant(fixture.candidate, {
      purpose: "IDENTITY_PERSONA",
      action: "PERSONA_EMPLOYER_CREATE",
      tenantId: fixture.companyBId,
      resourceId: invitation.invitationId,
    });
    expect(
      await acceptCompanyInvitation(
        invitation.rawToken,
        userInput(fixture.candidate),
        dependencies(fixture, fixture.candidate),
        {
          stepUpEvidenceId: wrongScope.evidenceId,
          stepUpGrantToken: wrongScope.grantToken,
        },
      ),
    ).toEqual({ ok: false, code: "STEP_UP_REQUIRED" });

    const grant = await fixture.issueGrant(fixture.candidate, {
      purpose: "IDENTITY_PERSONA",
      action: "PERSONA_EMPLOYER_CREATE",
      tenantId: fixture.companyAId,
      resourceId: invitation.invitationId,
    });
    const results = await Promise.all([
      acceptCompanyInvitation(
        invitation.rawToken,
        userInput(fixture.candidate),
        dependencies(fixture, fixture.candidate),
        {
          stepUpEvidenceId: grant.evidenceId,
          stepUpGrantToken: grant.grantToken,
        },
      ),
      acceptCompanyInvitation(
        invitation.rawToken,
        userInput(fixture.candidate),
        dependencies(fixture, fixture.candidate),
        {
          stepUpEvidenceId: grant.evidenceId,
          stepUpGrantToken: grant.grantToken,
        },
      ),
    ]);
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results.filter(({ ok }) => !ok)).toHaveLength(1);

    const [assignment, memberships, notification, audit] = await Promise.all([
      fixture.database.personaAssignment.findUnique({
        where: {
          userId_kind: {
            userId: fixture.candidate.userId,
            kind: "EMPLOYER",
          },
        },
      }),
      fixture.database.companyMembership.findMany({
        where: { userId: fixture.candidate.userId },
      }),
      fixture.database.notification.findMany({
        where: {
          recipientUserId: fixture.candidate.userId,
          kind: "TEAM_MEMBERSHIP_CHANGED",
        },
      }),
      fixture.database.auditLog.findMany({
        where: {
          actorUserId: fixture.candidate.userId,
          action: { in: ["PERSONA_ASSIGNMENT_CHANGED", "INVITATION_ACCEPTED"] },
        },
      }),
    ]);
    expect(assignment).toMatchObject({
      kind: "EMPLOYER",
      status: "ACTIVE",
      source: "COMPANY_INVITATION",
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      companyId: fixture.companyAId,
      status: "ACTIVE",
      role: "VIEWER",
    });
    expect(notification).toHaveLength(1);
    expect(audit.map(({ action }) => action).sort()).toEqual([
      "INVITATION_ACCEPTED",
      "PERSONA_ASSIGNMENT_CHANGED",
    ]);
    expect(
      await fixture.database.companyMembership.count({
        where: {
          companyId: fixture.companyBId,
          userId: fixture.candidate.userId,
        },
      }),
    ).toBe(0);
    expect(
      await acceptCompanyInvitation(
        invitation.rawToken,
        userInput(fixture.candidate),
        dependencies(fixture, fixture.candidate),
      ),
    ).toEqual({ ok: false, code: "INVALID" });
  });

  it("keeps expired and revoked invitations generic and side-effect free", async () => {
    const expired = await fixture.createInvitation({
      companyId: fixture.companyBId,
      inviteeEmail: fixture.admin.email,
      createdAt: new Date(fixture.now.getTime() - 2 * 86_400_000),
      expiresAt: new Date(fixture.now.getTime() - 86_400_000),
    });
    const revoked = await fixture.createInvitation({
      companyId: fixture.companyAId,
      inviteeEmail: fixture.admin.email,
    });
    await fixture.database.companyInvitation.update({
      where: { id: revoked.invitationId },
      data: {
        status: "REVOKED",
        revokedAt: fixture.now,
      },
    });

    for (const invitation of [expired, revoked]) {
      expect(
        await acceptCompanyInvitation(
          invitation.rawToken,
          userInput(fixture.admin),
          dependencies(fixture, fixture.admin),
        ),
      ).toEqual({ ok: false, code: "INVALID" });
    }
    expect(
      await fixture.database.personaAssignment.count({
        where: { userId: fixture.admin.userId, kind: "EMPLOYER" },
      }),
    ).toBe(0);
    expect(
      await fixture.database.companyMembership.count({
        where: { userId: fixture.admin.userId },
      }),
    ).toBe(0);
  });
});

function userInput(actor: Phase27Actor) {
  return {
    id: actor.userId,
    email: actor.email,
    role: actor.identityRole,
  };
}

function dependencies(
  fixture: Phase27PersonaFixture,
  actor: Phase27Actor,
) {
  return {
    database: fixture.database,
    environment: fixture.environment,
    request: fixture.request(),
    now: fixture.now,
    stepUpActor: {
      sessionId: actor.sessionId,
      globalRole: actor.identityRole,
    },
  } as const;
}
