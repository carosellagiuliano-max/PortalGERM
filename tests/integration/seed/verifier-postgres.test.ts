import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { SEED_GOLDEN_COUNTS } from "@/prisma/seed/contract";
import {
  orchestrateDemoSeed,
  verifyPersistedDemoSeed,
} from "@/prisma/seed/orchestrator";
import { verifyDemoSeedDatabase } from "@/prisma/seed/verifier";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Verifier test database is not initialized.");
  }
  return database;
}

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase_05_database_verifier");
  database = createDatabaseClient(isolated.connectionString);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential("Phase-05 independent PostgreSQL verifier", () => {
  it("derives the exact golden contract from rows and is read-only on a sealed seed", async () => {
    const seeded = await orchestrateDemoSeed(client());
    const persisted = await client().demoSeedManifest.findFirstOrThrow({
      where: { completedAt: { not: null }, manifestHash: { not: null } },
    });
    const before = await loadObservedVersions(client());

    const rerun = await orchestrateDemoSeed(client());
    const afterRerun = await loadObservedVersions(client());
    const direct = await verifyDemoSeedDatabase(client(), persisted.anchorAt);
    const sealed = await verifyPersistedDemoSeed(client());
    const after = await loadObservedVersions(client());

    expect(seeded.previouslyCompleted).toBe(false);
    expect(rerun.previouslyCompleted).toBe(true);
    expect(rerun.envelope).toEqual(seeded.envelope);
    expect(afterRerun).toEqual(before);
    expect(direct.counts).toEqual(SEED_GOLDEN_COUNTS);
    expect(direct.report.checkCount).toBeGreaterThan(350);
    expect(direct.blockDigest).toEqual(
      seeded.envelope.manifest.blocks.find(
        (block) => block.name === "database-verification",
      ),
    );
    expect(sealed.envelope).toEqual(seeded.envelope);
    expect(sealed.verificationCheckCount).toBe(direct.report.checkCount);
    expect(after).toEqual(afterRerun);
  }, 600_000);

  it("rejects drift in a previously omitted Message body", async () => {
    const message = await client().message.findFirstOrThrow({
      orderBy: { id: "asc" },
    });
    await client().message.update({
      where: { id: message.id },
      data: { body: `${message.body} [drift]` },
    });

    await expect(verifyPersistedDemoSeed(client())).rejects.toThrow(
      "The observed demo seed database does not match its sealed manifest hash.",
    );
  }, 120_000);
});

async function loadObservedVersions(db: DatabaseClient) {
  const tables = await db.$queryRaw<Array<{ tableName: string }>>`
    SELECT c.relname AS "tableName"
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     ORDER BY c.relname
  `;
  const snapshot: Array<{ entity: string; id: string; version: string }> = [];

  for (const { tableName } of tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tableName)) {
      throw new Error(`Unsafe public table identifier ${tableName}.`);
    }
    const rows = await db.$queryRawUnsafe<
      Array<{ id: string; version: string }>
    >(
      `SELECT ctid::text AS id, xmin::text AS version FROM "${tableName}" ORDER BY ctid`,
    );
    snapshot.push(
      ...rows.map((row) => ({
        entity: tableName,
        id: row.id,
        version: row.version,
      })),
    );
  }

  return snapshot;
}
