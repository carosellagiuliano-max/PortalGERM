import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "prisma", "migrations");
const PREVIOUS_MIGRATION =
  "20260721223000_phase_12_checkout_settlement_hardening";
const EXPIRY_BOUNDARY_MIGRATION =
  "20260721224000_phase_12_credit_expiry_boundary";
const DATABASE_NAME_PATTERN = /^sth_test_phase12expiry_[a-f0-9]+$/u;

const uuid = (sequence: number) =>
  `ceb00000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

const IDS = Object.freeze({
  company: uuid(1),
  account: uuid(2),
  grant: uuid(3),
  expiryAtBoundary: uuid(4),
  expiryAfterBoundary: uuid(5),
});

const VALID_FROM = "2045-01-01T00:00:00.000Z";
const VALID_TO = "2045-02-01T00:00:00.000Z";
const BEFORE_VALID_TO = "2045-01-31T23:59:59.999Z";
const AFTER_VALID_TO = "2045-02-02T00:00:00.000Z";

describe.sequential("Phase 12 Credit expiry boundary migration", () => {
  it("fails closed when historical EXPIRE evidence predates its Grant boundary", async () => {
    const database = await createDatabaseThrough(PREVIOUS_MIGRATION);
    try {
      await seedGrant(database.client, 1);
      await insertExpiry(database.client, {
        amount: -1,
        createdAt: BEFORE_VALID_TO,
        id: IDS.expiryAtBoundary,
        idempotencyKey: "phase12-expiry-historical-early",
      });

      await expectConstraint(
        () => applyMigration(database.client, EXPIRY_BOUNDARY_MIGRATION),
        "23514",
        "credit_ledger_expiry_grant_boundary_check",
      );
    } finally {
      await database.dispose();
    }
  }, 120_000);

  it("upgrades valid history and allows exact/later expiry without weakening append-only or idempotency guards", async () => {
    const database = await createDatabaseThrough(PREVIOUS_MIGRATION);
    try {
      await seedGrant(database.client, 2);
      await applyMigration(database.client, EXPIRY_BOUNDARY_MIGRATION);

      const trigger = await database.client.query<{ triggerName: string }>(
        `SELECT tgname AS "triggerName"
           FROM pg_trigger
          WHERE NOT tgisinternal
            AND tgname = 'phase12_credit_expiry_boundary_trigger'`,
      );
      expect(trigger.rows).toEqual([
        { triggerName: "phase12_credit_expiry_boundary_trigger" },
      ]);

      await expectConstraint(
        () =>
          insertExpiry(database.client, {
            amount: -1,
            createdAt: BEFORE_VALID_TO,
            id: IDS.expiryAtBoundary,
            idempotencyKey: "phase12-expiry-boundary",
          }),
        "23514",
        "credit_ledger_expiry_grant_boundary_check",
      );

      await insertExpiry(database.client, {
        amount: -1,
        createdAt: VALID_TO,
        id: IDS.expiryAtBoundary,
        idempotencyKey: "phase12-expiry-boundary",
      });
      await expectConstraint(
        () =>
          insertExpiry(database.client, {
            amount: -1,
            createdAt: AFTER_VALID_TO,
            id: uuid(6),
            idempotencyKey: "phase12-expiry-boundary",
          }),
        "23505",
        "CreditLedgerEntry_accountId_idempotencyKey_key",
      );
      await expectConstraint(
        () =>
          database.client.query(
            `UPDATE "CreditLedgerEntry"
                SET "consumedGrantEntryId" = NULL
              WHERE "id" = $1`,
            [IDS.expiryAtBoundary],
          ),
        "23514",
        "phase02_append_only",
      );

      await insertExpiry(database.client, {
        amount: -1,
        createdAt: AFTER_VALID_TO,
        id: IDS.expiryAfterBoundary,
        idempotencyKey: "phase12-expiry-after-boundary",
      });
      const total = await database.client.query<{ balance: string }>(
        `SELECT sum("amount")::text AS "balance"
           FROM "CreditLedgerEntry"
          WHERE "accountId" = $1`,
        [IDS.account],
      );
      expect(total.rows).toEqual([{ balance: "0" }]);
    } finally {
      await database.dispose();
    }
  }, 120_000);
});

async function seedGrant(client: Client, amount: number) {
  await client.query(
    `INSERT INTO "Company" (
       "id", "name", "slug", "values", "benefits", "status", "updatedAt"
     ) VALUES (
       $1, 'Credit Expiry Migration AG', 'credit-expiry-migration-ag',
       ARRAY[]::text[], ARRAY[]::text[], 'DRAFT', CURRENT_TIMESTAMP
     )`,
    [IDS.company],
  );
  await client.query(
    `INSERT INTO "CreditAccount" (
       "id", "companyId", "creditType", "fundingSource",
       "periodStart", "periodEnd"
     ) VALUES ($1, $2, 'TALENT_CONTACT', 'ADMIN_GRANT', $3, $4)`,
    [IDS.account, IDS.company, VALID_FROM, VALID_TO],
  );
  await client.query(
    `INSERT INTO "CreditLedgerEntry" (
       "id", "accountId", "fundingSource", "kind", "amount",
       "validFrom", "validTo", "idempotencyKey", "reasonCode", "createdAt"
     ) VALUES (
       $1, $2, 'ADMIN_GRANT', 'GRANT', $3, $4, $5,
       'phase12-expiry-migration-grant', 'TEST_GRANT', $4
     )`,
    [IDS.grant, IDS.account, amount, VALID_FROM, VALID_TO],
  );
}

async function insertExpiry(
  client: Client,
  input: Readonly<{
    amount: number;
    createdAt: string;
    id: string;
    idempotencyKey: string;
  }>,
) {
  await client.query(
    `INSERT INTO "CreditLedgerEntry" (
       "id", "accountId", "fundingSource", "kind", "amount",
       "consumedGrantEntryId", "validFrom", "validTo",
       "idempotencyKey", "reasonCode", "createdAt"
     ) VALUES (
       $1, $2, 'ADMIN_GRANT', 'EXPIRE', $3, $4, $5, $6, $7,
       'PERIOD_ENDED', $8
     )`,
    [
      input.id,
      IDS.account,
      input.amount,
      IDS.grant,
      VALID_FROM,
      VALID_TO,
      input.idempotencyKey,
      input.createdAt,
    ],
  );
}

async function expectConstraint(
  operation: () => Promise<unknown>,
  code: string,
  constraint: string,
) {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught, `Expected PostgreSQL constraint ${constraint} to reject`).toEqual(
    expect.objectContaining({ code, constraint }),
  );
}

async function createDatabaseThrough(finalMigration: string) {
  const configuration = getIsolatedTestDatabaseConfiguration();
  const baseUrl = new URL(configuration.connectionString);
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.searchParams.delete("schema");
  const databaseName = `sth_test_phase12expiry_${randomUUID().replaceAll("-", "")}`;
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Generated Phase-12 Credit expiry database name is unsafe.");
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
    await applyMigrationsThrough(client, finalMigration);
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
    throw new Error("Refusing to drop an unsafe Phase-12 Credit expiry database.");
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
