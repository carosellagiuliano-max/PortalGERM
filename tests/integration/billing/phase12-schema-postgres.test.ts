import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;

const uuid = (sequence: number) =>
  `72000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
const fingerprint = (character: string) => character.repeat(64);

const IDS = Object.freeze({
  owner: uuid(1),
  foreignOwner: uuid(2),
  company: uuid(3),
  foreignCompany: uuid(4),
  plan: uuid(5),
  planVersion: uuid(6),
  taxRateVersion: uuid(7),
  canonicalOrder: uuid(8),
  canonicalOrderLine: uuid(9),
});

const LINE_NET_RAPPEN = 10_000;
const LINE_VAT_RAPPEN = 810;
const LINE_TOTAL_RAPPEN = LINE_NET_RAPPEN + LINE_VAT_RAPPEN;
const TAX_RATE_BASIS_POINTS = 810;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_billing_schema");
  await seedMinimalBillingCatalog(getPool());
  await inTransaction(async (client) => {
    await insertOrderWithLine(client, {
      orderId: IDS.canonicalOrder,
      orderLineId: IDS.canonicalOrderLine,
      fingerprint: fingerprint("a"),
    });
  });
});

afterAll(async () => {
  await migrated?.dispose();
});

describe.sequential("Phase 12 PostgreSQL billing invariants", () => {
  it("accepts only lowercase 64-hex Order request fingerprints", async () => {
    const stored = await getPool().query<{ requestFingerprint: string }>(
      `SELECT "requestFingerprint"
         FROM "Order"
        WHERE "id" = $1`,
      [IDS.canonicalOrder],
    );

    expect(stored.rows).toEqual([
      { requestFingerprint: fingerprint("a") },
    ]);

    const invalidOrderId = uuid(10);
    await expectPgConstraint(
      () =>
        inTransaction(async (client) => {
          await insertOrderWithLine(client, {
            orderId: invalidOrderId,
            orderLineId: uuid(11),
            fingerprint: "not-a-sha-256-fingerprint",
          });
        }),
      "23514",
      "order_request_fingerprint_check",
    );

    const rejected = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Order" WHERE "id" = $1`,
      [invalidOrderId],
    );
    expect(rejected.rows[0]?.count).toBe("0");
  });

  it("allows exactly one PAID PaymentEvent per Order while retaining other event kinds", async () => {
    await insertPaymentEvent(uuid(12), "PAID", "phase12-paid-1");
    await insertPaymentEvent(
      uuid(13),
      "CHECKOUT_CREATED",
      "phase12-checkout-created-1",
    );

    await expectPgConstraint(
      () => insertPaymentEvent(uuid(14), "PAID", "phase12-paid-2"),
      "23505",
      "payment_event_single_paid_order_unique",
    );

    const events = await getPool().query<{ kind: string; count: string }>(
      `SELECT "kind"::text AS kind, count(*)::text AS count
         FROM "PaymentEvent"
        WHERE "orderId" = $1
        GROUP BY "kind"
        ORDER BY "kind"`,
      [IDS.canonicalOrder],
    );
    expect(events.rows).toEqual([
      { kind: "CHECKOUT_CREATED", count: "1" },
      { kind: "PAID", count: "1" },
    ]);
  });

  it("defers Order header validation until commit and requires an exact Line sum", async () => {
    const matchingOrderId = uuid(15);
    await inTransaction(async (client) => {
      // The header intentionally precedes its required line. The transaction
      // can commit only because the exact-sum trigger is initially deferred.
      await insertOrderWithLine(client, {
        orderId: matchingOrderId,
        orderLineId: uuid(16),
        fingerprint: fingerprint("b"),
      });
    });

    const matching = await getPool().query<{
      headerTotal: number;
      lineTotal: string;
    }>(
      `SELECT orders."totalRappen" AS "headerTotal",
              sum(lines."totalRappen")::text AS "lineTotal"
         FROM "Order" orders
         JOIN "OrderLine" lines ON lines."orderId" = orders."id"
        WHERE orders."id" = $1
        GROUP BY orders."id"`,
      [matchingOrderId],
    );
    expect(matching.rows).toEqual([
      { headerTotal: LINE_TOTAL_RAPPEN, lineTotal: String(LINE_TOTAL_RAPPEN) },
    ]);

    const mismatchedOrderId = uuid(17);
    await expectPgConstraint(
      () =>
        inTransaction(async (client) => {
          await insertOrderWithLine(client, {
            orderId: mismatchedOrderId,
            orderLineId: uuid(18),
            fingerprint: fingerprint("c"),
            headerNetRappen: LINE_NET_RAPPEN + 1,
            headerTotalRappen: LINE_TOTAL_RAPPEN + 1,
          });
        }),
      "23514",
      "order_line_sum_check",
    );

    const rejected = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Order" WHERE "id" = $1`,
      [mismatchedOrderId],
    );
    expect(rejected.rows[0]?.count).toBe("0");
  });

  it("requires an exact paid Order and Line copy for every Invoice", async () => {
    const matchingOrderId = uuid(19);
    const matchingOrderLineId = uuid(20);
    await inTransaction(async (client) => {
      await insertOrderWithLine(client, {
        orderId: matchingOrderId,
        orderLineId: matchingOrderLineId,
        fingerprint: fingerprint("d"),
      });
    });
    await markOrderPaid(matchingOrderId);

    const matchingInvoiceId = uuid(21);
    await inTransaction(async (client) => {
      await insertInvoiceWithLine(client, {
        invoiceId: matchingInvoiceId,
        invoiceLineId: uuid(22),
        orderId: matchingOrderId,
        orderLineId: matchingOrderLineId,
      });
    });

    const matching = await getPool().query<{
      headerTotal: number;
      lineTotal: string;
    }>(
      `SELECT invoices."totalRappen" AS "headerTotal",
              sum(lines."totalRappen")::text AS "lineTotal"
         FROM "Invoice" invoices
         JOIN "InvoiceLine" lines ON lines."invoiceId" = invoices."id"
        WHERE invoices."id" = $1
        GROUP BY invoices."id"`,
      [matchingInvoiceId],
    );
    expect(matching.rows).toEqual([
      { headerTotal: LINE_TOTAL_RAPPEN, lineTotal: String(LINE_TOTAL_RAPPEN) },
    ]);

    const mismatchedOrderId = uuid(23);
    const mismatchedOrderLineId = uuid(24);
    await inTransaction(async (client) => {
      await insertOrderWithLine(client, {
        orderId: mismatchedOrderId,
        orderLineId: mismatchedOrderLineId,
        fingerprint: fingerprint("e"),
      });
    });
    await markOrderPaid(mismatchedOrderId);

    const mismatchedInvoiceId = uuid(25);
    await expectPgConstraint(
      () =>
        inTransaction(async (client) => {
          await insertInvoiceWithLine(client, {
            invoiceId: mismatchedInvoiceId,
            invoiceLineId: uuid(26),
            orderId: mismatchedOrderId,
            orderLineId: mismatchedOrderLineId,
            headerNetRappen: LINE_NET_RAPPEN + 1,
            headerTotalRappen: LINE_TOTAL_RAPPEN + 1,
          });
        }),
      "23514",
      "invoice_paid_order_snapshot_check",
    );

    const rejected = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Invoice" WHERE "id" = $1`,
      [mismatchedInvoiceId],
    );
    expect(rejected.rows[0]?.count).toBe("0");
  });

  it("allows adjacent released Plan versions but rejects SCHEDULED/ACTIVE overlap", async () => {
    const planId = uuid(27);
    await getPool().query(
      `INSERT INTO "Plan" ("id", "code", "name", "updatedAt")
       VALUES ($1, $2, 'Phase 12 Range Plan', CURRENT_TIMESTAMP)`,
      [planId, `phase12-range-${planId.slice(-4)}`],
    );

    await insertPlanVersion({
      id: uuid(28),
      planId,
      version: 1,
      status: "SCHEDULED",
      validFrom: "2027-01-01T00:00:00.000Z",
      validTo: "2027-02-01T00:00:00.000Z",
    });
    await insertPlanVersion({
      id: uuid(29),
      planId,
      version: 2,
      status: "ACTIVE",
      validFrom: "2027-02-01T00:00:00.000Z",
      validTo: "2027-03-01T00:00:00.000Z",
    });

    await expectPgConstraint(
      () =>
        insertPlanVersion({
          id: uuid(30),
          planId,
          version: 3,
          status: "SCHEDULED",
          validFrom: "2027-01-15T00:00:00.000Z",
          validTo: "2027-02-15T00:00:00.000Z",
        }),
      "23P01",
      "plan_version_released_range_excl",
    );

    const released = await getPool().query<{ version: number; status: string }>(
      `SELECT "version", "status"::text AS status
         FROM "PlanVersion"
        WHERE "planId" = $1
        ORDER BY "version"`,
      [planId],
    );
    expect(released.rows).toEqual([
      { version: 1, status: "SCHEDULED" },
      { version: 2, status: "ACTIVE" },
    ]);
  });

  it("keeps SubscriptionOrderSnapshot quotes bound to their exact Line and tenant", async () => {
    await insertNewSubscriptionSnapshot({
      id: uuid(31),
      orderLineId: IDS.canonicalOrderLine,
      quotedNetRappen: LINE_NET_RAPPEN,
    });

    const scopedOrderId = uuid(32);
    const scopedOrderLineId = uuid(33);
    await inTransaction(async (client) => {
      await insertOrderWithLine(client, {
        orderId: scopedOrderId,
        orderLineId: scopedOrderLineId,
        fingerprint: fingerprint("f"),
      });
    });

    await expectPgConstraint(
      () =>
        insertNewSubscriptionSnapshot({
          id: uuid(34),
          orderLineId: scopedOrderLineId,
          quotedNetRappen: LINE_NET_RAPPEN - 1,
        }),
      "23514",
      "subscription_order_snapshot_line_check",
    );

    const sourceSubscriptionId = uuid(35);
    const sourcePeriodStart = "2027-04-01T00:00:00.000Z";
    const sourcePeriodEnd = "2027-05-01T00:00:00.000Z";
    await getPool().query(
      `INSERT INTO "EmployerSubscription" (
         "id", "companyId", "planVersionId", "status",
         "currentPeriodStart", "currentPeriodEnd", "billingIntervalSnapshot",
         "termMonthsSnapshot", "recurringNetRappenSnapshot",
         "monthlyEquivalentRappenSnapshot", "currencySnapshot", "activatedAt",
         "updatedAt"
       ) VALUES (
         $1, $2, $3, 'ACTIVE', $4, $5, 'MONTHLY', 1, 5000, 5000, 'CHF', $4,
         CURRENT_TIMESTAMP
       )`,
      [
        sourceSubscriptionId,
        IDS.foreignCompany,
        IDS.planVersion,
        sourcePeriodStart,
        sourcePeriodEnd,
      ],
    );

    await expectPgConstraint(
      () =>
        getPool().query(
          `INSERT INTO "SubscriptionOrderSnapshot" (
             "id", "orderLineId", "policyVersion", "changeKind",
             "sourceSubscriptionId", "sourcePeriodStart", "sourcePeriodEnd",
             "fulfillmentPeriodStart", "fulfillmentPeriodEnd",
             "sourceRecurringNetRappen", "targetRecurringNetRappen",
             "prorationNumeratorSeconds", "prorationDenominatorSeconds",
             "quotedNetRappen", "activeJobLimitSnapshot", "seatLimitSnapshot",
             "talentContactAllowanceSnapshot", "jobBoostAllowanceSnapshot",
             "retainedMembershipIds"
           ) VALUES (
             $1, $2, 'phase12-v1', 'UPGRADE', $3, $4, $5, $4, $5,
             5000, $6, 1, 2, $6, 3, 2, 5, 1, ARRAY[]::text[]
           )`,
          [
            uuid(36),
            scopedOrderLineId,
            sourceSubscriptionId,
            sourcePeriodStart,
            sourcePeriodEnd,
            LINE_NET_RAPPEN,
          ],
        ),
      "23514",
      "subscription_order_snapshot_source_check",
    );

    const snapshots = await getPool().query<{
      orderLineId: string;
      changeKind: string;
    }>(
      `SELECT "orderLineId", "changeKind"::text AS "changeKind"
         FROM "SubscriptionOrderSnapshot"
        ORDER BY "orderLineId"`,
    );
    expect(snapshots.rows).toEqual([
      {
        orderLineId: IDS.canonicalOrderLine,
        changeKind: "NEW",
      },
    ]);

    await expectPgConstraint(
      () =>
        getPool().query(
          `UPDATE "SubscriptionOrderSnapshot"
              SET "policyVersion" = 'rewritten'
            WHERE "orderLineId" = $1`,
          [IDS.canonicalOrderLine],
        ),
      "23514",
      "phase02_append_only",
    );
    await expectPgConstraint(
      () =>
        getPool().query(
          `DELETE FROM "SubscriptionOrderSnapshot" WHERE "orderLineId" = $1`,
          [IDS.canonicalOrderLine],
        ),
      "23514",
      "phase02_append_only",
    );
  });
});

async function seedMinimalBillingCatalog(pool: Pool) {
  await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO "User" (
         "id", "email", "emailNormalized", "role", "updatedAt"
       ) VALUES
         ($1, 'phase12-owner@example.ch', 'phase12-owner@example.ch', 'EMPLOYER', CURRENT_TIMESTAMP),
         ($2, 'phase12-foreign@example.ch', 'phase12-foreign@example.ch', 'EMPLOYER', CURRENT_TIMESTAMP)`,
      [IDS.owner, IDS.foreignOwner],
    );
    await client.query(
      `INSERT INTO "Company" ("id", "name", "slug", "updatedAt")
       VALUES
         ($1, 'Phase 12 Company', 'phase12-company', CURRENT_TIMESTAMP),
         ($2, 'Phase 12 Foreign Company', 'phase12-foreign-company', CURRENT_TIMESTAMP)`,
      [IDS.company, IDS.foreignCompany],
    );
    await client.query(
      `INSERT INTO "Plan" ("id", "code", "name", "updatedAt")
       VALUES ($1, 'phase12-schema-plan', 'Phase 12 Schema Plan', CURRENT_TIMESTAMP)`,
      [IDS.plan],
    );
    await client.query(
      `INSERT INTO "PlanVersion" (
         "id", "planId", "version", "status", "priceMode",
         "billingInterval", "termMonths", "netPriceRappen",
         "monthlyEquivalentRappen", "currency", "validFrom"
       ) VALUES (
         $1, $2, 1, 'DRAFT', 'FIXED', 'MONTHLY', 1, $3, $3, 'CHF',
         '2027-01-01T00:00:00.000Z'
       )`,
      [IDS.planVersion, IDS.plan, LINE_NET_RAPPEN],
    );
    await client.query(
      `INSERT INTO "TaxRateVersion" (
         "id", "jurisdiction", "taxType", "rateBasisPoints", "validFrom", "source"
       ) VALUES (
         $1, 'CH', 'MWST', $2, '2027-01-01T00:00:00.000Z', 'Phase 12 schema test'
       )`,
      [IDS.taxRateVersion, TAX_RATE_BASIS_POINTS],
    );
  }, pool);
}

async function insertOrderWithLine(
  client: PoolClient,
  input: Readonly<{
    orderId: string;
    orderLineId: string;
    fingerprint: string;
    headerNetRappen?: number;
    headerVatRappen?: number;
    headerTotalRappen?: number;
  }>,
) {
  const headerNetRappen = input.headerNetRappen ?? LINE_NET_RAPPEN;
  const headerVatRappen = input.headerVatRappen ?? LINE_VAT_RAPPEN;
  const headerTotalRappen = input.headerTotalRappen ?? LINE_TOTAL_RAPPEN;

  await client.query(
    `INSERT INTO "Order" (
       "id", "companyId", "createdByUserId", "status", "provider",
       "clientIdempotencyKey", "requestFingerprint",
       "billingLegalNameSnapshot", "billingContactEmailSnapshot",
       "billingStreetSnapshot", "billingPostalCodeSnapshot",
       "billingCitySnapshot", "billingCountryCodeSnapshot", "currency",
       "netTotalRappen", "vatTotalRappen", "totalRappen", "updatedAt"
     ) VALUES (
       $1, $2, $3, 'DRAFT', 'MOCK', $4, $5,
       'Phase 12 Company AG', 'billing@example.ch', 'Teststrasse 12', '8000',
       'Zuerich', 'CH', 'CHF', $6, $7, $8, CURRENT_TIMESTAMP
     )`,
    [
      input.orderId,
      IDS.company,
      IDS.owner,
      `phase12:${input.orderId}`,
      input.fingerprint,
      headerNetRappen,
      headerVatRappen,
      headerTotalRappen,
    ],
  );
  await client.query(
    `INSERT INTO "OrderLine" (
       "id", "orderId", "planVersionId", "taxRateVersionId", "quantity",
       "unitNetRappen", "netRappen", "taxRateBasisPoints", "vatRappen",
       "totalRappen", "currency", "descriptionSnapshot", "fulfillmentContext"
     ) VALUES (
       $1, $2, $3, $4, 1, $5, $5, $6, $7, $8, 'CHF',
       'Phase 12 monthly plan', 'SUBSCRIPTION'
     )`,
    [
      input.orderLineId,
      input.orderId,
      IDS.planVersion,
      IDS.taxRateVersion,
      LINE_NET_RAPPEN,
      TAX_RATE_BASIS_POINTS,
      LINE_VAT_RAPPEN,
      LINE_TOTAL_RAPPEN,
    ],
  );
}

async function insertInvoiceWithLine(
  client: PoolClient,
  input: Readonly<{
    invoiceId: string;
    invoiceLineId: string;
    orderId: string;
    orderLineId: string;
    headerNetRappen?: number;
    headerVatRappen?: number;
    headerTotalRappen?: number;
  }>,
) {
  const headerNetRappen = input.headerNetRappen ?? LINE_NET_RAPPEN;
  const headerVatRappen = input.headerVatRappen ?? LINE_VAT_RAPPEN;
  const headerTotalRappen = input.headerTotalRappen ?? LINE_TOTAL_RAPPEN;

  await client.query(
    `INSERT INTO "Invoice" (
       "id", "orderId", "companyId", "number", "status",
       "billingLegalNameSnapshot", "billingContactEmailSnapshot",
       "billingStreetSnapshot", "billingPostalCodeSnapshot",
       "billingCitySnapshot", "billingCountryCodeSnapshot", "currency",
       "netTotalRappen", "vatTotalRappen", "totalRappen", "dueAt"
     ) VALUES (
       $1, $2, $3, $4, 'DRAFT', 'Phase 12 Company AG', 'billing@example.ch',
       'Teststrasse 12', '8000', 'Zuerich', 'CH', 'CHF', $5, $6, $7,
       CURRENT_TIMESTAMP + interval '30 days'
     )`,
    [
      input.invoiceId,
      input.orderId,
      IDS.company,
      `P12-${input.invoiceId.slice(-12)}`,
      headerNetRappen,
      headerVatRappen,
      headerTotalRappen,
    ],
  );
  await client.query(
    `INSERT INTO "InvoiceLine" (
       "id", "invoiceId", "orderLineId", "sortOrder", "descriptionSnapshot",
       "quantity", "unitNetRappen", "netRappen", "taxRateBasisPoints",
       "vatRappen", "totalRappen", "currency"
     ) VALUES (
       $1, $2, $3, 1, 'Phase 12 monthly plan', 1, $4, $4, $5, $6, $7, 'CHF'
     )`,
    [
      input.invoiceLineId,
      input.invoiceId,
      input.orderLineId,
      LINE_NET_RAPPEN,
      TAX_RATE_BASIS_POINTS,
      LINE_VAT_RAPPEN,
      LINE_TOTAL_RAPPEN,
    ],
  );
}

async function insertPaymentEvent(
  id: string,
  kind: "CHECKOUT_CREATED" | "PAID",
  idempotencyKey: string,
) {
  await getPool().query(
    `INSERT INTO "PaymentEvent" (
       "id", "orderId", "provider", "kind", "providerReference",
       "idempotencyKey", "payload"
     ) VALUES ($1, $2, 'MOCK', $3, $4, $5, '{}'::jsonb)`,
    [id, IDS.canonicalOrder, kind, `provider:${id}`, idempotencyKey],
  );
}

async function markOrderPaid(orderId: string) {
  await getPool().query(
    `UPDATE "Order"
        SET "status" = 'PENDING', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1`,
    [orderId],
  );
  await getPool().query(
    `UPDATE "Order"
        SET "status" = 'PAID', "paidAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1`,
    [orderId],
  );
}

async function insertPlanVersion(input: Readonly<{
  id: string;
  planId: string;
  version: number;
  status: "SCHEDULED" | "ACTIVE";
  validFrom: string;
  validTo: string;
}>) {
  await getPool().query(
    `INSERT INTO "PlanVersion" (
       "id", "planId", "version", "status", "priceMode",
       "billingInterval", "termMonths", "netPriceRappen",
       "monthlyEquivalentRappen", "currency", "validFrom", "validTo"
     ) VALUES (
       $1, $2, $3, $4, 'FIXED', 'MONTHLY', 1, 15000, 15000, 'CHF', $5, $6
     )`,
    [
      input.id,
      input.planId,
      input.version,
      input.status,
      input.validFrom,
      input.validTo,
    ],
  );
}

async function insertNewSubscriptionSnapshot(input: Readonly<{
  id: string;
  orderLineId: string;
  quotedNetRappen: number;
}>) {
  await getPool().query(
    `INSERT INTO "SubscriptionOrderSnapshot" (
       "id", "orderLineId", "policyVersion", "changeKind",
       "fulfillmentPeriodStart", "fulfillmentPeriodEnd",
       "targetRecurringNetRappen", "quotedNetRappen",
       "activeJobLimitSnapshot", "seatLimitSnapshot",
       "talentContactAllowanceSnapshot", "jobBoostAllowanceSnapshot",
       "retainedMembershipIds"
     ) VALUES (
       $1, $2, 'phase12-v1', 'NEW', '2027-01-01T00:00:00.000Z',
       '2027-02-01T00:00:00.000Z', $3, $3, 3, 2, 5, 1, ARRAY[]::text[]
     )`,
    [input.id, input.orderLineId, input.quotedNetRappen],
  );
}

async function inTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
  pool: Pool = getPool(),
): Promise<T> {
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

async function expectPgConstraint(
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

function getPool() {
  if (migrated === undefined) {
    throw new Error("The isolated Phase 12 database is not initialized.");
  }
  return migrated.pool;
}
