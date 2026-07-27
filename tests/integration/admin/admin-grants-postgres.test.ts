import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  approveAdminRoleAssignment,
  requestAdminRoleAssignment,
} from "@/lib/admin/security-governance";
import { resolveAdminActor } from "@/lib/admin/role-policy";
import {
  createPhase25SecurityFixture,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";

describe("Phase 25 persisted admin grants", () => {
  let fixture: Phase25SecurityFixture;

  beforeAll(async () => {
    fixture = await createPhase25SecurityFixture("phase25_admin_grants");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("keeps an active global ADMIN at zero capabilities without a grant", async () => {
    const actor = await resolveAdminActor(
      fixture.database,
      {
        userId: fixture.targetAdmin.userId,
        role: "ADMIN",
        status: "ACTIVE",
      },
      fixture.now,
    );
    expect(actor.capabilities).toEqual([]);
    expect(actor.duties).toEqual([]);
  });

  it("requires a different approver and persists only the requested role", async () => {
    const requested = await requestAdminRoleAssignment(
      {
        userId: fixture.targetAdmin.userId,
        roleCode: "JOB_MODERATOR",
        validTo: new Date(
          fixture.now.getTime() + 60 * 60_000,
        ).toISOString(),
        reasonCode: "MODERATION_COVERAGE",
      },
      fixture.adminDependencies(fixture.requester),
    );
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    expect(
      await approveAdminRoleAssignment(
        {
          approvalId: requested.value.approvalId,
          reasonCode: "SELF_APPROVAL_ATTEMPT",
        },
        fixture.adminDependencies(fixture.requester),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });

    const approved = await approveAdminRoleAssignment(
      {
        approvalId: requested.value.approvalId,
        reasonCode: "SECOND_ACTOR_APPROVED",
      },
      fixture.adminDependencies(fixture.approver),
    );
    expect(approved.ok).toBe(true);

    const actor = await resolveAdminActor(
      fixture.database,
      {
        userId: fixture.targetAdmin.userId,
        role: "ADMIN",
        status: "ACTIVE",
      },
      fixture.now,
    );
    expect(actor.duties).toEqual(["MODERATION"]);
    expect(actor.capabilities).toContain("ADMIN_JOB_REVIEW");
    expect(actor.capabilities).not.toContain("ADMIN_BILLING_MUTATE");
    expect(
      await fixture.database.auditLog.count({
        where: {
          action: {
            in: [
              "ADMIN_ROLE_ASSIGNMENT_REQUESTED",
              "ADMIN_ROLE_ASSIGNMENT_APPROVED",
            ],
          },
        },
      }),
    ).toBe(2);
  });
});
