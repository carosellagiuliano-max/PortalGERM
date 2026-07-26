import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "prisma", "migrations");
const PRE_PHASE21_MIGRATION =
  "20260726143000_phase_20_notification_replay_audit";
const PHASE21_MIGRATION = "20260726210000_phase_21_document_vault";
const DATABASE_NAME_PATTERN = /^sth_test_phase21vault_[a-f0-9]+$/u;

const IDS = Object.freeze({
  userA: "21000000-0000-4000-8000-000000000101",
  userB: "21000000-0000-4000-8000-000000000102",
  profileA: "21000000-0000-4000-8000-000000000201",
  profileB: "21000000-0000-4000-8000-000000000202",
  metadataA: "21000000-0000-4000-8000-000000000301",
  metadataB: "21000000-0000-4000-8000-000000000302",
  document: "21000000-0000-4000-8000-000000000401",
  version: "21000000-0000-4000-8000-000000000501",
  category: "21000000-0000-4000-8000-000000000601",
  company: "21000000-0000-4000-8000-000000000701",
  job: "21000000-0000-4000-8000-000000000801",
  revision: "21000000-0000-4000-8000-000000000901",
  application: "21000000-0000-4000-8000-000000000a01",
  submissionDocument: "21000000-0000-4000-8000-000000000b01",
});

describe("Phase 21 document-vault migration", () => {
  it("preserves legacy metadata honestly and installs owner/state/evidence guards", async () => {
    const database = await createPrePhase21Database();
    try {
      await insertLegacyMetadata(database.client);
      await insertLegacySubmission(database.client);
      await applyMigration(database.client, PHASE21_MIGRATION);

      const tables = await database.client.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'Document',
              'DocumentVersion',
              'DocumentUploadIntent',
              'DocumentScanAttempt',
              'DocumentReadGrant',
              'DocumentAccessEvent',
              'ObjectLifecycleOutcome'
            )
          ORDER BY table_name`,
      );
      expect(tables.rows).toHaveLength(7);
      const legacy = await database.client.query<{
        id: string;
        storageKind: string;
        documentVersionId: string | null;
      }>(
        `SELECT "id"::text AS "id",
                "storageKind"::text AS "storageKind",
                "documentVersionId"::text AS "documentVersionId"
           FROM "CandidateDocumentMetadata"
          ORDER BY "id"`,
      );
      expect(legacy.rows).toEqual([
        {
          id: IDS.metadataA,
          storageKind: "METADATA_ONLY_LEGACY",
          documentVersionId: null,
        },
        {
          id: IDS.metadataB,
          storageKind: "METADATA_ONLY_LEGACY",
          documentVersionId: null,
        },
      ]);
      const invented = await database.client.query<{
        documents: number;
        versions: number;
        scans: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM "Document") AS "documents",
           (SELECT count(*)::int FROM "DocumentVersion") AS "versions",
           (SELECT count(*)::int FROM "DocumentScanAttempt") AS "scans"`,
      );
      expect(invented.rows).toEqual([
        { documents: 0, versions: 0, scans: 0 },
      ]);
      const migratedSubmission = await database.client.query<{
        candidateProfileId: string;
      }>(
        `SELECT "candidateProfileId"::text AS "candidateProfileId"
           FROM "ApplicationSubmissionDocument"
          WHERE "id" = $1::uuid`,
        [IDS.submissionDocument],
      );
      expect(migratedSubmission.rows).toEqual([
        { candidateProfileId: IDS.profileA },
      ]);
      await expect(
        database.client.query(
          `UPDATE "ApplicationSubmissionDocument"
              SET "safeFilenameSnapshot" = 'mutation-must-fail.pdf'
            WHERE "id" = $1::uuid`,
          [IDS.submissionDocument],
        ),
      ).rejects.toThrow(/append-only/u);

      await database.client.query(
        `INSERT INTO "Document" (
           "id", "candidateProfileId", "purpose", "updatedAt"
         ) VALUES ($1::uuid, $2::uuid, 'CV', CURRENT_TIMESTAMP)`,
        [IDS.document, IDS.profileA],
      );
      await database.client.query(
        `INSERT INTO "DocumentVersion" (
           "id", "documentId", "candidateProfileId", "sequence",
           "objectKey", "providerObjectVersion", "safeFilename",
           "declaredMimeType", "encryptionKeyVersion", "storageRegion",
           "status"
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, 1,
           'candidate-cv/21000000-0000-4000-8000-000000000501',
           'provider-version-1', 'legacy-safe.pdf', 'application/pdf',
           'document-v1', 'local-test', 'UPLOADING'
         )`,
        [IDS.version, IDS.document, IDS.profileA],
      );
      await expect(
        database.client.query(
          `UPDATE "CandidateDocumentMetadata"
              SET "storageKind" = 'VAULT_ENCRYPTED',
                  "documentVersionId" = $1::uuid
            WHERE "id" = $2::uuid`,
          [IDS.version, IDS.metadataB],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        database.client.query(
          `UPDATE "DocumentVersion"
              SET "status" = 'CLEAN',
                  "uploadedAt" = CURRENT_TIMESTAMP,
                  "scanCompletedAt" = CURRENT_TIMESTAMP,
                  "sizeBytes" = 1,
                  "sha256" = $1
            WHERE "id" = $2::uuid`,
          ["a".repeat(64), IDS.version],
        ),
      ).rejects.toThrow(/invalid document lifecycle transition/u);

      await database.client.query(
        `INSERT INTO "DocumentAccessEvent" (
           "id", "documentVersionId", "actorUserId", "kind",
           "outcomeCode", "correlationId", "occurredAt"
         ) VALUES (
           gen_random_uuid(), $1::uuid, $2::uuid,
           'UPLOAD_INTENT_CREATED', 'CREATED',
           'phase21-migration-append-only', CURRENT_TIMESTAMP
         )`,
        [IDS.version, IDS.userA],
      );
      await expect(
        database.client.query(
          `DELETE FROM "DocumentAccessEvent"
            WHERE "correlationId" = 'phase21-migration-append-only'`,
        ),
      ).rejects.toThrow(/append-only/u);
    } finally {
      await database.dispose();
    }
  }, 120_000);

  it("applies cleanly to an empty current database and exposes the full lifecycle enum", async () => {
    const database = await createPrePhase21Database();
    try {
      await applyMigration(database.client, PHASE21_MIGRATION);
      const values = await database.client.query<{ enumlabel: string }>(
        `SELECT enum_value.enumlabel
           FROM pg_enum enum_value
           JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
          WHERE enum_type.typname = 'ObjectLifecycleKind'
          ORDER BY enum_value.enumsortorder`,
      );
      expect(values.rows.map(({ enumlabel }) => enumlabel)).toEqual([
        "DB_WITHOUT_OBJECT",
        "OBJECT_WITHOUT_DB",
        "INCOMPLETE_UPLOAD",
        "CHECKSUM_MISMATCH",
        "DELETE_PENDING",
        "LEGAL_HOLD",
        "PROVIDER_FAILURE",
        "CONSISTENT",
      ]);
    } finally {
      await database.dispose();
    }
  }, 120_000);
});

async function insertLegacyMetadata(client: Client) {
  await client.query(
    `INSERT INTO "User" (
       "id", "email", "emailNormalized", "role", "status",
       "dataProvenance", "updatedAt"
     ) VALUES
       ($1::uuid, 'phase21-a@example.test', 'phase21-a@example.test',
        'CANDIDATE', 'ACTIVE', 'TEST', CURRENT_TIMESTAMP),
       ($2::uuid, 'phase21-b@example.test', 'phase21-b@example.test',
        'CANDIDATE', 'ACTIVE', 'TEST', CURRENT_TIMESTAMP)`,
    [IDS.userA, IDS.userB],
  );
  await client.query(
    `INSERT INTO "CandidateProfile" (
       "id", "userId", "firstName", "lastName", "updatedAt"
     ) VALUES
       ($1::uuid, $2::uuid, 'Phase', 'Twentyone A', CURRENT_TIMESTAMP),
       ($3::uuid, $4::uuid, 'Phase', 'Twentyone B', CURRENT_TIMESTAMP)`,
    [IDS.profileA, IDS.userA, IDS.profileB, IDS.userB],
  );
  await client.query(
    `INSERT INTO "CandidateDocumentMetadata" (
       "id", "candidateProfileId", "storageKey", "safeFilename",
       "mimeType", "sizeBytes", "purpose", "status"
     ) VALUES
       ($1::uuid, $2::uuid, 'mock-storage/phase21/a',
        'legacy-a.pdf', 'application/pdf', 120, 'CV', 'ACTIVE'),
       ($3::uuid, $4::uuid, 'mock-storage/phase21/b',
        'legacy-b.pdf', 'application/pdf', 140, 'CV', 'ACTIVE')`,
    [IDS.metadataA, IDS.profileA, IDS.metadataB, IDS.profileB],
  );
}

async function insertLegacySubmission(client: Client) {
  await client.query(
    `INSERT INTO "Category" (
       "id", "name", "slug", "updatedAt"
     ) VALUES (
       $1::uuid, 'Phase 21 Migration', 'phase-21-migration', CURRENT_TIMESTAMP
     )`,
    [IDS.category],
  );
  await client.query(
    `INSERT INTO "Company" (
       "id", "name", "slug", "status", "dataProvenance", "updatedAt"
     ) VALUES (
       $1::uuid, 'Phase 21 Migration Company',
       'phase-21-migration-company', 'DRAFT', 'TEST', CURRENT_TIMESTAMP
     )`,
    [IDS.company],
  );
  await client.query(
    `INSERT INTO "Job" (
       "id", "companyId", "slug", "status", "sourceReference",
       "dataProvenance", "createdByUserId", "updatedAt"
     ) VALUES (
       $1::uuid, $2::uuid, 'phase-21-migration-job', 'DRAFT',
       'integration:phase21-migration', 'TEST', $3::uuid, CURRENT_TIMESTAMP
     )`,
    [IDS.job, IDS.company, IDS.userA],
  );
  await client.query(
    `INSERT INTO "JobRevision" (
       "id", "jobId", "revisionNumber", "title", "description",
       "tasks", "requirements", "applicationProcessSteps",
       "requiredDocumentKinds", "jobType", "remoteType",
       "remoteCountryCode", "categoryId", "workloadMin", "workloadMax",
       "startByArrangement", "responseTargetDays", "applicationEffort",
       "applicationContactKind", "applicationContactValue",
       "authoredByUserId", "contentChecksum"
     ) VALUES (
       $1::uuid, $2::uuid, 1, 'Phase 21 Migration Job',
       'Migration canary for an immutable submitted document.',
       ARRAY['Test'], ARRAY['Test'], ARRAY['Apply'],
       ARRAY['CV']::"RequiredDocumentKind"[], 'PERMANENT', 'REMOTE',
       'CH', $3::uuid, 80, 100, true, 7, 'SIMPLE',
       'EMAIL', 'jobs@phase21.example.test', $4::uuid, $5
     )`,
    [IDS.revision, IDS.job, IDS.category, IDS.userA, "c".repeat(64)],
  );
  await client.query(
    `INSERT INTO "Application" (
       "id", "jobId", "submittedJobRevisionId", "candidateProfileId",
       "idempotencyKey", "submissionPayloadHash", "status", "updatedAt"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       'phase21:migration:application', $5, 'SUBMITTED', CURRENT_TIMESTAMP
     )`,
    [
      IDS.application,
      IDS.job,
      IDS.revision,
      IDS.profileA,
      "d".repeat(64),
    ],
  );
  await client.query(
    `INSERT INTO "ApplicationSubmissionDocument" (
       "id", "applicationId", "documentMetadataId",
       "safeFilenameSnapshot", "mimeTypeSnapshot", "sizeBytesSnapshot",
       "storageKeyHash"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid,
       'legacy-a.pdf', 'application/pdf', 120,
       encode(digest('mock-storage/phase21/a', 'sha256'), 'hex')
     )`,
    [IDS.submissionDocument, IDS.application, IDS.metadataA],
  );
}

async function createPrePhase21Database() {
  const configuration = getIsolatedTestDatabaseConfiguration();
  const baseUrl = new URL(configuration.connectionString);
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.searchParams.delete("schema");
  const databaseName =
    `sth_test_phase21vault_${randomUUID().replaceAll("-", "")}`;
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Generated Phase-21 vault migration database is unsafe.");
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
    await applyMigrationsThrough(client, PRE_PHASE21_MIGRATION);
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
    throw new Error("Refusing to drop an unsafe Phase-21 migration database.");
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
