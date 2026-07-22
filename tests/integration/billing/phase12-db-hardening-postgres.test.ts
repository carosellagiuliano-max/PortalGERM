import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const uuid = (sequence: number) =>
  `74200000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;

const IDS = Object.freeze({
  ownerUser: uuid(1),
  adminUser: uuid(2),
  company: uuid(3),
  foreignCompany: uuid(4),
  ownerMembership: uuid(5),
  adminMembership: uuid(6),
  plan: uuid(7),
  planVersion: uuid(8),
  taxRate: uuid(9),
  currentSubscription: uuid(10),
  successorSubscription: uuid(11),
});

const PERIOD_START = "2035-01-01T00:00:00.000Z";
const PERIOD_END = "2035-02-01T00:00:00.000Z";
const SUCCESSOR_END = "2035-03-01T00:00:00.000Z";
const NET_RAPPEN = 10_000;
const TAX_BASIS_POINTS = 810;
const VAT_RAPPEN = 810;
const TOTAL_RAPPEN = NET_RAPPEN + VAT_RAPPEN;

let migrated: MigratedDatabase | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_db_hardening");
  await seedContractScope(database());
});

afterAll(async () => {
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 PostgreSQL commercial snapshot hardening", () => {
  it("freezes CreditAccount identity and period and forbids deletion", async () => {
    const accountId = uuid(20);
    const entryId = uuid(21);
    await database().query(
      `INSERT INTO "CreditAccount" (
         "id", "companyId", "creditType", "fundingSource",
         "periodStart", "periodEnd"
       ) VALUES ($1, $2, 'TALENT_CONTACT', 'ADMIN_GRANT', $3, $4)`,
      [accountId, IDS.company, PERIOD_START, PERIOD_END],
    );
    await database().query(
      `INSERT INTO "CreditLedgerEntry" (
         "id", "accountId", "fundingSource", "kind", "amount",
         "validFrom", "validTo", "idempotencyKey", "reasonCode",
         "actorUserId", "createdAt"
       ) VALUES (
         $1, $2, 'ADMIN_GRANT', 'GRANT', 2, $3, $4,
         'phase12-hardening-credit', 'TEST_GRANT', $5, $3
       )`,
      [entryId, accountId, PERIOD_START, PERIOD_END, IDS.ownerUser],
    );

    await database().query(
      `UPDATE "CreditAccount" SET "periodEnd" = "periodEnd" WHERE "id" = $1`,
      [accountId],
    );
    await expectConstraint(
      () =>
        database().query(
          `UPDATE "CreditAccount"
              SET "companyId" = $2, "creditType" = 'JOB_BOOST',
                  "fundingSource" = 'PURCHASED_PACK',
                  "periodEnd" = $3
            WHERE "id" = $1`,
          [accountId, IDS.foreignCompany, SUCCESSOR_END],
        ),
      "23514",
      "credit_account_commercial_snapshot_immutable",
    );
    await expectConstraint(
      () => database().query(`DELETE FROM "CreditAccount" WHERE "id" = $1`, [accountId]),
      "23514",
      "credit_account_commercial_snapshot_immutable",
    );

    const preserved = await database().query<{
      companyId: string;
      creditType: string;
      fundingSource: string;
      ledgerCount: string;
      periodEnd: Date;
    }>(
      `SELECT account."companyId", account."creditType"::text AS "creditType",
              account."fundingSource"::text AS "fundingSource",
              account."periodEnd", count(entry."id")::text AS "ledgerCount"
         FROM "CreditAccount" AS account
         JOIN "CreditLedgerEntry" AS entry ON entry."accountId" = account."id"
        WHERE account."id" = $1
        GROUP BY account."id"`,
      [accountId],
    );
    expect(preserved.rows).toEqual([
      {
        companyId: IDS.company,
        creditType: "TALENT_CONTACT",
        fundingSource: "ADMIN_GRANT",
        ledgerCount: "1",
        periodEnd: new Date(PERIOD_END),
      },
    ]);
  });

  it("requires the retained default Owner membership inside both retained-seat snapshots", async () => {
    const rejectedOrderId = uuid(30);
    const rejectedLineId = uuid(31);
    await insertOrderWithLine(database(), {
      orderId: rejectedOrderId,
      orderLineId: rejectedLineId,
      suffix: "retained-owner-rejected",
    });
    await expectConstraint(
      () =>
        insertDowngradeSnapshot({
          id: uuid(32),
          orderLineId: rejectedLineId,
          retainedMembershipIds: [IDS.adminMembership],
        }),
      "23514",
      "subscription_order_snapshot_retained_owner_membership_check",
    );

    const acceptedOrderId = uuid(33);
    const acceptedLineId = uuid(34);
    await insertOrderWithLine(database(), {
      orderId: acceptedOrderId,
      orderLineId: acceptedLineId,
      suffix: "retained-owner-accepted",
    });
    await insertDowngradeSnapshot({
      id: uuid(35),
      orderLineId: acceptedLineId,
      retainedMembershipIds: [IDS.ownerMembership, IDS.adminMembership],
    });

    await expectConstraint(
      () =>
        insertDowngradeSchedule({
          id: uuid(36),
          retainedMembershipIds: [IDS.adminMembership],
          suffix: "rejected",
        }),
      "23514",
      "subscription_change_retained_owner_membership_check",
    );
    await insertDowngradeSchedule({
      id: uuid(37),
      retainedMembershipIds: [IDS.ownerMembership, IDS.adminMembership],
      suffix: "accepted",
    });

    const retained = await database().query<{
      orderOwnerIncluded: boolean;
      scheduleOwnerIncluded: boolean;
    }>(
      `SELECT
         snapshot."retainedMembershipIds" @> ARRAY[$1]::text[] AS "orderOwnerIncluded",
         schedule."retainedMembershipIds" @> ARRAY[$1]::text[] AS "scheduleOwnerIncluded"
       FROM "SubscriptionOrderSnapshot" AS snapshot
       CROSS JOIN "SubscriptionChangeSchedule" AS schedule
       WHERE snapshot."id" = $2 AND schedule."id" = $3`,
      [IDS.ownerMembership, uuid(35), uuid(37)],
    );
    expect(retained.rows).toEqual([
      { orderOwnerIncluded: true, scheduleOwnerIncluded: true },
    ]);
  });

  it("binds every OrderLine tax snapshot to the exact TaxRateVersion basis points", async () => {
    const rejectedOrderId = uuid(40);
    const rejectedLineId = uuid(41);
    await expectConstraint(
      () =>
        insertOrderWithLine(database(), {
          orderId: rejectedOrderId,
          orderLineId: rejectedLineId,
          suffix: "tax-mismatch",
          taxRateBasisPoints: 0,
          vatRappen: 0,
          totalRappen: NET_RAPPEN,
        }),
      "23503",
      "order_line_tax_rate_snapshot_fkey",
    );

    const acceptedOrderId = uuid(42);
    const acceptedLineId = uuid(43);
    await insertOrderWithLine(database(), {
      orderId: acceptedOrderId,
      orderLineId: acceptedLineId,
      suffix: "tax-exact",
    });
    await expectConstraint(
      () =>
        database().query(
          `UPDATE "TaxRateVersion" SET "rateBasisPoints" = 900 WHERE "id" = $1`,
          [IDS.taxRate],
        ),
      "23503",
      "order_line_tax_rate_snapshot_fkey",
    );

    const exact = await database().query<{
      lineRate: number;
      sourceRate: number;
    }>(
      `SELECT line."taxRateBasisPoints" AS "lineRate",
              tax."rateBasisPoints" AS "sourceRate"
         FROM "OrderLine" AS line
         JOIN "TaxRateVersion" AS tax ON tax."id" = line."taxRateVersionId"
        WHERE line."id" = $1`,
      [acceptedLineId],
    );
    expect(exact.rows).toEqual([
      { lineRate: TAX_BASIS_POINTS, sourceRate: TAX_BASIS_POINTS },
    ]);
  });

  it("copies a paid Order and its Lines exactly while retaining Invoice lifecycle transitions", async () => {
    const unpaidOrderId = uuid(50);
    const unpaidLineId = uuid(51);
    await insertOrderWithLine(database(), {
      orderId: unpaidOrderId,
      orderLineId: unpaidLineId,
      suffix: "invoice-unpaid",
    });
    await expectConstraint(
      () =>
        insertInvoice(database(), {
          invoiceId: uuid(52),
          invoiceLineId: uuid(53),
          number: "STH-2035-90001",
          orderId: unpaidOrderId,
          orderLineId: unpaidLineId,
        }),
      "23514",
      "invoice_paid_order_snapshot_check",
    );

    const paidOrderId = uuid(54);
    const paidLineId = uuid(55);
    await insertOrderWithLine(database(), {
      orderId: paidOrderId,
      orderLineId: paidLineId,
      suffix: "invoice-paid",
    });
    await markOrderPaid(paidOrderId);

    await expectConstraint(
      () =>
        insertInvoice(database(), {
          invoiceId: uuid(56),
          invoiceLineId: uuid(57),
          legalName: "Rewritten Tenant AG",
          number: "STH-2035-90002",
          orderId: paidOrderId,
          orderLineId: paidLineId,
        }),
      "23514",
      "invoice_paid_order_snapshot_check",
    );
    await expectConstraint(
      () =>
        insertInvoice(database(), {
          description: "Rewritten commercial line",
          invoiceId: uuid(58),
          invoiceLineId: uuid(59),
          number: "STH-2035-90003",
          orderId: paidOrderId,
          orderLineId: paidLineId,
        }),
      "23514",
      "invoice_line_order_snapshot_check",
    );

    const invoiceId = uuid(60);
    const invoiceLineId = uuid(61);
    await insertInvoice(database(), {
      invoiceId,
      invoiceLineId,
      number: "STH-2035-90004",
      orderId: paidOrderId,
      orderLineId: paidLineId,
    });
    await expectConstraint(
      () =>
        database().query(
          `UPDATE "Invoice" SET "dueAt" = "dueAt" + interval '1 day' WHERE "id" = $1`,
          [invoiceId],
        ),
      "23514",
      "invoice_released_immutable",
    );
    await expectConstraint(
      () =>
        database().query(
          `UPDATE "InvoiceLine" SET "sortOrder" = 2 WHERE "id" = $1`,
          [invoiceLineId],
        ),
      "23514",
      "phase02_append_only",
    );

    await database().query(
      `UPDATE "Invoice"
          SET "status" = 'ISSUED', "issuedAt" = '2035-01-15T12:00:00.000Z'
        WHERE "id" = $1`,
      [invoiceId],
    );
    await database().query(
      `UPDATE "Invoice"
          SET "status" = 'PAID', "paidAt" = '2035-01-15T12:01:00.000Z'
        WHERE "id" = $1`,
      [invoiceId],
    );

    const copied = await database().query<{
      invoiceStatus: string;
      headerMatches: boolean;
      lineMatches: boolean;
    }>(
      `SELECT invoice."status"::text AS "invoiceStatus",
              ROW(
                invoice."companyId", invoice."billingLegalNameSnapshot",
                invoice."billingContactEmailSnapshot", invoice."billingStreetSnapshot",
                invoice."billingPostalCodeSnapshot", invoice."billingCitySnapshot",
                invoice."billingCountryCodeSnapshot", invoice."billingUidSnapshot",
                invoice."billingVatNumberSnapshot", invoice."currency",
                invoice."netTotalRappen", invoice."vatTotalRappen", invoice."totalRappen"
              ) IS NOT DISTINCT FROM ROW(
                orders."companyId", orders."billingLegalNameSnapshot",
                orders."billingContactEmailSnapshot", orders."billingStreetSnapshot",
                orders."billingPostalCodeSnapshot", orders."billingCitySnapshot",
                orders."billingCountryCodeSnapshot", orders."billingUidSnapshot",
                orders."billingVatNumberSnapshot", orders."currency",
                orders."netTotalRappen", orders."vatTotalRappen", orders."totalRappen"
              ) AS "headerMatches",
              ROW(
                invoice_line."descriptionSnapshot", invoice_line."quantity",
                invoice_line."unitNetRappen", invoice_line."netRappen",
                invoice_line."taxRateBasisPoints", invoice_line."vatRappen",
                invoice_line."totalRappen", invoice_line."currency"
              ) IS NOT DISTINCT FROM ROW(
                order_line."descriptionSnapshot", order_line."quantity",
                order_line."unitNetRappen", order_line."netRappen",
                order_line."taxRateBasisPoints", order_line."vatRappen",
                order_line."totalRappen", order_line."currency"
              ) AS "lineMatches"
         FROM "Invoice" AS invoice
         JOIN "Order" AS orders ON orders."id" = invoice."orderId"
         JOIN "InvoiceLine" AS invoice_line ON invoice_line."invoiceId" = invoice."id"
         JOIN "OrderLine" AS order_line ON order_line."id" = invoice_line."orderLineId"
        WHERE invoice."id" = $1`,
      [invoiceId],
    );
    expect(copied.rows).toEqual([
      { headerMatches: true, invoiceStatus: "PAID", lineMatches: true },
    ]);
  });
});

async function seedContractScope(pool: Pool) {
  await pool.query(
    `INSERT INTO "User" ("id", "email", "emailNormalized", "role", "updatedAt")
     VALUES
       ($1, 'phase12-hardening-owner@example.ch', 'phase12-hardening-owner@example.ch', 'EMPLOYER', CURRENT_TIMESTAMP),
       ($2, 'phase12-hardening-admin@example.ch', 'phase12-hardening-admin@example.ch', 'EMPLOYER', CURRENT_TIMESTAMP)`,
    [IDS.ownerUser, IDS.adminUser],
  );
  await pool.query(
    `INSERT INTO "Company" ("id", "name", "slug", "updatedAt")
     VALUES
       ($1, 'Phase 12 Hardening AG', 'phase12-hardening', CURRENT_TIMESTAMP),
       ($2, 'Phase 12 Foreign AG', 'phase12-hardening-foreign', CURRENT_TIMESTAMP)`,
    [IDS.company, IDS.foreignCompany],
  );
  await pool.query(
    `INSERT INTO "CompanyMembership" (
       "id", "companyId", "userId", "role", "status", "updatedAt"
     ) VALUES
       ($1, $2, $3, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP),
       ($4, $2, $5, 'ADMIN', 'ACTIVE', CURRENT_TIMESTAMP)`,
    [
      IDS.ownerMembership,
      IDS.company,
      IDS.ownerUser,
      IDS.adminMembership,
      IDS.adminUser,
    ],
  );
  await pool.query(
    `INSERT INTO "Plan" ("id", "code", "name", "updatedAt")
     VALUES ($1, 'PHASE12_HARDENING', 'Phase 12 Hardening', CURRENT_TIMESTAMP)`,
    [IDS.plan],
  );
  await pool.query(
    `INSERT INTO "PlanVersion" (
       "id", "planId", "version", "status", "priceMode",
       "billingInterval", "termMonths", "netPriceRappen",
       "monthlyEquivalentRappen", "currency", "validFrom"
     ) VALUES (
       $1, $2, 1, 'DRAFT', 'FIXED', 'MONTHLY', 1,
       $3, $3, 'CHF', '2035-01-01T00:00:00.000Z'
     )`,
    [IDS.planVersion, IDS.plan, NET_RAPPEN],
  );
  await pool.query(
    `INSERT INTO "TaxRateVersion" (
       "id", "jurisdiction", "taxType", "rateBasisPoints",
       "validFrom", "source", "reviewStatus"
     ) VALUES (
       $1, 'CH-PHASE12-HARDENING', 'VAT', $2,
       '2035-01-01T00:00:00.000Z', 'Phase 12 hardening test', 'DRAFT'
     )`,
    [IDS.taxRate, TAX_BASIS_POINTS],
  );
  await pool.query(
    `INSERT INTO "EmployerSubscription" (
       "id", "companyId", "planVersionId", "status",
       "currentPeriodStart", "currentPeriodEnd", "billingIntervalSnapshot",
       "termMonthsSnapshot", "recurringNetRappenSnapshot",
       "monthlyEquivalentRappenSnapshot", "currencySnapshot",
       "activatedAt", "updatedAt"
     ) VALUES
       ($1, $2, $3, 'ACTIVE', $4, $5, 'MONTHLY', 1, 20000, 20000, 'CHF', $4, CURRENT_TIMESTAMP),
       ($6, $2, $3, 'SCHEDULED', $5, $7, 'MONTHLY', 1, 10000, 10000, 'CHF', NULL, CURRENT_TIMESTAMP)`,
    [
      IDS.currentSubscription,
      IDS.company,
      IDS.planVersion,
      PERIOD_START,
      PERIOD_END,
      IDS.successorSubscription,
      SUCCESSOR_END,
    ],
  );
}

async function insertOrderWithLine(
  pool: Pool,
  input: Readonly<{
    orderId: string;
    orderLineId: string;
    suffix: string;
    taxRateBasisPoints?: number;
    vatRappen?: number;
    totalRappen?: number;
  }>,
) {
  const taxRateBasisPoints = input.taxRateBasisPoints ?? TAX_BASIS_POINTS;
  const vatRappen = input.vatRappen ?? VAT_RAPPEN;
  const totalRappen = input.totalRappen ?? TOTAL_RAPPEN;
  await inTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO "Order" (
         "id", "companyId", "createdByUserId", "status", "provider",
         "clientIdempotencyKey", "requestFingerprint",
         "billingLegalNameSnapshot", "billingContactEmailSnapshot",
         "billingStreetSnapshot", "billingPostalCodeSnapshot",
         "billingCitySnapshot", "billingCountryCodeSnapshot",
         "billingUidSnapshot", "billingVatNumberSnapshot", "currency",
         "netTotalRappen", "vatTotalRappen", "totalRappen", "updatedAt"
       ) VALUES (
         $1, $2, $3, 'DRAFT', 'MOCK', $4, $5,
         'Phase 12 Hardening AG', 'billing@phase12-hardening.example.ch',
         'Vertragsstrasse 12', '8000', 'Zürich', 'CH',
         'CHE-123.456.789', 'CHE-123.456.789 MWST', 'CHF',
         $6, $7, $8, CURRENT_TIMESTAMP
       )`,
      [
        input.orderId,
        IDS.company,
        IDS.ownerUser,
        `phase12-hardening:${input.suffix}`,
        input.orderId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        NET_RAPPEN,
        vatRappen,
        totalRappen,
      ],
    );
    await client.query(
      `INSERT INTO "OrderLine" (
         "id", "orderId", "planVersionId", "taxRateVersionId",
         "quantity", "unitNetRappen", "netRappen", "taxRateBasisPoints",
         "vatRappen", "totalRappen", "currency", "descriptionSnapshot",
         "fulfillmentContext"
       ) VALUES (
         $1, $2, $3, $4, 1, $5, $5, $6, $7, $8, 'CHF',
         'Phase 12 hardening monthly plan', 'SUBSCRIPTION'
       )`,
      [
        input.orderLineId,
        input.orderId,
        IDS.planVersion,
        IDS.taxRate,
        NET_RAPPEN,
        taxRateBasisPoints,
        vatRappen,
        totalRappen,
      ],
    );
  });
}

async function insertDowngradeSnapshot(input: Readonly<{
  id: string;
  orderLineId: string;
  retainedMembershipIds: readonly string[];
}>) {
  await database().query(
    `INSERT INTO "SubscriptionOrderSnapshot" (
       "id", "orderLineId", "policyVersion", "changeKind",
       "sourceSubscriptionId", "sourcePeriodStart", "sourcePeriodEnd",
       "fulfillmentPeriodStart", "fulfillmentPeriodEnd",
       "sourceRecurringNetRappen", "targetRecurringNetRappen",
       "quotedNetRappen", "activeJobLimitSnapshot", "seatLimitSnapshot",
       "talentContactAllowanceSnapshot", "jobBoostAllowanceSnapshot",
       "retainedMembershipIds", "retainedDefaultOwnerId"
     ) VALUES (
       $1, $2, 'phase12-v1', 'DOWNGRADE', $3, $4, $5, $5, $6,
       20000, $7, $7, 3, 2, 5, 1, $8::text[], $9
     )`,
    [
      input.id,
      input.orderLineId,
      IDS.currentSubscription,
      PERIOD_START,
      PERIOD_END,
      SUCCESSOR_END,
      NET_RAPPEN,
      [...input.retainedMembershipIds],
      IDS.ownerUser,
    ],
  );
}

async function insertDowngradeSchedule(input: Readonly<{
  id: string;
  retainedMembershipIds: readonly string[];
  suffix: string;
}>) {
  await database().query(
    `INSERT INTO "SubscriptionChangeSchedule" (
       "id", "companyId", "currentSubscriptionId", "successorSubscriptionId",
       "kind", "status", "effectiveAt", "retainedMembershipIds",
       "retainedDefaultOwnerId", "invitationRevocationScope", "actorUserId",
       "idempotencyKey", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, 'DOWNGRADE', 'PENDING', $5, $6::text[], $7,
       '{"policyVersion":"phase12-v1"}'::jsonb, $7, $8, CURRENT_TIMESTAMP
     )`,
    [
      input.id,
      IDS.company,
      IDS.currentSubscription,
      IDS.successorSubscription,
      PERIOD_END,
      [...input.retainedMembershipIds],
      IDS.ownerUser,
      `phase12-hardening-schedule:${input.suffix}`,
    ],
  );
}

async function markOrderPaid(orderId: string) {
  await database().query(
    `UPDATE "Order"
        SET "status" = 'PENDING', "updatedAt" = '2035-01-15T11:59:00.000Z'
      WHERE "id" = $1`,
    [orderId],
  );
  await database().query(
    `UPDATE "Order"
        SET "status" = 'PAID', "paidAt" = '2035-01-15T12:00:00.000Z',
            "providerReference" = $2, "updatedAt" = '2035-01-15T12:00:00.000Z'
      WHERE "id" = $1`,
    [orderId, `mock_payment_${orderId.replaceAll("-", "").padEnd(64, "0").slice(0, 64)}`],
  );
}

async function insertInvoice(
  pool: Pool,
  input: Readonly<{
    description?: string;
    invoiceId: string;
    invoiceLineId: string;
    legalName?: string;
    number: string;
    orderId: string;
    orderLineId: string;
  }>,
) {
  await inTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO "Invoice" (
         "id", "orderId", "companyId", "number", "status",
         "billingLegalNameSnapshot", "billingContactEmailSnapshot",
         "billingStreetSnapshot", "billingPostalCodeSnapshot",
         "billingCitySnapshot", "billingCountryCodeSnapshot",
         "billingUidSnapshot", "billingVatNumberSnapshot", "currency",
         "netTotalRappen", "vatTotalRappen", "totalRappen", "dueAt"
       ) VALUES (
         $1, $2, $3, $4, 'DRAFT', $5,
         'billing@phase12-hardening.example.ch', 'Vertragsstrasse 12',
         '8000', 'Zürich', 'CH', 'CHE-123.456.789',
         'CHE-123.456.789 MWST', 'CHF', $6, $7, $8,
         '2035-01-15T12:00:00.000Z'
       )`,
      [
        input.invoiceId,
        input.orderId,
        IDS.company,
        input.number,
        input.legalName ?? "Phase 12 Hardening AG",
        NET_RAPPEN,
        VAT_RAPPEN,
        TOTAL_RAPPEN,
      ],
    );
    await client.query(
      `INSERT INTO "InvoiceLine" (
         "id", "invoiceId", "orderLineId", "sortOrder",
         "descriptionSnapshot", "quantity", "unitNetRappen", "netRappen",
         "taxRateBasisPoints", "vatRappen", "totalRappen", "currency"
       ) VALUES (
         $1, $2, $3, 1, $4, 1, $5, $5, $6, $7, $8, 'CHF'
       )`,
      [
        input.invoiceLineId,
        input.invoiceId,
        input.orderLineId,
        input.description ?? "Phase 12 hardening monthly plan",
        NET_RAPPEN,
        TAX_BASIS_POINTS,
        VAT_RAPPEN,
        TOTAL_RAPPEN,
      ],
    );
  });
}

async function inTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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

function database() {
  if (migrated === undefined) {
    throw new Error("The isolated Phase 12 hardening database is unavailable.");
  }
  return migrated.pool;
}
