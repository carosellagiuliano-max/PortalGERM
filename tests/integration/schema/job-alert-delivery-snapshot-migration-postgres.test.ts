import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EmailLogIdempotencyConflictError,
  MockEmailProvider,
  type EmailLogRepository,
} from "@/lib/providers/email/mock-email-provider";
import { renderEmailTemplate } from "@/lib/providers/email/templates";
import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "prisma", "migrations");
const PRE_SNAPSHOT_MIGRATION =
  "20260720231100_phase_09_demo_job_alert_reconciliation";
const SNAPSHOT_MIGRATION =
  "20260720231200_phase_09_job_alert_delivery_snapshots";
const DATABASE_NAME_PATTERN = /^sth_test_alertsnap_[a-f0-9]+$/u;

const IDS = Object.freeze({
  user: "92000000-0000-4000-8000-000000000001",
  profile: "92000000-0000-4000-8000-000000000002",
  alert: "92000000-0000-4000-8000-000000000003",
  digest: "92000000-0000-4000-8000-000000000004",
});
const ORIGINAL = Object.freeze({
  alertName: "Pflege » Nacht",
  email: "phase09-migration-original@example.test",
});
const MUTATED = Object.freeze({
  alertName: "Informatik",
  email: "phase09-migration-mutated@example.test",
});

describe("Phase-09 JobAlert delivery snapshot migration", () => {
  it("recovers the original retry identity from EmailLog after Alert and email edits", async () => {
    const database = await createPreSnapshotMigrationDatabase();
    try {
      await insertPreSnapshotCanary(database.client);
      const repository = createEmailLogRepository(database.client);
      const provider = new MockEmailProvider(repository, {
        mailbox: Object.freeze({
          validate: () => undefined,
          capture: () => undefined,
        }),
      });
      await sendDigest(provider, ORIGINAL, "A".repeat(43));

      await database.client.query(
        `UPDATE "JobAlert"
           SET "query" = $1::jsonb, "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $2::uuid`,
        [JSON.stringify({ keyword: MUTATED.alertName }), IDS.alert],
      );
      await database.client.query(
        `UPDATE "User"
           SET "email" = $1, "emailNormalized" = $1,
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $2::uuid`,
        [MUTATED.email, IDS.user],
      );

      await applyMigration(database.client, SNAPSHOT_MIGRATION);

      const snapshot = await database.client.query<{
        alertNameSnapshot: string;
        recipientEmailSnapshot: string;
      }>(
        `SELECT "alertNameSnapshot", "recipientEmailSnapshot"
           FROM "JobAlertDigest"
           WHERE "id" = $1::uuid`,
        [IDS.digest],
      );
      expect(snapshot.rows).toEqual([
        {
          alertNameSnapshot: ORIGINAL.alertName,
          recipientEmailSnapshot: ORIGINAL.email,
        },
      ]);

      await sendDigest(provider, ORIGINAL, "B".repeat(43));
      await expect(
        database.client.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM "EmailLog"
             WHERE "purpose" = 'job_alert_digest_mock'`,
        ),
      ).resolves.toMatchObject({ rows: [{ count: "1" }] });
    } finally {
      await database.dispose();
    }
  }, 120_000);
});

async function sendDigest(
  provider: MockEmailProvider,
  delivery: Readonly<{ alertName: string; email: string }>,
  rawToken: string,
) {
  const data = Object.freeze({
    alertName: delivery.alertName,
    jobCount: 0,
    idempotencyKey: `job-alert-digest:${IDS.digest}`,
    unsubscribeUrl: `http://127.0.0.1:3000/alerts/unsubscribe/${rawToken}`,
  });
  const rendered = renderEmailTemplate("job_alert_digest_mock", data);
  return provider.send({
    to: delivery.email,
    templateKey: "job_alert_digest_mock",
    data,
    subject: rendered.subject,
  });
}

function createEmailLogRepository(client: Client): EmailLogRepository {
  return Object.freeze({
    async record(input: Parameters<EmailLogRepository["record"]>[0]) {
      if (input.id === undefined) {
        throw new Error(
          "The migration canary requires a deterministic log ID.",
        );
      }
      const existing = await client.query<{
        recipient: string;
        templateKey: string;
        providerReference: string | null;
      }>(
        `SELECT "recipient", "templateKey", "providerReference"
         FROM "EmailLog"
         WHERE "id" = $1::uuid`,
        [input.id],
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        if (
          row.recipient !== input.recipient ||
          row.templateKey !== input.templateKey ||
          row.providerReference !== input.providerReference
        ) {
          throw new EmailLogIdempotencyConflictError();
        }
        return Object.freeze({ id: input.id, created: false });
      }
      await client.query(
        `INSERT INTO "EmailLog" (
          "id", "recipient", "purpose", "templateKey", "payload", "status",
          "providerReference", "updatedAt"
        ) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::"EmailLogStatus", $7,
          CURRENT_TIMESTAMP)`,
        [
          input.id,
          input.recipient,
          input.purpose,
          input.templateKey,
          JSON.stringify(input.payload),
          input.status,
          input.providerReference,
        ],
      );
      return Object.freeze({ id: input.id, created: true });
    },
  });
}

async function insertPreSnapshotCanary(client: Client) {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO "User" (
        "id", "email", "emailNormalized", "role", "status",
        "dataProvenance", "updatedAt"
      ) VALUES ($1::uuid, $2, $2, 'CANDIDATE', 'ACTIVE', 'LIVE',
        CURRENT_TIMESTAMP)`,
      [IDS.user, ORIGINAL.email],
    );
    await client.query(
      `INSERT INTO "CandidateProfile" ("id", "userId", "updatedAt")
       VALUES ($1::uuid, $2::uuid, CURRENT_TIMESTAMP)`,
      [IDS.profile, IDS.user],
    );
    await client.query(
      `INSERT INTO "JobAlert" (
        "id", "candidateProfileId", "query", "frequency", "status",
        "nextDueAt", "createdAt", "updatedAt"
      ) VALUES (
        $1::uuid, $2::uuid, $3::jsonb, 'DAILY', 'ACTIVE',
        TIMESTAMPTZ '2026-07-19 12:00:00+00',
        TIMESTAMPTZ '2026-07-17 12:00:00+00',
        TIMESTAMPTZ '2026-07-17 12:00:00+00'
      )`,
      [IDS.alert, IDS.profile, JSON.stringify({ keyword: ORIGINAL.alertName })],
    );
    await client.query(
      `INSERT INTO "JobAlertDigest" (
        "id", "jobAlertId", "policyVersion", "windowStart", "windowEnd",
        "scheduledFor", "runAt", "itemCount", "createdAt"
      ) VALUES (
        $1::uuid, $2::uuid, 'job-alert-policy-v1',
        TIMESTAMPTZ '2026-07-17 12:00:00+00',
        TIMESTAMPTZ '2026-07-19 12:00:00+00',
        TIMESTAMPTZ '2026-07-19 12:00:00+00',
        TIMESTAMPTZ '2026-07-19 12:00:00+00', 0,
        TIMESTAMPTZ '2026-07-19 12:00:00+00'
      )`,
      [IDS.digest, IDS.alert],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function createPreSnapshotMigrationDatabase() {
  const configuration = getIsolatedTestDatabaseConfiguration();
  const baseUrl = new URL(configuration.connectionString);
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.searchParams.delete("schema");
  const databaseName = `sth_test_alertsnap_${randomUUID().replaceAll("-", "")}`;
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Generated alert-snapshot database name is unsafe.");
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
    await applyMigrationsThrough(client, PRE_SNAPSHOT_MIGRATION);
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
    throw new Error("Refusing to drop an unsafe alert-snapshot database.");
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
