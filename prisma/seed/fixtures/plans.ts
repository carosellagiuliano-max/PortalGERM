export const ENTITLEMENT_KEYS = Object.freeze([
  "ACTIVE_JOB_LIMIT",
  "SEAT_LIMIT",
  "TALENT_RADAR_ACCESS",
  "TALENT_CONTACT_ALLOWANCE",
  "JOB_BOOST_ALLOWANCE",
  "ANALYTICS_LEVEL",
  "ENHANCED_COMPANY_PROFILE",
  "EMPLOYER_IMPORT_ACCESS",
] as const);

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];
export type AnalyticsLevel = "NONE" | "BASIC" | "ADVANCED" | "PRO";
export type PlanCode =
  | "FREE_BASIC"
  | "STARTER"
  | "PRO"
  | "BUSINESS"
  | "ENTERPRISE_CONTRACT";

export interface PlanFixture {
  readonly code: PlanCode;
  readonly name: string;
  readonly isDefaultFree: boolean;
}

export interface PlanVersionFixture {
  readonly naturalKey: string;
  readonly planCode: PlanCode;
  readonly version: number;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly priceMode: "FIXED" | "CONTRACT";
  readonly billingInterval: "MONTHLY" | "ANNUAL";
  readonly termMonths: number;
  readonly netPriceRappen: number | null;
  readonly monthlyEquivalentRappen: number | null;
  readonly currency: "CHF";
  readonly isPublic: boolean;
  readonly isSelfService: boolean;
  readonly validFrom: string;
  readonly validTo: string | null;
}

interface EntitlementFixtureBase {
  readonly naturalKey: string;
  readonly planVersionNaturalKey: string;
  readonly key: EntitlementKey;
}

export type PlanEntitlementFixture =
  | (EntitlementFixtureBase & {
      readonly valueType: "BOOLEAN";
      readonly booleanValue: boolean;
      readonly integerValue: null;
      readonly analyticsLevelValue: null;
    })
  | (EntitlementFixtureBase & {
      readonly valueType: "INTEGER";
      readonly booleanValue: null;
      readonly integerValue: number;
      readonly analyticsLevelValue: null;
    })
  | (EntitlementFixtureBase & {
      readonly valueType: "ANALYTICS_LEVEL";
      readonly booleanValue: null;
      readonly integerValue: null;
      readonly analyticsLevelValue: AnalyticsLevel;
    });

export const PLAN_FIXTURES: readonly Readonly<PlanFixture>[] = Object.freeze(
  ([
    { code: "FREE_BASIC", name: "Free Basic", isDefaultFree: true },
    { code: "STARTER", name: "Starter", isDefaultFree: false },
    { code: "PRO", name: "Pro", isDefaultFree: false },
    { code: "BUSINESS", name: "Business", isDefaultFree: false },
    {
      code: "ENTERPRISE_CONTRACT",
      name: "Enterprise contract template",
      isDefaultFree: false,
    },
  ] satisfies PlanFixture[]).map((fixture) => Object.freeze(fixture)),
);

const CATALOG_VALID_FROM = "2026-01-01T00:00:00.000Z";

export const PLAN_VERSION_FIXTURES: readonly Readonly<PlanVersionFixture>[] =
  Object.freeze(
    ([
      {
        naturalKey: "FREE_BASIC:v1",
        planCode: "FREE_BASIC",
        version: 1,
        status: "ACTIVE",
        priceMode: "FIXED",
        billingInterval: "MONTHLY",
        termMonths: 1,
        netPriceRappen: 0,
        monthlyEquivalentRappen: 0,
        currency: "CHF",
        isPublic: true,
        isSelfService: false,
        validFrom: CATALOG_VALID_FROM,
        validTo: null,
      },
      {
        naturalKey: "STARTER:v1",
        planCode: "STARTER",
        version: 1,
        status: "ACTIVE",
        priceMode: "FIXED",
        billingInterval: "MONTHLY",
        termMonths: 1,
        netPriceRappen: 14_900,
        monthlyEquivalentRappen: 14_900,
        currency: "CHF",
        isPublic: true,
        isSelfService: true,
        validFrom: CATALOG_VALID_FROM,
        validTo: null,
      },
      {
        naturalKey: "PRO:v1",
        planCode: "PRO",
        version: 1,
        status: "ACTIVE",
        priceMode: "FIXED",
        billingInterval: "MONTHLY",
        termMonths: 1,
        netPriceRappen: 39_900,
        monthlyEquivalentRappen: 39_900,
        currency: "CHF",
        isPublic: true,
        isSelfService: true,
        validFrom: CATALOG_VALID_FROM,
        validTo: null,
      },
      {
        naturalKey: "BUSINESS:v1",
        planCode: "BUSINESS",
        version: 1,
        status: "ACTIVE",
        priceMode: "FIXED",
        billingInterval: "MONTHLY",
        termMonths: 1,
        netPriceRappen: 89_900,
        monthlyEquivalentRappen: 89_900,
        currency: "CHF",
        isPublic: true,
        isSelfService: false,
        validFrom: CATALOG_VALID_FROM,
        validTo: null,
      },
      {
        naturalKey: "ENTERPRISE_CONTRACT:v1",
        planCode: "ENTERPRISE_CONTRACT",
        version: 1,
        status: "ACTIVE",
        priceMode: "CONTRACT",
        billingInterval: "MONTHLY",
        termMonths: 12,
        netPriceRappen: null,
        monthlyEquivalentRappen: null,
        currency: "CHF",
        isPublic: false,
        isSelfService: false,
        validFrom: CATALOG_VALID_FROM,
        validTo: null,
      },
      {
        naturalKey: "STARTER:v2",
        planCode: "STARTER",
        version: 2,
        status: "INACTIVE",
        priceMode: "FIXED",
        billingInterval: "ANNUAL",
        termMonths: 12,
        netPriceRappen: 149_000,
        monthlyEquivalentRappen: 12_417,
        currency: "CHF",
        isPublic: false,
        isSelfService: false,
        validFrom: CATALOG_VALID_FROM,
        validTo: null,
      },
      {
        naturalKey: "PRO:v2",
        planCode: "PRO",
        version: 2,
        status: "INACTIVE",
        priceMode: "FIXED",
        billingInterval: "ANNUAL",
        termMonths: 12,
        netPriceRappen: 399_000,
        monthlyEquivalentRappen: 33_250,
        currency: "CHF",
        isPublic: false,
        isSelfService: false,
        validFrom: CATALOG_VALID_FROM,
        validTo: null,
      },
      {
        naturalKey: "BUSINESS:v2",
        planCode: "BUSINESS",
        version: 2,
        status: "INACTIVE",
        priceMode: "FIXED",
        billingInterval: "ANNUAL",
        termMonths: 12,
        netPriceRappen: 899_000,
        monthlyEquivalentRappen: 74_917,
        currency: "CHF",
        isPublic: false,
        isSelfService: false,
        validFrom: CATALOG_VALID_FROM,
        validTo: null,
      },
    ] satisfies PlanVersionFixture[]).map((fixture) => Object.freeze(fixture)),
  );

type EntitlementMatrix = Readonly<{
  ACTIVE_JOB_LIMIT: number;
  SEAT_LIMIT: number;
  TALENT_RADAR_ACCESS: boolean;
  TALENT_CONTACT_ALLOWANCE: number;
  JOB_BOOST_ALLOWANCE: number;
  ANALYTICS_LEVEL: AnalyticsLevel;
  ENHANCED_COMPANY_PROFILE: boolean;
  EMPLOYER_IMPORT_ACCESS: boolean;
}>;

const ENTITLEMENT_MATRIX: Readonly<Record<PlanCode, EntitlementMatrix>> =
  Object.freeze({
    FREE_BASIC: Object.freeze({
      ACTIVE_JOB_LIMIT: 1,
      SEAT_LIMIT: 1,
      TALENT_RADAR_ACCESS: false,
      TALENT_CONTACT_ALLOWANCE: 0,
      JOB_BOOST_ALLOWANCE: 0,
      ANALYTICS_LEVEL: "NONE",
      ENHANCED_COMPANY_PROFILE: false,
      EMPLOYER_IMPORT_ACCESS: false,
    }),
    STARTER: Object.freeze({
      ACTIVE_JOB_LIMIT: 3,
      SEAT_LIMIT: 2,
      TALENT_RADAR_ACCESS: false,
      TALENT_CONTACT_ALLOWANCE: 0,
      JOB_BOOST_ALLOWANCE: 0,
      ANALYTICS_LEVEL: "BASIC",
      ENHANCED_COMPANY_PROFILE: false,
      EMPLOYER_IMPORT_ACCESS: false,
    }),
    PRO: Object.freeze({
      ACTIVE_JOB_LIMIT: 10,
      SEAT_LIMIT: 5,
      TALENT_RADAR_ACCESS: true,
      TALENT_CONTACT_ALLOWANCE: 10,
      JOB_BOOST_ALLOWANCE: 3,
      ANALYTICS_LEVEL: "ADVANCED",
      ENHANCED_COMPANY_PROFILE: true,
      EMPLOYER_IMPORT_ACCESS: false,
    }),
    BUSINESS: Object.freeze({
      ACTIVE_JOB_LIMIT: 30,
      SEAT_LIMIT: 15,
      TALENT_RADAR_ACCESS: true,
      TALENT_CONTACT_ALLOWANCE: 50,
      JOB_BOOST_ALLOWANCE: 10,
      ANALYTICS_LEVEL: "PRO",
      ENHANCED_COMPANY_PROFILE: true,
      EMPLOYER_IMPORT_ACCESS: false,
    }),
    ENTERPRISE_CONTRACT: Object.freeze({
      ACTIVE_JOB_LIMIT: 100,
      SEAT_LIMIT: 50,
      TALENT_RADAR_ACCESS: true,
      TALENT_CONTACT_ALLOWANCE: 100,
      JOB_BOOST_ALLOWANCE: 20,
      ANALYTICS_LEVEL: "PRO",
      ENHANCED_COMPANY_PROFILE: true,
      EMPLOYER_IMPORT_ACCESS: false,
    }),
  });

function entitlementFixture(
  version: PlanVersionFixture,
  key: EntitlementKey,
): PlanEntitlementFixture {
  const naturalKey = `${version.naturalKey}:${key}`;
  const base = {
    naturalKey,
    planVersionNaturalKey: version.naturalKey,
    key,
  } as const;
  const value = ENTITLEMENT_MATRIX[version.planCode][key];

  if (key === "ANALYTICS_LEVEL") {
    return Object.freeze({
      ...base,
      valueType: "ANALYTICS_LEVEL",
      booleanValue: null,
      integerValue: null,
      analyticsLevelValue: value as AnalyticsLevel,
    });
  }
  if (
    key === "TALENT_RADAR_ACCESS" ||
    key === "ENHANCED_COMPANY_PROFILE" ||
    key === "EMPLOYER_IMPORT_ACCESS"
  ) {
    return Object.freeze({
      ...base,
      valueType: "BOOLEAN",
      booleanValue: value as boolean,
      integerValue: null,
      analyticsLevelValue: null,
    });
  }
  return Object.freeze({
    ...base,
    valueType: "INTEGER",
    booleanValue: null,
    integerValue: value as number,
    analyticsLevelValue: null,
  });
}

export const PLAN_ENTITLEMENT_FIXTURES: readonly Readonly<PlanEntitlementFixture>[] =
  Object.freeze(
    PLAN_VERSION_FIXTURES.flatMap((version) =>
      ENTITLEMENT_KEYS.map((key) => entitlementFixture(version, key)),
    ),
  );
