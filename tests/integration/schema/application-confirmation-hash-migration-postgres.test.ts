import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import {
  buildApplicationConfirmationProjection,
  sha256Utf8,
} from "@/lib/applications/integrity";
import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "prisma", "migrations");
const PRE_HASH_MIGRATION = "20260720230500_phase_09_radar_consent_currentness";
const HASH_MIGRATIONS = [
  "20260720230600_phase_09_application_content_hashes",
  "20260720230700_phase_09_demo_application_notice_reconciliation",
  "20260720230800_phase_09_legacy_demo_application_reconciliation",
] as const;
const DATABASE_NAME_PATTERN = /^swisstalenthub_test_hash_migration_[a-f0-9]+$/u;

const IDS = Object.freeze({
  user: "91000000-0000-4000-8000-000000000001",
  profile: "91000000-0000-4000-8000-000000000002",
  category: "91000000-0000-4000-8000-000000000003",
  company: "91000000-0000-4000-8000-000000000004",
  job: "91000000-0000-4000-8000-000000000005",
  revision: "91000000-0000-4000-8000-000000000006",
  application: "91000000-0000-4000-8000-000000000007",
  snapshot: "91000000-0000-4000-8000-000000000008",
});
const RAW = Object.freeze({
  firstName: " \t<b>Ada &amp;</b>  ",
  lastName: "  Lovelace&nbsp;<i>Raw</i>\n",
  email: "  Mixed.Case+Canary@Example.TEST \t",
  companyName: " \t<strong>Raw &amp; Company</strong>  ",
  jobTitle: "\tLead <em>R&amp;D</em> Engineer  \n",
  contactValue: "  Raw&amp;Contact@Example.TEST \t",
});
const JOB_SLUG = "phase09-migration-hash-canary";

describe("Phase-09 application confirmation hash data migrations", () => {
  it(
    "binds raw case, whitespace and markup canaries in 30600, 30700 and 30800",
    async () => {
      const database = await createPreHashMigrationDatabase();
      try {
        const expected = buildApplicationConfirmationProjection({
          candidate: {
            firstName: RAW.firstName,
            lastName: RAW.lastName,
            email: RAW.email,
          },
          recipient: {
            companyName: RAW.companyName,
            contactKind: "EMAIL",
            contactValue: RAW.contactValue,
          },
          job: {
            revisionId: IDS.revision,
            slug: JOB_SLUG,
            title: RAW.jobTitle,
            responseTargetDays: 7,
            applicationEffort: "SIMPLE",
            requiredDocumentKinds: ["NONE"],
          },
        });
        const normalized = buildApplicationConfirmationProjection({
          candidate: {
            firstName: RAW.firstName,
            lastName: RAW.lastName,
            email: RAW.email.trim().toLowerCase(),
          },
          recipient: {
            companyName: RAW.companyName,
            contactKind: "EMAIL",
            contactValue: RAW.contactValue.trim(),
          },
          job: {
            revisionId: IDS.revision,
            slug: JOB_SLUG,
            title: RAW.jobTitle,
            responseTargetDays: 7,
            applicationEffort: "SIMPLE",
            requiredDocumentKinds: ["NONE"],
          },
        });
        expect(expected.confirmationSnapshotHash).not.toBe(
          normalized.confirmationSnapshotHash,
        );

        await insertPreHashCanary(
          database.client,
          expected.confirmationNoticeHash,
        );
        await applyMigration(database.client, HASH_MIGRATIONS[0]);
        await expectRawHash(database.client, expected.confirmationSnapshotHash);

        await resetDemoSnapshotForReconciliation(
          database.client,
          "seed:application:hash-canary",
        );
        await applyMigration(database.client, HASH_MIGRATIONS[1]);
        await expectRawHash(database.client, expected.confirmationSnapshotHash);

        await resetDemoSnapshotForReconciliation(
          database.client,
          "legacy-demo-hash-canary",
        );
        await applyMigration(database.client, HASH_MIGRATIONS[2]);
        await expectRawHash(database.client, expected.confirmationSnapshotHash);
      } finally {
        await database.dispose();
      }
    },
    120_000,
  );
});

async function insertPreHashCanary(
  client: Client,
  confirmationNoticeHash: string,
) {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO "User"
        (id, email, "emailNormalized", role, status, "dataProvenance", "updatedAt")
       VALUES ($1::uuid, $2, $3, 'CANDIDATE', 'ACTIVE', 'DEMO', CURRENT_TIMESTAMP)`,
      [IDS.user, RAW.email, RAW.email.trim().toLowerCase()],
    );
    await client.query(
      `INSERT INTO "CandidateProfile"
        (id, "userId", "firstName", "lastName", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3, $4, CURRENT_TIMESTAMP)`,
      [IDS.profile, IDS.user, RAW.firstName, RAW.lastName],
    );
    await client.query(
      `INSERT INTO "Category" (id, name, slug, "updatedAt")
       VALUES ($1::uuid, 'Hash Canary', 'phase09-hash-canary', CURRENT_TIMESTAMP)`,
      [IDS.category],
    );
    await client.query(
      `INSERT INTO "Company"
        (id, name, slug, values, benefits, status, "dataProvenance", "updatedAt")
       VALUES ($1::uuid, $2, 'phase09-hash-canary-company', ARRAY[]::text[],
         ARRAY[]::text[], 'DRAFT', 'DEMO', CURRENT_TIMESTAMP)`,
      [IDS.company, RAW.companyName],
    );
    await client.query(
      `INSERT INTO "Job"
        (id, "companyId", slug, status, "sourceReference", "dataProvenance",
         "createdByUserId", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3, 'DRAFT', 'integration:hash-canary',
         'DEMO', $4::uuid, CURRENT_TIMESTAMP)`,
      [IDS.job, IDS.company, JOB_SLUG, IDS.user],
    );
    await client.query(
      `INSERT INTO "JobRevision" (
        id, "jobId", "revisionNumber", title, description, tasks, requirements,
        "applicationProcessSteps", "requiredDocumentKinds", "jobType", "remoteType",
        "remoteCountryCode",
        "categoryId", "workloadMin", "workloadMax", "startByArrangement",
        "responseTargetDays", "applicationEffort", "applicationContactKind",
        "applicationContactValue", "authoredByUserId", "contentChecksum"
      ) VALUES (
        $1::uuid, $2::uuid, 1, $3, 'Hash migration canary', ARRAY['One'], ARRAY['One'],
        ARRAY['Apply'], ARRAY['NONE']::"RequiredDocumentKind"[], 'PERMANENT', 'REMOTE',
        'CH', $4::uuid, 80, 100, true, 7, 'SIMPLE', 'EMAIL', $5, $6::uuid, $7
      )`,
      [
        IDS.revision,
        IDS.job,
        RAW.jobTitle,
        IDS.category,
        RAW.contactValue,
        IDS.user,
        sha256Utf8("phase09-hash-canary-revision"),
      ],
    );
    await client.query(
      `INSERT INTO "Application" (
        id, "jobId", "submittedJobRevisionId", "candidateProfileId", "idempotencyKey",
        "submissionPayloadHash", status, "submittedAt", "updatedAt"
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'seed:application:hash-canary',
        $5, 'SUBMITTED', TIMESTAMPTZ '2026-07-20 12:00:00+00', CURRENT_TIMESTAMP
      )`,
      [IDS.application, IDS.job, IDS.revision, IDS.profile, "1".repeat(64)],
    );
    await client.query(
      `INSERT INTO "ApplicationSubmissionSnapshot" (
        id, "applicationId", "jobRevisionId", "candidateFirstName", "candidateLastName",
        "candidateEmail", "coverLetterSnapshot", "recipientCompanyName",
        "applicationContactKind", "applicationContactValue", "responseTargetDays",
        "applicationEffort", "requiredDocumentKinds", "confirmationNoticeVersion",
        "confirmationNoticeHash", "confirmationSnapshotHash", "submittedAt"
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, NULL, $7, 'EMAIL', $8, 7,
        'SIMPLE', ARRAY['NONE']::"RequiredDocumentKind"[], 'application-confirmation-v1',
        $9, $10, TIMESTAMPTZ '2026-07-20 12:00:00+00'
      )`,
      [
        IDS.snapshot,
        IDS.application,
        IDS.revision,
        RAW.firstName,
        RAW.lastName,
        RAW.email,
        RAW.companyName,
        RAW.contactValue,
        confirmationNoticeHash,
        "0".repeat(64),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function resetDemoSnapshotForReconciliation(
  client: Client,
  idempotencyKey: string,
) {
  const placeholderNoticeHash = sha256Utf8(
    "application-confirmation-notice-v1",
  );
  await client.query(
    'ALTER TABLE "ApplicationSubmissionSnapshot" DISABLE TRIGGER USER',
  );
  await client.query(
    `UPDATE "ApplicationSubmissionSnapshot"
     SET "confirmationNoticeHash" = $1,
         "confirmationSnapshotHash" = $2,
         "confirmationSnapshotHashVersion" = 'legacy-id-derived-v1'
     WHERE id = $3::uuid`,
    [placeholderNoticeHash, "2".repeat(64), IDS.snapshot],
  );
  await client.query(
    'ALTER TABLE "ApplicationSubmissionSnapshot" ENABLE TRIGGER USER',
  );
  await client.query('ALTER TABLE "Application" DISABLE TRIGGER USER');
  await client.query(
    'UPDATE "Application" SET "idempotencyKey" = $1 WHERE id = $2::uuid',
    [idempotencyKey, IDS.application],
  );
  await client.query('ALTER TABLE "Application" ENABLE TRIGGER USER');
}

async function expectRawHash(client: Client, expectedHash: string) {
  const result = await client.query<{
    candidateFirstName: string;
    candidateLastName: string;
    candidateEmail: string;
    recipientCompanyName: string;
    applicationContactValue: string;
    confirmationSnapshotHash: string;
    confirmationSnapshotHashVersion: string;
  }>(
    `SELECT
       "candidateFirstName", "candidateLastName", "candidateEmail",
       "recipientCompanyName", "applicationContactValue",
       "confirmationSnapshotHash", "confirmationSnapshotHashVersion"
     FROM "ApplicationSubmissionSnapshot"
     WHERE id = $1::uuid`,
    [IDS.snapshot],
  );
  expect(result.rows).toEqual([
    {
      candidateFirstName: RAW.firstName,
      candidateLastName: RAW.lastName,
      candidateEmail: RAW.email,
      recipientCompanyName: RAW.companyName,
      applicationContactValue: RAW.contactValue,
      confirmationSnapshotHash: expectedHash,
      confirmationSnapshotHashVersion: "application-confirmation-snapshot-v1",
    },
  ]);
}

async function createPreHashMigrationDatabase() {
  const configuration = getIsolatedTestDatabaseConfiguration();
  const baseUrl = new URL(configuration.connectionString);
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.searchParams.delete("schema");
  const databaseName = `swisstalenthub_test_hash_migration_${randomUUID().replaceAll("-", "")}`;
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Generated hash-migration database name is unsafe.");
  }
  const databaseUrl = new URL(baseUrl);
  databaseUrl.pathname = `/${databaseName}`;
  databaseUrl.searchParams.set("schema", "public");
  const maintenance = new Client({ connectionString: maintenanceUrl.toString() });
  await maintenance.connect();
  try {
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await maintenance.end();
  }
  const client = new Client({ connectionString: databaseUrl.toString() });
  try {
    await client.connect();
    await applyMigrationsThrough(client, PRE_HASH_MIGRATION);
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
  for (const migration of migrations) await applyMigration(client, migration);
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
    throw new Error("Refusing to drop an unsafe hash-migration database name.");
  }
  const maintenance = new Client({ connectionString: maintenanceUrl.toString() });
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
