import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPhase27PersonaFixture,
  type Phase27PersonaFixture,
} from "@/tests/fixtures/phase27-persona";

describe.sequential("Phase 27 additive persona migration", () => {
  let fixture: Phase27PersonaFixture;

  beforeAll(async () => {
    fixture = await createPhase27PersonaFixture("migration");
  }, 120_000);

  afterAll(async () => {
    await fixture.dispose();
  });

  it("installs closed enums, named checks, indexes and invalidation triggers", async () => {
    const enumValues = await fixture.database.$queryRaw<
      { enumName: string; value: string }[]
    >`
      SELECT type.typname AS "enumName", enum.enumlabel AS "value"
        FROM pg_type type
        JOIN pg_enum enum ON enum.enumtypid = type.oid
       WHERE type.typname IN (
         'PersonaKind',
         'PersonaAssignmentStatus',
         'PersonaAssignmentSource',
         'PortalContextKind'
       )
       ORDER BY type.typname, enum.enumsortorder
    `;
    expect(enumValues).toEqual(
      expect.arrayContaining([
        { enumName: "PersonaKind", value: "CANDIDATE" },
        { enumName: "PersonaKind", value: "EMPLOYER" },
        { enumName: "PersonaAssignmentStatus", value: "SUSPENDED" },
        { enumName: "PersonaAssignmentSource", value: "SELF_SERVICE" },
        { enumName: "PortalContextKind", value: "ADMIN" },
      ]),
    );

    const constraints = await fixture.database.$queryRaw<{ name: string }[]>`
      SELECT constraint_name AS "name"
        FROM information_schema.table_constraints
       WHERE table_schema = 'public'
         AND constraint_name IN (
           'persona_assignment_version_check',
           'persona_assignment_status_time_check',
           'persona_assignment_event_transition_check',
           'session_context_version_check',
           'session_company_context_check',
           'audit_session_context_version_check',
           'analytics_session_context_version_check'
         )
       ORDER BY constraint_name
    `;
    expect(constraints).toHaveLength(7);
    const triggers = await fixture.database.$queryRaw<{ name: string }[]>`
      SELECT tgname AS "name"
        FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname LIKE 'phase27_%'
       ORDER BY tgname
    `;
    expect(triggers.map(({ name }) => name)).toEqual([
      "phase27_company_membership_session_invalidation",
      "phase27_persona_assignment_event_append_only",
      "phase27_persona_assignment_identity",
      "phase27_persona_assignment_session_invalidation",
    ]);
  });

  it("rejects duplicate personas, invalid lifecycle timestamps and history mutation", async () => {
    await expect(
      fixture.database.personaAssignment.create({
        data: {
          userId: fixture.dual.userId,
          kind: "CANDIDATE",
          source: "SELF_SERVICE",
          activatedAt: fixture.now,
          updatedAt: fixture.now,
        },
      }),
    ).rejects.toThrow();
    await expect(
      fixture.database.personaAssignment.create({
        data: {
          userId: fixture.admin.userId,
          kind: "CANDIDATE",
          source: "SELF_SERVICE",
          status: "SUSPENDED",
          activatedAt: fixture.now,
          suspendedAt: null,
          updatedAt: fixture.now,
        },
      }),
    ).rejects.toThrow();

    const assignment =
      await fixture.database.personaAssignment.findUniqueOrThrow({
        where: {
          userId_kind: {
            userId: fixture.dual.userId,
            kind: "CANDIDATE",
          },
        },
        include: { events: true },
      });
    await expect(
      fixture.database.personaAssignment.update({
        where: { id: assignment.id },
        data: { updatedAt: new Date(fixture.now.getTime() + 1_000) },
      }),
    ).rejects.toThrow();
    await expect(
      fixture.database.personaAssignmentEvent.update({
        where: { id: assignment.events[0]!.id },
        data: { reasonCode: "MUTATION_ATTEMPT" },
      }),
    ).rejects.toThrow(/append-only/iu);
  });

  it("replays migrate deploy without changing persona, event, membership or session counts", async () => {
    const before = await counts(fixture);
    await fixture.migrated.migrate();
    expect(await counts(fixture)).toEqual(before);
  }, 120_000);
});

async function counts(fixture: Phase27PersonaFixture) {
  const [personas, events, memberships, sessions, grants] = await Promise.all([
    fixture.database.personaAssignment.count(),
    fixture.database.personaAssignmentEvent.count(),
    fixture.database.companyMembership.count(),
    fixture.database.session.count(),
    fixture.database.adminCapabilityGrant.count(),
  ]);
  return { personas, events, memberships, sessions, grants };
}
