import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reverseCreditConsume } from "@/lib/billing/admin-billing";
import {
  consumeCompanyCredits,
  projectDueCreditExpiries,
  type CreditConsumeDependencies,
} from "@/lib/billing/credits";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const DAY = 86_400_000;
const NOW = new Date("2026-07-21T12:00:00.000Z");
const id = (sequence: number) =>
  `c1300000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

const IDS = Object.freeze({
  admin: id(1),
  priorityActor: id(2),
  balanceActor: id(3),
  canton: id(4),
  city: id(5),
  priorityCompany: id(10),
  balanceCompany: id(11),
  priorityMembership: id(12),
  balanceMembership: id(13),
  plan: id(20),
  planVersion: id(21),
  planEarlySubscription: id(22),
  planEarlyAccount: id(24),
  planEarlyGrant: id(26),
  contactProduct: id(30),
  contactProductVersion: id(31),
  taxRate: id(32),
  contactOrder: id(33),
  contactOrderLine: id(34),
  purchasedAccount: id(35),
  purchasedGrant: id(36),
  adminAccount: id(40),
  adminGrant: id(41),
  jobBoostAccount: id(42),
  jobBoostGrant: id(43),
  adminLateAccount: id(44),
  adminLateGrant: id(45),
  balanceAccount: id(50),
  balanceGrant: id(51),
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_shared_credit_consume");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  await seedCreditFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 shared credit consumption", () => {
  it("consumes signed concrete Grants in plan, expiry, purchased and admin order and replays exactly", async () => {
    const idempotencyKey = randomUUID();
    const first = await consumeCompanyCredits(
      {
        companyId: IDS.priorityCompany,
        creditType: "TALENT_CONTACT",
        amount: 5,
        idempotencyKey,
        reasonCode: "CONTACT_REQUEST",
      },
      priorityDependencies(NOW),
    );
    expect(first).toEqual({
      ok: true,
      value: {
        allocations: [
          expect.objectContaining({
            amount: 1,
            consumedGrantEntryId: IDS.planEarlyGrant,
            fundingSource: "PLAN_ALLOWANCE",
          }),
          expect.objectContaining({
            amount: 2,
            consumedGrantEntryId: IDS.purchasedGrant,
            fundingSource: "PURCHASED_PACK",
          }),
          expect.objectContaining({
            amount: 1,
            consumedGrantEntryId: IDS.adminGrant,
            fundingSource: "ADMIN_GRANT",
          }),
          expect.objectContaining({
            amount: 1,
            consumedGrantEntryId: IDS.adminLateGrant,
            fundingSource: "ADMIN_GRANT",
          }),
        ],
        companyId: IDS.priorityCompany,
        consumedAmount: 5,
        creditType: "TALENT_CONTACT",
      },
    });
    if (!first.ok) throw new Error("Expected the first Credit consume to succeed.");

    const entryIds = first.value.allocations.map((allocation) => allocation.entryId);
    const persisted = await db().creditLedgerEntry.findMany({
      where: { id: { in: entryIds } },
      orderBy: { idempotencyKey: "asc" },
      select: {
        id: true,
        accountId: true,
        amount: true,
        consumedGrantEntryId: true,
        fundingSource: true,
        kind: true,
        sourceOrderLineId: true,
        sourcePlanVersionId: true,
        sourceSubscriptionId: true,
      },
    });
    expect(persisted.map(({ amount }) => amount)).toEqual([-1, -2, -1, -1]);
    expect(
      persisted.every(
        (entry) =>
          entry.kind === "CONSUME" &&
          entry.amount < 0 &&
          entry.consumedGrantEntryId !== null &&
          entry.sourceOrderLineId === null &&
          entry.sourcePlanVersionId === null &&
          entry.sourceSubscriptionId === null,
      ),
    ).toBe(true);
    await expect(
      db().auditLog.count({
        where: {
          action: "CREDITS_CONSUMED",
          companyId: IDS.priorityCompany,
          targetId: { in: entryIds },
          capability: "EMPLOYER_TALENT_CONTACT_CREATE",
        },
      }),
    ).resolves.toBe(4);

    const retry = await consumeCompanyCredits(
      {
        companyId: IDS.priorityCompany,
        creditType: "TALENT_CONTACT",
        amount: 5,
        idempotencyKey,
        reasonCode: "CONTACT_REQUEST",
      },
      priorityDependencies(new Date(NOW.getTime() + 1_000)),
    );
    expect(retry).toEqual({
      ok: true,
      replay: true,
      value: expect.objectContaining({
        consumedAmount: 5,
        allocations: first.value.allocations,
      }),
    });
    await expect(
      db().creditLedgerEntry.count({ where: { id: { in: entryIds } } }),
    ).resolves.toBe(4);
    await expect(
      db().auditLog.count({
        where: { action: "CREDITS_CONSUMED", targetId: { in: entryIds } },
      }),
    ).resolves.toBe(4);

    await expect(
      consumeCompanyCredits(
        {
          companyId: IDS.priorityCompany,
          creditType: "TALENT_CONTACT",
          amount: 4,
          idempotencyKey,
          reasonCode: "CONTACT_REQUEST",
        },
        priorityDependencies(NOW),
      ),
    ).resolves.toEqual({ ok: false, code: "IDEMPOTENCY_MISMATCH" });
    await expect(db().jobBoost.count()).resolves.toBe(0);
    await expect(db().employerContactRequest.count()).resolves.toBe(0);
  });

  it("fails closed across Company and CreditType scope without consuming another tenant or pool", async () => {
    const balanceBefore = await db().creditLedgerEntry.aggregate({
      where: { accountId: IDS.balanceAccount },
      _sum: { amount: true },
    });
    await expect(
      consumeCompanyCredits(
        {
          companyId: IDS.balanceCompany,
          creditType: "TALENT_CONTACT",
          amount: 1,
          idempotencyKey: randomUUID(),
          reasonCode: "CONTACT_REQUEST",
        },
        priorityDependencies(NOW),
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await db().creditLedgerEntry.aggregate({
        where: { accountId: IDS.balanceAccount },
        _sum: { amount: true },
      }),
    ).toEqual(balanceBefore);

    await expect(
      consumeCompanyCredits(
        {
          companyId: IDS.priorityCompany,
          creditType: "TALENT_CONTACT",
          amount: 1,
          idempotencyKey: randomUUID(),
          reasonCode: "CONTACT_REQUEST",
        },
        priorityDependencies(NOW),
      ),
    ).resolves.toEqual({ ok: false, code: "INSUFFICIENT_CREDITS" });
    await expect(
      db().creditLedgerEntry.count({
        where: { accountId: IDS.jobBoostAccount, kind: "CONSUME" },
      }),
    ).resolves.toBe(0);
  });

  it("releases exact Grant lineage after an Admin reversal and permits one new consume", async () => {
    const original = await db().creditLedgerEntry.findFirstOrThrow({
      where: {
        kind: "CONSUME",
        consumedGrantEntryId: IDS.planEarlyGrant,
      },
      select: { id: true },
    });
    const reversal = await reverseCreditConsume(
      {
        entryId: original.id,
        reasonCode: "BUSINESS_STATE_RESTORED",
        idempotencyKey: randomUUID(),
      },
      {
        actor: {
          userId: IDS.admin,
          email: "credit-admin@example.ch",
          role: "ADMIN",
          status: "ACTIVE",
        },
        correlationId: randomUUID(),
        database: db(),
        now: new Date(NOW.getTime() + 2_000),
      },
    );
    expect(reversal).toEqual({
      ok: true,
      value: expect.objectContaining({
        reversalOfEntryId: original.id,
        amount: 1,
      }),
    });

    const consumedAgain = await consumeCompanyCredits(
      {
        companyId: IDS.priorityCompany,
        creditType: "TALENT_CONTACT",
        amount: 1,
        idempotencyKey: randomUUID(),
        reasonCode: "CONTACT_REQUEST",
      },
      priorityDependencies(new Date(NOW.getTime() + 3_000)),
    );
    expect(consumedAgain).toEqual({
      ok: true,
      value: expect.objectContaining({
        consumedAmount: 1,
        allocations: [
          expect.objectContaining({
            amount: 1,
            consumedGrantEntryId: IDS.planEarlyGrant,
            fundingSource: "PLAN_ALLOWANCE",
          }),
        ],
      }),
    });
    await expect(
      db().creditLedgerEntry.count({
        where: {
          consumedGrantEntryId: IDS.planEarlyGrant,
          kind: "CONSUME",
        },
      }),
    ).resolves.toBe(2);
    await expect(
      db().creditLedgerEntry.count({ where: { reversalOfEntryId: original.id } }),
    ).resolves.toBe(1);
  });

  it("serializes two balance-one consumes to exactly one effect and one insufficient result", async () => {
    const inputs = [randomUUID(), randomUUID()].map((idempotencyKey) => ({
      companyId: IDS.balanceCompany,
      creditType: "TALENT_CONTACT" as const,
      amount: 1,
      idempotencyKey,
      reasonCode: "CONTACT_REQUEST",
    }));
    const results = await Promise.all(
      inputs.map((input) =>
        consumeCompanyCredits(input, balanceDependencies(NOW)),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "INSUFFICIENT_CREDITS" },
    ]);
    await expect(
      db().creditLedgerEntry.count({
        where: { accountId: IDS.balanceAccount, kind: "CONSUME" },
      }),
    ).resolves.toBe(1);
    await expect(
      db().creditLedgerEntry.aggregate({
        where: { accountId: IDS.balanceAccount },
        _sum: { amount: true },
      }),
    ).resolves.toEqual({ _sum: { amount: 0 } });
    await expect(
      db().auditLog.count({
        where: {
          action: "CREDITS_CONSUMED",
          companyId: IDS.balanceCompany,
        },
      }),
    ).resolves.toBe(1);
  });

  it("projects each remaining expired Grant exactly once under parallel retries", async () => {
    const accountId = randomUUID();
    const grantId = randomUUID();
    const periodStart = new Date(NOW.getTime() - 2 * DAY);
    await db().creditAccount.create({
      data: {
        id: accountId,
        companyId: IDS.priorityCompany,
        creditType: "SOCIAL_PUSH",
        fundingSource: "ADMIN_GRANT",
        periodStart,
        periodEnd: NOW,
      },
    });
    await db().creditLedgerEntry.create({
      data: {
        id: grantId,
        accountId,
        fundingSource: "ADMIN_GRANT",
        kind: "GRANT",
        amount: 10,
        validFrom: periodStart,
        validTo: NOW,
        idempotencyKey: "phase12-expiry-projector-grant",
        reasonCode: "CUSTOMER_SUCCESS_GRANT",
        actorUserId: IDS.admin,
        createdAt: periodStart,
      },
    });
    await db().creditLedgerEntry.create({
      data: {
        accountId,
        fundingSource: "ADMIN_GRANT",
        kind: "CONSUME",
        amount: -3,
        consumedGrantEntryId: grantId,
        validFrom: periodStart,
        validTo: NOW,
        idempotencyKey: "phase12-expiry-projector-consume",
        reasonCode: "SOCIAL_PUSH_BOOKED",
        actorUserId: IDS.priorityActor,
        createdAt: new Date(NOW.getTime() - 1),
      },
    });
    const dependencies = () => ({
      actor: {
        userId: IDS.admin,
        email: "credit-admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
      },
      correlationId: randomUUID(),
      database: db(),
      now: NOW,
    } as const);

    const results = await Promise.all([
      projectDueCreditExpiries({}, dependencies()),
      projectDueCreditExpiries({}, dependencies()),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const projected = results.reduce(
      (sum, result) => sum + (result.ok ? result.value.projectedGrantCount : 0),
      0,
    );
    const amount = results.reduce(
      (sum, result) => sum + (result.ok ? result.value.expiredCreditAmount : 0),
      0,
    );
    expect({ projected, amount }).toEqual({ projected: 1, amount: 7 });
    await expect(
      db().creditLedgerEntry.findMany({
        where: { accountId, kind: "EXPIRE" },
        select: {
          amount: true,
          consumedGrantEntryId: true,
          idempotencyKey: true,
          reasonCode: true,
        },
      }),
    ).resolves.toEqual([
      {
        amount: -7,
        consumedGrantEntryId: grantId,
        idempotencyKey: `credit-expire-v1:${grantId}`,
        reasonCode: "PERIOD_ENDED",
      },
    ]);
    await expect(
      db().creditLedgerEntry.aggregate({
        where: { accountId },
        _sum: { amount: true },
      }),
    ).resolves.toEqual({ _sum: { amount: 0 } });
    await expect(
      db().auditLog.count({
        where: {
          action: "CREDITS_EXPIRED",
          actorKind: "SYSTEM",
          companyId: IDS.priorityCompany,
        },
      }),
    ).resolves.toBe(1);
    await expect(projectDueCreditExpiries({}, dependencies())).resolves.toEqual({
      ok: true,
      value: { expiredCreditAmount: 0, projectedGrantCount: 0 },
    });
  });
});

function priorityDependencies(now: Date): CreditConsumeDependencies {
  return Object.freeze({
    actor: { kind: "USER" as const, userId: IDS.priorityActor },
    capability: "EMPLOYER_TALENT_CONTACT_CREATE",
    correlationId: randomUUID(),
    database: db(),
    now,
  });
}

function balanceDependencies(now: Date): CreditConsumeDependencies {
  return Object.freeze({
    actor: { kind: "USER" as const, userId: IDS.balanceActor },
    capability: "EMPLOYER_TALENT_CONTACT_CREATE",
    correlationId: randomUUID(),
    database: db(),
    now,
  });
}

async function seedCreditFixtures(client: DatabaseClient) {
  await client.user.createMany({
    data: [
      {
        id: IDS.admin,
        email: "credit-admin@example.ch",
        emailNormalized: "credit-admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
      },
      {
        id: IDS.priorityActor,
        email: "credit-priority@example.ch",
        emailNormalized: "credit-priority@example.ch",
        role: "EMPLOYER",
        status: "ACTIVE",
      },
      {
        id: IDS.balanceActor,
        email: "credit-balance@example.ch",
        emailNormalized: "credit-balance@example.ch",
        role: "EMPLOYER",
        status: "ACTIVE",
      },
    ],
  });
  await client.canton.create({
    data: {
      id: IDS.canton,
      code: "ZH",
      name: "Zürich",
      slug: "credit-consume-zuerich",
      language: "DE",
    },
  });
  await client.city.create({
    data: {
      id: IDS.city,
      cantonId: IDS.canton,
      name: "Zürich Credit Consume",
      slug: "credit-consume-zuerich",
    },
  });
  await createActiveCompany(
    client,
    IDS.priorityCompany,
    "Credit Priority AG",
    "credit-priority",
  );
  await createActiveCompany(
    client,
    IDS.balanceCompany,
    "Credit Balance AG",
    "credit-balance",
  );
  await client.companyMembership.createMany({
    data: [
      {
        id: IDS.priorityMembership,
        companyId: IDS.priorityCompany,
        userId: IDS.priorityActor,
        role: "OWNER",
        status: "ACTIVE",
      },
      {
        id: IDS.balanceMembership,
        companyId: IDS.balanceCompany,
        userId: IDS.balanceActor,
        role: "OWNER",
        status: "ACTIVE",
      },
    ],
  });

  await client.plan.create({
    data: {
      id: IDS.plan,
      code: "CREDIT_CONSUME_PLAN",
      name: "Credit Consume Plan",
      isDefaultFree: false,
    },
  });
  await client.planVersion.create({
    data: {
      id: IDS.planVersion,
      planId: IDS.plan,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: 1_000,
      monthlyEquivalentRappen: 1_000,
      currency: "CHF",
      validFrom: new Date(NOW.getTime() - 30 * DAY),
    },
  });
  await client.planEntitlement.create({
    data: {
      planVersionId: IDS.planVersion,
      key: "TALENT_CONTACT_ALLOWANCE",
      valueType: "INTEGER",
      integerValue: 1,
    },
  });
  await client.planVersion.update({
    where: { id: IDS.planVersion },
    data: { status: "ACTIVE" },
  });
  await createPlanGrant(client, {
    accountId: IDS.planEarlyAccount,
    grantId: IDS.planEarlyGrant,
    periodStart: new Date(NOW.getTime() - 2 * DAY),
    periodEnd: new Date(NOW.getTime() + 10 * DAY),
    subscriptionId: IDS.planEarlySubscription,
  });
  await seedPurchasedGrant(client);
  await createDirectGrant(client, {
    accountId: IDS.adminAccount,
    amount: 1,
    companyId: IDS.priorityCompany,
    creditType: "TALENT_CONTACT",
    fundingSource: "ADMIN_GRANT",
    grantId: IDS.adminGrant,
    periodEnd: new Date(NOW.getTime() + 2 * DAY),
  });
  await createDirectGrant(client, {
    accountId: IDS.adminLateAccount,
    amount: 1,
    companyId: IDS.priorityCompany,
    creditType: "TALENT_CONTACT",
    fundingSource: "ADMIN_GRANT",
    grantId: IDS.adminLateGrant,
    periodStart: new Date(NOW.getTime() - 2 * DAY),
    periodEnd: new Date(NOW.getTime() + 20 * DAY),
  });
  await createDirectGrant(client, {
    accountId: IDS.jobBoostAccount,
    amount: 10,
    companyId: IDS.priorityCompany,
    creditType: "JOB_BOOST",
    fundingSource: "ADMIN_GRANT",
    grantId: IDS.jobBoostGrant,
    periodEnd: new Date(NOW.getTime() + 30 * DAY),
  });
  await createDirectGrant(client, {
    accountId: IDS.balanceAccount,
    amount: 1,
    companyId: IDS.balanceCompany,
    creditType: "TALENT_CONTACT",
    fundingSource: "ADMIN_GRANT",
    grantId: IDS.balanceGrant,
    periodEnd: new Date(NOW.getTime() + 30 * DAY),
  });
}

async function createActiveCompany(
  client: DatabaseClient,
  companyId: string,
  name: string,
  slug: string,
) {
  await client.company.create({
    data: {
      id: companyId,
      name,
      slug,
      industry: "Technology",
      size: "10-49",
      website: `https://${slug}.example.test`,
      about: "A complete Company profile for shared Credit consumption tests.",
      values: [],
      benefits: [],
      status: "DRAFT",
      dataProvenance: "TEST",
    },
  });
  await client.companyLocation.create({
    data: {
      companyId,
      cantonId: IDS.canton,
      cityId: IDS.city,
      address: "Teststrasse 13",
      postalCode: "8000",
      isPrimary: true,
    },
  });
  await client.company.update({
    where: { id: companyId },
    data: { status: "ACTIVE" },
  });
}

async function createPlanGrant(
  client: DatabaseClient,
  input: Readonly<{
    accountId: string;
    grantId: string;
    periodEnd: Date;
    periodStart: Date;
    subscriptionId: string;
  }>,
) {
  await client.employerSubscription.create({
    data: {
      id: input.subscriptionId,
      companyId: IDS.priorityCompany,
      planVersionId: IDS.planVersion,
      status: "ACTIVE",
      currentPeriodStart: input.periodStart,
      currentPeriodEnd: input.periodEnd,
      billingIntervalSnapshot: "MONTHLY",
      termMonthsSnapshot: 1,
      recurringNetRappenSnapshot: 1_000,
      monthlyEquivalentRappenSnapshot: 1_000,
      currencySnapshot: "CHF",
      activatedAt: input.periodStart,
    },
  });
  await client.creditAccount.create({
    data: {
      id: input.accountId,
      companyId: IDS.priorityCompany,
      creditType: "TALENT_CONTACT",
      fundingSource: "PLAN_ALLOWANCE",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    },
  });
  await client.creditLedgerEntry.create({
    data: {
      id: input.grantId,
      accountId: input.accountId,
      fundingSource: "PLAN_ALLOWANCE",
      kind: "GRANT",
      amount: 1,
      sourcePlanVersionId: IDS.planVersion,
      sourceSubscriptionId: input.subscriptionId,
      validFrom: input.periodStart,
      validTo: input.periodEnd,
      idempotencyKey: `plan-grant:${input.grantId}`,
      reasonCode: "SUBSCRIPTION_ALLOWANCE",
      createdAt: input.periodStart,
    },
  });
}

async function seedPurchasedGrant(client: DatabaseClient) {
  await client.product.create({
    data: {
      id: IDS.contactProduct,
      code: "CREDIT_CONSUME_CONTACT_PACK",
      name: "Credit Consume Contact Pack",
      type: "CONTACT_PACK",
    },
  });
  await client.productVersion.create({
    data: {
      id: IDS.contactProductVersion,
      productId: IDS.contactProduct,
      version: 1,
      status: "DRAFT",
      netPriceRappen: 1_000,
      currency: "CHF",
      creditType: "TALENT_CONTACT",
      creditAmount: 2,
      isPublic: true,
      isSelfService: true,
      validFrom: new Date(NOW.getTime() - DAY),
    },
  });
  await client.productVersion.update({
    where: { id: IDS.contactProductVersion },
    data: { status: "ACTIVE" },
  });
  await client.taxRateVersion.create({
    data: {
      id: IDS.taxRate,
      jurisdiction: "CH",
      taxType: "MWST_STANDARD_DEMO",
      rateBasisPoints: 0,
      validFrom: new Date(NOW.getTime() - 30 * DAY),
      source: "Phase 12 isolated Credit test fixture",
      reviewStatus: "APPROVED",
      reviewedByUserId: IDS.admin,
      reviewedAt: NOW,
    },
  });
  await client.$transaction(async (transaction) => {
    await transaction.order.create({
      data: {
        id: IDS.contactOrder,
        companyId: IDS.priorityCompany,
        createdByUserId: IDS.priorityActor,
        status: "DRAFT",
        provider: "MOCK",
        clientIdempotencyKey: "credit-consume-purchased-order",
        providerIdempotencyKey: "credit-consume-purchased-provider",
        providerReference: "credit-consume-purchased-reference",
        requestFingerprint: "a".repeat(64),
        billingLegalNameSnapshot: "Credit Priority AG",
        billingContactEmailSnapshot: "billing@credit-priority.example.test",
        billingStreetSnapshot: "Teststrasse 13",
        billingPostalCodeSnapshot: "8000",
        billingCitySnapshot: "Zürich",
        billingCountryCodeSnapshot: "CH",
        currency: "CHF",
        netTotalRappen: 1_000,
        vatTotalRappen: 0,
        totalRappen: 1_000,
        expiresAt: new Date(NOW.getTime() + DAY),
        createdAt: NOW,
      },
    });
    await transaction.orderLine.create({
      data: {
        id: IDS.contactOrderLine,
        orderId: IDS.contactOrder,
        productVersionId: IDS.contactProductVersion,
        taxRateVersionId: IDS.taxRate,
        quantity: 1,
        unitNetRappen: 1_000,
        netRappen: 1_000,
        taxRateBasisPoints: 0,
        vatRappen: 0,
        totalRappen: 1_000,
        currency: "CHF",
        descriptionSnapshot: "Two Talent Contact Credits",
        fulfillmentContext: "CONTACT_PACK",
        targetCreditType: "TALENT_CONTACT",
        createdAt: NOW,
      },
    });
    await transaction.order.update({
      where: { id: IDS.contactOrder },
      data: { status: "PENDING" },
    });
    await transaction.order.update({
      where: { id: IDS.contactOrder },
      data: { status: "PAID", paidAt: NOW },
    });
  });
  const periodEnd = new Date(NOW.getTime() + 5 * DAY);
  await client.creditAccount.create({
    data: {
      id: IDS.purchasedAccount,
      companyId: IDS.priorityCompany,
      creditType: "TALENT_CONTACT",
      fundingSource: "PURCHASED_PACK",
      periodStart: NOW,
      periodEnd,
    },
  });
  await client.creditLedgerEntry.create({
    data: {
      id: IDS.purchasedGrant,
      accountId: IDS.purchasedAccount,
      fundingSource: "PURCHASED_PACK",
      kind: "GRANT",
      amount: 2,
      sourceOrderLineId: IDS.contactOrderLine,
      validFrom: NOW,
      validTo: periodEnd,
      idempotencyKey: "purchased-grant:credit-consume",
      reasonCode: "PAID_CONTACT_PACK",
      createdAt: NOW,
    },
  });
}

async function createDirectGrant(
  client: DatabaseClient,
  input: Readonly<{
    accountId: string;
    amount: number;
    companyId: string;
    creditType: "TALENT_CONTACT" | "JOB_BOOST";
    fundingSource: "ADMIN_GRANT";
    grantId: string;
    periodEnd: Date;
    periodStart?: Date;
  }>,
) {
  const periodStart = input.periodStart ?? new Date(NOW.getTime() - DAY);
  await client.creditAccount.create({
    data: {
      id: input.accountId,
      companyId: input.companyId,
      creditType: input.creditType,
      fundingSource: input.fundingSource,
      periodStart,
      periodEnd: input.periodEnd,
    },
  });
  await client.creditLedgerEntry.create({
    data: {
      id: input.grantId,
      accountId: input.accountId,
      fundingSource: input.fundingSource,
      kind: "GRANT",
      amount: input.amount,
      validFrom: periodStart,
      validTo: input.periodEnd,
      idempotencyKey: `admin-grant:${input.grantId}`,
      reasonCode: "CUSTOMER_SUCCESS_GRANT",
      actorUserId: IDS.admin,
      createdAt: periodStart,
    },
  });
}

function db(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Shared Credit consume integration database unavailable.");
  }
  return database;
}
