import { describe, expect, it } from "vitest";

import { ANALYTICS_EVENT_KINDS_V1 } from "@/lib/analytics/event-contracts";
import {
  calculateCandidateActivation7dV1,
  calculateCheckoutConversionV1,
  calculateEmployerActivation14dV1,
  calculateLeadFunnelV1,
  calculateSearchToApply7dV1,
  type FunnelEventV1,
} from "@/lib/analytics/funnel-definitions";
import {
  ANALYTICS_SEED_COHORT_CONTRACT,
  BILLING_OPS_SEED_IDENTITIES,
  buildAnalyticsSeedFixtures,
  buildBillingOpsSeedBlockDigest,
  buildBillingOpsSeedIdentities,
  type AnalyticsSeedFixture,
  type BillingCompanyHandle,
  type BillingJobHandle,
} from "@/prisma/seed/blocks/billing-ops";
import { REFERENCE_CATALOG_SEED_IDENTITIES } from "@/prisma/seed/blocks/reference-catalog";
import {
  COMPANY_FIXTURES,
  countGuideWords,
  DEMO_GUIDE_FIXTURES,
  deriveSeedBillingMrrContractV1,
  getSeedSubscriptionCommercialSnapshotV1,
  PLAN_VERSION_FIXTURES,
  SEED_BILLING_MRR_CONTRACT_V1,
  SEED_CUSTOM_SUBSCRIPTION_COMMERCIAL_CONTRACTS_V1,
  SEED_EFFECTIVE_PAID_SUBSCRIPTION_COMMERCIAL_FIXTURES_V1,
  type PlanCode,
} from "@/prisma/seed/fixtures";
import { stableSeedId } from "@/prisma/seed/ids";

describe("Phase-05 reference, Billing/Ops and content contract", () => {
  it("closes every reference-catalog identity before persistence", () => {
    expect(REFERENCE_CATALOG_SEED_IDENTITIES).toHaveLength(298);
    expect(new Set(REFERENCE_CATALOG_SEED_IDENTITIES.map(({ id }) => id)).size).toBe(
      298,
    );
    expect(
      new Set(
        REFERENCE_CATALOG_SEED_IDENTITIES.map(
          ({ entity, naturalKey }) => `${entity}:${naturalKey}`,
        ),
      ).size,
    ).toBe(298);
  });

  it("contains exactly seven original 300-600-word German demo guides", () => {
    expect(DEMO_GUIDE_FIXTURES).toHaveLength(7);
    expect(new Set(DEMO_GUIDE_FIXTURES.map(({ slug }) => slug)).size).toBe(7);
    expect(DEMO_GUIDE_FIXTURES.map(({ body }) => countGuideWords(body))).toEqual(
      expect.arrayContaining([
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      ]),
    );
    for (const guide of DEMO_GUIDE_FIXTURES) {
      expect(guide.locale).toBe("de-CH");
      expect(guide.type).toBe("GUIDE");
      expect(guide.canonicalPath).toBe(`/ratgeber/${guide.slug}`);
      expect(countGuideWords(guide.body)).toBeGreaterThanOrEqual(300);
      expect(countGuideWords(guide.body)).toBeLessThanOrEqual(600);
    }
  });

  it("builds a complete dependency-derived identity list without an anchor", () => {
    const companies = companyHandles();
    const jobs = jobHandles(companies);
    const identities = buildBillingOpsSeedIdentities({ companies, jobs });

    expect(BILLING_OPS_SEED_IDENTITIES).toHaveLength(468);
    expect(identities).toHaveLength(605);
    expect(new Set(identities.map(({ id }) => id)).size).toBe(identities.length);
    expect(
      new Set(
        identities.map(({ entity, naturalKey }) => `${entity}:${naturalKey}`),
      ).size,
    ).toBe(identities.length);
    expect(buildBillingOpsSeedBlockDigest({ companies, jobs })).toEqual(
      buildBillingOpsSeedBlockDigest({
        companies: [...companies].reverse(),
        jobs: [...jobs].reverse(),
      }),
    );
  });

  it("rejects an incomplete paid-company scenario before any database call", () => {
    const companies = companyHandles().slice(0, 24);
    const jobs = jobHandles(companies);
    expect(() => buildBillingOpsSeedIdentities({ companies, jobs })).toThrow(
      "exactly 20 paid Companies",
    );
  });

  it("derives the exact MRR target from Company, PlanVersion and custom-commercial contracts", () => {
    const paidCompanies = COMPANY_FIXTURES.filter(
      ({ planCode }) => planCode !== "FREE_BASIC",
    );
    expect(
      SEED_EFFECTIVE_PAID_SUBSCRIPTION_COMMERCIAL_FIXTURES_V1.map(
        ({ companyId }) => companyId,
      ),
    ).toEqual(paidCompanies.map(({ id }) => id));

    for (const planCode of ["STARTER", "PRO", "BUSINESS"] as const) {
      const commercial = getSeedSubscriptionCommercialSnapshotV1(planCode);
      const planVersion = PLAN_VERSION_FIXTURES.find(
        ({ naturalKey }) => naturalKey === commercial.planVersionNaturalKey,
      );
      expect(planVersion).toBeDefined();
      expect(commercial).toEqual(
        expect.objectContaining({
          currency: planVersion?.currency,
          monthlyEquivalentRappen: planVersion?.monthlyEquivalentRappen,
          recurringNetRappen: planVersion?.netPriceRappen,
        }),
      );
    }

    expect(
      getSeedSubscriptionCommercialSnapshotV1("ENTERPRISE_CONTRACT"),
    ).toEqual(
      expect.objectContaining(
        SEED_CUSTOM_SUBSCRIPTION_COMMERCIAL_CONTRACTS_V1.ENTERPRISE_CONTRACT,
      ),
    );
    expect(
      deriveSeedBillingMrrContractV1(
        SEED_EFFECTIVE_PAID_SUBSCRIPTION_COMMERCIAL_FIXTURES_V1,
      ),
    ).toEqual(SEED_BILLING_MRR_CONTRACT_V1);
    expect(SEED_BILLING_MRR_CONTRACT_V1).toEqual({
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
  });

  it("builds ordered, correctly keyed analytics cohorts and a suppressed negative population", () => {
    const companies = companyHandles();
    const jobs = jobHandles(companies);
    const anchorAt = new Date("2026-07-20T10:00:00.000Z");
    const fixtures = buildAnalyticsSeedFixtures(anchorAt, companies, jobs);

    expect(fixtures).toHaveLength(ANALYTICS_SEED_COHORT_CONTRACT.totalEvents);
    expect(new Set(fixtures.map(({ id }) => id)).size).toBe(300);
    expect(new Set(fixtures.map(({ dedupeKey }) => dedupeKey)).size).toBe(300);
    expect(new Set(fixtures.map(({ kind }) => kind))).toEqual(
      new Set(
        ANALYTICS_EVENT_KINDS_V1.filter(
          (kind) => kind !== "EXTERNAL_APPLY_CLICKED",
        ),
      ),
    );
    expect(buildAnalyticsSeedFixtures(anchorAt, companies, jobs)).toEqual(
      fixtures,
    );

    const candidate = cohort(fixtures, "CANDIDATE_ACTIVATION");
    expect(countKind(candidate, "CANDIDATE_REGISTERED")).toBe(20);
    expect(countKind(candidate, "CANDIDATE_PROFILE_COMPLETED")).toBe(18);
    expect(calculateCandidateActivation7dV1(toFunnelEvents(candidate))).toEqual({
      status: "VALUE",
      numerator: 17,
      denominator: 20,
      rateBps: 8_500,
    });

    const employer = cohort(fixtures, "EMPLOYER_ACTIVATION");
    expect(countKind(employer, "EMPLOYER_REGISTERED")).toBe(20);
    expect(countKind(employer, "COMPANY_ONBOARDING_COMPLETED")).toBe(20);
    expect(countKind(employer, "JOB_PUBLISHED")).toBe(18);
    expect(calculateEmployerActivation14dV1(toFunnelEvents(employer))).toEqual({
      status: "VALUE",
      numerator: 17,
      denominator: 20,
      rateBps: 8_500,
    });
    for (const events of groupByCohortKey(employer).values()) {
      expect(new Set(events.map(({ companyId }) => companyId)).size).toBe(1);
      expect(
        new Set(events.map(({ pseudonymousActorId }) => pseudonymousActorId)).size,
      ).toBe(1);
      expect(isChronological(events)).toBe(true);
      const published = events.find(({ kind }) => kind === "JOB_PUBLISHED");
      if (published !== undefined) {
        expect(
          jobs.some(
            (job) =>
              job.id === published.jobId && job.companyId === published.companyId,
          ),
        ).toBe(true);
      }
    }

    const search = cohort(fixtures, "SEARCH_TO_APPLY");
    expect(calculateSearchToApply7dV1(toFunnelEvents(search))).toEqual({
      status: "VALUE",
      resultSessions: 20,
      detailSessions: 19,
      intentSessions: 18,
      submittedSessions: 17,
      resultToApplyRateBps: 8_500,
    });
    for (const [key, events] of groupByCohortKey(search)) {
      expect(events.every(({ pseudonymousSessionId }) => pseudonymousSessionId === key)).toBe(
        true,
      );
      expect(
        new Set(events.map(({ pseudonymousActorId }) => pseudonymousActorId)).size,
      ).toBe(1);
      expect(isChronological(events)).toBe(true);
      const scoped = events.filter(({ jobId }) => jobId !== null);
      if (scoped.length > 0) {
        expect(new Set(scoped.map(({ companyId }) => companyId)).size).toBe(1);
        expect(new Set(scoped.map(({ jobId }) => jobId)).size).toBe(1);
      }
    }

    const leads = cohort(fixtures, "LEAD_FUNNEL");
    expect(countKind(leads, "LEAD_SUBMITTED")).toBe(4);
    expect(countKind(leads, "LEAD_QUALIFIED")).toBe(3);
    expect(countKind(leads, "LEAD_WON")).toBe(2);
    expect(calculateLeadFunnelV1(toFunnelEvents(leads))).toMatchObject({
      status: "SUPPRESSED",
    });
    expectOrderedCohortKeys(leads);

    const checkout = cohort(fixtures, "CHECKOUT_FUNNEL");
    expect(countKind(checkout, "CHECKOUT_STARTED")).toBe(12);
    expect(countKind(checkout, "CHECKOUT_COMPLETED")).toBe(7);
    expect(calculateCheckoutConversionV1(toFunnelEvents(checkout))).toMatchObject({
      status: "SUPPRESSED",
    });
    expectOrderedCohortKeys(checkout);

    const suppression = cohort(fixtures, "SEARCH_SUPPRESSION");
    expect(suppression).toHaveLength(5);
    expect(new Set(suppression.map(({ cohortKey }) => cohortKey)).size).toBe(5);
    expect(calculateSearchToApply7dV1(toFunnelEvents(suppression))).toMatchObject({
      status: "SUPPRESSED",
    });
  });
});

function cohort(
  fixtures: readonly AnalyticsSeedFixture[],
  name: AnalyticsSeedFixture["cohort"],
) {
  return fixtures.filter((fixture) => fixture.cohort === name);
}

function countKind(
  fixtures: readonly AnalyticsSeedFixture[],
  kind: AnalyticsSeedFixture["kind"],
) {
  return fixtures.filter((fixture) => fixture.kind === kind).length;
}

function groupByCohortKey(fixtures: readonly AnalyticsSeedFixture[]) {
  const groups = new Map<string, AnalyticsSeedFixture[]>();
  for (const fixture of fixtures) {
    const current = groups.get(fixture.cohortKey) ?? [];
    current.push(fixture);
    groups.set(fixture.cohortKey, current);
  }
  return groups;
}

function expectOrderedCohortKeys(fixtures: readonly AnalyticsSeedFixture[]) {
  for (const [key, events] of groupByCohortKey(fixtures)) {
    expect(events.every(({ pseudonymousSessionId }) => pseudonymousSessionId === key)).toBe(
      true,
    );
    expect(new Set(events.map(({ companyId }) => companyId)).size).toBe(1);
    expect(isChronological(events)).toBe(true);
  }
}

function isChronological(events: readonly AnalyticsSeedFixture[]) {
  return events.every(
    (event, index) =>
      index === 0 ||
      event.occurredAt.getTime() >=
        (events[index - 1]?.occurredAt.getTime() ?? Number.POSITIVE_INFINITY),
  );
}

function toFunnelEvents(
  fixtures: readonly AnalyticsSeedFixture[],
): readonly FunnelEventV1[] {
  return fixtures.map((fixture) => ({
    actorProvenance: "LIVE",
    companyId: fixture.companyId ?? undefined,
    companyProvenance: fixture.companyId === null ? null : "LIVE",
    jobId: fixture.jobId ?? undefined,
    jobProvenance: fixture.jobId === null ? null : "LIVE",
    kind: fixture.kind,
    leadId: fixture.cohort === "LEAD_FUNNEL" ? fixture.cohortKey : undefined,
    occurredAt: fixture.occurredAt,
    orderId:
      fixture.cohort === "CHECKOUT_FUNNEL" ? fixture.cohortKey : undefined,
    pseudonymousSessionId: fixture.pseudonymousSessionId,
    receivedAt: new Date(fixture.occurredAt.getTime() + 60_000),
    subjectId:
      fixture.cohort === "CANDIDATE_ACTIVATION"
        ? fixture.cohortKey
        : undefined,
  }));
}

function companyHandles(): readonly BillingCompanyHandle[] {
  const plans: readonly PlanCode[] = [
    ...Array<PlanCode>(5).fill("FREE_BASIC"),
    ...Array<PlanCode>(6).fill("STARTER"),
    ...Array<PlanCode>(6).fill("PRO"),
    ...Array<PlanCode>(5).fill("BUSINESS"),
    ...Array<PlanCode>(3).fill("ENTERPRISE_CONTRACT"),
  ];
  return Object.freeze(
    plans.map((planCode, index) => {
      const slug = `company-${String(index + 1).padStart(2, "0")}`;
      return Object.freeze({
        id: stableSeedId("company", slug),
        name: `Demo Company ${index + 1}`,
        ownerMembershipId: stableSeedId("company-membership", `${slug}:owner`),
        ownerUserId: stableSeedId("user", `${slug}:owner`),
        planCode,
        slug,
      });
    }),
  );
}

function jobHandles(
  companies: readonly BillingCompanyHandle[],
): readonly BillingJobHandle[] {
  return Object.freeze(
    companies.map((company, index) => {
      const slug = `job-${String(index + 1).padStart(2, "0")}`;
      const revisionId = stableSeedId("job-revision", `${slug}:1`);
      return Object.freeze({
        companyId: company.id,
        id: stableSeedId("job", slug),
        publishedRevisionId: revisionId,
        revisionId,
        slug,
        status: "PUBLISHED",
      });
    }),
  );
}
