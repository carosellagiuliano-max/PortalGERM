import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveAdminActor } from "@/lib/admin/role-policy";
import { switchPersonaContext } from "@/lib/auth/persona-context";
import { effectiveLegacyRoleForContext } from "@/lib/auth/persona-policy";
import {
  createPhase27PersonaFixture,
  type Phase27PersonaFixture,
} from "@/tests/fixtures/phase27-persona";

describe.sequential("Phase 27 admin and normal-persona separation", () => {
  let fixture: Phase27PersonaFixture;

  beforeAll(async () => {
    fixture = await createPhase27PersonaFixture("admin_separation");
  }, 120_000);

  afterAll(async () => {
    await fixture.dispose();
  });

  it("denies an admin portal switch for every non-admin identity combination", async () => {
    expect(
      await switchPersonaContext(
        { portal: "ADMIN" },
        await fixture.contextActor(fixture.dual),
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "CONTEXT_UNAVAILABLE" });
    expect(
      await resolveAdminActor(
        fixture.database,
        {
          userId: fixture.dual.userId,
          role: "ADMIN",
          status: "ACTIVE",
        },
        fixture.now,
      ),
    ).toMatchObject({
      capabilities: [],
      duties: [],
      breakGlassGrantIds: [],
    });
  });

  it("keeps an admin identity's normal persona and company membership outside its explicit grants", async () => {
    for (const kind of ["CANDIDATE", "EMPLOYER"] as const) {
      await fixture.database.personaAssignment.create({
        data: {
          userId: fixture.admin.userId,
          kind,
          status: "ACTIVE",
          source: "SUPPORT_LINK",
          version: 1,
          activatedAt: fixture.now,
          createdAt: fixture.now,
          updatedAt: fixture.now,
          events: {
            create: {
              kind: "CREATED",
              toStatus: "ACTIVE",
              source: "SUPPORT_LINK",
              actorUserId: fixture.admin.userId,
              reasonCode: "PHASE27_ADMIN_SEPARATION_TEST",
              correlationId: crypto.randomUUID(),
              createdAt: fixture.now,
            },
          },
        },
      });
    }
    await fixture.database.candidateProfile.create({
      data: {
        userId: fixture.admin.userId,
        onboardingStatus: "DRAFT",
      },
    });
    await fixture.database.companyMembership.create({
      data: {
        companyId: fixture.companyAId,
        userId: fixture.admin.userId,
        role: "ADMIN",
        status: "ACTIVE",
        joinedAt: fixture.now,
        events: {
          create: {
            kind: "CREATED",
            toRole: "ADMIN",
            actorUserId: fixture.employer.userId,
            reasonCode: "PHASE27_ADMIN_SEPARATION_TEST",
            correlationId: crypto.randomUUID(),
            createdAt: fixture.now,
          },
        },
      },
    });

    const role = await fixture.database.adminRole.findUniqueOrThrow({
      where: { code: "PLATFORM_OPERATOR" },
    });
    await fixture.database.adminRoleAssignment.create({
      data: {
        userId: fixture.admin.userId,
        adminRoleId: role.id,
        reasonCode: "PHASE27_EXPLICIT_ADMIN_GRANT",
        validFrom: new Date(fixture.now.getTime() - 1_000),
        validTo: new Date(fixture.now.getTime() + 86_400_000),
        createdAt: fixture.now,
      },
    });
    const explicit = await resolveAdminActor(
      fixture.database,
      {
        userId: fixture.admin.userId,
        role: "ADMIN",
        status: "ACTIVE",
      },
      fixture.now,
    );
    expect(explicit.capabilities.length).toBeGreaterThan(0);

    expect(
      await switchPersonaContext(
        { portal: "EMPLOYER", companyId: fixture.companyAId },
        await fixture.contextActor(fixture.admin),
        fixture.dependencies(),
      ),
    ).toMatchObject({
      ok: true,
      portal: "EMPLOYER",
      companyId: fixture.companyAId,
    });
    expect(
      effectiveLegacyRoleForContext({
        identityRole: "ADMIN",
        portal: "EMPLOYER",
        membershipRole: "ADMIN",
      }),
    ).toBe("EMPLOYER");
    expect(
      await fixture.database.adminRoleAssignment.count({
        where: { userId: fixture.admin.userId },
      }),
    ).toBe(1);
    expect(
      await fixture.database.adminCapabilityGrant.count({
        where: { userId: fixture.admin.userId },
      }),
    ).toBe(0);

    expect(
      await switchPersonaContext(
        { portal: "ADMIN" },
        await fixture.contextActor(fixture.admin),
        fixture.dependencies(),
      ),
    ).toMatchObject({ ok: true, portal: "ADMIN", companyId: null });
  });
});
