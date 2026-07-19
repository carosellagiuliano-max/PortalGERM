import type {
  EffectiveEntitlements,
  EntitlementRights,
  FundableBySource,
  PlanEntitlementRecord,
  PlanVersionEntitlementSource,
} from "@/lib/billing/entitlements";

export const AT = new Date("2026-07-19T12:00:00.000Z");
export const COMPANY_ID = "company-1";

export const FREE_RIGHTS: EntitlementRights = {
  ACTIVE_JOB_LIMIT: 1,
  SEAT_LIMIT: 1,
  TALENT_RADAR_ACCESS: false,
  TALENT_CONTACT_ALLOWANCE: 0,
  JOB_BOOST_ALLOWANCE: 0,
  ANALYTICS_LEVEL: "NONE",
  ENHANCED_COMPANY_PROFILE: false,
  EMPLOYER_IMPORT_ACCESS: false,
};

export const PRO_RIGHTS: EntitlementRights = {
  ACTIVE_JOB_LIMIT: 10,
  SEAT_LIMIT: 5,
  TALENT_RADAR_ACCESS: true,
  TALENT_CONTACT_ALLOWANCE: 10,
  JOB_BOOST_ALLOWANCE: 3,
  ANALYTICS_LEVEL: "ADVANCED",
  ENHANCED_COMPANY_PROFILE: true,
  EMPLOYER_IMPORT_ACCESS: false,
};

export function entitlementRows(
  rights: EntitlementRights,
): PlanEntitlementRecord[] {
  return [
    integerRow("ACTIVE_JOB_LIMIT", rights.ACTIVE_JOB_LIMIT),
    integerRow("SEAT_LIMIT", rights.SEAT_LIMIT),
    booleanRow("TALENT_RADAR_ACCESS", rights.TALENT_RADAR_ACCESS),
    integerRow("TALENT_CONTACT_ALLOWANCE", rights.TALENT_CONTACT_ALLOWANCE),
    integerRow("JOB_BOOST_ALLOWANCE", rights.JOB_BOOST_ALLOWANCE),
    {
      key: "ANALYTICS_LEVEL",
      valueType: "ANALYTICS_LEVEL",
      booleanValue: null,
      integerValue: null,
      analyticsLevelValue: rights.ANALYTICS_LEVEL,
    },
    booleanRow(
      "ENHANCED_COMPANY_PROFILE",
      rights.ENHANCED_COMPANY_PROFILE,
    ),
    booleanRow("EMPLOYER_IMPORT_ACCESS", rights.EMPLOYER_IMPORT_ACCESS),
  ];
}

export function planVersion(
  overrides: Partial<PlanVersionEntitlementSource> = {},
): PlanVersionEntitlementSource {
  return {
    id: "plan-version-free-1",
    planSlug: "free",
    isDefaultFree: true,
    status: "ACTIVE",
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validTo: null,
    entitlements: entitlementRows(FREE_RIGHTS),
    ...overrides,
  };
}

export function emptyFundableBySource(): FundableBySource {
  return {
    PLAN_ALLOWANCE: creditRecord(),
    PURCHASED_PACK: creditRecord(),
    ADMIN_GRANT: creditRecord(),
  };
}

export function effectiveEntitlements(
  overrides: Partial<EffectiveEntitlements> = {},
): EffectiveEntitlements {
  return {
    companyId: COMPANY_ID,
    resolvedAt: new Date(AT),
    source: {
      kind: "SUBSCRIPTION",
      planSlug: "pro",
      planVersionId: "plan-version-pro-1",
      subscriptionId: "subscription-1",
    },
    planRights: PRO_RIGHTS,
    rights: PRO_RIGHTS,
    appliedGrantIds: [],
    fundableBySource: emptyFundableBySource(),
    ...overrides,
  };
}

function integerRow(key: string, integerValue: number): PlanEntitlementRecord {
  return {
    key,
    valueType: "INTEGER",
    booleanValue: null,
    integerValue,
    analyticsLevelValue: null,
  };
}

function booleanRow(key: string, booleanValue: boolean): PlanEntitlementRecord {
  return {
    key,
    valueType: "BOOLEAN",
    booleanValue,
    integerValue: null,
    analyticsLevelValue: null,
  };
}

function creditRecord() {
  return {
    JOB_BOOST: 0,
    TALENT_CONTACT: 0,
    NEWSLETTER: 0,
    SOCIAL_PUSH: 0,
  };
}
