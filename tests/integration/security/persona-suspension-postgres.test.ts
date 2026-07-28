import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  changePersonaAssignmentStatus,
  switchPersonaContext,
} from "@/lib/auth/persona-context";
import {
  createPhase27PersonaFixture,
  type Phase27PersonaFixture,
} from "@/tests/fixtures/phase27-persona";

describe.sequential("Phase 27 suspension scope and session invalidation", () => {
  let fixture: Phase27PersonaFixture;

  beforeAll(async () => {
    fixture = await createPhase27PersonaFixture("suspension");
  }, 120_000);

  afterAll(async () => {
    await fixture.dispose();
  });

  it("suspends only the selected persona and falls back without deleting memberships", async () => {
    const assignment =
      await fixture.database.personaAssignment.findUniqueOrThrow({
        where: {
          userId_kind: {
            userId: fixture.dual.userId,
            kind: "EMPLOYER",
          },
        },
      });
    const grant = await fixture.issueGrant(fixture.dual, {
      purpose: "EMPLOYER_TEAM",
      action: "TEAM_INVITE",
      tenantId: fixture.companyAId,
      resourceId: crypto.randomUUID(),
    });

    expect(
      await changePersonaAssignmentStatus(fixture.database, {
        assignmentId: assignment.id,
        expectedVersion: assignment.version,
        toStatus: "SUSPENDED",
        actorUserId: fixture.dual.userId,
        reasonCode: "PHASE27_SCOPE_TEST",
        correlationId: crypto.randomUUID(),
        now: fixture.now,
      }),
    ).toMatchObject({
      ok: true,
      status: "SUSPENDED",
      version: 2,
    });

    await expect(
      fixture.database.session.findUniqueOrThrow({
        where: { id: fixture.dual.sessionId },
        select: {
          activePortal: true,
          activeCompanyId: true,
          contextVersion: true,
        },
      }),
    ).resolves.toEqual({
      activePortal: "CANDIDATE",
      activeCompanyId: null,
      contextVersion: 2,
    });
    const revokedEvidence =
      await fixture.database.authAssuranceEvidence.findUniqueOrThrow({
        where: { id: grant.evidenceId },
        select: { revokedAt: true },
      });
    expect(revokedEvidence.revokedAt).toBeInstanceOf(Date);
    await expect(
      fixture.database.personaAssignment.findUniqueOrThrow({
        where: {
          userId_kind: {
            userId: fixture.dual.userId,
            kind: "CANDIDATE",
          },
        },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "ACTIVE" });
    expect(
      await fixture.database.companyMembership.count({
        where: { userId: fixture.dual.userId, status: "ACTIVE" },
      }),
    ).toBe(2);

    expect(
      await switchPersonaContext(
        { portal: "EMPLOYER", companyId: fixture.companyAId },
        await fixture.contextActor(fixture.dual),
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "CONTEXT_UNAVAILABLE" });
  });

  it("reactivates explicitly and keeps a membership suspension tenant-local", async () => {
    const assignment =
      await fixture.database.personaAssignment.findUniqueOrThrow({
        where: {
          userId_kind: {
            userId: fixture.dual.userId,
            kind: "EMPLOYER",
          },
        },
      });
    expect(
      await changePersonaAssignmentStatus(fixture.database, {
        assignmentId: assignment.id,
        expectedVersion: assignment.version,
        toStatus: "ACTIVE",
        actorUserId: fixture.dual.userId,
        reasonCode: "PHASE27_REACTIVATION_TEST",
        correlationId: crypto.randomUUID(),
        now: new Date(fixture.now.getTime() + 1_000),
      }),
    ).toMatchObject({ ok: true, status: "ACTIVE", version: 3 });

    expect(
      await switchPersonaContext(
        { portal: "EMPLOYER", companyId: fixture.companyAId },
        await fixture.contextActor(fixture.dual),
        {
          ...fixture.dependencies(),
          now: new Date(fixture.now.getTime() + 2_000),
        },
      ),
    ).toMatchObject({
      ok: true,
      portal: "EMPLOYER",
      companyId: fixture.companyAId,
    });
    const membershipA =
      await fixture.database.companyMembership.findUniqueOrThrow({
        where: {
          companyId_userId: {
            companyId: fixture.companyAId,
            userId: fixture.dual.userId,
          },
        },
      });
    await fixture.database.companyMembership.update({
      where: { id: membershipA.id },
      data: {
        status: "SUSPENDED",
        updatedAt: new Date(fixture.now.getTime() + 3_000),
      },
    });

    await expect(
      fixture.database.session.findUniqueOrThrow({
        where: { id: fixture.dual.sessionId },
        select: {
          activePortal: true,
          activeCompanyId: true,
          contextVersion: true,
        },
      }),
    ).resolves.toMatchObject({
      activePortal: "EMPLOYER",
      activeCompanyId: null,
    });
    await expect(
      fixture.database.companyMembership.findUniqueOrThrow({
        where: {
          companyId_userId: {
            companyId: fixture.companyBId,
            userId: fixture.dual.userId,
          },
        },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "ACTIVE" });
    await expect(
      fixture.database.user.findUniqueOrThrow({
        where: { id: fixture.dual.userId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "ACTIVE" });
  });
});
