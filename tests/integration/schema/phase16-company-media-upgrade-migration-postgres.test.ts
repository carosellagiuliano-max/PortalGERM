import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "prisma", "migrations");
const PRE_PHASE_16_MIGRATION =
  "20260722211000_phase_15_cluster_policy_versioned_check";
const COMPANY_MEDIA_MIGRATION =
  "20260723090000_phase_16_company_media_manifest";
const DATABASE_NAME_PATTERN = /^sth_test_phase16media_[a-f0-9]+$/u;

const COMPANY_IDS = Object.freeze({
  live: "9b000000-0000-4000-8000-000000000001",
  demo: "9b000000-0000-4000-8000-000000000002",
  test: "9b000000-0000-4000-8000-000000000003",
  empty: "9b000000-0000-4000-8000-000000000004",
});

describe("Phase-16 company-media upgrade migration", () => {
  it("normalizes legacy media per column for every provenance and preserves reviewed values", async () => {
    const database = await createPrePhase16Database();
    try {
      await insertHistoricalCompanyMedia(database.client);
      await applyMigration(database.client, COMPANY_MEDIA_MIGRATION);

      const companies = await database.client.query<{
        id: string;
        dataProvenance: "LIVE" | "DEMO" | "TEST";
        logoStorageKey: string | null;
        coverStorageKey: string | null;
      }>(
        `SELECT "id", "dataProvenance", "logoStorageKey", "coverStorageKey"
           FROM "Company"
          WHERE "id" = ANY($1::uuid[])
          ORDER BY "id"`,
        [Object.values(COMPANY_IDS)],
      );

      expect(companies.rows).toEqual([
        {
          id: COMPANY_IDS.live,
          dataProvenance: "LIVE",
          logoStorageKey: "/assets/company-media/default-logo.svg",
          coverStorageKey: "/assets/company-media/alpine-cover.svg",
        },
        {
          id: COMPANY_IDS.demo,
          dataProvenance: "DEMO",
          logoStorageKey: "/assets/company-media/default-logo.svg",
          coverStorageKey: "/assets/company-media/default-cover.svg",
        },
        {
          id: COMPANY_IDS.test,
          dataProvenance: "TEST",
          logoStorageKey: "/assets/company-media/default-logo.svg",
          coverStorageKey: "/assets/company-media/default-cover.svg",
        },
        {
          id: COMPANY_IDS.empty,
          dataProvenance: "LIVE",
          logoStorageKey: null,
          coverStorageKey: null,
        },
      ]);

      await expectConstraint(
        () =>
          database.client.query(
            `UPDATE "Company"
                SET "logoStorageKey" = 'https://tracking.example/pixel.svg'
              WHERE "id" = $1::uuid`,
            [COMPANY_IDS.live],
          ),
        "Company_logoStorageKey_reviewed_manifest_check",
      );
      await expectConstraint(
        () =>
          database.client.query(
            `UPDATE "Company"
                SET "coverStorageKey" = '/uploads/unreviewed-cover.svg'
              WHERE "id" = $1::uuid`,
            [COMPANY_IDS.demo],
          ),
        "Company_coverStorageKey_reviewed_manifest_check",
      );
    } finally {
      await database.dispose();
    }
  }, 120_000);
});

async function insertHistoricalCompanyMedia(client: Client) {
  await client.query(
    `INSERT INTO "Company" (
       "id", "name", "slug", "logoStorageKey", "coverStorageKey",
       "values", "benefits", "dataProvenance", "updatedAt"
     ) VALUES
       (
         $1::uuid, 'Live Legacy Media AG', 'live-legacy-media-ag',
         's3://legacy-live/logo.svg',
         '/assets/company-media/alpine-cover.svg',
         ARRAY[]::text[], ARRAY[]::text[], 'LIVE', CURRENT_TIMESTAMP
       ),
       (
         $2::uuid, 'Demo Legacy Media AG', 'demo-legacy-media-ag',
         '/assets/company-media/default-logo.svg',
         'mock-storage/demo/company/legacy-cover.svg',
         ARRAY[]::text[], ARRAY[]::text[], 'DEMO', CURRENT_TIMESTAMP
       ),
       (
         $3::uuid, 'Test Legacy Media AG', 'test-legacy-media-ag',
         '/uploads/test-logo.svg', 'https://legacy.example/cover.svg',
         ARRAY[]::text[], ARRAY[]::text[], 'TEST', CURRENT_TIMESTAMP
       ),
       (
         $4::uuid, 'Empty Media AG', 'empty-media-ag',
         NULL, NULL,
         ARRAY[]::text[], ARRAY[]::text[], 'LIVE', CURRENT_TIMESTAMP
       )`,
    [
      COMPANY_IDS.live,
      COMPANY_IDS.demo,
      COMPANY_IDS.test,
      COMPANY_IDS.empty,
    ],
  );
}

async function expectConstraint(
  operation: () => Promise<unknown>,
  constraint: string,
) {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toEqual(
    expect.objectContaining({ code: "23514", constraint }),
  );
}

async function createPrePhase16Database() {
  const configuration = getIsolatedTestDatabaseConfiguration();
  const baseUrl = new URL(configuration.connectionString);
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.searchParams.delete("schema");
  const databaseName =
    `sth_test_phase16media_${randomUUID().replaceAll("-", "")}`;
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Generated Phase-16 media upgrade database name is unsafe.");
  }
  const databaseUrl = new URL(baseUrl);
  databaseUrl.pathname = `/${databaseName}`;
  databaseUrl.searchParams.set("schema", "public");
  const maintenance = new Client({
    connectionString: maintenanceUrl.toString(),
  });
  await maintenance.connect();
  try {
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await maintenance.end();
  }

  const client = new Client({ connectionString: databaseUrl.toString() });
  try {
    await client.connect();
    await applyMigrationsThrough(client, PRE_PHASE_16_MIGRATION);
  } catch (error) {
    await client.end().catch(() => undefined);
    await dropDatabase(maintenanceUrl, databaseName);
    throw error;
  }

  return Object.freeze({
    client,
    async dispose() {
      await client.end().catch(() => undefined);
      await dropDatabase(maintenanceUrl, databaseName);
    },
  });
}

async function applyMigrationsThrough(client: Client, finalMigration: string) {
  const entries = await readdir(MIGRATIONS_DIRECTORY, {
    withFileTypes: true,
  });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name <= finalMigration)
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await applyMigration(client, migration);
  }
}

async function applyMigration(client: Client, migration: string) {
  const sql = await readFile(
    resolve(MIGRATIONS_DIRECTORY, migration, "migration.sql"),
    "utf8",
  );
  await client.query(sql);
}

async function dropDatabase(maintenanceUrl: URL, databaseName: string) {
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Refusing to drop an unsafe Phase-16 media database.");
  }
  const maintenance = new Client({
    connectionString: maintenanceUrl.toString(),
  });
  await maintenance.connect();
  try {
    await maintenance.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await maintenance.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await maintenance.end();
  }
}
