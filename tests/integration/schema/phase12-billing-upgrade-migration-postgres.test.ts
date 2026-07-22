import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "prisma", "migrations");
const PRE_PHASE_12_MIGRATION = "20260721160000_phase_11_admin_operations";
const PHASE_12_MIGRATION = "20260721203000_phase_12_billing_entitlements";
const DATABASE_NAME_PATTERN = /^sth_test_phase12upgrade_[a-f0-9]+$/u;

const IDS = Object.freeze({
  user: "8a000000-0000-4000-8000-000000000001",
  company: "8a000000-0000-4000-8000-000000000002",
  plan: "8a000000-0000-4000-8000-000000000003",
  planVersion: "8a000000-0000-4000-8000-000000000004",
  entitlement: "8a000000-0000-4000-8000-000000000005",
  subscription: "8a000000-0000-4000-8000-000000000006",
  account: "8a000000-0000-4000-8000-000000000007",
  grant: "8a000000-0000-4000-8000-000000000008",
  consume: "8a000000-0000-4000-8000-000000000009",
  taxRate: "8a000000-0000-4000-8000-000000000010",
  order: "8a000000-0000-4000-8000-000000000011",
  orderLine: "8a000000-0000-4000-8000-000000000012",
  subscriptionSnapshot: "8a000000-0000-4000-8000-000000000013",
});

describe("Phase-12 billing upgrade migration", () => {
  it("backfills released Orders and append-only Credit lineage without weakening their guards", async () => {
    const database = await createPrePhase12Database();
    try {
      await insertHistoricalBillingCanary(database.client);
      await applyMigration(database.client, PHASE_12_MIGRATION);

      const order = await database.client.query<{ requestFingerprint: string }>(
        `SELECT "requestFingerprint" FROM "Order" WHERE "id" = $1::uuid`,
        [IDS.order],
      );
      expect(order.rows[0]?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/u);

      const lineage = await database.client.query<{
        id: string;
        sourceSubscriptionId: string | null;
        consumedGrantEntryId: string | null;
      }>(
        `SELECT "id", "sourceSubscriptionId", "consumedGrantEntryId"
           FROM "CreditLedgerEntry"
          WHERE "id" IN ($1::uuid, $2::uuid)
          ORDER BY "id"`,
        [IDS.grant, IDS.consume],
      );
      expect(lineage.rows).toEqual([
        {
          id: IDS.grant,
          sourceSubscriptionId: IDS.subscription,
          consumedGrantEntryId: null,
        },
        {
          id: IDS.consume,
          sourceSubscriptionId: null,
          consumedGrantEntryId: IDS.grant,
        },
      ]);

      await expectConstraint(
        () =>
          database.client.query(
            `UPDATE "Order" SET "requestFingerprint" = $1 WHERE "id" = $2::uuid`,
            ["f".repeat(64), IDS.order],
          ),
        "order_released_immutable",
      );
      await expectConstraint(
        () =>
          database.client.query(
            `UPDATE "CreditLedgerEntry" SET "reasonCode" = 'REWRITTEN' WHERE "id" = $1::uuid`,
            [IDS.grant],
          ),
        "phase02_append_only",
      );

      await database.client.query(
        `INSERT INTO "SubscriptionOrderSnapshot" (
           "id", "orderLineId", "policyVersion", "changeKind",
           "fulfillmentPeriodStart", "fulfillmentPeriodEnd",
           "targetRecurringNetRappen", "quotedNetRappen",
           "activeJobLimitSnapshot", "seatLimitSnapshot",
           "talentContactAllowanceSnapshot", "jobBoostAllowanceSnapshot",
           "retainedMembershipIds"
         ) VALUES (
           $1::uuid, $2::uuid, 'BILLING_POLICY_V1', 'NEW',
           '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
           100, 100, 2, 1, 2, 0, ARRAY[]::text[]
         )`,
        [IDS.subscriptionSnapshot, IDS.orderLine],
      );
      await expectConstraint(
        () =>
          database.client.query(
            `UPDATE "SubscriptionOrderSnapshot"
                SET "policyVersion" = 'REWRITTEN'
              WHERE "id" = $1::uuid`,
            [IDS.subscriptionSnapshot],
          ),
        "phase02_append_only",
      );
    } finally {
      await database.dispose();
    }
  }, 120_000);
});

async function insertHistoricalBillingCanary(client: Client) {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO "User" (
         "id", "email", "emailNormalized", "role", "updatedAt"
       ) VALUES (
         $1::uuid, 'phase12-upgrade@example.test',
         'phase12-upgrade@example.test', 'EMPLOYER', CURRENT_TIMESTAMP
       )`,
      [IDS.user],
    );
    await client.query(
      `INSERT INTO "Company" (
         "id", "name", "slug", "values", "benefits", "status", "updatedAt"
       ) VALUES (
         $1::uuid, 'Phase 12 Upgrade AG', 'phase12-upgrade-ag',
         ARRAY[]::text[], ARRAY[]::text[], 'DRAFT', CURRENT_TIMESTAMP
       )`,
      [IDS.company],
    );
    await client.query(
      `INSERT INTO "Plan" ("id", "code", "name", "updatedAt")
       VALUES ($1::uuid, 'PHASE12_UPGRADE', 'Phase 12 Upgrade', CURRENT_TIMESTAMP)`,
      [IDS.plan],
    );
    await client.query(
      `INSERT INTO "PlanVersion" (
         "id", "planId", "version", "status", "priceMode",
         "billingInterval", "termMonths", "netPriceRappen",
         "monthlyEquivalentRappen", "currency", "validFrom"
       ) VALUES (
         $1::uuid, $2::uuid, 1, 'DRAFT', 'FIXED', 'MONTHLY', 1,
         100, 100, 'CHF', '2026-01-01T00:00:00.000Z'
       )`,
      [IDS.planVersion, IDS.plan],
    );
    await client.query(
      `INSERT INTO "PlanEntitlement" (
         "id", "planVersionId", "key", "valueType", "integerValue"
       ) VALUES ($1::uuid, $2::uuid, 'TALENT_CONTACT_ALLOWANCE', 'INTEGER', 2)`,
      [IDS.entitlement, IDS.planVersion],
    );
    await client.query(
      `UPDATE "PlanVersion" SET "status" = 'ACTIVE' WHERE "id" = $1::uuid`,
      [IDS.planVersion],
    );
    await client.query(
      `INSERT INTO "EmployerSubscription" (
         "id", "companyId", "planVersionId", "status",
         "currentPeriodStart", "currentPeriodEnd", "billingIntervalSnapshot",
         "termMonthsSnapshot", "recurringNetRappenSnapshot",
         "monthlyEquivalentRappenSnapshot", "currencySnapshot", "activatedAt",
         "updatedAt"
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'ACTIVE',
         '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
         'MONTHLY', 1, 100, 100, 'CHF', '2026-07-01T00:00:00.000Z',
         CURRENT_TIMESTAMP
       )`,
      [IDS.subscription, IDS.company, IDS.planVersion],
    );
    await client.query(
      `INSERT INTO "CreditAccount" (
         "id", "companyId", "creditType", "fundingSource",
         "periodStart", "periodEnd"
       ) VALUES (
         $1::uuid, $2::uuid, 'TALENT_CONTACT', 'PLAN_ALLOWANCE',
         '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
       )`,
      [IDS.account, IDS.company],
    );
    await client.query(
      `INSERT INTO "CreditLedgerEntry" (
         "id", "accountId", "fundingSource", "kind", "amount",
         "sourcePlanVersionId", "validFrom", "validTo", "idempotencyKey",
         "reasonCode", "createdAt"
       ) VALUES (
         $1::uuid, $2::uuid, 'PLAN_ALLOWANCE', 'GRANT', 2, $3::uuid,
         '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
         'phase12-upgrade-grant', 'PERIOD_ALLOWANCE',
         '2026-07-01T00:01:00.000Z'
       )`,
      [IDS.grant, IDS.account, IDS.planVersion],
    );
    await client.query(
      `INSERT INTO "CreditLedgerEntry" (
         "id", "accountId", "fundingSource", "kind", "amount",
         "validFrom", "validTo", "idempotencyKey", "reasonCode", "createdAt"
       ) VALUES (
         $1::uuid, $2::uuid, 'PLAN_ALLOWANCE', 'CONSUME', -1,
         '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
         'phase12-upgrade-consume', 'CONTACT_REQUEST',
         '2026-07-02T00:00:00.000Z'
       )`,
      [IDS.consume, IDS.account],
    );
    await client.query(
      `INSERT INTO "TaxRateVersion" (
         "id", "jurisdiction", "taxType", "rateBasisPoints", "validFrom", "source"
       ) VALUES (
         $1::uuid, 'CH', 'MWST_STANDARD_DEMO', 810,
         '2026-01-01T00:00:00.000Z', 'Phase 12 upgrade canary'
       )`,
      [IDS.taxRate],
    );
    await client.query(
      `INSERT INTO "Order" (
         "id", "companyId", "createdByUserId", "status", "provider",
         "clientIdempotencyKey", "billingLegalNameSnapshot",
         "billingContactEmailSnapshot", "billingStreetSnapshot",
         "billingPostalCodeSnapshot", "billingCitySnapshot",
         "billingCountryCodeSnapshot", "currency", "netTotalRappen",
         "vatTotalRappen", "totalRappen", "updatedAt"
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'DRAFT', 'MOCK',
         'phase12-upgrade-order', 'Phase 12 Upgrade AG',
         'billing@example.test', 'Teststrasse 1', '8000', 'Zürich', 'CH',
         'CHF', 100, 8, 108, CURRENT_TIMESTAMP
       )`,
      [IDS.order, IDS.company, IDS.user],
    );
    await client.query(
      `INSERT INTO "OrderLine" (
         "id", "orderId", "planVersionId", "taxRateVersionId", "quantity",
         "unitNetRappen", "netRappen", "taxRateBasisPoints", "vatRappen",
         "totalRappen", "currency", "descriptionSnapshot", "fulfillmentContext"
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, 100, 100, 810, 8, 108,
         'CHF', 'Historical monthly plan', 'SUBSCRIPTION'
       )`,
      [IDS.orderLine, IDS.order, IDS.planVersion, IDS.taxRate],
    );
    await client.query(
      `UPDATE "Order" SET "status" = 'PENDING' WHERE "id" = $1::uuid`,
      [IDS.order],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
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

async function createPrePhase12Database() {
  const configuration = getIsolatedTestDatabaseConfiguration();
  const baseUrl = new URL(configuration.connectionString);
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.searchParams.delete("schema");
  const databaseName = `sth_test_phase12upgrade_${randomUUID().replaceAll("-", "")}`;
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Generated Phase-12 upgrade database name is unsafe.");
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
    await applyMigrationsThrough(client, PRE_PHASE_12_MIGRATION);
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
    throw new Error("Refusing to drop an unsafe Phase-12 upgrade database.");
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
