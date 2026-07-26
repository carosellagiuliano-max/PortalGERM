import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "prisma", "migrations");
const PRE_PHASE20_MIGRATION =
  "20260723194000_phase_17_company_profile_array_defaults";
const PHASE20_IDENTITY_MIGRATION =
  "20260726140000_phase_20_identity_notification_outbox";
const PHASE20_REPLAY_MIGRATION =
  "20260726143000_phase_20_notification_replay_audit";
const DATABASE_NAME_PATTERN = /^sth_test_phase20migration_[a-f0-9]+$/u;

const USERS = Object.freeze({
  live: "20000000-0000-4000-8000-000000000101",
  demo: "20000000-0000-4000-8000-000000000102",
  test: "20000000-0000-4000-8000-000000000103",
});

describe("Phase 20 identity/outbox migration", () => {
  it("applies to an empty Phase-19 database and installs constraints and append-only guards", async () => {
    const database = await createPrePhase20Database();
    try {
      await applyMigration(database.client, PHASE20_IDENTITY_MIGRATION);
      await applyMigration(database.client, PHASE20_REPLAY_MIGRATION);
      const tables = await database.client.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'EmailVerificationChallenge',
              'PendingEmailChange',
              'AuthAssuranceEvidence',
              'NotificationOutbox',
              'NotificationDeliveryAttempt',
              'NotificationSuppression',
              'NotificationPreference',
              'NotificationPreferenceEvent',
              'AuthSecurityEvent'
            )
          ORDER BY table_name`,
      );
      expect(tables.rows).toHaveLength(9);
      const replayAction = await database.client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM pg_enum enum_value
             JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
            WHERE enum_type.typname = 'AuditAction'
              AND enum_value.enumlabel = 'NOTIFICATION_DELIVERY_REPLAYED'
         ) AS "exists"`,
      );
      expect(replayAction.rows).toEqual([{ exists: true }]);

      await expect(
        database.client.query(
          `INSERT INTO "NotificationOutbox" (
             "id", "purpose", "purposeClass", "channel", "templateKey",
             "payloadSchemaVersion", "payload", "dedupeKey",
             "providerDedupeKey", "status", "availableAt", "updatedAt"
           ) VALUES (
             gen_random_uuid(), 'PASSWORD_RESET', 'MANDATORY', 'EMAIL',
             'password_reset_mock', 'password-reset-v2', '{}'::jsonb,
             'invalid-recipient-shape', 'invalid-recipient-shape-provider',
             'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
           )`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await database.dispose();
    }
  }, 120_000);

  it("rolls an interrupted migration back, safely reruns it, and never promotes LIVE identities", async () => {
    const database = await createPrePhase20Database();
    try {
      await insertLegacyUsers(database.client);
      const migrationSql = await readMigration(PHASE20_IDENTITY_MIGRATION);
      await expect(
        database.client.query(`BEGIN;\n${migrationSql}\nSELECT 1 / 0;\nCOMMIT;`),
      ).rejects.toBeDefined();
      await database.client.query("ROLLBACK").catch(() => undefined);
      const afterFailure = await database.client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'User'
              AND column_name = 'identityAssurance'
         ) AS "exists"`,
      );
      expect(afterFailure.rows).toEqual([{ exists: false }]);

      await applyMigration(database.client, PHASE20_IDENTITY_MIGRATION);
      const first = await readIdentityStates(database.client);
      expect(first).toEqual([
        {
          id: USERS.live,
          dataProvenance: "LIVE",
          emailVerified: true,
          identityAssurance: "LEGACY_ASSURANCE",
          emailAddressEpoch: 1,
        },
        {
          id: USERS.demo,
          dataProvenance: "DEMO",
          emailVerified: true,
          identityAssurance: "VERIFIED_EMAIL",
          emailAddressEpoch: 1,
        },
        {
          id: USERS.test,
          dataProvenance: "TEST",
          emailVerified: false,
          identityAssurance: "LOW_ASSURANCE",
          emailAddressEpoch: 1,
        },
      ]);

      await rerunBackfill(database.client);
      expect(await readIdentityStates(database.client)).toEqual(first);
      await database.client.query(
        `INSERT INTO "User" (
           "id", "email", "emailNormalized", "role", "status",
           "dataProvenance", "updatedAt"
         ) VALUES (
           '20000000-0000-4000-8000-000000000104'::uuid,
           'phase20-parallel-writer@example.test',
           'phase20-parallel-writer@example.test',
           'CANDIDATE', 'ACTIVE', 'LIVE', CURRENT_TIMESTAMP
         )`,
      );
      const parallelWriter = await database.client.query<{
        identityAssurance: string;
        emailVerifiedAt: Date | null;
      }>(
        `SELECT "identityAssurance"::text AS "identityAssurance",
                "emailVerifiedAt"
           FROM "User"
          WHERE "id" = '20000000-0000-4000-8000-000000000104'::uuid`,
      );
      expect(parallelWriter.rows).toEqual([
        {
          identityAssurance: "LOW_ASSURANCE",
          emailVerifiedAt: null,
        },
      ]);
      expect(
        await countIdentityOrphans(database.client),
      ).toEqual({
        challengeOrphans: 0,
        outboxOrphans: 0,
        invalidVerified: 0,
      });
    } finally {
      await database.dispose();
    }
  }, 120_000);

  it("enforces current-challenge uniqueness and append-only attempt/preference/security evidence", async () => {
    const database = await createPrePhase20Database();
    try {
      await applyMigration(database.client, PHASE20_IDENTITY_MIGRATION);
      await database.client.query(
        `INSERT INTO "User" (
           "id", "email", "emailNormalized", "role", "status",
           "dataProvenance", "emailVerifiedAt", "identityAssurance", "updatedAt"
         ) VALUES (
           $1::uuid, 'phase20-constraint@example.test',
           'phase20-constraint@example.test', 'CANDIDATE', 'ACTIVE', 'TEST',
           CURRENT_TIMESTAMP, 'VERIFIED_EMAIL', CURRENT_TIMESTAMP
         )`,
        [USERS.test],
      );
      const firstChallenge =
        "20000000-0000-4000-8000-000000000120";
      await database.client.query(
        `INSERT INTO "EmailVerificationChallenge" (
           "id", "userId", "purpose", "addressEpoch",
           "targetNormalizedHash", "tokenHash", "expiresAt", "createdAt"
         ) VALUES (
           $1::uuid, $2::uuid, 'REGISTRATION', 1, $3, $4,
           TIMESTAMPTZ '2026-07-26 13:00:00+00',
           TIMESTAMPTZ '2026-07-26 12:00:00+00'
         )`,
        [firstChallenge, USERS.test, "a".repeat(64), "b".repeat(64)],
      );
      await expect(
        database.client.query(
          `INSERT INTO "EmailVerificationChallenge" (
             "id", "userId", "purpose", "addressEpoch",
             "targetNormalizedHash", "tokenHash", "expiresAt", "createdAt"
           ) VALUES (
             gen_random_uuid(), $1::uuid, 'REGISTRATION', 1, $2, $3,
             TIMESTAMPTZ '2026-07-26 13:00:00+00',
             TIMESTAMPTZ '2026-07-26 12:00:00+00'
           )`,
          [USERS.test, "c".repeat(64), "d".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      await database.client.query(
        `INSERT INTO "AuthSecurityEvent" (
           "id", "userId", "kind", "correlationId", "outcomeCode",
           "occurredAt", "retainUntil"
         ) VALUES (
           gen_random_uuid(), $1::uuid, 'VERIFICATION_REQUESTED',
           'phase20-append-only', 'CHALLENGE_CREATED',
           TIMESTAMPTZ '2026-07-26 12:00:00+00',
           TIMESTAMPTZ '2026-10-26 12:00:00+00'
         )`,
        [USERS.test],
      );
      await expect(
        database.client.query(
          `DELETE FROM "AuthSecurityEvent"
            WHERE "correlationId" = 'phase20-append-only'`,
        ),
      ).rejects.toThrow(/append-only/u);
      await expect(
        database.client.query(
          `UPDATE "User" SET "emailAddressEpoch" = 0 WHERE "id" = $1::uuid`,
          [USERS.test],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await database.dispose();
    }
  }, 120_000);
});

async function insertLegacyUsers(client: Client) {
  await client.query(
    `INSERT INTO "User" (
       "id", "email", "emailNormalized", "role", "status",
       "dataProvenance", "emailVerifiedAt", "updatedAt"
     ) VALUES
       ($1::uuid, 'phase20-live@example.test', 'phase20-live@example.test',
        'CANDIDATE', 'ACTIVE', 'LIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ($2::uuid, 'phase20-demo@example.test', 'phase20-demo@example.test',
        'CANDIDATE', 'ACTIVE', 'DEMO', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ($3::uuid, 'phase20-test@example.test', 'phase20-test@example.test',
        'CANDIDATE', 'ACTIVE', 'TEST', NULL, CURRENT_TIMESTAMP)`,
    [USERS.live, USERS.demo, USERS.test],
  );
}

async function rerunBackfill(client: Client) {
  await client.query(
    `UPDATE "User"
        SET "identityAssurance" =
          CASE
            WHEN "dataProvenance" IN ('DEMO', 'TEST')
                 AND "emailVerifiedAt" IS NOT NULL
              THEN 'VERIFIED_EMAIL'::"IdentityAssuranceLevel"
            WHEN "dataProvenance" = 'LIVE'
              THEN 'LEGACY_ASSURANCE'::"IdentityAssuranceLevel"
            ELSE 'LOW_ASSURANCE'::"IdentityAssuranceLevel"
          END`,
  );
}

async function readIdentityStates(client: Client) {
  const result = await client.query<{
    id: string;
    dataProvenance: string;
    emailVerified: boolean;
    identityAssurance: string;
    emailAddressEpoch: number;
  }>(
    `SELECT "id"::text AS "id",
            "dataProvenance"::text AS "dataProvenance",
            ("emailVerifiedAt" IS NOT NULL) AS "emailVerified",
            "identityAssurance"::text AS "identityAssurance",
            "emailAddressEpoch"
       FROM "User"
      WHERE "id" = ANY($1::uuid[])
      ORDER BY "id"`,
    [[USERS.live, USERS.demo, USERS.test]],
  );
  return result.rows;
}

async function countIdentityOrphans(client: Client) {
  const result = await client.query<{
    challengeOrphans: number;
    outboxOrphans: number;
    invalidVerified: number;
  }>(
    `SELECT
       (
         SELECT count(*)::int
           FROM "EmailVerificationChallenge" challenge
           LEFT JOIN "User" owner ON owner."id" = challenge."userId"
          WHERE owner."id" IS NULL
       ) AS "challengeOrphans",
       (
         SELECT count(*)::int
           FROM "NotificationOutbox" outbox
           LEFT JOIN "User" recipient ON recipient."id" = outbox."recipientUserId"
          WHERE outbox."recipientUserId" IS NOT NULL
            AND recipient."id" IS NULL
       ) AS "outboxOrphans",
       (
         SELECT count(*)::int
           FROM "User"
          WHERE "identityAssurance" = 'VERIFIED_EMAIL'
            AND "emailVerifiedAt" IS NULL
       ) AS "invalidVerified"`,
  );
  return result.rows[0]!;
}

async function createPrePhase20Database() {
  const configuration = getIsolatedTestDatabaseConfiguration();
  const baseUrl = new URL(configuration.connectionString);
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.searchParams.delete("schema");
  const databaseName =
    `sth_test_phase20migration_${randomUUID().replaceAll("-", "")}`;
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Generated Phase 20 migration database name is unsafe.");
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
    await applyMigrationsThrough(client, PRE_PHASE20_MIGRATION);
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
  const entries = await readdir(MIGRATIONS_DIRECTORY, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name <= finalMigration)
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await applyMigration(client, migration);
  }
}

async function readMigration(migration: string) {
  return readFile(
    resolve(MIGRATIONS_DIRECTORY, migration, "migration.sql"),
    "utf8",
  );
}

async function applyMigration(client: Client, migration: string) {
  await client.query(await readMigration(migration));
}

async function dropDatabase(maintenanceUrl: URL, databaseName: string) {
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Refusing to drop an unsafe Phase 20 migration database.");
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
