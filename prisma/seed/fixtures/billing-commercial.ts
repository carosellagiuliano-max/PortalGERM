import { COMPANY_FIXTURES, type CompanyFixture } from "./companies-jobs";
import {
  PLAN_VERSION_FIXTURES,
  type PlanCode,
  type PlanVersionFixture,
} from "./plans";

export type PaidSeedPlanCode = Exclude<PlanCode, "FREE_BASIC">;

/**
 * Selects the exact released PlanVersion used by each effective paid demo
 * subscription. Keeping this selection versioned prevents a later catalog
 * fixture from silently changing the Phase-12 MRR baseline.
 */
export const SEED_SUBSCRIPTION_PLAN_VERSION_CONTRACT_V1 = Object.freeze({
  STARTER: "STARTER:v1",
  PRO: "PRO:v1",
  BUSINESS: "BUSINESS:v1",
  ENTERPRISE_CONTRACT: "ENTERPRISE_CONTRACT:v1",
} as const satisfies Readonly<Record<PaidSeedPlanCode, string>>);

/**
 * Contract-priced PlanVersions deliberately have no public catalog price.
 * Their demo subscription snapshots therefore need an explicit, versioned
 * commercial agreement instead of falling back to an inferred value.
 */
export const SEED_CUSTOM_SUBSCRIPTION_COMMERCIAL_CONTRACTS_V1: Readonly<
  Partial<
    Record<
      PaidSeedPlanCode,
      Readonly<{
        currency: "CHF";
        monthlyEquivalentRappen: number;
        recurringNetRappen: number;
      }>
    >
  >
> = Object.freeze({
  ENTERPRISE_CONTRACT: Object.freeze({
    currency: "CHF" as const,
    monthlyEquivalentRappen: 149_900,
    recurringNetRappen: 149_900,
  }),
});

export type SeedSubscriptionCommercialSnapshotV1 = Readonly<{
  billingInterval: "MONTHLY" | "ANNUAL";
  currency: "CHF";
  monthlyEquivalentRappen: number;
  planCode: PaidSeedPlanCode;
  planVersionNaturalKey: string;
  recurringNetRappen: number;
  termMonths: number;
}>;

export type EffectivePaidSubscriptionCommercialFixtureV1 =
  SeedSubscriptionCommercialSnapshotV1 &
    Readonly<{
      companyId: string;
      companySlug: string;
    }>;

type CommercialDerivationInput = Readonly<{
  companies: readonly Readonly<Pick<CompanyFixture, "id" | "planCode" | "slug">>[];
  planVersions: readonly Readonly<PlanVersionFixture>[];
}>;

const DEFAULT_DERIVATION_INPUT: CommercialDerivationInput = Object.freeze({
  companies: COMPANY_FIXTURES,
  planVersions: PLAN_VERSION_FIXTURES,
});

export function getSeedSubscriptionCommercialSnapshotV1(
  planCode: PaidSeedPlanCode,
  planVersions: readonly Readonly<PlanVersionFixture>[] = PLAN_VERSION_FIXTURES,
): SeedSubscriptionCommercialSnapshotV1 {
  const planVersionNaturalKey =
    SEED_SUBSCRIPTION_PLAN_VERSION_CONTRACT_V1[planCode];
  const planVersion = planVersions.find(
    (candidate) => candidate.naturalKey === planVersionNaturalKey,
  );
  if (planVersion === undefined || planVersion.planCode !== planCode) {
    throw new Error(
      `Missing contracted PlanVersion ${planVersionNaturalKey} for ${planCode}.`,
    );
  }
  if (planVersion.status !== "ACTIVE") {
    throw new Error(`Contracted PlanVersion ${planVersionNaturalKey} is not active.`);
  }

  const custom = SEED_CUSTOM_SUBSCRIPTION_COMMERCIAL_CONTRACTS_V1[planCode];
  if (planVersion.priceMode === "CONTRACT" && custom === undefined) {
    throw new Error(`Missing custom subscription commercial contract for ${planCode}.`);
  }
  if (planVersion.priceMode !== "CONTRACT" && custom !== undefined) {
    throw new Error(`Unexpected custom subscription commercial contract for ${planCode}.`);
  }

  const recurringNetRappen = custom?.recurringNetRappen ?? planVersion.netPriceRappen;
  const monthlyEquivalentRappen =
    custom?.monthlyEquivalentRappen ?? planVersion.monthlyEquivalentRappen;
  const currency = custom?.currency ?? planVersion.currency;
  if (currency !== planVersion.currency) {
    throw new Error(`Subscription currency conflicts with ${planVersionNaturalKey}.`);
  }
  if (
    recurringNetRappen === null ||
    monthlyEquivalentRappen === null ||
    recurringNetRappen < 1 ||
    monthlyEquivalentRappen < 1 ||
    !Number.isSafeInteger(recurringNetRappen) ||
    !Number.isSafeInteger(monthlyEquivalentRappen)
  ) {
    throw new Error(`Invalid subscription commercial values for ${planCode}.`);
  }

  return Object.freeze({
    billingInterval: planVersion.billingInterval,
    currency,
    monthlyEquivalentRappen,
    planCode,
    planVersionNaturalKey,
    recurringNetRappen,
    termMonths: planVersion.termMonths,
  });
}

export function buildEffectivePaidSubscriptionCommercialFixturesV1(
  input: CommercialDerivationInput = DEFAULT_DERIVATION_INPUT,
): readonly EffectivePaidSubscriptionCommercialFixtureV1[] {
  if (new Set(input.companies.map(({ id }) => id)).size !== input.companies.length) {
    throw new Error("Seed MRR derivation requires unique Company ids.");
  }
  return Object.freeze(
    input.companies
      .filter(
        (company): company is typeof company & { planCode: PaidSeedPlanCode } =>
          company.planCode !== "FREE_BASIC",
      )
      .map((company) =>
        Object.freeze({
          companyId: company.id,
          companySlug: company.slug,
          ...getSeedSubscriptionCommercialSnapshotV1(
            company.planCode,
            input.planVersions,
          ),
        }),
      ),
  );
}

export function deriveSeedBillingMrrContractV1(
  subscriptions: readonly EffectivePaidSubscriptionCommercialFixtureV1[] =
    buildEffectivePaidSubscriptionCommercialFixturesV1(),
) {
  const paidPlanDistribution: Record<PaidSeedPlanCode, number> = {
    STARTER: 0,
    PRO: 0,
    BUSINESS: 0,
    ENTERPRISE_CONTRACT: 0,
  };
  let totalMonthlyEquivalentRappen = 0;
  for (const subscription of subscriptions) {
    paidPlanDistribution[subscription.planCode] += 1;
    totalMonthlyEquivalentRappen += subscription.monthlyEquivalentRappen;
    if (!Number.isSafeInteger(totalMonthlyEquivalentRappen)) {
      throw new RangeError("Seed MRR exceeds the safe integer range.");
    }
  }

  const currencies = new Set(subscriptions.map(({ currency }) => currency));
  if (currencies.size !== 1 || !currencies.has("CHF")) {
    throw new Error("Effective paid seed subscriptions must use CHF exclusively.");
  }

  return Object.freeze({
    currency: "CHF" as const,
    effectivePaidSubscriptions: subscriptions.length,
    paidPlanDistribution: Object.freeze(paidPlanDistribution),
    totalMonthlyEquivalentRappen,
  });
}

export const SEED_EFFECTIVE_PAID_SUBSCRIPTION_COMMERCIAL_FIXTURES_V1 =
  buildEffectivePaidSubscriptionCommercialFixturesV1();

export const SEED_BILLING_MRR_CONTRACT_V1 = deriveSeedBillingMrrContractV1(
  SEED_EFFECTIVE_PAID_SUBSCRIPTION_COMMERCIAL_FIXTURES_V1,
);
