import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const SQLSTATE = {
  checkViolation: "23514",
  uniqueViolation: "23505",
} as const;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const ANCHOR_AT = "2026-01-15T09:00:00.000Z";
const COMPLETED_AT = "2026-01-15T09:15:00.000Z";

let database: MigratedDatabase | undefined;

function pool(): Pool {
  if (!database) {
    throw new Error("Phase 05 seed contract database is unavailable.");
  }

  return database.pool;
}

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase05_seed_manifest_contract");
});

afterAll(async () => {
  await database?.dispose();
  database = undefined;
});

describe("Phase 05 seed schema contract", () => {
  it("exposes only the versioned create-or-verify manifest identity and evidence fields", async () => {
    const columns = await pool().query<{
      character_maximum_length: number | null;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'DemoSeedManifest'
       ORDER BY ordinal_position`,
    );

    expect(columns.rows).toEqual([
      {
        character_maximum_length: 64,
        column_name: "namespace",
        data_type: "character varying",
        is_nullable: "NO",
      },
      {
        character_maximum_length: 64,
        column_name: "seedVersion",
        data_type: "character varying",
        is_nullable: "NO",
      },
      {
        character_maximum_length: 64,
        column_name: "schemaVersion",
        data_type: "character varying",
        is_nullable: "NO",
      },
      {
        character_maximum_length: 64,
        column_name: "contractHash",
        data_type: "character varying",
        is_nullable: "NO",
      },
      {
        character_maximum_length: 64,
        column_name: "manifestHash",
        data_type: "character varying",
        is_nullable: "YES",
      },
      {
        character_maximum_length: null,
        column_name: "anchorAt",
        data_type: "timestamp with time zone",
        is_nullable: "NO",
      },
      {
        character_maximum_length: null,
        column_name: "completedAt",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      },
      {
        character_maximum_length: null,
        column_name: "createdAt",
        data_type: "timestamp with time zone",
        is_nullable: "NO",
      },
    ]);

    const primaryKey = await pool().query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = '"DemoSeedManifest"'::regclass
         AND conname = 'DemoSeedManifest_pkey'`,
    );
    expect(primaryKey.rows).toEqual([
      { definition: 'PRIMARY KEY (namespace, "seedVersion")' },
    ]);
  });

  it("adds the content language and occupation disclaimer without weakening publication", async () => {
    const columns = await pool().query<{
      column_default: string | null;
      column_name: string;
      data_type: string;
      is_nullable: string;
      table_name: string;
      udt_name: string;
    }>(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (
           ('JobRevision', 'contentLanguage'),
           ('OccupationCodeVersion', 'disclaimer')
         )
       ORDER BY table_name, column_name`,
    );

    expect(columns.rows).toEqual([
      {
        column_default: "'DE'::\"Language\"",
        column_name: "contentLanguage",
        data_type: "USER-DEFINED",
        is_nullable: "NO",
        table_name: "JobRevision",
        udt_name: "Language",
      },
      {
        column_default: null,
        column_name: "disclaimer",
        data_type: "character varying",
        is_nullable: "NO",
        table_name: "OccupationCodeVersion",
        udt_name: "varchar",
      },
    ]);

    const retainedPublicationContracts = await pool().query<{
      constraint_name: string;
    }>(
      `SELECT conname AS constraint_name
       FROM pg_constraint
       WHERE conname = ANY($1::text[])
       UNION ALL
       SELECT tgname AS constraint_name
       FROM pg_trigger
       WHERE NOT tgisinternal AND tgname = $2`,
      [
        [
          "job_published_projection_presence_check",
          "JobRevision_location_scope_check",
        ],
        "job_published_projection_trigger",
      ],
    );
    expect(retainedPublicationContracts.rows.map((row) => row.constraint_name).sort()).toEqual([
      "JobRevision_location_scope_check",
      "job_published_projection_presence_check",
      "job_published_projection_trigger",
    ]);

    await expect(
      pool().query(
        `INSERT INTO "OccupationCodeVersion"
          ("id","datasetKey","datasetYear","version","source","disclaimer","validFrom")
         VALUES ($1,'phase05-empty',2026,'v1','Mock source','   ',$2::timestamptz)`,
        ["50000000-0000-4000-8000-000000000001", ANCHOR_AT],
      ),
    ).rejects.toMatchObject({
      code: SQLSTATE.checkViolation,
      constraint: "occupation_code_version_disclaimer_check",
    });
  });

  it("persists one stable first-run anchor and permits version rotation", async () => {
    await pool().query(
      `INSERT INTO "DemoSeedManifest"
        ("namespace","seedVersion","schemaVersion","contractHash","anchorAt")
       VALUES ($1,$2,$3,$4,$5::timestamptz)`,
      ["swisstalenthub-demo", "phase-05-v1", "phase-05", HASH_A, ANCHOR_AT],
    );

    const firstRun = await pool().query<{
      anchorAt: Date;
      completedAt: Date | null;
      manifestHash: string | null;
    }>(
      `SELECT "anchorAt", "completedAt", "manifestHash"
       FROM "DemoSeedManifest"
       WHERE "namespace" = $1 AND "seedVersion" = $2`,
      ["swisstalenthub-demo", "phase-05-v1"],
    );
    expect(firstRun.rows).toEqual([
      {
        anchorAt: new Date(ANCHOR_AT),
        completedAt: null,
        manifestHash: null,
      },
    ]);

    await expect(
      pool().query(
        `INSERT INTO "DemoSeedManifest"
          ("namespace","seedVersion","schemaVersion","contractHash","anchorAt")
         VALUES ($1,$2,$3,$4,$5::timestamptz)`,
        ["swisstalenthub-demo", "phase-05-v1", "phase-05", HASH_A, ANCHOR_AT],
      ),
    ).rejects.toMatchObject({
      code: SQLSTATE.uniqueViolation,
      constraint: "DemoSeedManifest_pkey",
    });

    await pool().query(
      `INSERT INTO "DemoSeedManifest"
        ("namespace","seedVersion","schemaVersion","contractHash","anchorAt")
       VALUES ($1,$2,$3,$4,$5::timestamptz)`,
      ["swisstalenthub-demo", "phase-05-v2", "phase-05", HASH_B, ANCHOR_AT],
    );

    const versions = await pool().query<{ seedVersion: string }>(
      `SELECT "seedVersion" FROM "DemoSeedManifest"
       WHERE "namespace" = $1 ORDER BY "seedVersion"`,
      ["swisstalenthub-demo"],
    );
    expect(versions.rows).toEqual([
      { seedVersion: "phase-05-v1" },
      { seedVersion: "phase-05-v2" },
    ]);
  });

  it("requires a valid paired completion and seals completed evidence", async () => {
    await expect(
      pool().query(
        `INSERT INTO "DemoSeedManifest"
          ("namespace","seedVersion","schemaVersion","contractHash","anchorAt")
         VALUES ('invalid-hash','v1','phase-05','ABC',$1::timestamptz)`,
        [ANCHOR_AT],
      ),
    ).rejects.toMatchObject({
      code: SQLSTATE.checkViolation,
      constraint: "demo_seed_manifest_contract_hash_check",
    });

    await expect(
      pool().query(
        `INSERT INTO "DemoSeedManifest"
          ("namespace","seedVersion","schemaVersion","contractHash","manifestHash","anchorAt")
         VALUES ('unpaired','v1','phase-05',$1,$2,$3::timestamptz)`,
        [HASH_A, HASH_B, ANCHOR_AT],
      ),
    ).rejects.toMatchObject({
      code: SQLSTATE.checkViolation,
      constraint: "demo_seed_manifest_completion_check",
    });

    await expect(
      pool().query(
        `INSERT INTO "DemoSeedManifest"
          ("namespace","seedVersion","schemaVersion","contractHash","manifestHash","anchorAt","completedAt")
         VALUES ('time-travel','v1','phase-05',$1,$2,$3::timestamptz,$4::timestamptz)`,
        [HASH_A, HASH_B, COMPLETED_AT, ANCHOR_AT],
      ),
    ).rejects.toMatchObject({
      code: SQLSTATE.checkViolation,
      constraint: "demo_seed_manifest_completion_check",
    });

    await pool().query(
      `UPDATE "DemoSeedManifest"
       SET "manifestHash" = $3, "completedAt" = $4::timestamptz
       WHERE "namespace" = $1 AND "seedVersion" = $2`,
      ["swisstalenthub-demo", "phase-05-v1", HASH_B, COMPLETED_AT],
    );

    const completed = await pool().query<{
      anchorAt: Date;
      completedAt: Date;
      contractHash: string;
      manifestHash: string;
    }>(
      `SELECT "anchorAt", "completedAt", "contractHash", "manifestHash"
       FROM "DemoSeedManifest"
       WHERE "namespace" = $1 AND "seedVersion" = $2`,
      ["swisstalenthub-demo", "phase-05-v1"],
    );
    expect(completed.rows).toEqual([
      {
        anchorAt: new Date(ANCHOR_AT),
        completedAt: new Date(COMPLETED_AT),
        contractHash: HASH_A,
        manifestHash: HASH_B,
      },
    ]);

    for (const mutate of [
      () =>
        pool().query(
          `UPDATE "DemoSeedManifest" SET "contractHash" = $3
           WHERE "namespace" = $1 AND "seedVersion" = $2`,
          ["swisstalenthub-demo", "phase-05-v1", HASH_C],
        ),
      () =>
        pool().query(
          `UPDATE "DemoSeedManifest" SET "manifestHash" = $3
           WHERE "namespace" = $1 AND "seedVersion" = $2`,
          ["swisstalenthub-demo", "phase-05-v1", HASH_C],
        ),
      () =>
        pool().query(
          `DELETE FROM "DemoSeedManifest"
           WHERE "namespace" = $1 AND "seedVersion" = $2`,
          ["swisstalenthub-demo", "phase-05-v1"],
        ),
    ]) {
      await expect(mutate()).rejects.toMatchObject({
        code: SQLSTATE.checkViolation,
        constraint: "demo_seed_manifest_immutable",
      });
    }
  });
});
