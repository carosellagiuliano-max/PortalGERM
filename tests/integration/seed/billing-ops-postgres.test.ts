import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAdminFinancialMetrics } from "@/lib/analytics/admin-metrics";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { seedBillingOpsContent } from "@/prisma/seed/blocks/billing-ops";
import { seedDemoAccountsCompaniesAndJobs } from "@/prisma/seed/blocks/companies-jobs";
import { seedReferenceCatalog } from "@/prisma/seed/blocks/reference-catalog";
import {
  deriveSeedBillingMrrContractV1,
  SEED_BILLING_MRR_CONTRACT_V1,
  SEED_EFFECTIVE_PAID_SUBSCRIPTION_COMMERCIAL_FIXTURES_V1,
} from "@/prisma/seed/fixtures";
import { stableSeedId } from "@/prisma/seed/ids";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Billing/Ops test database is not initialized.");
  }
  return database;
}

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase_05_billing_ops");
  database = createDatabaseClient(isolated.connectionString);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential("Phase-05 Billing/Ops PostgreSQL seed", () => {
  it(
    "persists the trigger-safe graph and leaves every released row unchanged on rerun",
    async () => {
      const anchorAt = new Date();
      anchorAt.setMilliseconds(0);
      const referenceCatalog = await seedReferenceCatalog(client());
      const referenceBefore = await loadReferenceXmin(client());
      expect(await seedReferenceCatalog(client())).toEqual(referenceCatalog);
      expect(await loadReferenceXmin(client())).toEqual(referenceBefore);
      expect({
        cantons: await client().canton.count(),
        cities: await client().city.count(),
        categories: await client().category.count(),
        skills: await client().skill.count(),
        occupationCodes: await client().occupationCode.count(),
        salaryBands: await client().salaryBand.count(),
        plans: await client().plan.count(),
        planVersions: await client().planVersion.count(),
        planEntitlements: await client().planEntitlement.count(),
        products: await client().product.count(),
        activeProductVersions: await client().productVersion.count({
          where: { status: "ACTIVE" },
        }),
      }).toEqual({
        cantons: 26,
        cities: 29,
        categories: 18,
        skills: 72,
        occupationCodes: 40,
        salaryBands: 12,
        plans: 5,
        planVersions: 8,
        planEntitlements: 64,
        products: 11,
        activeProductVersions: 4,
      });
      const dependencies = await seedDemoAccountsCompaniesAndJobs(
        client(),
        anchorAt,
      );
      const admin = dependencies.demoAccounts.find(
        (account) => account.email === "admin@demo.ch",
      );
      if (admin === undefined) {
        throw new Error("Admin demo account is missing from seed dependencies.");
      }
      const input = {
        adminUserId: admin.id,
        anchorAt,
        companies: dependencies.companies,
        db: client(),
        jobs: dependencies.jobs,
        referenceCatalog,
      } as const;

      const first = await seedBillingOpsContent(input);
      const before = await loadBillingXmin(client());
      const second = await seedBillingOpsContent(input);
      const after = await loadBillingXmin(client());

      expect(second).toEqual(first);
      expect(after).toEqual(before);
      expect(await client().companyBillingProfile.count()).toBe(21);
      expect(await client().employerSubscription.count()).toBe(23);
      expect(await client().subscriptionChangeSchedule.count()).toBe(2);
      expect(await client().order.count()).toBe(12);
      expect(await client().orderLine.count()).toBe(12);
      expect(await client().paymentEvent.count()).toBe(22);
      expect(await client().invoice.count()).toBe(7);
      expect(await client().invoiceLine.count()).toBe(7);
      expect(await client().creditAccount.count()).toBe(29);
      expect(await client().creditLedgerEntry.count()).toBe(37);
      expect(await client().jobBoost.groupBy({
        by: ["status"],
        _count: { _all: true },
        orderBy: { status: "asc" },
      })).toEqual([
        { status: "SCHEDULED", _count: { _all: 1 } },
        { status: "ACTIVE", _count: { _all: 5 } },
        { status: "EXPIRED", _count: { _all: 5 } },
        { status: "CANCELLED", _count: { _all: 1 } },
      ]);
      expect(await client().salesLead.count()).toBe(4);
      expect(await client().abuseReport.count({ where: { status: "OPEN" } })).toBe(
        3,
      );
      expect(await client().auditLog.count()).toBe(30);
      await expect(
        client().auditLog.findUnique({
          where: { id: stableSeedId("audit-log", "phase-05:18") },
          select: { action: true, targetId: true, targetType: true },
        }),
      ).resolves.toEqual({
        action: "JOB_BOOST_ACTIVATED",
        targetId: stableSeedId("job-boost", "phase-05:8"),
        targetType: "JOB_BOOST",
      });
      expect(await client().analyticsEvent.count()).toBe(300);
      const analyticsEvents = await loadAnalyticsEvents(client());
      expect(
        analyticsEvents.every(
          (event) =>
            event.actorProvenanceSnapshot === "DEMO" &&
            (event.companyId === null
              ? event.companyProvenanceSnapshot === null
              : event.companyProvenanceSnapshot === "DEMO") &&
            (event.jobId === null
              ? event.jobProvenanceSnapshot === null
              : event.jobProvenanceSnapshot === "DEMO"),
        ),
      ).toBe(true);
      expectPersistedAnalyticsCohorts(analyticsEvents);
      expect(await client().contentPage.count({ where: { dataProvenance: "DEMO" } })).toBe(
        7,
      );
      expect(await client().contentRevision.count({ where: { status: "PUBLISHED" } })).toBe(
        7,
      );
      expect(await client().contentEvent.count()).toBe(28);
      expect(await client().supportCase.count()).toBe(2);
      expect(await client().systemTask.count()).toBe(3);

      const expectedMrr = deriveSeedBillingMrrContractV1(
        SEED_EFFECTIVE_PAID_SUBSCRIPTION_COMMERCIAL_FIXTURES_V1,
      );
      expect(expectedMrr).toEqual(SEED_BILLING_MRR_CONTRACT_V1);
      expect(expectedMrr).toEqual({
        currency: "CHF",
        effectivePaidSubscriptions: 20,
        paidPlanDistribution: {
          STARTER: 6,
          PRO: 6,
          BUSINESS: 5,
          ENTERPRISE_CONTRACT: 3,
        },
        totalMonthlyEquivalentRappen: 1_228_000,
      });

      const metrics = await getAdminFinancialMetrics({
        actor: {
          userId: admin.id,
          email: admin.email,
          role: "ADMIN",
          status: "ACTIVE",
        },
        correlationId: "phase12-seed-mrr-reconciliation",
        database: client(),
        now: anchorAt,
      });
      expect(metrics).not.toBeNull();
      if (metrics === null) {
        throw new Error("Seed MRR metrics unexpectedly denied Admin access.");
      }
      expect(metrics.measuredAt).toEqual(anchorAt);
      expect(metrics).toEqual(
        expect.objectContaining({
          activeSubscriptions: expectedMrr.effectivePaidSubscriptions,
          customContractsWithoutValue: 0,
          freeEmployers: 5,
          mrrRappen: expectedMrr.totalMonthlyEquivalentRappen,
          paidEmployers: expectedMrr.effectivePaidSubscriptions,
        }),
      );

      const effectiveByCompany = await client().employerSubscription.groupBy({
        by: ["companyId"],
        where: {
          company: { status: "ACTIVE" },
          status: { in: ["ACTIVE", "CANCELLING"] },
          currentPeriodStart: { lte: anchorAt },
          currentPeriodEnd: { gt: anchorAt },
        },
        _count: { _all: true },
      });
      expect(effectiveByCompany).toHaveLength(20);
      expect(effectiveByCompany.every((row) => row._count._all === 1)).toBe(true);
      const effectivePaidSubscriptions =
        await client().employerSubscription.findMany({
          where: {
            company: { status: "ACTIVE" },
            status: { in: ["ACTIVE", "CANCELLING"] },
            currentPeriodStart: { lte: anchorAt },
            currentPeriodEnd: { gt: anchorAt },
          },
          orderBy: { companyId: "asc" },
          select: {
            companyId: true,
            currencySnapshot: true,
            monthlyEquivalentRappenSnapshot: true,
            planVersionId: true,
            recurringNetRappenSnapshot: true,
            planVersion: { select: { plan: { select: { code: true } } } },
          },
        });
      const actualPaidDistribution = Object.fromEntries(
        Object.keys(expectedMrr.paidPlanDistribution).map(
          (planCode) => [
            planCode,
            effectivePaidSubscriptions.filter(
              (subscription) => subscription.planVersion.plan.code === planCode,
            ).length,
          ],
        ),
      );
      expect(actualPaidDistribution).toEqual(expectedMrr.paidPlanDistribution);
      expect(effectivePaidSubscriptions).toHaveLength(
        expectedMrr.effectivePaidSubscriptions,
      );
      expect(
        effectivePaidSubscriptions.map((subscription) => ({
          companyId: subscription.companyId,
          currencySnapshot: subscription.currencySnapshot,
          monthlyEquivalentRappenSnapshot:
            subscription.monthlyEquivalentRappenSnapshot,
          planVersionId: subscription.planVersionId,
          recurringNetRappenSnapshot: subscription.recurringNetRappenSnapshot,
        })),
      ).toEqual(
        SEED_EFFECTIVE_PAID_SUBSCRIPTION_COMMERCIAL_FIXTURES_V1.map(
          (subscription) => ({
            companyId: subscription.companyId,
            currencySnapshot: subscription.currency,
            monthlyEquivalentRappenSnapshot:
              subscription.monthlyEquivalentRappen,
            planVersionId: stableSeedId(
              "plan-version",
              subscription.planVersionNaturalKey,
            ),
            recurringNetRappenSnapshot: subscription.recurringNetRappen,
          }),
        ).sort((left, right) => left.companyId.localeCompare(right.companyId)),
      );
      const reconciledSnapshotMrr = effectivePaidSubscriptions.reduce(
        (total, subscription) =>
          total + subscription.monthlyEquivalentRappenSnapshot,
        0,
      );
      expect(reconciledSnapshotMrr).toBe(
        expectedMrr.totalMonthlyEquivalentRappen,
      );
      expect(reconciledSnapshotMrr).toBe(metrics.mrrRappen);
      expect(
        await client().taxRateVersion.count({
          where: { rateBasisPoints: 810, reviewStatus: "APPROVED" },
        }),
      ).toBe(1);
    },
    300_000,
  );
});

async function loadAnalyticsEvents(db: DatabaseClient) {
  return db.analyticsEvent.findMany({
    where: { producer: "phase-05-demo-seed" },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
}

type PersistedAnalyticsEvent = Awaited<
  ReturnType<typeof loadAnalyticsEvents>
>[number];

function expectPersistedAnalyticsCohorts(
  events: readonly PersistedAnalyticsEvent[],
): void {
  const candidate = events.filter(
    (event) =>
      event.pseudonymousActorId?.startsWith("demo-candidate-") === true &&
      ["CANDIDATE_REGISTERED", "CANDIDATE_PROFILE_COMPLETED"].includes(
        event.kind,
      ),
  );
  expect(stageCounts(candidate, [
    "CANDIDATE_REGISTERED",
    "CANDIDATE_PROFILE_COMPLETED",
  ])).toEqual([20, 18]);
  expectOrderedStages(
    candidate,
    (event) => event.pseudonymousActorId,
    ["CANDIDATE_REGISTERED", "CANDIDATE_PROFILE_COMPLETED"],
    20,
  );

  const employer = events.filter(
    (event) => event.pseudonymousActorId?.startsWith("demo-employer-") === true,
  );
  expect(stageCounts(employer, [
    "EMPLOYER_REGISTERED",
    "COMPANY_ONBOARDING_COMPLETED",
    "JOB_PUBLISHED",
  ])).toEqual([20, 20, 18]);
  expectOrderedStages(
    employer,
    (event) => event.companyId,
    [
      "EMPLOYER_REGISTERED",
      "COMPANY_ONBOARDING_COMPLETED",
      "JOB_PUBLISHED",
    ],
    20,
  );
  for (const event of employer.filter((candidate) => candidate.jobId !== null)) {
    expect(event.companyId).not.toBeNull();
  }

  const search = events.filter(
    (event) => event.pseudonymousSessionId?.startsWith("demo-search-") === true,
  );
  expect(stageCounts(search, [
    "SEARCH_SUBMITTED",
    "SEARCH_RESULTS_VIEWED",
    "JOB_DETAIL_VIEWED",
    "APPLY_INTENT_STARTED",
    "APPLICATION_SUBMITTED",
  ])).toEqual([20, 20, 19, 18, 17]);
  expectOrderedStages(
    search,
    (event) => event.pseudonymousSessionId,
    [
      "SEARCH_SUBMITTED",
      "SEARCH_RESULTS_VIEWED",
      "JOB_DETAIL_VIEWED",
      "APPLY_INTENT_STARTED",
      "APPLICATION_SUBMITTED",
    ],
    20,
  );
  for (const scoped of groupEvents(
    search.filter((event) => event.jobId !== null),
    (event) => event.pseudonymousSessionId,
  ).values()) {
    expect(new Set(scoped.map(({ companyId }) => companyId)).size).toBe(1);
    expect(new Set(scoped.map(({ jobId }) => jobId)).size).toBe(1);
  }

  const leads = events.filter(
    (event) => event.pseudonymousSessionId?.startsWith("demo-lead-") === true,
  );
  expect(stageCounts(leads, [
    "LEAD_SUBMITTED",
    "LEAD_QUALIFIED",
    "LEAD_WON",
  ])).toEqual([4, 3, 2]);
  expectOrderedStages(
    leads,
    (event) => event.pseudonymousSessionId,
    ["LEAD_SUBMITTED", "LEAD_QUALIFIED", "LEAD_WON"],
    4,
  );

  const checkout = events.filter(
    (event) => event.pseudonymousSessionId?.startsWith("demo-order-") === true,
  );
  expect(stageCounts(checkout, [
    "PRICING_VIEWED",
    "CHECKOUT_STARTED",
    "CHECKOUT_COMPLETED",
  ])).toEqual([12, 12, 7]);
  expectOrderedStages(
    checkout,
    (event) => event.pseudonymousSessionId,
    ["PRICING_VIEWED", "CHECKOUT_STARTED", "CHECKOUT_COMPLETED"],
    12,
  );

  const suppressed = events.filter(
    (event) =>
      event.pseudonymousSessionId?.startsWith(
        "demo-suppression-search-",
      ) === true,
  );
  expect(suppressed).toHaveLength(5);
  expect(suppressed.every(({ kind }) => kind === "SEARCH_RESULTS_VIEWED")).toBe(
    true,
  );
  expect(
    new Set(suppressed.map(({ pseudonymousSessionId }) => pseudonymousSessionId))
      .size,
  ).toBe(5);
}

function stageCounts(
  events: readonly PersistedAnalyticsEvent[],
  stages: readonly string[],
) {
  return stages.map(
    (stage) => events.filter((event) => event.kind === stage).length,
  );
}

function expectOrderedStages(
  events: readonly PersistedAnalyticsEvent[],
  selectKey: (event: PersistedAnalyticsEvent) => string | null,
  stages: readonly string[],
  expectedCohorts: number,
): void {
  const groups = groupEvents(events, selectKey);
  expect(groups.size).toBe(expectedCohorts);
  for (const values of groups.values()) {
    let missingStage = false;
    let previous = Number.NEGATIVE_INFINITY;
    for (const stage of stages) {
      const event = values.find((candidate) => candidate.kind === stage);
      if (event === undefined) {
        missingStage = true;
        continue;
      }
      expect(missingStage).toBe(false);
      expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(previous);
      previous = event.occurredAt.getTime();
    }
  }
}

function groupEvents(
  events: readonly PersistedAnalyticsEvent[],
  selectKey: (event: PersistedAnalyticsEvent) => string | null,
) {
  const groups = new Map<string, PersistedAnalyticsEvent[]>();
  for (const event of events) {
    const key = selectKey(event);
    if (key === null) continue;
    const values = groups.get(key) ?? [];
    values.push(event);
    groups.set(key, values);
  }
  return groups;
}

async function loadBillingXmin(db: DatabaseClient) {
  return db.$queryRaw<Array<{ entity: string; id: string; xmin: string }>>`
    SELECT 'Order' AS entity, "id"::text AS id, xmin::text AS xmin FROM "Order"
    UNION ALL
    SELECT 'Invoice', "id"::text, xmin::text FROM "Invoice"
    UNION ALL
    SELECT 'EmployerSubscription', "id"::text, xmin::text FROM "EmployerSubscription"
    UNION ALL
    SELECT 'ContentPage', "id"::text, xmin::text FROM "ContentPage"
    UNION ALL
    SELECT 'ContentRevision', "id"::text, xmin::text FROM "ContentRevision"
    UNION ALL
    SELECT 'CompanyBillingProfile', "id"::text, xmin::text FROM "CompanyBillingProfile"
    UNION ALL
    SELECT 'AnalyticsEvent', "id"::text, xmin::text FROM "AnalyticsEvent"
    ORDER BY entity, id
  `;
}

async function loadReferenceXmin(db: DatabaseClient) {
  return db.$queryRaw<Array<{ entity: string; id: string; xmin: string }>>`
    SELECT 'Canton' AS entity, "id"::text AS id, xmin::text AS xmin FROM "Canton"
    UNION ALL
    SELECT 'City', "id"::text, xmin::text FROM "City"
    UNION ALL
    SELECT 'Category', "id"::text, xmin::text FROM "Category"
    UNION ALL
    SELECT 'Skill', "id"::text, xmin::text FROM "Skill"
    UNION ALL
    SELECT 'OccupationCodeVersion', "id"::text, xmin::text FROM "OccupationCodeVersion"
    UNION ALL
    SELECT 'OccupationCode', "id"::text, xmin::text FROM "OccupationCode"
    UNION ALL
    SELECT 'SalaryDatasetVersion', "id"::text, xmin::text FROM "SalaryDatasetVersion"
    UNION ALL
    SELECT 'SalaryBand', "id"::text, xmin::text FROM "SalaryBand"
    UNION ALL
    SELECT 'Plan', "id"::text, xmin::text FROM "Plan"
    UNION ALL
    SELECT 'PlanVersion', "id"::text, xmin::text FROM "PlanVersion"
    UNION ALL
    SELECT 'PlanEntitlement', "id"::text, xmin::text FROM "PlanEntitlement"
    UNION ALL
    SELECT 'Product', "id"::text, xmin::text FROM "Product"
    UNION ALL
    SELECT 'ProductVersion', "id"::text, xmin::text FROM "ProductVersion"
    ORDER BY entity, id
  `;
}
