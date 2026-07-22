import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { adminMockRenewSubscription } from "@/lib/billing/admin-renewal";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-08-01T10:00:00.000Z");
const PERIOD_START = new Date("2026-07-01T10:00:00.000Z");
const PERIOD_END = NOW;
const NEXT_PERIOD_END = new Date("2026-09-01T10:00:00.000Z");
const ADMIN_ID = "12d00000-0000-4000-8000-000000000001";
const PLAN_ID = "12d00000-0000-4000-8000-000000000002";
const PLAN_VERSION_ID = "12d00000-0000-4000-8000-000000000003";
const CANTON_ID = "12d00000-0000-4000-8000-000000000004";
const CITY_ID = "12d00000-0000-4000-8000-000000000005";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function db() {
  if (database === undefined) throw new Error("Admin renewal test DB unavailable.");
  return database;
}

function dependencies(now = NOW) {
  return Object.freeze({
    actor: {
      userId: ADMIN_ID,
      email: "admin-renewal@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
    },
    correlationId: randomUUID(),
    database: db(),
    now,
  });
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_admin_renewal");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  await seedCatalog(db());
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("ADR-004 explicit Admin mock renewal", () => {
  it("renews one due ACTIVE term atomically with full allowances and no financial artifacts", async () => {
    const fixture = await createSubscriptionFixture({ status: "ACTIVE" });
    const idempotencyKey = randomUUID();
    const input = {
      subscriptionId: fixture.subscriptionId,
      expectedPeriodEnd: PERIOD_END,
      reasonCode: "ADMIN_MOCK_RENEWAL",
      idempotencyKey,
    } as const;
    const financialCountsBefore = await financialCounts();

    const first = await adminMockRenewSubscription(input, dependencies());

    expect(first).toEqual({
      ok: true,
      value: {
        companyId: fixture.companyId,
        sourceSubscriptionId: fixture.subscriptionId,
        subscriptionId: idempotencyKey,
        planVersionId: PLAN_VERSION_ID,
        periodStart: PERIOD_END,
        periodEnd: NEXT_PERIOD_END,
        grantedTalentContacts: 5,
        grantedJobBoosts: 2,
      },
    });
    await expect(
      db().employerSubscription.findUniqueOrThrow({
        where: { id: fixture.subscriptionId },
        select: { status: true, endedAt: true },
      }),
    ).resolves.toEqual({ status: "EXPIRED", endedAt: PERIOD_END });
    await expect(
      db().employerSubscription.findUniqueOrThrow({
        where: { id: idempotencyKey },
        select: {
          sourceOrderId: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          activatedAt: true,
        },
      }),
    ).resolves.toEqual({
      sourceOrderId: null,
      status: "ACTIVE",
      currentPeriodStart: PERIOD_END,
      currentPeriodEnd: NEXT_PERIOD_END,
      activatedAt: PERIOD_END,
    });

    const allowances = await db().creditLedgerEntry.findMany({
      where: { sourceSubscriptionId: idempotencyKey },
      orderBy: { amount: "asc" },
      select: {
        amount: true,
        fundingSource: true,
        kind: true,
        sourceOrderLineId: true,
        validFrom: true,
        validTo: true,
        account: { select: { creditType: true, periodStart: true, periodEnd: true } },
      },
    });
    expect(allowances).toEqual([
      {
        amount: 2,
        fundingSource: "PLAN_ALLOWANCE",
        kind: "GRANT",
        sourceOrderLineId: null,
        validFrom: PERIOD_END,
        validTo: NEXT_PERIOD_END,
        account: {
          creditType: "JOB_BOOST",
          periodStart: PERIOD_END,
          periodEnd: NEXT_PERIOD_END,
        },
      },
      {
        amount: 5,
        fundingSource: "PLAN_ALLOWANCE",
        kind: "GRANT",
        sourceOrderLineId: null,
        validFrom: PERIOD_END,
        validTo: NEXT_PERIOD_END,
        account: {
          creditType: "TALENT_CONTACT",
          periodStart: PERIOD_END,
          periodEnd: NEXT_PERIOD_END,
        },
      },
    ]);
    await expect(
      db().subscriptionEvent.count({
        where: { correlationId: idempotencyKey },
      }),
    ).resolves.toBe(3);
    await expect(
      db().auditLog.count({
        where: { correlationId: idempotencyKey, result: "SUCCEEDED" },
      }),
    ).resolves.toBe(5);
    await expect(financialCounts()).resolves.toEqual(financialCountsBefore);

    await expect(
      adminMockRenewSubscription(input, dependencies()),
    ).resolves.toEqual(expect.objectContaining({ ok: true, replay: true }));
    await expect(
      adminMockRenewSubscription(
        { ...input, reasonCode: "RENEWAL_REASON_CHANGED" },
        dependencies(),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      adminMockRenewSubscription(
        {
          ...input,
          expectedPeriodEnd: new Date(PERIOD_END.getTime() + 1_000),
        },
        dependencies(),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      db().employerSubscription.count({ where: { companyId: fixture.companyId } }),
    ).resolves.toBe(2);
  });

  it("renews an already naturally EXPIRED term without duplicating its expiry transition", async () => {
    const fixture = await createSubscriptionFixture({ status: "EXPIRED" });
    const idempotencyKey = randomUUID();

    await expect(
      adminMockRenewSubscription(
        {
          subscriptionId: fixture.subscriptionId,
          expectedPeriodEnd: PERIOD_END,
          reasonCode: "ADMIN_MOCK_RENEWAL",
          idempotencyKey,
        },
        dependencies(),
      ),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(
      db().subscriptionEvent.count({
        where: {
          subscriptionId: fixture.subscriptionId,
          correlationId: idempotencyKey,
          kind: "EXPIRED",
        },
      }),
    ).resolves.toBe(0);
    await expect(
      db().auditLog.count({
        where: {
          targetId: fixture.subscriptionId,
          correlationId: idempotencyKey,
          action: "SUBSCRIPTION_EXPIRED",
        },
      }),
    ).resolves.toBe(0);
    await expect(
      db().subscriptionEvent.count({ where: { correlationId: idempotencyKey } }),
    ).resolves.toBe(2);
  });

  it("serializes concurrent retries into one successor and one replay", async () => {
    const fixture = await createSubscriptionFixture({ status: "ACTIVE" });
    const idempotencyKey = randomUUID();
    const input = {
      subscriptionId: fixture.subscriptionId,
      expectedPeriodEnd: PERIOD_END,
      reasonCode: "ADMIN_MOCK_RENEWAL",
      idempotencyKey,
    } as const;

    const results = await Promise.all([
      adminMockRenewSubscription(input, dependencies()),
      adminMockRenewSubscription(input, dependencies()),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok && result.replay === true)).toHaveLength(1);
    await expect(
      db().employerSubscription.count({
        where: { id: idempotencyKey, companyId: fixture.companyId },
      }),
    ).resolves.toBe(1);
    await expect(
      db().subscriptionEvent.count({ where: { correlationId: idempotencyKey } }),
    ).resolves.toBe(3);
  });

  it("rejects not-due, stale, cancelling and superseded sources without writes", async () => {
    const notDue = await createSubscriptionFixture({
      status: "ACTIVE",
      periodStart: PERIOD_END,
      periodEnd: NEXT_PERIOD_END,
    });
    const stale = await createSubscriptionFixture({
      status: "EXPIRED",
      periodStart: new Date("2026-05-01T10:00:00.000Z"),
      periodEnd: new Date("2026-06-01T10:00:00.000Z"),
    });
    const cancelling = await createSubscriptionFixture({ status: "CANCELLING" });
    const superseded = await createSubscriptionFixture({ status: "EXPIRED" });
    await db().employerSubscription.create({
      data: {
        id: randomUUID(),
        companyId: superseded.companyId,
        planVersionId: PLAN_VERSION_ID,
        sourceOrderId: null,
        status: "SCHEDULED",
        currentPeriodStart: PERIOD_END,
        currentPeriodEnd: NEXT_PERIOD_END,
        billingIntervalSnapshot: "MONTHLY",
        termMonthsSnapshot: 1,
        recurringNetRappenSnapshot: 14_900,
        monthlyEquivalentRappenSnapshot: 14_900,
        currencySnapshot: "CHF",
        activatedAt: null,
        endedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });

    for (const fixture of [notDue, stale, cancelling, superseded]) {
      const before = await db().employerSubscription.count({
        where: { companyId: fixture.companyId },
      });
      await expect(
        adminMockRenewSubscription(
          {
            subscriptionId: fixture.subscriptionId,
            expectedPeriodEnd: fixture.periodEnd,
            reasonCode: "ADMIN_MOCK_RENEWAL",
            idempotencyKey: randomUUID(),
          },
          dependencies(),
        ),
      ).resolves.toEqual({ ok: false, code: "CONFLICT" });
      await expect(
        db().employerSubscription.count({ where: { companyId: fixture.companyId } }),
      ).resolves.toBe(before);
    }
  });

  it("rolls back the source transition, successor, events and audits on an allowance conflict", async () => {
    const fixture = await createSubscriptionFixture({ status: "ACTIVE" });
    await db().creditAccount.create({
      data: {
        id: randomUUID(),
        companyId: fixture.companyId,
        creditType: "TALENT_CONTACT",
        fundingSource: "PLAN_ALLOWANCE",
        periodStart: PERIOD_END,
        periodEnd: new Date("2026-08-15T10:00:00.000Z"),
        createdAt: NOW,
      },
    });
    const idempotencyKey = randomUUID();

    await expect(
      adminMockRenewSubscription(
        {
          subscriptionId: fixture.subscriptionId,
          expectedPeriodEnd: PERIOD_END,
          reasonCode: "ADMIN_MOCK_RENEWAL",
          idempotencyKey,
        },
        dependencies(),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      db().employerSubscription.findUniqueOrThrow({
        where: { id: fixture.subscriptionId },
        select: { status: true, endedAt: true },
      }),
    ).resolves.toEqual({ status: "ACTIVE", endedAt: null });
    await expect(
      db().employerSubscription.count({ where: { id: idempotencyKey } }),
    ).resolves.toBe(0);
    await expect(
      db().subscriptionEvent.count({ where: { correlationId: idempotencyKey } }),
    ).resolves.toBe(0);
    await expect(
      db().auditLog.count({ where: { correlationId: idempotencyKey } }),
    ).resolves.toBe(0);
  });
});

async function seedCatalog(client: DatabaseClient) {
  await client.user.create({
    data: {
      id: ADMIN_ID,
      email: "admin-renewal@example.ch",
      emailNormalized: "admin-renewal@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  await client.canton.create({
    data: {
      id: CANTON_ID,
      code: "ZH",
      name: "Zürich",
      slug: "renewal-zuerich",
      language: "DE",
      sortOrder: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  await client.city.create({
    data: {
      id: CITY_ID,
      cantonId: CANTON_ID,
      name: "Zürich",
      slug: "renewal-zuerich",
      sortOrder: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  await client.plan.create({
    data: {
      id: PLAN_ID,
      code: "RENEWAL_STARTER",
      name: "Renewal Starter",
      isDefaultFree: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  await client.planVersion.create({
    data: {
      id: PLAN_VERSION_ID,
      planId: PLAN_ID,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: 14_900,
      monthlyEquivalentRappen: 14_900,
      currency: "CHF",
      isPublic: true,
      isSelfService: true,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: null,
      createdAt: NOW,
    },
  });
  await client.planEntitlement.createMany({
    data: [
      integerEntitlement("ACTIVE_JOB_LIMIT", 3),
      integerEntitlement("SEAT_LIMIT", 2),
      integerEntitlement("TALENT_CONTACT_ALLOWANCE", 5),
      integerEntitlement("JOB_BOOST_ALLOWANCE", 2),
      booleanEntitlement("TALENT_RADAR_ACCESS", true),
      booleanEntitlement("ENHANCED_COMPANY_PROFILE", true),
      booleanEntitlement("EMPLOYER_IMPORT_ACCESS", false),
      {
        id: randomUUID(),
        planVersionId: PLAN_VERSION_ID,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        analyticsLevelValue: "BASIC",
        createdAt: NOW,
      },
    ],
  });
  await client.planVersion.update({
    where: { id: PLAN_VERSION_ID },
    data: { status: "ACTIVE" },
  });
}

async function createSubscriptionFixture(input: Readonly<{
  status: "ACTIVE" | "CANCELLING" | "EXPIRED";
  periodStart?: Date;
  periodEnd?: Date;
}>) {
  const companyId = randomUUID();
  const subscriptionId = randomUUID();
  const periodStart = input.periodStart ?? PERIOD_START;
  const periodEnd = input.periodEnd ?? PERIOD_END;
  await db().company.create({
    data: {
      id: companyId,
      name: `Renewal ${companyId.slice(0, 8)} AG`,
      slug: `renewal-${companyId}`,
      status: "DRAFT",
      industry: "Software",
      size: "11-50",
      about: "Deterministische Testfirma für manuelle Verlängerungen.",
      website: "https://renewal.example.ch",
      dataProvenance: "TEST",
      createdAt: periodStart,
      updatedAt: periodStart,
    },
  });
  await db().companyLocation.create({
    data: {
      id: randomUUID(),
      companyId,
      cantonId: CANTON_ID,
      cityId: CITY_ID,
      address: "Teststrasse 12",
      postalCode: "8000",
      isPrimary: true,
      createdAt: periodStart,
      updatedAt: periodStart,
    },
  });
  await db().company.update({
    where: { id: companyId },
    data: { status: "ACTIVE", updatedAt: periodStart },
  });
  await db().employerSubscription.create({
    data: {
      id: subscriptionId,
      companyId,
      planVersionId: PLAN_VERSION_ID,
      sourceOrderId: null,
      status: input.status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      billingIntervalSnapshot: "MONTHLY",
      termMonthsSnapshot: 1,
      recurringNetRappenSnapshot: 14_900,
      monthlyEquivalentRappenSnapshot: 14_900,
      currencySnapshot: "CHF",
      activatedAt: periodStart,
      endedAt: input.status === "EXPIRED" ? periodEnd : null,
      createdAt: periodStart,
      updatedAt: periodStart,
    },
  });
  return Object.freeze({ companyId, subscriptionId, periodStart, periodEnd });
}

function integerEntitlement(
  key: "ACTIVE_JOB_LIMIT" | "SEAT_LIMIT" | "TALENT_CONTACT_ALLOWANCE" | "JOB_BOOST_ALLOWANCE",
  integerValue: number,
) {
  return {
    id: randomUUID(),
    planVersionId: PLAN_VERSION_ID,
    key,
    valueType: "INTEGER" as const,
    integerValue,
    createdAt: NOW,
  };
}

function booleanEntitlement(
  key: "TALENT_RADAR_ACCESS" | "ENHANCED_COMPANY_PROFILE" | "EMPLOYER_IMPORT_ACCESS",
  booleanValue: boolean,
) {
  return {
    id: randomUUID(),
    planVersionId: PLAN_VERSION_ID,
    key,
    valueType: "BOOLEAN" as const,
    booleanValue,
    createdAt: NOW,
  };
}

async function financialCounts() {
  const [orders, invoices, paymentEvents] = await Promise.all([
    db().order.count(),
    db().invoice.count(),
    db().paymentEvent.count(),
  ]);
  return Object.freeze({ orders, invoices, paymentEvents });
}
