import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  approveBreakGlassGrant,
  projectExpiredSecurityGrants,
  requestAdminRoleAssignment,
  requestBreakGlassGrant,
} from "@/lib/admin/security-governance";
import { resolveAdminActor } from "@/lib/admin/role-policy";
import { projectExpiredSecurityState } from "@/lib/security/security-expiry";
import {
  createPhase25SecurityFixture,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";

describe("Phase 25 separation of duties and break-glass", () => {
  let fixture: Phase25SecurityFixture;

  beforeAll(async () => {
    fixture = await createPhase25SecurityFixture(
      "phase25_admin_sod_breakglass",
    );
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("rejects a conflicting finance plus security role combination", async () => {
    await fixture.assignRole(fixture.targetAdmin, "FINANCE_OPERATOR");
    expect(
      await requestAdminRoleAssignment(
        {
          userId: fixture.targetAdmin.userId,
          roleCode: "SECURITY_ADMIN",
          validTo: new Date(
            fixture.now.getTime() + 60 * 60_000,
          ).toISOString(),
          reasonCode: "CONFLICTING_DUTY_ATTEMPT",
        },
        fixture.adminDependencies(fixture.requester),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("activates break-glass with two actors, alerts, then expires fail closed", async () => {
    const validTo = new Date(fixture.now.getTime() + 10 * 60_000);
    const requested = await requestBreakGlassGrant(
      {
        userId: fixture.targetAdmin.userId,
        capabilities: ["ADMIN_SECURITY_READ"],
        incidentReference: "INC-P25-0001",
        validTo: validTo.toISOString(),
        reasonCode: "ACTIVE_SECURITY_INCIDENT",
      },
      fixture.adminDependencies(fixture.requester),
    );
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    expect(
      await approveBreakGlassGrant(
        {
          approvalId: requested.value.approvalId,
          reasonCode: "SELF_APPROVAL_ATTEMPT",
        },
        fixture.adminDependencies(fixture.requester),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });

    const activated = await approveBreakGlassGrant(
      {
        approvalId: requested.value.approvalId,
        reasonCode: "INCIDENT_APPROVED",
      },
      fixture.adminDependencies(fixture.approver),
    );
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
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
    ).toContain("ADMIN_SECURITY_READ");
    expect(
      await fixture.database.systemTask.count({
        where: {
          kind: "SECURITY_INCIDENT",
          reasonCode: "BREAK_GLASS_ACTIVATED",
        },
      }),
    ).toBe(1);

    const projected = await projectExpiredSecurityState(fixture.database, {
      correlationId: crypto.randomUUID(),
      now: new Date(validTo.getTime() + 1),
    });
    expect(projected.breakGlass).toBe(1);
    expect(
      (
        await fixture.database.breakGlassGrant.findUniqueOrThrow({
          where: { id: activated.value.grantId },
        })
      ).status,
    ).toBe("EXPIRED");
    expect(
      (
        await fixture.database.session.findUniqueOrThrow({
          where: { id: fixture.targetAdmin.sessionId },
        })
      ).revokedAt,
    ).not.toBeNull();
  });

  it("keeps the actor-gated compatibility projector protected", async () => {
    expect(
      await projectExpiredSecurityGrants(
        fixture.adminDependencies(fixture.targetAdmin),
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});
