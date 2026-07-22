import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getAdminFinancialMetrics,
  getZurichMonthWindow,
} from "@/lib/analytics/admin-metrics";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-21T12:00:00.000Z");
const MONTH_START = new Date("2026-06-30T22:00:00.000Z");
const MONTH_END = new Date("2026-07-31T22:00:00.000Z");
const TAX_RATE_BASIS_POINTS = 810;

type Fixtures = Readonly<{
  adminUserId: string;
}>;

type CatalogReference =
  | Readonly<{ kind: "PLAN"; planVersionId: string }>
  | Readonly<{
      kind: "CONTACT_PACK";
      productVersionId: string;
    }>
  | Readonly<{
      jobId: string;
      kind: "JOB_BOOST";
      productVersionId: string;
    }>;

type InvoiceScenario = Readonly<{
  catalog: CatalogReference;
  companyId: string;
  invoiceStatus: "DRAFT" | "ISSUED" | "PAID" | "VOID";
  netRappen: number;
  orderProvider?: "MOCK" | "STRIPE";
  orderStatus: "DRAFT" | "PENDING" | "PAID" | "FAILED" | "CANCELLED";
  paymentEvent?: Readonly<{
    at: Date;
    kind: "PAID" | "FAILED" | "CANCELLED";
    provider?: "MOCK" | "STRIPE";
  }>;
  sequence: number;
}>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let fixtures: Fixtures | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_admin_metrics");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  fixtures = await seedRevenueFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe("Phase 12 PostgreSQL revenue reconciliation", () => {
  it("matches independent SQL aggregates at the half-open Zurich month boundary", async () => {
    const month = getZurichMonthWindow(NOW);
    expect(month).toEqual({
      label: "2026-07",
      start: MONTH_START,
      end: MONTH_END,
    });

    const metrics = await getAdminFinancialMetrics({
      actor: {
        userId: data().adminUserId,
        email: "phase12-revenue-admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
      },
      correlationId: "phase12-revenue-reconciliation",
      database: client(),
      now: NOW,
    });
    expect(metrics).not.toBeNull();
    if (metrics === null) throw new Error("Admin metrics unexpectedly denied access.");

    const subscriptions = await reconcileSubscriptionsWithSql();
    expect(subscriptions).toEqual({
      activeSubscriptions: 2,
      customContractsWithoutValue: 1,
      freeEmployers: 2,
      mrrRappen: 14_900,
      paidEmployers: 2,
    });
    expect(metrics).toEqual(
      expect.objectContaining({
        activeSubscriptions: subscriptions.activeSubscriptions,
        customContractsWithoutValue:
          subscriptions.customContractsWithoutValue,
        freeEmployers: subscriptions.freeEmployers,
        mrrRappen: subscriptions.mrrRappen,
        paidEmployers: subscriptions.paidEmployers,
      }),
    );

    const revenue = await reconcilePaidLinesWithSql(month.start, month.end);
    expect(revenue).toEqual({
      boostSalesCount: 1,
      boostSalesNetRappen: 4_900,
      contactPackSalesCount: 1,
      contactPackSalesNetRappen: 9_900,
      monthlyMockPaidNetRappen: 29_700,
      monthlyMockPaidPlanNetRappen: 14_900,
      monthlyMockPaidProductNetRappen: 14_800,
    });
    expect(metrics).toEqual(
      expect.objectContaining({
        boostSales: {
          count: revenue.boostSalesCount,
          netRappen: revenue.boostSalesNetRappen,
        },
        contactPackSales: {
          count: revenue.contactPackSalesCount,
          netRappen: revenue.contactPackSalesNetRappen,
        },
        monthlyMockPaidNetRappen: revenue.monthlyMockPaidNetRappen,
        monthlyMockPaidPlanNetRappen:
          revenue.monthlyMockPaidPlanNetRappen,
        monthlyMockPaidProductNetRappen:
          revenue.monthlyMockPaidProductNetRappen,
      }),
    );

    const invoices = await reconcileInvoiceStatusesWithSql();
    expect(invoices).toEqual({
      DRAFT: { count: 1, totalRappen: 7_567 },
      ISSUED: { count: 1, totalRappen: 6_486 },
      PAID: { count: 7, totalRappen: 51_024 },
      VOID: { count: 1, totalRappen: 5_405 },
    });
    expect(metrics.invoices).toEqual(invoices);
  });
});

async function seedRevenueFixtures(db: DatabaseClient): Promise<Fixtures> {
  const admin = await db.user.create({
    data: {
      email: "phase12-revenue-admin@example.ch",
      emailNormalized: "phase12-revenue-admin@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
      dataProvenance: "TEST",
    },
  });
  const canton = await db.canton.create({
    data: {
      code: "ZH",
      name: "Zürich",
      slug: "phase12-revenue-zuerich",
      language: "DE",
    },
  });
  const city = await db.city.create({
    data: {
      cantonId: canton.id,
      name: "Zürich Revenue",
      slug: "phase12-revenue-zuerich",
    },
  });
  const companies = await Promise.all(
    ["fixed", "custom", "boundary", "free", "suspended-paid"].map((suffix) =>
      createActiveCompany(db, suffix, canton.id, city.id),
    ),
  );
  const [fixedCompany, customCompany, boundaryCompany, , suspendedPaidCompany] = companies;
  if (
    fixedCompany === undefined ||
    customCompany === undefined ||
    boundaryCompany === undefined ||
    suspendedPaidCompany === undefined
  ) {
    throw new Error("Revenue fixture companies were not created.");
  }

  const fixedPlanVersion = await createPlanVersion(db, {
    code: "STARTER_REVENUE_TEST",
    name: "Starter Revenue Test",
    priceMode: "FIXED",
  });
  const customPlanVersion = await createPlanVersion(db, {
    code: "CUSTOM_REVENUE_TEST",
    name: "Custom Revenue Test",
    priceMode: "CONTRACT",
  });
  await db.employerSubscription.createMany({
    data: [
      {
        companyId: fixedCompany.id,
        planVersionId: fixedPlanVersion.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        billingIntervalSnapshot: "MONTHLY",
        termMonthsSnapshot: 1,
        recurringNetRappenSnapshot: 14_900,
        monthlyEquivalentRappenSnapshot: 14_900,
        currencySnapshot: "CHF",
        activatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        companyId: customCompany.id,
        planVersionId: customPlanVersion.id,
        status: "CANCELLING",
        currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        billingIntervalSnapshot: "MONTHLY",
        termMonthsSnapshot: 1,
        recurringNetRappenSnapshot: 0,
        monthlyEquivalentRappenSnapshot: 0,
        currencySnapshot: "CHF",
        activatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        companyId: boundaryCompany.id,
        planVersionId: fixedPlanVersion.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-21T12:00:00.000Z"),
        currentPeriodEnd: NOW,
        billingIntervalSnapshot: "MONTHLY",
        termMonthsSnapshot: 1,
        recurringNetRappenSnapshot: 99_900,
        monthlyEquivalentRappenSnapshot: 99_900,
        currencySnapshot: "CHF",
        activatedAt: new Date("2026-06-21T12:00:00.000Z"),
      },
      {
        companyId: suspendedPaidCompany.id,
        planVersionId: fixedPlanVersion.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        billingIntervalSnapshot: "MONTHLY",
        termMonthsSnapshot: 1,
        recurringNetRappenSnapshot: 88_800,
        monthlyEquivalentRappenSnapshot: 88_800,
        currencySnapshot: "CHF",
        activatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
  });
  await db.company.update({
    where: { id: suspendedPaidCompany.id },
    data: { status: "SUSPENDED" },
  });

  const contactPackVersion = await createProductVersion(db, {
    code: "contact-pack-revenue-test",
    name: "Contact Pack Revenue Test",
    type: "CONTACT_PACK",
  });
  const boostVersion = await createProductVersion(db, {
    code: "job-boost-revenue-test",
    name: "Job Boost Revenue Test",
    type: "JOB_BOOST",
  });
  const targetJob = await db.job.create({
    data: {
      companyId: fixedCompany.id,
      slug: "phase12-revenue-boost-target",
      status: "DRAFT",
      createdByUserId: admin.id,
      dataProvenance: "TEST",
    },
  });
  const taxRate = await db.taxRateVersion.create({
    data: {
      jurisdiction: "CH",
      taxType: "MWST_STANDARD_REVENUE_TEST",
      rateBasisPoints: TAX_RATE_BASIS_POINTS,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "Phase 12 revenue reconciliation fixture",
      reviewStatus: "DRAFT",
    },
  });

  const planCatalog = {
    kind: "PLAN",
    planVersionId: fixedPlanVersion.id,
  } as const;
  const contactCatalog = {
    kind: "CONTACT_PACK",
    productVersionId: contactPackVersion.id,
  } as const;
  const boostCatalog = {
    jobId: targetJob.id,
    kind: "JOB_BOOST",
    productVersionId: boostVersion.id,
  } as const;

  const scenarios: readonly InvoiceScenario[] = [
    {
      sequence: 1,
      companyId: fixedCompany.id,
      catalog: planCatalog,
      netRappen: 14_900,
      orderStatus: "PAID",
      invoiceStatus: "PAID",
      paymentEvent: { kind: "PAID", at: MONTH_START },
    },
    {
      sequence: 2,
      companyId: fixedCompany.id,
      catalog: contactCatalog,
      netRappen: 9_900,
      orderStatus: "PAID",
      invoiceStatus: "PAID",
      paymentEvent: {
        kind: "PAID",
        at: new Date(MONTH_END.getTime() - 1),
      },
    },
    {
      sequence: 3,
      companyId: fixedCompany.id,
      catalog: boostCatalog,
      netRappen: 4_900,
      orderStatus: "PAID",
      invoiceStatus: "PAID",
      paymentEvent: { kind: "PAID", at: NOW },
    },
    {
      sequence: 4,
      companyId: fixedCompany.id,
      catalog: planCatalog,
      netRappen: 2_500,
      orderStatus: "PAID",
      invoiceStatus: "PAID",
      paymentEvent: {
        kind: "PAID",
        at: new Date(MONTH_START.getTime() - 1),
      },
    },
    {
      sequence: 5,
      companyId: fixedCompany.id,
      catalog: contactCatalog,
      netRappen: 3_000,
      orderStatus: "PAID",
      invoiceStatus: "PAID",
      paymentEvent: { kind: "PAID", at: MONTH_END },
    },
    {
      sequence: 6,
      companyId: fixedCompany.id,
      catalog: contactCatalog,
      netRappen: 4_000,
      orderProvider: "STRIPE",
      orderStatus: "PAID",
      invoiceStatus: "PAID",
      paymentEvent: { kind: "PAID", at: NOW },
    },
    {
      sequence: 7,
      companyId: fixedCompany.id,
      catalog: contactCatalog,
      netRappen: 5_000,
      orderStatus: "PAID",
      invoiceStatus: "VOID",
      paymentEvent: { kind: "CANCELLED", at: NOW },
    },
    {
      sequence: 8,
      companyId: fixedCompany.id,
      catalog: contactCatalog,
      netRappen: 6_000,
      orderStatus: "PAID",
      invoiceStatus: "ISSUED",
      paymentEvent: { kind: "FAILED", at: NOW },
    },
    {
      sequence: 9,
      companyId: fixedCompany.id,
      catalog: contactCatalog,
      netRappen: 7_000,
      orderStatus: "PAID",
      invoiceStatus: "DRAFT",
    },
    {
      sequence: 10,
      companyId: fixedCompany.id,
      catalog: contactCatalog,
      netRappen: 8_000,
      orderStatus: "PAID",
      invoiceStatus: "PAID",
      paymentEvent: { kind: "PAID", at: NOW, provider: "STRIPE" },
    },
  ];
  for (const scenario of scenarios) {
    await createInvoiceScenario(db, admin.id, taxRate.id, scenario);
  }

  return Object.freeze({ adminUserId: admin.id });
}

async function createActiveCompany(
  db: DatabaseClient,
  suffix: string,
  cantonId: string,
  cityId: string,
) {
  const company = await db.company.create({
    data: {
      name: `Phase 12 Revenue ${suffix} AG`,
      slug: `phase12-revenue-${suffix}`,
      status: "DRAFT",
      industry: "Software",
      size: "10-49",
      website: `https://phase12-revenue-${suffix}.example.test`,
      about: "A complete live company used for revenue reconciliation.",
      values: [],
      benefits: [],
      dataProvenance: "LIVE",
    },
  });
  await db.companyLocation.create({
    data: {
      companyId: company.id,
      cantonId,
      cityId,
      address: "Teststrasse 12",
      postalCode: "8000",
      isPrimary: true,
    },
  });
  return db.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
}

async function createPlanVersion(
  db: DatabaseClient,
  input: Readonly<{
    code: string;
    name: string;
    priceMode: "FIXED" | "CONTRACT";
  }>,
) {
  const plan = await db.plan.create({
    data: { code: input.code, name: input.name, isDefaultFree: false },
  });
  return db.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      status: "DRAFT",
      priceMode: input.priceMode,
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: input.priceMode === "FIXED" ? 14_900 : null,
      monthlyEquivalentRappen: input.priceMode === "FIXED" ? 14_900 : null,
      currency: "CHF",
      isPublic: input.priceMode === "FIXED",
      isSelfService: input.priceMode === "FIXED",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
}

async function createProductVersion(
  db: DatabaseClient,
  input: Readonly<{
    code: string;
    name: string;
    type: "CONTACT_PACK" | "JOB_BOOST";
  }>,
) {
  const product = await db.product.create({
    data: { code: input.code, name: input.name, type: input.type },
  });
  return db.productVersion.create({
    data: {
      productId: product.id,
      version: 1,
      status: "DRAFT",
      netPriceRappen: input.type === "CONTACT_PACK" ? 9_900 : 4_900,
      currency: "CHF",
      durationDays: input.type === "JOB_BOOST" ? 7 : null,
      creditType: input.type === "CONTACT_PACK" ? "TALENT_CONTACT" : null,
      creditAmount: input.type === "CONTACT_PACK" ? 10 : null,
      isPublic: false,
      isSelfService: false,
      requiresLegalReview: false,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
}

async function createInvoiceScenario(
  db: DatabaseClient,
  createdByUserId: string,
  taxRateVersionId: string,
  input: InvoiceScenario,
) {
  const vatRappen = Math.floor(
    (input.netRappen * TAX_RATE_BASIS_POINTS) / 10_000 + 0.5,
  );
  const totalRappen = input.netRappen + vatRappen;
  await db.$transaction(async (transaction) => {
    const order = await transaction.order.create({
      data: {
        companyId: input.companyId,
        createdByUserId,
        status: "DRAFT",
        provider: input.orderProvider ?? "MOCK",
        clientIdempotencyKey: `phase12-revenue-order-${input.sequence}`,
        requestFingerprint: input.sequence.toString(16).padStart(64, "0"),
        billingLegalNameSnapshot: "Phase 12 Revenue AG",
        billingContactEmailSnapshot: "billing@example.test",
        billingStreetSnapshot: "Teststrasse 12",
        billingPostalCodeSnapshot: "8000",
        billingCitySnapshot: "Zürich",
        billingCountryCodeSnapshot: "CH",
        currency: "CHF",
        netTotalRappen: input.netRappen,
        vatTotalRappen: vatRappen,
        totalRappen,
      },
    });
    const orderLine = await transaction.orderLine.create({
      data: {
        orderId: order.id,
        planVersionId:
          input.catalog.kind === "PLAN"
            ? input.catalog.planVersionId
            : null,
        productVersionId:
          input.catalog.kind === "PLAN"
            ? null
            : input.catalog.productVersionId,
        taxRateVersionId,
        quantity: 1,
        unitNetRappen: input.netRappen,
        netRappen: input.netRappen,
        taxRateBasisPoints: TAX_RATE_BASIS_POINTS,
        vatRappen,
        totalRappen,
        currency: "CHF",
        descriptionSnapshot: `Revenue scenario ${input.sequence}`,
        fulfillmentContext:
          input.catalog.kind === "PLAN"
            ? "SUBSCRIPTION"
            : input.catalog.kind,
        targetJobId:
          input.catalog.kind === "JOB_BOOST" ? input.catalog.jobId : null,
        targetCreditType:
          input.catalog.kind === "CONTACT_PACK" ? "TALENT_CONTACT" : null,
      },
    });
    if (input.orderStatus !== "DRAFT") {
      await transaction.order.update({
        where: { id: order.id },
        data: { status: "PENDING" },
      });
    }
    const lifecycleAt = input.paymentEvent?.at ?? NOW;
    if (input.orderStatus === "PAID") {
      await transaction.order.update({
        where: { id: order.id },
        data: { status: "PAID", paidAt: lifecycleAt },
      });
    } else if (input.orderStatus === "FAILED") {
      await transaction.order.update({
        where: { id: order.id },
        data: { status: "FAILED", failedAt: lifecycleAt },
      });
    } else if (input.orderStatus === "CANCELLED") {
      await transaction.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED", cancelledAt: lifecycleAt },
      });
    }
    const invoice = await transaction.invoice.create({
      data: {
        orderId: order.id,
        companyId: input.companyId,
        number: `STH-2026-${String(90_000 + input.sequence).padStart(5, "0")}`,
        status: "DRAFT",
        billingLegalNameSnapshot: "Phase 12 Revenue AG",
        billingContactEmailSnapshot: "billing@example.test",
        billingStreetSnapshot: "Teststrasse 12",
        billingPostalCodeSnapshot: "8000",
        billingCitySnapshot: "Zürich",
        billingCountryCodeSnapshot: "CH",
        currency: "CHF",
        netTotalRappen: input.netRappen,
        vatTotalRappen: vatRappen,
        totalRappen,
        dueAt: new Date("2026-08-20T12:00:00.000Z"),
      },
    });
    await transaction.invoiceLine.create({
      data: {
        invoiceId: invoice.id,
        orderLineId: orderLine.id,
        sortOrder: 1,
        descriptionSnapshot: `Revenue scenario ${input.sequence}`,
        quantity: 1,
        unitNetRappen: input.netRappen,
        netRappen: input.netRappen,
        taxRateBasisPoints: TAX_RATE_BASIS_POINTS,
        vatRappen,
        totalRappen,
        currency: "CHF",
      },
    });

    if (input.invoiceStatus !== "DRAFT") {
      await transaction.invoice.update({
        where: { id: invoice.id },
        data: { status: "ISSUED", issuedAt: lifecycleAt },
      });
    }
    if (input.invoiceStatus === "PAID") {
      await transaction.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidAt: lifecycleAt },
      });
    } else if (input.invoiceStatus === "VOID") {
      await transaction.invoice.update({
        where: { id: invoice.id },
        data: { status: "VOID", voidedAt: lifecycleAt },
      });
    }

    if (input.paymentEvent !== undefined) {
      await transaction.paymentEvent.create({
        data: {
          orderId: order.id,
          provider:
            input.paymentEvent.provider ?? input.orderProvider ?? "MOCK",
          kind: input.paymentEvent.kind,
          idempotencyKey: `phase12-revenue-payment-${input.sequence}`,
          payload: { fixture: "phase12-revenue-reconciliation" },
          createdAt: input.paymentEvent.at,
        },
      });
    }
  });
}

async function reconcileSubscriptionsWithSql() {
  const result = await store().pool.query<{
    activeSubscriptions: number;
    customContractsWithoutValue: number;
    freeEmployers: number;
    mrrRappen: number;
    paidEmployers: number;
  }>(
    `WITH effective AS (
       SELECT
         subscription."companyId",
         subscription."monthlyEquivalentRappenSnapshot",
         subscription."recurringNetRappenSnapshot"
        FROM "EmployerSubscription" AS subscription
        INNER JOIN "Company" AS company
          ON company."id" = subscription."companyId"
         AND company."status" = 'ACTIVE'
       WHERE subscription."status" IN ('ACTIVE', 'CANCELLING')
         AND subscription."currentPeriodStart" <= $1
         AND subscription."currentPeriodEnd" > $1
     ), active_companies AS (
       SELECT count(*)::integer AS count
       FROM "Company"
       WHERE "status" = 'ACTIVE'
     )
     SELECT
       count(*)::integer AS "activeSubscriptions",
       count(*) FILTER (
         WHERE "monthlyEquivalentRappenSnapshot" = 0
           AND "recurringNetRappenSnapshot" = 0
       )::integer AS "customContractsWithoutValue",
       (
         (SELECT count FROM active_companies)
         - count(DISTINCT "companyId")
       )::integer AS "freeEmployers",
       COALESCE(sum("monthlyEquivalentRappenSnapshot"), 0)::integer AS "mrrRappen",
       count(DISTINCT "companyId")::integer AS "paidEmployers"
     FROM effective`,
    [NOW],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Subscription SQL returned no row.");
  return row;
}

async function reconcilePaidLinesWithSql(start: Date, end: Date) {
  const result = await store().pool.query<{
    boostSalesCount: number;
    boostSalesNetRappen: number;
    contactPackSalesCount: number;
    contactPackSalesNetRappen: number;
    monthlyMockPaidNetRappen: number;
    monthlyMockPaidPlanNetRappen: number;
    monthlyMockPaidProductNetRappen: number;
  }>(
    `WITH first_mock_paid AS (
       SELECT event."orderId", min(event."createdAt") AS "firstPaidAt"
       FROM "PaymentEvent" AS event
       INNER JOIN "Order" AS billing_order ON billing_order."id" = event."orderId"
       WHERE event."kind" = 'PAID'
         AND event."provider" = 'MOCK'
         AND billing_order."provider" = 'MOCK'
       GROUP BY event."orderId"
     ), eligible_lines AS (
       SELECT
         invoice_line."netRappen",
         order_line."planVersionId",
         product."type" AS "productType"
       FROM first_mock_paid
       INNER JOIN "Invoice" AS invoice
         ON invoice."orderId" = first_mock_paid."orderId"
        AND invoice."status" = 'PAID'
       INNER JOIN "InvoiceLine" AS invoice_line
         ON invoice_line."invoiceId" = invoice."id"
       INNER JOIN "OrderLine" AS order_line
         ON order_line."id" = invoice_line."orderLineId"
       LEFT JOIN "ProductVersion" AS product_version
         ON product_version."id" = order_line."productVersionId"
       LEFT JOIN "Product" AS product
         ON product."id" = product_version."productId"
       WHERE first_mock_paid."firstPaidAt" >= $1
         AND first_mock_paid."firstPaidAt" < $2
     )
     SELECT
       count(*) FILTER (WHERE "productType" = 'JOB_BOOST')::integer AS "boostSalesCount",
       COALESCE(sum("netRappen") FILTER (WHERE "productType" = 'JOB_BOOST'), 0)::integer AS "boostSalesNetRappen",
       count(*) FILTER (WHERE "productType" = 'CONTACT_PACK')::integer AS "contactPackSalesCount",
       COALESCE(sum("netRappen") FILTER (WHERE "productType" = 'CONTACT_PACK'), 0)::integer AS "contactPackSalesNetRappen",
       COALESCE(sum("netRappen"), 0)::integer AS "monthlyMockPaidNetRappen",
       COALESCE(sum("netRappen") FILTER (WHERE "planVersionId" IS NOT NULL), 0)::integer AS "monthlyMockPaidPlanNetRappen",
       COALESCE(sum("netRappen") FILTER (WHERE "planVersionId" IS NULL), 0)::integer AS "monthlyMockPaidProductNetRappen"
     FROM eligible_lines`,
    [start, end],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Revenue SQL returned no row.");
  return row;
}

async function reconcileInvoiceStatusesWithSql() {
  const result = await store().pool.query<{
    count: number;
    status: "DRAFT" | "ISSUED" | "PAID" | "VOID";
    totalRappen: number;
  }>(
    `SELECT
       "status"::text AS status,
       count(*)::integer AS count,
       COALESCE(sum("totalRappen"), 0)::integer AS "totalRappen"
     FROM "Invoice"
     GROUP BY "status"`,
  );
  const reconciled = {
    DRAFT: { count: 0, totalRappen: 0 },
    ISSUED: { count: 0, totalRappen: 0 },
    PAID: { count: 0, totalRappen: 0 },
    VOID: { count: 0, totalRappen: 0 },
  };
  for (const row of result.rows) {
    reconciled[row.status] = {
      count: row.count,
      totalRappen: row.totalRappen,
    };
  }
  return reconciled;
}

function client() {
  if (database === undefined) throw new Error("Database is not ready.");
  return database;
}

function store() {
  if (migrated === undefined) throw new Error("Migrated database is not ready.");
  return migrated;
}

function data() {
  if (fixtures === undefined) throw new Error("Fixtures are not ready.");
  return fixtures;
}
