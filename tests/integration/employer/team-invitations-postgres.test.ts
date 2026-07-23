import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AuthRequestContext } from "@/lib/auth/request-context";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  acceptCompanyInvitation,
  assignRecruiterToJob,
  changeCompanyMemberRole,
  getEmployerTeam,
  hashInvitationToken,
  inspectCompanyInvitation,
  registerAndAcceptCompanyInvitation,
  removeCompanyMember,
  resendCompanyInvitation,
  revokeCompanyInvitation,
  revokeJobAssignment,
  sendCompanyInvitation,
} from "@/lib/employer/team";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
type UserRole = "ADMIN" | "CANDIDATE" | "EMPLOYER" | "RECRUITER";
type MembershipRole = "ADMIN" | "OWNER" | "RECRUITER" | "VIEWER";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1_000;
const APP_URL = "http://phase10-team.test";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;
let cantonId = "";
let cityId = "";

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The Phase-10 team test database is not initialized.");
  }
  return database;
}

function runtimeEnvironment(): ServerEnvironment {
  if (environment === undefined) {
    throw new Error("The Phase-10 team test environment is not initialized.");
  }
  return environment;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase_10_team_invitations");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = parseEnvironment(
    createValidEnvironment({
      APP_URL,
      DATABASE_URL: migrated.connectionString,
      RATE_LIMIT_BACKEND: "postgres",
    }),
  );
  await seedSharedCatalog(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-10 team and invitation PostgreSQL contracts", () => {
  it("counts pending invitations as reserved seats and rejects acceptance after the company becomes over-limit", async () => {
    const fixture = await createCompanyFixture("seat-reservation", 2);
    const invitee = await createUser("seat-target", "EMPLOYER");
    const provider = new CapturingEmailProvider();

    const invited = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: invitee.email, role: "VIEWER" },
      dependencies(provider),
    );
    expect(invited).toMatchObject({ ok: true, emailRecorded: true });

    const blocked = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: uniqueEmail("seat-blocked"), role: "RECRUITER" },
      dependencies(provider),
    );
    expect(blocked).toEqual({ ok: false, code: "SEAT_LIMIT" });

    const [activeMembers, pendingInvitations] = await Promise.all([
      client().companyMembership.count({
        where: { companyId: fixture.companyId, status: "ACTIVE" },
      }),
      client().companyInvitation.count({
        where: {
          companyId: fixture.companyId,
          status: "PENDING",
          expiresAt: { gt: NOW },
        },
      }),
    ]);
    expect({
      activeMembers,
      pendingInvitations,
      seatUsage: activeMembers + pendingInvitations,
    }).toEqual({
      activeMembers: 1,
      pendingInvitations: 1,
      seatUsage: 2,
    });

    const occupyingUser = await createUser("seat-occupier", "EMPLOYER");
    await createMembership(
      fixture,
      occupyingUser.id,
      "VIEWER",
      fixture.ownerUserId,
    );
    const accepted = await acceptCompanyInvitation(
      provider.tokenAt(0),
      invitee,
      dependencies(undefined, new Date(NOW.getTime() + 1_000)),
    );
    expect(accepted).toEqual({ ok: false, code: "SEAT_LIMIT" });
    expect(
      await client().companyMembership.count({
        where: { companyId: fixture.companyId, userId: invitee.id },
      }),
    ).toBe(0);
    expect(
      await client().companyInvitation.findUniqueOrThrow({
        where: { tokenHash: hashInvitationToken(provider.tokenAt(0)) },
        select: { status: true },
      }),
    ).toEqual({ status: "PENDING" });
  });

  it("allows exactly one of two parallel sends when only one seat remains", async () => {
    const fixture = await createCompanyFixture("parallel-last-seat", 2);
    const provider = new CapturingEmailProvider();

    const results = await Promise.all([
      sendCompanyInvitation(
        fixture.companyId,
        ownerActor(fixture),
        { email: uniqueEmail("parallel-a"), role: "RECRUITER" },
        dependencies(provider),
      ),
      sendCompanyInvitation(
        fixture.companyId,
        ownerActor(fixture),
        { email: uniqueEmail("parallel-b"), role: "VIEWER" },
        dependencies(provider),
      ),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "SEAT_LIMIT" },
    ]);
    expect(provider.messages).toHaveLength(1);
    expect(
      await client().companyInvitation.count({
        where: { companyId: fixture.companyId, status: "PENDING" },
      }),
    ).toBe(1);
  });

  it("expires stale seat reservations before duplicate and entitlement checks", async () => {
    const fixture = await createCompanyFixture("expired-seat-reservation", 2);
    const provider = new CapturingEmailProvider();
    const firstEmail = uniqueEmail("expired-seat-first");

    const first = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: firstEmail, role: "VIEWER" },
      dependencies(provider),
    );
    if (!first.ok) throw new Error(`Expiry fixture failed: ${first.code}`);

    expect(
      await sendCompanyInvitation(
        fixture.companyId,
        ownerActor(fixture),
        { email: firstEmail.toUpperCase(), role: "RECRUITER" },
        dependencies(provider, new Date(NOW.getTime() + 1)),
      ),
    ).toEqual({ ok: false, code: "DUPLICATE" });
    expect(provider.messages).toHaveLength(1);

    const afterExpiry = new Date(NOW.getTime() + 8 * DAY);
    const replacement = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: uniqueEmail("expired-seat-replacement"), role: "RECRUITER" },
      dependencies(provider, afterExpiry),
    );
    expect(replacement).toMatchObject({ ok: true, emailRecorded: true });

    const expired = await client().companyInvitation.findUniqueOrThrow({
      where: { id: first.invitationId },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });
    expect(expired.status).toBe("EXPIRED");
    expect(
      expired.events.map(({ kind, reasonCode }) => ({ kind, reasonCode })),
    ).toEqual([
      { kind: "CREATED", reasonCode: null },
      { kind: "EXPIRED", reasonCode: "TTL_ELAPSED" },
    ]);
    expect(
      await inspectCompanyInvitation(
        provider.tokenAt(0),
        client(),
        null,
        afterExpiry,
      ),
    ).toEqual({ state: "EXPIRED" });
    expect(
      await client().companyInvitation.count({
        where: {
          companyId: fixture.companyId,
          status: "PENDING",
          expiresAt: { gt: afterExpiry },
        },
      }),
    ).toBe(1);
  });

  it("rotates the digest and version on resend so the prior token is unusable", async () => {
    const fixture = await createCompanyFixture("resend-rotation", 3);
    const invitee = await createUser("resend-target", "EMPLOYER");
    const provider = new CapturingEmailProvider();

    const sent = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: invitee.email, role: "ADMIN" },
      dependencies(provider),
    );
    if (!sent.ok) throw new Error(`Initial invitation failed: ${sent.code}`);
    const firstToken = provider.tokenAt(0);
    const firstRow = await client().companyInvitation.findUniqueOrThrow({
      where: { id: sent.invitationId },
      select: { tokenHash: true, tokenVersion: true },
    });

    const resent = await resendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      sent.invitationId,
      dependencies(provider, new Date(NOW.getTime() + 60_000)),
    );
    expect(resent).toMatchObject({
      ok: true,
      invitationId: sent.invitationId,
      emailRecorded: true,
    });
    const secondToken = provider.tokenAt(1);
    const secondRow = await client().companyInvitation.findUniqueOrThrow({
      where: { id: sent.invitationId },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });

    expect(secondToken).not.toBe(firstToken);
    expect(firstRow).toEqual({
      tokenHash: hashInvitationToken(firstToken),
      tokenVersion: 1,
    });
    expect(secondRow).toMatchObject({
      tokenHash: hashInvitationToken(secondToken),
      tokenVersion: 2,
    });
    expect(secondRow.tokenHash).not.toBe(firstRow.tokenHash);
    expect(secondRow.events.map(({ kind }) => kind)).toEqual([
      "CREATED",
      "RESENT",
    ]);
    expect(
      await inspectCompanyInvitation(firstToken, client(), invitee, NOW),
    ).toEqual({ state: "INVALID" });
    expect(
      await acceptCompanyInvitation(
        firstToken,
        invitee,
        dependencies(undefined, new Date(NOW.getTime() + 60_001)),
      ),
    ).toEqual({ ok: false, code: "INVALID" });
    expect(
      await inspectCompanyInvitation(
        secondToken,
        client(),
        invitee,
        new Date(NOW.getTime() + 60_001),
      ),
    ).toMatchObject({ state: "READY", intendedRole: "ADMIN" });
  });

  it("keeps revoke and accept single-use with explicit terminal states", async () => {
    const fixture = await createCompanyFixture("single-use", 4);
    const revokedUser = await createUser("revoked-target", "EMPLOYER");
    const acceptedUser = await createUser("accepted-target", "RECRUITER");
    const provider = new CapturingEmailProvider();

    const revokedInvitation = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: revokedUser.email, role: "VIEWER" },
      dependencies(provider),
    );
    if (!revokedInvitation.ok) {
      throw new Error(`Revocation fixture failed: ${revokedInvitation.code}`);
    }
    const revokedToken = provider.tokenAt(0);
    expect(
      await revokeCompanyInvitation(
        fixture.companyId,
        ownerActor(fixture),
        revokedInvitation.invitationId,
        dependencies(undefined, new Date(NOW.getTime() + 1_000)),
      ),
    ).toEqual({ ok: true });
    expect(
      await inspectCompanyInvitation(revokedToken, client(), revokedUser, NOW),
    ).toEqual({ state: "REVOKED" });
    expect(
      await acceptCompanyInvitation(
        revokedToken,
        revokedUser,
        dependencies(undefined, new Date(NOW.getTime() + 2_000)),
      ),
    ).toEqual({ ok: false, code: "INVALID" });
    expect(
      await revokeCompanyInvitation(
        fixture.companyId,
        ownerActor(fixture),
        revokedInvitation.invitationId,
        dependencies(undefined, new Date(NOW.getTime() + 3_000)),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    const acceptedInvitation = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: acceptedUser.email, role: "RECRUITER" },
      dependencies(provider, new Date(NOW.getTime() + 4_000)),
    );
    if (!acceptedInvitation.ok) {
      throw new Error(`Acceptance fixture failed: ${acceptedInvitation.code}`);
    }
    const acceptedToken = provider.tokenAt(1);
    const accepted = await acceptCompanyInvitation(
      acceptedToken,
      acceptedUser,
      dependencies(undefined, new Date(NOW.getTime() + 5_000)),
    );
    expect(accepted).toMatchObject({ ok: true, companyId: fixture.companyId });
    expect(
      await acceptCompanyInvitation(
        acceptedToken,
        acceptedUser,
        dependencies(undefined, new Date(NOW.getTime() + 6_000)),
      ),
    ).toEqual({ ok: false, code: "INVALID" });
    expect(
      await inspectCompanyInvitation(
        acceptedToken,
        client(),
        acceptedUser,
        NOW,
      ),
    ).toEqual({ state: "USED" });
    expect(
      await client().companyMembership.count({
        where: { companyId: fixture.companyId, userId: acceptedUser.id },
      }),
    ).toBe(1);
    const invitationAudits = await client().auditLog.findMany({
      where: {
        targetId: {
          in: [
            revokedInvitation.invitationId,
            acceptedInvitation.invitationId,
          ],
        },
        action: {
          in: [
            "INVITATION_SENT",
            "INVITATION_REVOKED",
            "INVITATION_ACCEPTED",
          ],
        },
      },
      select: { action: true, targetId: true, targetType: true },
    });
    expect(invitationAudits).toEqual(
      expect.arrayContaining([
        {
          action: "INVITATION_SENT",
          targetId: revokedInvitation.invitationId,
          targetType: "INVITATION",
        },
        {
          action: "INVITATION_REVOKED",
          targetId: revokedInvitation.invitationId,
          targetType: "INVITATION",
        },
        {
          action: "INVITATION_SENT",
          targetId: acceptedInvitation.invitationId,
          targetType: "INVITATION",
        },
        {
          action: "INVITATION_ACCEPTED",
          targetId: acceptedInvitation.invitationId,
          targetType: "INVITATION",
        },
      ]),
    );
  });

  it("returns non-disclosing mismatch states and denies Candidate or platform Admin accounts", async () => {
    const fixture = await createCompanyFixture("generic-denials", 5);
    const candidate = await createUser("candidate-denied", "CANDIDATE");
    const platformAdmin = await createUser("admin-denied", "ADMIN");
    const otherEmployer = await createUser("email-mismatch", "EMPLOYER");
    const provider = new CapturingEmailProvider();

    await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: candidate.email, role: "VIEWER" },
      dependencies(provider),
    );
    await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: platformAdmin.email, role: "ADMIN" },
      dependencies(provider),
    );
    const candidateToken = provider.tokenAt(0);
    const adminToken = provider.tokenAt(1);

    expect(
      await inspectCompanyInvitation(candidateToken, client(), null, NOW),
    ).toEqual({ state: "AUTH_REQUIRED" });
    expect(
      await inspectCompanyInvitation(
        candidateToken,
        client(),
        otherEmployer,
        NOW,
      ),
    ).toEqual({ state: "EMAIL_MISMATCH" });
    expect(
      await acceptCompanyInvitation(
        candidateToken,
        otherEmployer,
        dependencies(),
      ),
    ).toEqual({ ok: false, code: "INVALID" });
    expect(
      await inspectCompanyInvitation(candidateToken, client(), candidate, NOW),
    ).toEqual({ state: "ACCOUNT_TYPE_UNSUPPORTED" });
    expect(
      await inspectCompanyInvitation(adminToken, client(), platformAdmin, NOW),
    ).toEqual({ state: "ACCOUNT_TYPE_UNSUPPORTED" });
    expect(
      await acceptCompanyInvitation(candidateToken, candidate, dependencies()),
    ).toEqual({ ok: false, code: "ACCOUNT_TYPE_UNSUPPORTED" });
    expect(
      await acceptCompanyInvitation(adminToken, platformAdmin, dependencies()),
    ).toEqual({ ok: false, code: "ACCOUNT_TYPE_UNSUPPORTED" });
    expect(
      await inspectCompanyInvitation("x".repeat(48), client(), null, NOW),
    ).toEqual({ state: "INVALID" });
    expect(
      await inspectCompanyInvitation(
        candidateToken,
        client(),
        candidate,
        new Date(NOW.getTime() + 8 * DAY),
      ),
    ).toEqual({ state: "EXPIRED" });

    expect(
      await sendCompanyInvitation(
        fixture.companyId,
        {
          userId: candidate.id,
          membershipId: randomUUID(),
          role: "OWNER",
        },
        { email: uniqueEmail("candidate-forged-send"), role: "VIEWER" },
        dependencies(provider),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await sendCompanyInvitation(
        fixture.companyId,
        {
          userId: platformAdmin.id,
          membershipId: randomUUID(),
          role: "OWNER",
        },
        { email: uniqueEmail("admin-forged-send"), role: "VIEWER" },
        dependencies(provider),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("reactivates the same REMOVED membership and preserves its event history", async () => {
    const fixture = await createCompanyFixture("removed-reactivation", 4);
    const recruiter = await createUser("removed-recruiter", "RECRUITER");
    const membership = await createMembership(
      fixture,
      recruiter.id,
      "RECRUITER",
      fixture.ownerUserId,
    );

    expect(
      await removeCompanyMember(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: membership.id, reason: "Integration test removal" },
        dependencies(),
      ),
    ).toEqual({ ok: true });

    const provider = new CapturingEmailProvider();
    const invitation = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: recruiter.email, role: "VIEWER" },
      dependencies(provider, new Date(NOW.getTime() + 1_000)),
    );
    if (!invitation.ok) {
      throw new Error(`Reactivation invitation failed: ${invitation.code}`);
    }
    const accepted = await acceptCompanyInvitation(
      provider.tokenAt(0),
      recruiter,
      dependencies(undefined, new Date(NOW.getTime() + 2_000)),
    );
    expect(accepted).toEqual({
      ok: true,
      companyId: fixture.companyId,
      membershipId: membership.id,
    });

    const reactivated = await client().companyMembership.findUniqueOrThrow({
      where: { id: membership.id },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });
    expect(reactivated).toMatchObject({
      id: membership.id,
      role: "VIEWER",
      status: "ACTIVE",
      removedAt: null,
    });
    expect(reactivated.events.map(({ kind }) => kind)).toEqual([
      "CREATED",
      "REMOVED",
      "REACTIVATED",
    ]);
  });

  it("protects the last active Owner against demotion and removal", async () => {
    const fixture = await createCompanyFixture("last-owner", 4);
    const secondOwner = await createUser("second-owner", "EMPLOYER");
    const secondMembership = await createMembership(
      fixture,
      secondOwner.id,
      "OWNER",
      fixture.ownerUserId,
    );

    expect(
      await changeCompanyMemberRole(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: secondMembership.id, role: "ADMIN" },
        dependencies(),
      ),
    ).toEqual({ ok: true });
    expect(
      await changeCompanyMemberRole(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: fixture.ownerMembershipId, role: "ADMIN" },
        dependencies(undefined, new Date(NOW.getTime() + 1_000)),
      ),
    ).toEqual({ ok: false, code: "LAST_OWNER" });
    expect(
      await removeCompanyMember(
        fixture.companyId,
        ownerActor(fixture),
        {
          membershipId: fixture.ownerMembershipId,
          reason: "Cannot remove the final owner",
        },
        dependencies(undefined, new Date(NOW.getTime() + 2_000)),
      ),
    ).toEqual({ ok: false, code: "SELF_REMOVAL" });
    expect(
      await removeCompanyMember(
        fixture.companyId,
        {
          userId: secondOwner.id,
          membershipId: secondMembership.id,
          role: "ADMIN",
        },
        {
          membershipId: fixture.ownerMembershipId,
          reason: "Admin must not remove the owner",
        },
        dependencies(undefined, new Date(NOW.getTime() + 3_000)),
      ),
    ).toEqual({ ok: false, code: "OWNER_REQUIRED" });
    expect(
      await client().companyMembership.count({
        where: {
          companyId: fixture.companyId,
          role: "OWNER",
          status: "ACTIVE",
        },
      }),
    ).toBe(1);
  });

  it("scopes assignments to one company and makes expiry and revoke effective on the next read", async () => {
    const companyA = await createCompanyFixture("assignment-a", 5);
    const companyB = await createCompanyFixture("assignment-b", 5);
    const recruiterA = await createUser("assignment-recruiter-a", "RECRUITER");
    const recruiterB = await createUser("assignment-recruiter-b", "RECRUITER");
    const membershipA = await createMembership(
      companyA,
      recruiterA.id,
      "RECRUITER",
      companyA.ownerUserId,
    );
    const membershipB = await createMembership(
      companyB,
      recruiterB.id,
      "RECRUITER",
      companyB.ownerUserId,
    );
    const jobA = await createJob(companyA, "assignment-job-a");
    const jobB = await createJob(companyB, "assignment-job-b");

    expect(
      await assignRecruiterToJob(
        companyA.companyId,
        ownerActor(companyA),
        { jobId: jobA.id, membershipId: membershipB.id, role: "EDITOR" },
        dependencies(),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await assignRecruiterToJob(
        companyA.companyId,
        ownerActor(companyA),
        { jobId: jobB.id, membershipId: membershipA.id, role: "EDITOR" },
        dependencies(),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await assignRecruiterToJob(
        companyA.companyId,
        ownerActor(companyA),
        {
          jobId: jobA.id,
          membershipId: membershipA.id,
          role: "EDITOR",
          expiresAt: new Date(NOW.getTime() - 1),
        },
        dependencies(),
      ),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });

    const expiresAt = new Date(NOW.getTime() + 60_000);
    const first = await assignRecruiterToJob(
      companyA.companyId,
      ownerActor(companyA),
      {
        jobId: jobA.id,
        membershipId: membershipA.id,
        role: "EDITOR",
        expiresAt,
      },
      dependencies(),
    );
    if (!first.ok) throw new Error(`Initial assignment failed: ${first.code}`);
    expect(
      (await getEmployerTeam(
        companyA.companyId,
        ownerActor(companyA),
        client(),
        expiresAt,
      ))?.assignments,
    ).toHaveLength(0);

    const later = new Date(expiresAt.getTime() + 1);
    const replacement = await assignRecruiterToJob(
      companyA.companyId,
      ownerActor(companyA),
      {
        jobId: jobA.id,
        membershipId: membershipA.id,
        role: "PIPELINE",
      },
      dependencies(undefined, later),
    );
    if (!replacement.ok) {
      throw new Error(`Replacement assignment failed: ${replacement.code}`);
    }
    expect(replacement.assignmentId).not.toBe(first.assignmentId);
    expect(
      await client().jobAssignment.findMany({
        where: { jobId: jobA.id, userId: recruiterA.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, status: true },
      }),
    ).toEqual([
      { id: first.assignmentId, role: "EDITOR", status: "EXPIRED" },
      {
        id: replacement.assignmentId,
        role: "PIPELINE",
        status: "ACTIVE",
      },
    ]);

    expect(
      await revokeJobAssignment(
        companyA.companyId,
        ownerActor(companyA),
        replacement.assignmentId,
        dependencies(undefined, new Date(later.getTime() + 1)),
      ),
    ).toEqual({ ok: true });
    expect(
      await revokeJobAssignment(
        companyA.companyId,
        ownerActor(companyA),
        replacement.assignmentId,
        dependencies(undefined, new Date(later.getTime() + 2)),
      ),
    ).toEqual({ ok: true });
    expect(
      (
        await getEmployerTeam(
          companyA.companyId,
          ownerActor(companyA),
          client(),
          new Date(later.getTime() + 3),
        )
      )?.assignments,
    ).toHaveLength(0);

    const revoked = await client().jobAssignment.findUniqueOrThrow({
      where: { id: replacement.assignmentId },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });
    expect(revoked).toMatchObject({ status: "REVOKED" });
    expect(revoked.events.map(({ kind }) => kind)).toEqual([
      "ASSIGNED",
      "REVOKED",
    ]);
  });

  it("serializes accept against resend and revoke without deadlocks or split-brain state", async () => {
    const resendCompany = await createCompanyFixture("accept-resend-race", 3);
    const resendUser = await createUser("accept-resend-user", "EMPLOYER");
    const resendProvider = new CapturingEmailProvider();
    const resendInvitation = await sendCompanyInvitation(
      resendCompany.companyId,
      ownerActor(resendCompany),
      { email: resendUser.email, role: "ADMIN" },
      dependencies(resendProvider),
    );
    if (!resendInvitation.ok) {
      throw new Error(`Resend race fixture failed: ${resendInvitation.code}`);
    }
    const resendRace = await Promise.all([
      acceptCompanyInvitation(
        resendProvider.tokenAt(0),
        resendUser,
        dependencies(undefined, new Date(NOW.getTime() + 1_000)),
      ),
      resendCompanyInvitation(
        resendCompany.companyId,
        ownerActor(resendCompany),
        resendInvitation.invitationId,
        dependencies(resendProvider, new Date(NOW.getTime() + 1_000)),
      ),
    ]);
    expect(resendRace.filter(({ ok }) => ok)).toHaveLength(1);
    const resendLoserCodes = resendRace
      .filter((result) => !result.ok)
      .map((result) => result.code);
    expect(resendLoserCodes).toHaveLength(1);
    expect(["INVALID", "NOT_FOUND"]).toContain(resendLoserCodes[0]);
    const resendTerminal = await client().companyInvitation.findUniqueOrThrow({
      where: { id: resendInvitation.invitationId },
      select: { status: true, tokenVersion: true },
    });
    const resendMembershipCount = await client().companyMembership.count({
      where: { companyId: resendCompany.companyId, userId: resendUser.id },
    });
    if (resendTerminal.status === "ACCEPTED") {
      expect(resendMembershipCount).toBe(1);
      expect(resendTerminal.tokenVersion).toBe(1);
    } else {
      expect(resendTerminal).toEqual({ status: "PENDING", tokenVersion: 2 });
      expect(resendMembershipCount).toBe(0);
    }

    const revokeCompany = await createCompanyFixture("accept-revoke-race", 3);
    const revokeUser = await createUser("accept-revoke-user", "RECRUITER");
    const revokeProvider = new CapturingEmailProvider();
    const revokeInvitation = await sendCompanyInvitation(
      revokeCompany.companyId,
      ownerActor(revokeCompany),
      { email: revokeUser.email, role: "RECRUITER" },
      dependencies(revokeProvider),
    );
    if (!revokeInvitation.ok) {
      throw new Error(`Revoke race fixture failed: ${revokeInvitation.code}`);
    }
    const revokeRace = await Promise.all([
      acceptCompanyInvitation(
        revokeProvider.tokenAt(0),
        revokeUser,
        dependencies(undefined, new Date(NOW.getTime() + 2_000)),
      ),
      revokeCompanyInvitation(
        revokeCompany.companyId,
        ownerActor(revokeCompany),
        revokeInvitation.invitationId,
        dependencies(undefined, new Date(NOW.getTime() + 2_000)),
      ),
    ]);
    expect(revokeRace.filter(({ ok }) => ok)).toHaveLength(1);
    const revokeLoserCodes = revokeRace
      .filter((result) => !result.ok)
      .map((result) => result.code);
    expect(revokeLoserCodes).toHaveLength(1);
    expect(["INVALID", "NOT_FOUND"]).toContain(revokeLoserCodes[0]);
    const revokeTerminal = await client().companyInvitation.findUniqueOrThrow({
      where: { id: revokeInvitation.invitationId },
      select: { status: true },
    });
    const revokeMembershipCount = await client().companyMembership.count({
      where: { companyId: revokeCompany.companyId, userId: revokeUser.id },
    });
    expect(["ACCEPTED", "REVOKED"]).toContain(revokeTerminal.status);
    expect(revokeMembershipCount).toBe(
      revokeTerminal.status === "ACCEPTED" ? 1 : 0,
    );
  });

  it("registers invitation accounts with the exact global and membership role matrix", async () => {
    const fixture = await createCompanyFixture("registration-role-matrix", 10);
    const provider = new CapturingEmailProvider();
    const matrix = [
      { invitedRole: "OWNER", expectedGlobalRole: "EMPLOYER" },
      { invitedRole: "ADMIN", expectedGlobalRole: "EMPLOYER" },
      { invitedRole: "VIEWER", expectedGlobalRole: "EMPLOYER" },
      { invitedRole: "RECRUITER", expectedGlobalRole: "RECRUITER" },
    ] as const;

    for (const [index, entry] of matrix.entries()) {
      const email = uniqueEmail(`registration-${entry.invitedRole.toLowerCase()}`);
      const sent = await sendCompanyInvitation(
        fixture.companyId,
        ownerActor(fixture),
        { email, role: entry.invitedRole },
        dependencies(provider, new Date(NOW.getTime() + index)),
      );
      if (!sent.ok) throw new Error(`Role matrix invite failed: ${sent.code}`);
      const registered = await registerAndAcceptCompanyInvitation(
        provider.tokenAt(index),
        {
          name: `Invitation ${entry.invitedRole}`,
          email,
          password: "Phase10!RoleMatrix42",
          acceptedTerms: true,
          marketingConsent: false,
        },
        dependencies(
          undefined,
          new Date(NOW.getTime() + 100 + index),
          `192.0.2.${10 + index}`,
        ),
      );
      expect(registered).toMatchObject({
        ok: true,
        companyId: fixture.companyId,
      });
      const user = await client().user.findUniqueOrThrow({
        where: { emailNormalized: email },
        select: {
          role: true,
          companyMemberships: {
            where: { companyId: fixture.companyId },
            select: { role: true, status: true },
          },
        },
      });
      expect(user).toEqual({
        role: entry.expectedGlobalRole,
        companyMemberships: [{ role: entry.invitedRole, status: "ACTIVE" }],
      });
    }

    const existingEmployer = await createUser(
      "existing-employer-invited-recruiter",
      "EMPLOYER",
    );
    const existingRecruiter = await createUser(
      "existing-recruiter-invited-viewer",
      "RECRUITER",
    );
    for (const [index, entry] of [
      { user: existingEmployer, invitedRole: "RECRUITER" as const },
      { user: existingRecruiter, invitedRole: "VIEWER" as const },
    ].entries()) {
      const sent = await sendCompanyInvitation(
        fixture.companyId,
        ownerActor(fixture),
        { email: entry.user.email, role: entry.invitedRole },
        dependencies(provider, new Date(NOW.getTime() + 200 + index)),
      );
      if (!sent.ok) throw new Error(`Existing role invite failed: ${sent.code}`);
      expect(
        await acceptCompanyInvitation(
          provider.tokenAt(matrix.length + index),
          entry.user,
          dependencies(undefined, new Date(NOW.getTime() + 300 + index)),
        ),
      ).toMatchObject({ ok: true, companyId: fixture.companyId });
      const persisted = await client().user.findUniqueOrThrow({
        where: { id: entry.user.id },
        select: {
          role: true,
          companyMemberships: {
            where: { companyId: fixture.companyId },
            select: { role: true },
          },
        },
      });
      expect(persisted).toEqual({
        role: entry.user.role,
        companyMemberships: [{ role: entry.invitedRole }],
      });
    }
  });

  it("enforces the shared password policy and rolls registration back atomically when acceptance fails", async () => {
    const fixture = await createCompanyFixture("registration-rollback", 2);
    const email = uniqueEmail("registration-rollback-user");
    const provider = new CapturingEmailProvider();
    const sent = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email, role: "ADMIN" },
      dependencies(provider),
    );
    if (!sent.ok) throw new Error(`Rollback invite failed: ${sent.code}`);

    expect(
      await registerAndAcceptCompanyInvitation(
        provider.tokenAt(0),
        {
          name: "Weak Password",
          email,
          password: "abcdefghijkl",
          acceptedTerms: true,
          marketingConsent: false,
        },
        dependencies(undefined, NOW, "192.0.2.30"),
      ),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await client().user.count({ where: { emailNormalized: email } }),
    ).toBe(0);

    const occupier = await createUser("registration-seat-occupier", "EMPLOYER");
    await createMembership(
      fixture,
      occupier.id,
      "VIEWER",
      fixture.ownerUserId,
    );
    expect(
      await registerAndAcceptCompanyInvitation(
        provider.tokenAt(0),
        {
          name: "Atomic Rollback",
          email,
          password: "Phase10!AtomicRollback42",
          acceptedTerms: true,
          marketingConsent: true,
        },
        dependencies(
          undefined,
          new Date(NOW.getTime() + 1_000),
          "192.0.2.31",
        ),
      ),
    ).toEqual({ ok: false, code: "SEAT_LIMIT" });
    expect(
      await client().user.count({ where: { emailNormalized: email } }),
    ).toBe(0);
    expect(
      await client().companyInvitation.findUniqueOrThrow({
        where: { id: sent.invitationId },
        select: { status: true, acceptedAt: true, acceptedByUserId: true },
      }),
    ).toEqual({
      status: "PENDING",
      acceptedAt: null,
      acceptedByUserId: null,
    });
  });

  it("applies the shared REGISTER rate limit before invitation-account password hashing", async () => {
    const fixture = await createCompanyFixture("registration-rate-limit", 3);
    const existing = await createUser("registration-rate-limit-existing", "EMPLOYER");
    const provider = new CapturingEmailProvider();
    const invitation = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: existing.email, role: "VIEWER" },
      dependencies(provider),
    );
    if (!invitation.ok) {
      throw new Error(`Rate-limit invite failed: ${invitation.code}`);
    }
    const input = {
      name: "Existing Invitation Account",
      email: existing.email,
      password: "Phase10!RateLimit42",
      acceptedTerms: true,
      marketingConsent: false,
    } as const;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        await registerAndAcceptCompanyInvitation(
          provider.tokenAt(0),
          input,
          dependencies(
            undefined,
            new Date(NOW.getTime() + attempt),
            "192.0.2.40",
          ),
        ),
      ).toEqual({ ok: false, code: "ACCOUNT_EXISTS" });
    }
    expect(
      await registerAndAcceptCompanyInvitation(
        provider.tokenAt(0),
        input,
        dependencies(
          undefined,
          new Date(NOW.getTime() + 10),
          "192.0.2.40",
        ),
      ),
    ).toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(
      await client().auditLog.findMany({
        where: { action: "RATE_LIMITED", reasonCode: "RATE_LIMITED" },
        select: {
          actorKind: true,
          actorUserId: true,
          capability: true,
          companyId: true,
          targetId: true,
          targetType: true,
        },
      }),
    ).toEqual([
      {
        actorKind: "ANONYMOUS",
        actorUserId: null,
        capability: "AUTH_REGISTER_INVITATION",
        companyId: fixture.companyId,
        targetId: fixture.companyId,
        targetType: "COMPANY",
      },
    ]);
  });

  it("revalidates active Owner or Admin scope for every team read", async () => {
    const fixture = await createCompanyFixture("team-read-scope", 8);
    const otherCompany = await createCompanyFixture("team-read-other", 3);
    const admin = await createUser("team-read-admin", "EMPLOYER");
    const adminMembership = await createMembership(
      fixture,
      admin.id,
      "ADMIN",
      fixture.ownerUserId,
    );
    const staleAdminActor = {
      userId: admin.id,
      membershipId: adminMembership.id,
      role: "ADMIN" as const,
    };
    expect(
      await getEmployerTeam(
        fixture.companyId,
        staleAdminActor,
        client(),
        NOW,
      ),
    ).not.toBeNull();
    expect(
      await getEmployerTeam(
        otherCompany.companyId,
        staleAdminActor,
        client(),
        NOW,
      ),
    ).toBeNull();

    expect(
      await changeCompanyMemberRole(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: adminMembership.id, role: "VIEWER" },
        dependencies(),
      ),
    ).toEqual({ ok: true });
    expect(
      await getEmployerTeam(
        fixture.companyId,
        staleAdminActor,
        client(),
        new Date(NOW.getTime() + 1),
      ),
    ).toBeNull();

    const removedAdmin = await createUser("team-read-removed-admin", "EMPLOYER");
    const removedMembership = await createMembership(
      fixture,
      removedAdmin.id,
      "ADMIN",
      fixture.ownerUserId,
    );
    expect(
      await removeCompanyMember(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: removedMembership.id, reason: "Read access revoked" },
        dependencies(undefined, new Date(NOW.getTime() + 2)),
      ),
    ).toEqual({ ok: true });
    expect(
      await getEmployerTeam(
        fixture.companyId,
        {
          userId: removedAdmin.id,
          membershipId: removedMembership.id,
          role: "ADMIN",
        },
        client(),
        new Date(NOW.getTime() + 3),
      ),
    ).toBeNull();

    const recruiter = await createUser("team-read-recruiter", "RECRUITER");
    const recruiterMembership = await createMembership(
      fixture,
      recruiter.id,
      "RECRUITER",
      fixture.ownerUserId,
    );
    expect(
      await getEmployerTeam(
        fixture.companyId,
        {
          userId: recruiter.id,
          membershipId: recruiterMembership.id,
          role: "RECRUITER",
        },
        client(),
        NOW,
      ),
    ).toBeNull();
  });

  it("revalidates manager role and company scope at every invitation command boundary", async () => {
    const company = await createCompanyFixture("invitation-command-scope", 6);
    const foreignCompany = await createCompanyFixture(
      "invitation-command-foreign",
      4,
    );
    const admin = await createUser("invitation-command-admin", "EMPLOYER");
    const adminMembership = await createMembership(
      company,
      admin.id,
      "ADMIN",
      company.ownerUserId,
    );
    const recruiter = await createUser(
      "invitation-command-recruiter",
      "RECRUITER",
    );
    const recruiterMembership = await createMembership(
      company,
      recruiter.id,
      "RECRUITER",
      company.ownerUserId,
    );
    const adminActor = {
      userId: admin.id,
      membershipId: adminMembership.id,
      role: "ADMIN" as const,
    };
    const recruiterActor = {
      userId: recruiter.id,
      membershipId: recruiterMembership.id,
      role: "RECRUITER" as const,
    };
    const provider = new CapturingEmailProvider();

    expect(
      await sendCompanyInvitation(
        company.companyId,
        adminActor,
        { email: uniqueEmail("admin-owner-denied"), role: "OWNER" },
        dependencies(provider),
      ),
    ).toEqual({ ok: false, code: "OWNER_REQUIRED" });
    expect(
      await sendCompanyInvitation(
        company.companyId,
        recruiterActor,
        { email: uniqueEmail("recruiter-manager-denied"), role: "VIEWER" },
        dependencies(provider),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    const sent = await sendCompanyInvitation(
      company.companyId,
      adminActor,
      { email: uniqueEmail("admin-viewer-allowed"), role: "VIEWER" },
      dependencies(provider),
    );
    if (!sent.ok) throw new Error(`Admin invitation failed: ${sent.code}`);

    expect(
      await resendCompanyInvitation(
        foreignCompany.companyId,
        ownerActor(foreignCompany),
        sent.invitationId,
        dependencies(provider, new Date(NOW.getTime() + 1)),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await revokeCompanyInvitation(
        foreignCompany.companyId,
        ownerActor(foreignCompany),
        sent.invitationId,
        dependencies(undefined, new Date(NOW.getTime() + 2)),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    expect(
      await changeCompanyMemberRole(
        company.companyId,
        ownerActor(company),
        { membershipId: adminMembership.id, role: "VIEWER" },
        dependencies(undefined, new Date(NOW.getTime() + 3)),
      ),
    ).toEqual({ ok: true });
    expect(
      await revokeCompanyInvitation(
        company.companyId,
        adminActor,
        sent.invitationId,
        dependencies(undefined, new Date(NOW.getTime() + 4)),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    expect(
      await client().companyInvitation.findUniqueOrThrow({
        where: { id: sent.invitationId },
        select: { companyId: true, status: true, tokenVersion: true },
      }),
    ).toEqual({
      companyId: company.companyId,
      status: "PENDING",
      tokenVersion: 1,
    });
  });

  it("does not invite or reactivate a suspended membership", async () => {
    const fixture = await createCompanyFixture("suspended-membership", 5);
    const suspendedUser = await createUser("suspended-existing", "EMPLOYER");
    const suspendedMembership = await createMembership(
      fixture,
      suspendedUser.id,
      "ADMIN",
      fixture.ownerUserId,
    );
    await client().companyMembership.update({
      where: { id: suspendedMembership.id },
      data: { status: "SUSPENDED" },
    });
    const provider = new CapturingEmailProvider();
    expect(
      await sendCompanyInvitation(
        fixture.companyId,
        ownerActor(fixture),
        { email: suspendedUser.email, role: "VIEWER" },
        dependencies(provider),
      ),
    ).toEqual({ ok: false, code: "ALREADY_MEMBER" });
    expect(provider.messages).toHaveLength(0);
    expect(
      await client().companyInvitation.count({
        where: {
          companyId: fixture.companyId,
          inviteeEmailNormalized: suspendedUser.email,
        },
      }),
    ).toBe(0);

    const racedUser = await createUser("suspended-before-accept", "EMPLOYER");
    const invitation = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: racedUser.email, role: "VIEWER" },
      dependencies(provider, new Date(NOW.getTime() + 1)),
    );
    if (!invitation.ok) {
      throw new Error(`Suspension race invite failed: ${invitation.code}`);
    }
    const racedMembership = await createMembership(
      fixture,
      racedUser.id,
      "RECRUITER",
      fixture.ownerUserId,
    );
    await client().companyMembership.update({
      where: { id: racedMembership.id },
      data: { status: "SUSPENDED" },
    });
    expect(
      await acceptCompanyInvitation(
        provider.tokenAt(0),
        racedUser,
        dependencies(undefined, new Date(NOW.getTime() + 2)),
      ),
    ).toEqual({ ok: false, code: "ALREADY_MEMBER" });
    expect(
      await client().companyMembership.findUniqueOrThrow({
        where: { id: racedMembership.id },
        select: { role: true, status: true },
      }),
    ).toEqual({ role: "RECRUITER", status: "SUSPENDED" });
    expect(
      await client().companyInvitation.findUniqueOrThrow({
        where: { id: invitation.invitationId },
        select: { status: true },
      }),
    ).toEqual({ status: "PENDING" });
  });

  it("atomically revokes active assignments when a Recruiter is demoted", async () => {
    const fixture = await createCompanyFixture("recruiter-demotion", 5);
    const recruiter = await createUser("recruiter-demotion-user", "RECRUITER");
    const membership = await createMembership(
      fixture,
      recruiter.id,
      "RECRUITER",
      fixture.ownerUserId,
    );
    const job = await createJob(fixture, "recruiter-demotion-job");
    const assigned = await assignRecruiterToJob(
      fixture.companyId,
      ownerActor(fixture),
      { jobId: job.id, membershipId: membership.id, role: "EDITOR" },
      dependencies(),
    );
    if (!assigned.ok) throw new Error(`Demotion assignment failed: ${assigned.code}`);

    expect(
      await changeCompanyMemberRole(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: membership.id, role: "VIEWER" },
        dependencies(undefined, new Date(NOW.getTime() + 1_000)),
      ),
    ).toEqual({ ok: true });
    const revoked = await client().jobAssignment.findUniqueOrThrow({
      where: { id: assigned.assignmentId },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });
    expect(revoked).toMatchObject({ status: "REVOKED" });
    expect(revoked.revokedAt).not.toBeNull();
    expect(
      revoked.events.map(({ kind, reasonCode }) => ({ kind, reasonCode })),
    ).toEqual([
      { kind: "ASSIGNED", reasonCode: null },
      { kind: "REVOKED", reasonCode: "MEMBERSHIP_ROLE_CHANGED" },
    ]);
    expect(
      await client().auditLog.count({
        where: {
          action: "JOB_ASSIGNMENT_REVOKED",
          targetId: assigned.assignmentId,
          reasonCode: "MEMBERSHIP_ROLE_CHANGED",
        },
      }),
    ).toBe(1);

    expect(
      await changeCompanyMemberRole(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: membership.id, role: "RECRUITER" },
        dependencies(undefined, new Date(NOW.getTime() + 2_000)),
      ),
    ).toEqual({ ok: true });
    expect(
      await client().jobAssignment.findUniqueOrThrow({
        where: { id: assigned.assignmentId },
        select: { status: true },
      }),
    ).toEqual({ status: "REVOKED" });
  });

  it("uses persisted event identities for distinct membership and assignment notifications", async () => {
    const fixture = await createCompanyFixture("notification-event-dedupe", 5);
    const recruiter = await createUser("notification-event-user", "RECRUITER");
    const membership = await createMembership(
      fixture,
      recruiter.id,
      "RECRUITER",
      fixture.ownerUserId,
    );

    expect(
      await changeCompanyMemberRole(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: membership.id, role: "VIEWER" },
        dependencies(),
      ),
    ).toEqual({ ok: true });
    expect(
      await changeCompanyMemberRole(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: membership.id, role: "RECRUITER" },
        dependencies(undefined, new Date(NOW.getTime() + 1)),
      ),
    ).toEqual({ ok: true });
    expect(
      await changeCompanyMemberRole(
        fixture.companyId,
        ownerActor(fixture),
        { membershipId: membership.id, role: "RECRUITER" },
        dependencies(undefined, new Date(NOW.getTime() + 2)),
      ),
    ).toEqual({ ok: true });
    expect(
      await client().notification.count({
        where: {
          recipientUserId: recruiter.id,
          kind: "TEAM_MEMBERSHIP_CHANGED",
        },
      }),
    ).toBe(2);

    const job = await createJob(fixture, "notification-event-job");
    const first = await assignRecruiterToJob(
      fixture.companyId,
      ownerActor(fixture),
      { jobId: job.id, membershipId: membership.id, role: "EDITOR" },
      dependencies(undefined, new Date(NOW.getTime() + 3)),
    );
    if (!first.ok) throw new Error(`Notification assignment failed: ${first.code}`);
    for (const [index, role] of ["REVIEWER", "PIPELINE", "PIPELINE"].entries()) {
      const updated = await assignRecruiterToJob(
        fixture.companyId,
        ownerActor(fixture),
        { jobId: job.id, membershipId: membership.id, role },
        dependencies(undefined, new Date(NOW.getTime() + 4 + index)),
      );
      expect(updated).toEqual({ ok: true, assignmentId: first.assignmentId });
    }
    expect(
      await client().notification.count({
        where: {
          recipientUserId: recruiter.id,
          kind: "TEAM_MEMBERSHIP_CHANGED",
        },
      }),
    ).toBe(5);
    expect(
      await client().jobAssignmentEvent.findMany({
        where: { jobAssignmentId: first.assignmentId },
        orderBy: { createdAt: "asc" },
        select: { kind: true, fromRole: true, toRole: true },
      }),
    ).toEqual([
      { kind: "ASSIGNED", fromRole: null, toRole: "EDITOR" },
      { kind: "ROLE_CHANGED", fromRole: "EDITOR", toRole: "REVIEWER" },
      { kind: "ROLE_CHANGED", fromRole: "REVIEWER", toRole: "PIPELINE" },
    ]);
  });

  it("heals a failed post-commit notification on exact state replay without duplicating events or audits", async () => {
    const fixture = await createCompanyFixture("notification-replay-healing", 8);
    await installFailOnceNotificationTrigger();
    try {
      const roleUser = await createUser("notification-replay-role", "EMPLOYER");
      const roleMembership = await createMembership(
        fixture,
        roleUser.id,
        "VIEWER",
        fixture.ownerUserId,
      );
      const roleInput = { membershipId: roleMembership.id, role: "ADMIN" } as const;
      expect(
        await changeCompanyMemberRole(
          fixture.companyId,
          ownerActor(fixture),
          roleInput,
          dependencies(),
        ),
      ).toEqual({ ok: true });
      expect(
        await client().notification.count({
          where: { recipientUserId: roleUser.id, kind: "TEAM_MEMBERSHIP_CHANGED" },
        }),
      ).toBe(0);
      expect(
        await changeCompanyMemberRole(
          fixture.companyId,
          ownerActor(fixture),
          roleInput,
          dependencies(undefined, new Date(NOW.getTime() + 1)),
        ),
      ).toEqual({ ok: true });
      expect(
        await client().notification.count({
          where: { recipientUserId: roleUser.id, kind: "TEAM_MEMBERSHIP_CHANGED" },
        }),
      ).toBe(1);
      expect(
        await client().companyMembershipEvent.count({
          where: { membershipId: roleMembership.id, kind: "ROLE_CHANGED" },
        }),
      ).toBe(1);
      expect(
        await client().auditLog.count({
          where: { targetId: roleMembership.id, action: "MEMBERSHIP_ROLE_CHANGED" },
        }),
      ).toBe(1);

      await resetFailOnceNotificationTrigger();
      const removedUser = await createUser("notification-replay-remove", "EMPLOYER");
      const removedMembership = await createMembership(
        fixture,
        removedUser.id,
        "VIEWER",
        fixture.ownerUserId,
      );
      const removeInput = {
        membershipId: removedMembership.id,
        reason: "Replay notification healing",
      };
      expect(
        await removeCompanyMember(
          fixture.companyId,
          ownerActor(fixture),
          removeInput,
          dependencies(undefined, new Date(NOW.getTime() + 2)),
        ),
      ).toEqual({ ok: true });
      expect(
        await client().notification.count({
          where: { recipientUserId: removedUser.id, kind: "TEAM_MEMBERSHIP_CHANGED" },
        }),
      ).toBe(0);
      expect(
        await removeCompanyMember(
          fixture.companyId,
          ownerActor(fixture),
          removeInput,
          dependencies(undefined, new Date(NOW.getTime() + 3)),
        ),
      ).toEqual({ ok: true });
      expect(
        await client().notification.count({
          where: { recipientUserId: removedUser.id, kind: "TEAM_MEMBERSHIP_CHANGED" },
        }),
      ).toBe(1);
      expect(
        await client().companyMembershipEvent.count({
          where: { membershipId: removedMembership.id, kind: "REMOVED" },
        }),
      ).toBe(1);
      expect(
        await client().auditLog.count({
          where: { targetId: removedMembership.id, action: "MEMBERSHIP_REMOVED" },
        }),
      ).toBe(1);

      await resetFailOnceNotificationTrigger();
      const recruiter = await createUser("notification-replay-assignment", "RECRUITER");
      const recruiterMembership = await createMembership(
        fixture,
        recruiter.id,
        "RECRUITER",
        fixture.ownerUserId,
      );
      const job = await createJob(fixture, "notification-replay-job");
      const assignmentInput = {
        jobId: job.id,
        membershipId: recruiterMembership.id,
        role: "EDITOR" as const,
      };
      const assigned = await assignRecruiterToJob(
        fixture.companyId,
        ownerActor(fixture),
        assignmentInput,
        dependencies(undefined, new Date(NOW.getTime() + 4)),
      );
      if (!assigned.ok) throw new Error(`Replay assignment failed: ${assigned.code}`);
      expect(
        await client().notification.count({
          where: { recipientUserId: recruiter.id, kind: "TEAM_MEMBERSHIP_CHANGED" },
        }),
      ).toBe(0);
      expect(
        await assignRecruiterToJob(
          fixture.companyId,
          ownerActor(fixture),
          assignmentInput,
          dependencies(undefined, new Date(NOW.getTime() + 5)),
        ),
      ).toEqual({ ok: true, assignmentId: assigned.assignmentId });
      expect(
        await client().notification.count({
          where: { recipientUserId: recruiter.id, kind: "TEAM_MEMBERSHIP_CHANGED" },
        }),
      ).toBe(1);
      expect(
        await client().jobAssignmentEvent.count({
          where: { jobAssignmentId: assigned.assignmentId },
        }),
      ).toBe(1);
      expect(
        await client().auditLog.count({
          where: { targetId: assigned.assignmentId, action: "JOB_ASSIGNMENT_CREATED" },
        }),
      ).toBe(1);

      await resetFailOnceNotificationTrigger();
      expect(
        await revokeJobAssignment(
          fixture.companyId,
          ownerActor(fixture),
          assigned.assignmentId,
          dependencies(undefined, new Date(NOW.getTime() + 6)),
        ),
      ).toEqual({ ok: true });
      expect(
        await client().notification.count({
          where: { recipientUserId: recruiter.id, kind: "TEAM_MEMBERSHIP_CHANGED" },
        }),
      ).toBe(1);
      expect(
        await revokeJobAssignment(
          fixture.companyId,
          ownerActor(fixture),
          assigned.assignmentId,
          dependencies(undefined, new Date(NOW.getTime() + 7)),
        ),
      ).toEqual({ ok: true });
      expect(
        await client().notification.count({
          where: { recipientUserId: recruiter.id, kind: "TEAM_MEMBERSHIP_CHANGED" },
        }),
      ).toBe(2);
      expect(
        await client().jobAssignmentEvent.count({
          where: { jobAssignmentId: assigned.assignmentId, kind: "REVOKED" },
        }),
      ).toBe(1);
      expect(
        await client().auditLog.count({
          where: { targetId: assigned.assignmentId, action: "JOB_ASSIGNMENT_REVOKED" },
        }),
      ).toBe(1);
    } finally {
      await removeFailOnceNotificationTrigger();
    }
  });

  it("rejects partial accepted-at or accepted-by invitation projections at the database boundary", async () => {
    const fixture = await createCompanyFixture("invitation-lifecycle", 3);
    const invitee = await createUser("invitation-lifecycle-target", "EMPLOYER");
    const invited = await sendCompanyInvitation(
      fixture.companyId,
      ownerActor(fixture),
      { email: invitee.email, role: "VIEWER" },
      dependencies(new CapturingEmailProvider()),
    );
    expect(invited.ok).toBe(true);
    const invitation = await client().companyInvitation.findFirstOrThrow({
      where: {
        companyId: fixture.companyId,
        inviteeEmailNormalized: invitee.email.trim().toLowerCase(),
        status: "PENDING",
      },
      select: { id: true },
    });

    await expect(
      client().companyInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: NOW },
      }),
    ).rejects.toBeDefined();
    await expect(
      client().companyInvitation.update({
        where: { id: invitation.id },
        data: { acceptedByUserId: invitee.id },
      }),
    ).rejects.toBeDefined();
  });
});

async function installFailOnceNotificationTrigger(): Promise<void> {
  await removeFailOnceNotificationTrigger();
  await client().$executeRawUnsafe(
    "CREATE SEQUENCE team_notification_fail_once_sequence START WITH 1",
  );
  await client().$executeRawUnsafe(`
    CREATE FUNCTION team_notification_fail_once() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF nextval('team_notification_fail_once_sequence') = 1 THEN
        RAISE EXCEPTION 'intentional first notification failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await client().$executeRawUnsafe(`
    CREATE TRIGGER team_notification_fail_once_trigger
    BEFORE INSERT ON "Notification"
    FOR EACH ROW EXECUTE FUNCTION team_notification_fail_once()
  `);
}

async function resetFailOnceNotificationTrigger(): Promise<void> {
  await client().$executeRawUnsafe(
    "ALTER SEQUENCE team_notification_fail_once_sequence RESTART WITH 1",
  );
}

async function removeFailOnceNotificationTrigger(): Promise<void> {
  await client().$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS team_notification_fail_once_trigger ON "Notification"',
  );
  await client().$executeRawUnsafe(
    "DROP FUNCTION IF EXISTS team_notification_fail_once()",
  );
  await client().$executeRawUnsafe(
    "DROP SEQUENCE IF EXISTS team_notification_fail_once_sequence",
  );
}

type CompanyFixture = Readonly<{
  companyId: string;
  ownerMembershipId: string;
  ownerUserId: string;
}>;

async function seedSharedCatalog(db: DatabaseClient): Promise<void> {
  const canton = await db.canton.create({
    data: {
      code: "TT",
      name: "Team Test Canton",
      slug: `team-test-canton-${randomUUID()}`,
      language: "DE",
    },
  });
  cantonId = canton.id;
  const city = await db.city.create({
    data: {
      cantonId,
      name: "Team Test City",
      slug: `team-test-city-${randomUUID()}`,
    },
  });
  cityId = city.id;

  const plan = await db.plan.create({
    data: {
      code: `TEAM_TEST_FREE_${randomUUID()}`,
      name: "Team test free plan",
      isDefaultFree: true,
    },
  });
  const version = await db.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: 0,
      monthlyEquivalentRappen: 0,
      validFrom: new Date(NOW.getTime() - DAY),
    },
  });
  await db.planEntitlement.createMany({
    data: [
      integerEntitlement(version.id, "ACTIVE_JOB_LIMIT", 10),
      integerEntitlement(version.id, "SEAT_LIMIT", 1),
      booleanEntitlement(version.id, "TALENT_RADAR_ACCESS", false),
      integerEntitlement(version.id, "TALENT_CONTACT_ALLOWANCE", 0),
      integerEntitlement(version.id, "JOB_BOOST_ALLOWANCE", 0),
      {
        planVersionId: version.id,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        analyticsLevelValue: "NONE",
      },
      booleanEntitlement(version.id, "ENHANCED_COMPANY_PROFILE", false),
      booleanEntitlement(version.id, "EMPLOYER_IMPORT_ACCESS", false),
    ],
  });
  await db.planVersion.update({
    where: { id: version.id },
    data: { status: "ACTIVE" },
  });
}

async function createCompanyFixture(
  label: string,
  seatLimit: number,
): Promise<CompanyFixture> {
  const owner = await createUser(`${label}-owner`, "EMPLOYER");
  const slug = `${label}-${randomUUID()}`;
  const company = await client().company.create({
    data: {
      name: `Team Test ${label}`,
      slug,
      industry: "Technology",
      size: "10-49",
      website: `https://${label}.example.test`,
      about:
        "A complete company used only for isolated team integration tests.",
      values: [],
      benefits: [],
      status: "DRAFT",
      dataProvenance: "TEST",
    },
  });
  await client().companyLocation.create({
    data: {
      companyId: company.id,
      cantonId,
      cityId,
      isPrimary: true,
    },
  });
  const ownerMembership = await client().companyMembership.create({
    data: {
      companyId: company.id,
      userId: owner.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: NOW,
      createdAt: NOW,
      events: {
        create: {
          kind: "CREATED",
          toRole: "OWNER",
          actorUserId: owner.id,
          reasonCode: "TEST_FIXTURE",
          correlationId: randomUUID(),
          createdAt: NOW,
        },
      },
    },
  });
  await client().company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
  await client().entitlementGrant.create({
    data: {
      companyId: company.id,
      key: "SEAT_LIMIT",
      valueType: "INTEGER",
      integerValue: seatLimit,
      integerMode: "REPLACE",
      reasonCode: "TEST_SEAT_LIMIT",
      grantedByUserId: owner.id,
      validFrom: new Date(NOW.getTime() - DAY),
      validTo: new Date(NOW.getTime() + 365 * DAY),
      idempotencyKey: `team-seat:${company.id}`,
    },
  });
  return Object.freeze({
    companyId: company.id,
    ownerMembershipId: ownerMembership.id,
    ownerUserId: owner.id,
  });
}

async function createUser(label: string, role: UserRole) {
  const email = uniqueEmail(label);
  return client().user.create({
    data: {
      email,
      emailNormalized: email,
      name: `Team Test ${label}`,
      role,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
      createdAt: NOW,
    },
    select: { id: true, email: true, role: true },
  });
}

async function createMembership(
  company: CompanyFixture,
  userId: string,
  role: MembershipRole,
  actorUserId: string,
) {
  return client().companyMembership.create({
    data: {
      companyId: company.companyId,
      userId,
      role,
      status: "ACTIVE",
      joinedAt: NOW,
      createdAt: NOW,
      events: {
        create: {
          kind: "CREATED",
          toRole: role,
          actorUserId,
          reasonCode: "TEST_FIXTURE",
          correlationId: randomUUID(),
          createdAt: NOW,
        },
      },
    },
  });
}

async function createJob(company: CompanyFixture, label: string) {
  return client().job.create({
    data: {
      companyId: company.companyId,
      slug: `${label}-${randomUUID()}`,
      status: "DRAFT",
      dataProvenance: "TEST",
      createdByUserId: company.ownerUserId,
      createdAt: NOW,
    },
    select: { id: true },
  });
}

function ownerActor(company: CompanyFixture) {
  return Object.freeze({
    userId: company.ownerUserId,
    membershipId: company.ownerMembershipId,
    role: "OWNER" as const,
  });
}

function dependencies(
  emailProvider?: EmailProvider,
  now = NOW,
  sourceIp = "127.0.0.1",
) {
  return Object.freeze({
    database: client(),
    environment: runtimeEnvironment(),
    request: requestContext(sourceIp),
    now,
    ...(emailProvider === undefined ? {} : { emailProvider }),
  });
}

function requestContext(sourceIp: string): AuthRequestContext {
  return Object.freeze({
    correlationId: randomUUID(),
    expectedOrigin: APP_URL,
    origin: APP_URL,
    production: false,
    sourceIp,
    userAgent: "SwissTalentHub Phase-10 team integration test",
  });
}

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.test`;
}

function integerEntitlement(
  planVersionId: string,
  key:
    | "ACTIVE_JOB_LIMIT"
    | "JOB_BOOST_ALLOWANCE"
    | "SEAT_LIMIT"
    | "TALENT_CONTACT_ALLOWANCE",
  integerValue: number,
) {
  return {
    planVersionId,
    key,
    valueType: "INTEGER" as const,
    integerValue,
  };
}

function booleanEntitlement(
  planVersionId: string,
  key:
    | "EMPLOYER_IMPORT_ACCESS"
    | "ENHANCED_COMPANY_PROFILE"
    | "TALENT_RADAR_ACCESS",
  booleanValue: boolean,
) {
  return {
    planVersionId,
    key,
    valueType: "BOOLEAN" as const,
    booleanValue,
  };
}

class CapturingEmailProvider implements EmailProvider {
  readonly messages: Array<Parameters<EmailProvider["send"]>[0]> = [];

  async send(input: Parameters<EmailProvider["send"]>[0]) {
    this.messages.push(structuredClone(input));
    return { logId: randomUUID() };
  }

  tokenAt(index: number): string {
    const rawUrl = this.messages[index]?.data.invitationUrl;
    if (typeof rawUrl !== "string") {
      throw new Error(`Invitation message ${index} has no invitation URL.`);
    }
    const token = new URL(rawUrl).pathname.split("/").at(-1);
    if (token === undefined || token.length === 0) {
      throw new Error(`Invitation message ${index} has no raw token.`);
    }
    return token;
  }
}
