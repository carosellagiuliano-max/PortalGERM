import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

describe("Phase 25 additive security migration", () => {
  let migrated: Migrated;
  let database: DatabaseClient;

  beforeAll(async () => {
    migrated = await createMigratedTestDatabase(
      "phase25_security_migration",
    );
    database = createDatabaseClient(migrated.connectionString);
    await database.$connect();
  });

  afterAll(async () => {
    await database.$disconnect().catch(() => undefined);
    await migrated.dispose();
  });

  it("creates the closed role catalog without a wildcard or default-all grant", async () => {
    const [roles, capabilities, assignments, grants] = await Promise.all([
      database.adminRole.findMany({
        orderBy: { code: "asc" },
        include: { capabilities: true },
      }),
      database.adminRoleCapability.findMany(),
      database.adminRoleAssignment.count(),
      database.adminCapabilityGrant.count(),
    ]);
    expect(roles).toHaveLength(10);
    expect(capabilities.length).toBeGreaterThanOrEqual(36);
    expect(
      capabilities.some(({ capability }) => capability.includes("*")),
    ).toBe(false);
    expect(assignments).toBe(0);
    expect(grants).toBe(0);
  });

  it("rejects orphan grants and duplicate active factors at the database boundary", async () => {
    const email = `phase25-migration-${randomUUID()}@example.test`;
    const user = await database.user.create({
      data: {
        email,
        emailNormalized: email,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    const role = await database.adminRole.findUniqueOrThrow({
      where: { code: "PLATFORM_OPERATOR" },
    });
    await expect(
      database.adminRoleAssignment.create({
        data: {
          userId: randomUUID(),
          adminRoleId: role.id,
          reasonCode: "ORPHAN_ATTEMPT",
          validFrom: new Date("2026-07-28T00:00:00.000Z"),
          validTo: new Date("2026-07-29T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow();

    await database.authenticator.create({
      data: {
        userId: user.id,
        kind: "TOTP",
        status: "PENDING",
        label: "Primary",
      },
    });
    await expect(
      database.authenticator.create({
        data: {
          userId: user.id,
          kind: "TOTP",
          status: "ACTIVE",
          label: "Primary",
          verifiedAt: new Date("2026-07-28T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("replays migrate deploy with zero additional catalog or grant effects", async () => {
    const before = {
      roles: await database.adminRole.count(),
      capabilities: await database.adminRoleCapability.count(),
      assignments: await database.adminRoleAssignment.count(),
      grants: await database.adminCapabilityGrant.count(),
    };
    await migrated.migrate();
    const after = {
      roles: await database.adminRole.count(),
      capabilities: await database.adminRoleCapability.count(),
      assignments: await database.adminRoleAssignment.count(),
      grants: await database.adminCapabilityGrant.count(),
    };
    expect(after).toEqual(before);
  });
});
