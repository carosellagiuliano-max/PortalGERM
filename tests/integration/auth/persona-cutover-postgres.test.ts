import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { switchPersonaContext } from "@/lib/auth/persona-context";
import { parseEnvironment } from "@/lib/config/env-schema";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import {
  createPhase27PersonaFixture,
  type Phase27PersonaFixture,
} from "@/tests/fixtures/phase27-persona";

describe.sequential("Phase 27 dual-read cutover and kill switch", () => {
  let fixture: Phase27PersonaFixture;

  beforeAll(async () => {
    fixture = await createPhase27PersonaFixture("cutover");
  }, 120_000);

  afterAll(async () => {
    await fixture.dispose();
  });

  it.each([
    ["disabled", "disabled"],
    ["dual read", "dual_read"],
  ] as const)("blocks new switches in %s while preserving legacy authority", async (_label, mode) => {
    const environment = parseEnvironment(
      createValidEnvironment({
        APP_URL: "http://phase27-persona.test",
        DATABASE_URL: fixture.migrated.connectionString,
        IDENTITY_PERSONA_V2: mode,
        EXISTING_IDENTITY_INVITATION: "false",
        PERSONA_PORTAL_SWITCH: "false",
        PERSONA_PRIVACY_V2: "false",
        PERSONA_LEGACY_CONTRACT: "false",
      }),
    );
    const before =
      await fixture.database.session.findUniqueOrThrow({
        where: { id: fixture.dual.sessionId },
        select: {
          activePortal: true,
          activeCompanyId: true,
          contextVersion: true,
        },
      });
    expect(
      await switchPersonaContext(
        { portal: "CANDIDATE" },
        await fixture.contextActor(fixture.dual),
        {
          database: fixture.database,
          environment,
          request: fixture.request(),
          now: fixture.now,
        },
      ),
    ).toEqual({ ok: false, code: "FEATURE_DISABLED" });
    await expect(
      fixture.database.session.findUniqueOrThrow({
        where: { id: fixture.dual.sessionId },
        select: {
          activePortal: true,
          activeCompanyId: true,
          contextVersion: true,
        },
      }),
    ).resolves.toEqual(before);
  });

  it("keeps User.role and all valid memberships as the rollback reader", async () => {
    const [user, assignments, memberships] = await Promise.all([
      fixture.database.user.findUniqueOrThrow({
        where: { id: fixture.dual.userId },
        select: { role: true },
      }),
      fixture.database.personaAssignment.findMany({
        where: { userId: fixture.dual.userId },
        orderBy: { kind: "asc" },
      }),
      fixture.database.companyMembership.findMany({
        where: { userId: fixture.dual.userId },
        orderBy: { companyId: "asc" },
      }),
    ]);
    expect(user.role).toBe("EMPLOYER");
    expect(assignments.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: "CANDIDATE", status: "ACTIVE" },
      { kind: "EMPLOYER", status: "ACTIVE" },
    ]);
    expect(memberships).toHaveLength(2);
    expect(memberships.every(({ status }) => status === "ACTIVE")).toBe(true);
    expect(
      await fixture.database.adminCapabilityGrant.count({
        where: { userId: fixture.dual.userId },
      }),
    ).toBe(0);
  });
});
