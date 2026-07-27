import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { revokeAdminRoleAssignment } from "@/lib/admin/security-governance";
import { resolveAdminActor } from "@/lib/admin/role-policy";
import {
  createPhase25SecurityFixture,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";

describe("Phase 25 immediate admin revocation", () => {
  let fixture: Phase25SecurityFixture;

  beforeAll(async () => {
    fixture = await createPhase25SecurityFixture("phase25_admin_revocation");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("revokes assignment, sessions and assurance in the same commit", async () => {
    const assignmentId = await fixture.assignRole(
      fixture.targetAdmin,
      "SUPPORT_AGENT",
    );
    await fixture.issueAal2(fixture.targetAdmin);
    expect(
      (
        await resolveAdminActor(
          fixture.database,
          {
            userId: fixture.targetAdmin.userId,
            role: "ADMIN",
            status: "ACTIVE",
          },
          fixture.now,
        )
      ).capabilities,
    ).toContain("ADMIN_SUPPORT_MANAGE");

    const revoked = await revokeAdminRoleAssignment(
      { id: assignmentId, reasonCode: "ACCESS_NO_LONGER_REQUIRED" },
      fixture.adminDependencies(fixture.requester),
    );
    expect(revoked).toEqual({
      ok: true,
      value: { assignmentId },
    });

    const [assignment, session, activeAssurance, actor] = await Promise.all([
      fixture.database.adminRoleAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
      }),
      fixture.database.session.findUniqueOrThrow({
        where: { id: fixture.targetAdmin.sessionId },
      }),
      fixture.database.sessionAssurance.count({
        where: {
          userId: fixture.targetAdmin.userId,
          revokedAt: null,
        },
      }),
      resolveAdminActor(
        fixture.database,
        {
          userId: fixture.targetAdmin.userId,
          role: "ADMIN",
          status: "ACTIVE",
        },
        fixture.now,
      ),
    ]);
    expect(assignment.revokedAt).toEqual(fixture.now);
    expect(session.revokedAt).toEqual(fixture.now);
    expect(activeAssurance).toBe(0);
    expect(actor.capabilities).toEqual([]);
  });

  it("does not permit a security operator to revoke their own role", async () => {
    const ownAssignment = await fixture.database.adminRoleAssignment.findFirstOrThrow({
      where: {
        userId: fixture.requester.userId,
        adminRole: { code: "SECURITY_ADMIN" },
        revokedAt: null,
      },
      select: { id: true },
    });
    expect(
      await revokeAdminRoleAssignment(
        { id: ownAssignment.id, reasonCode: "SELF_REVOKE_ATTEMPT" },
        fixture.adminDependencies(fixture.requester),
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});
