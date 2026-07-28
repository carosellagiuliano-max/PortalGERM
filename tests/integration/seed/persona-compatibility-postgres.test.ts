import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { reconcileDemoPersonaCompatibility } from "@/prisma/seed/blocks/persona-compatibility";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

const ANCHOR = new Date("2026-07-28T17:00:00.000Z");

describe("Phase 27 fresh-seed persona compatibility", () => {
  let database: DatabaseClient;
  let migrated: Awaited<ReturnType<typeof createMigratedTestDatabase>>;

  beforeAll(async () => {
    migrated = await createMigratedTestDatabase("phase27_seed_persona");
    database = createDatabaseClient(migrated.connectionString);
    await database.$connect();
  });

  afterAll(async () => {
    await database?.$disconnect().catch(() => undefined);
    await migrated?.dispose();
  });

  it("projects post-migration DEMO identities idempotently without granting Admin", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createdAt = new Date("2026-07-01T08:00:00.000Z");
    const users = await Promise.all(
      [
        { label: "candidate", role: "CANDIDATE", status: "ACTIVE" },
        { label: "employer", role: "EMPLOYER", status: "ACTIVE" },
        { label: "recruiter", role: "RECRUITER", status: "ACTIVE" },
        { label: "suspended", role: "CANDIDATE", status: "SUSPENDED" },
        { label: "admin", role: "ADMIN", status: "ACTIVE" },
      ].map((fixture) =>
        database.user.create({
          data: {
            email: `${fixture.label}-${suffix}@phase27-seed.example`,
            emailNormalized: `${fixture.label}-${suffix}@phase27-seed.example`,
            role: fixture.role as
              | "ADMIN"
              | "CANDIDATE"
              | "EMPLOYER"
              | "RECRUITER",
            status: fixture.status as "ACTIVE" | "SUSPENDED",
            dataProvenance: "DEMO",
            createdAt,
          },
          select: { id: true, role: true, status: true },
        }),
      ),
    );

    const first = await reconcileDemoPersonaCompatibility(database, ANCHOR);
    const second = await reconcileDemoPersonaCompatibility(database, ANCHOR);
    const userIds = users.map(({ id }) => id);
    const assignments = await database.personaAssignment.findMany({
      where: { userId: { in: userIds } },
      orderBy: [{ userId: "asc" }, { kind: "asc" }],
      select: {
        userId: true,
        kind: true,
        status: true,
        source: true,
        events: {
          select: {
            kind: true,
            toStatus: true,
            source: true,
            reasonCode: true,
          },
        },
      },
    });

    expect(first.assignmentCount).toBe(4);
    expect(first.eventCount).toBe(4);
    expect(second).toEqual(first);
    expect(assignments).toHaveLength(4);
    expect(assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "CANDIDATE",
          status: "SUSPENDED",
          source: "LEGACY_BACKFILL",
        }),
        expect.objectContaining({
          kind: "CANDIDATE",
          status: "ACTIVE",
          source: "LEGACY_BACKFILL",
        }),
        expect.objectContaining({
          kind: "EMPLOYER",
          status: "ACTIVE",
          source: "LEGACY_BACKFILL",
        }),
      ]),
    );
    expect(
      assignments.every(
        ({ events }) =>
          events.length === 1 &&
          events[0]?.kind === "MIGRATED" &&
          events[0].source === "LEGACY_BACKFILL" &&
          events[0].reasonCode === "LEGACY_ROLE_BACKFILL",
      ),
    ).toBe(true);
    const admin = users.find(({ role }) => role === "ADMIN");
    expect(
      assignments.some(({ userId }) => userId === admin?.id),
    ).toBe(false);
  });
});
