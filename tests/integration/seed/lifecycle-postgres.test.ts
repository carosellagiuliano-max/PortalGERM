import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  SEED_DATASET_VERSION,
  SEED_GOLDEN_COUNTS,
  SEED_NAMESPACE,
} from "@/prisma/seed/contract";
import { stableSeedId } from "@/prisma/seed/ids";
import { beginSeedRun, completeSeedRun } from "@/prisma/seed/lifecycle";
import { buildSeedManifest } from "@/prisma/seed/manifest";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const identities = [
  {
    entity: "integration-fixture",
    id: stableSeedId("integration-fixture", "manifest-lifecycle"),
    naturalKey: "manifest-lifecycle",
  },
] as const;

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The manifest lifecycle database is not initialized.");
  }
  return database;
}

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase_05_seed_lifecycle");
  database = createDatabaseClient(isolated.connectionString);
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential("Phase-05 PostgreSQL seed lifecycle", () => {
  it("reuses the first anchor and seals exactly one result hash", async () => {
    const firstClock = new Date("2026-07-20T10:00:00.000Z");
    const first = await beginSeedRun(client(), identities, () => firstClock);
    const retry = await beginSeedRun(client(), identities, () =>
      new Date("2030-01-01T00:00:00.000Z"),
    );

    expect(first).toEqual({
      anchorAt: firstClock,
      completed: false,
      manifestHash: null,
    });
    expect(retry).toEqual(first);

    const envelope = buildSeedManifest({
      anchorAt: first.anchorAt.toISOString(),
      counts: SEED_GOLDEN_COUNTS,
      identities,
      seedVersion: SEED_DATASET_VERSION,
    });
    await completeSeedRun(client(), envelope, () =>
      new Date("2026-07-20T10:01:00.000Z"),
    );
    await completeSeedRun(client(), envelope, () =>
      new Date("2026-07-20T10:02:00.000Z"),
    );

    const completed = await beginSeedRun(client(), identities);
    expect(completed).toMatchObject({
      anchorAt: firstClock,
      completed: true,
      manifestHash: envelope.manifestSha256,
    });
  });

  it("lets PostgreSQL reject rewriting or deleting sealed evidence", async () => {
    await expect(
      client().demoSeedManifest.update({
        data: { contractHash: "0".repeat(64) },
        where: {
          namespace_seedVersion: {
            namespace: SEED_NAMESPACE,
            seedVersion: SEED_DATASET_VERSION,
          },
        },
      }),
    ).rejects.toThrow();

    await expect(
      client().demoSeedManifest.delete({
        where: {
          namespace_seedVersion: {
            namespace: SEED_NAMESPACE,
            seedVersion: SEED_DATASET_VERSION,
          },
        },
      }),
    ).rejects.toThrow();
  });
}, 120_000);
