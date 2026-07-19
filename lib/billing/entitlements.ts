export const ENTITLEMENT_KEYS_V1 = [
  "ACTIVE_JOB_LIMIT",
  "SEAT_LIMIT",
  "TALENT_RADAR_ACCESS",
  "TALENT_CONTACT_ALLOWANCE",
  "JOB_BOOST_ALLOWANCE",
  "ANALYTICS_LEVEL",
  "ENHANCED_COMPANY_PROFILE",
  "EMPLOYER_IMPORT_ACCESS",
] as const;

export const CREDIT_FUNDING_SOURCES = [
  "PLAN_ALLOWANCE",
  "PURCHASED_PACK",
  "ADMIN_GRANT",
] as const;

export const CREDIT_TYPES = [
  "JOB_BOOST",
  "TALENT_CONTACT",
  "NEWSLETTER",
  "SOCIAL_PUSH",
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS_V1)[number];
export type EntitlementValueType = "BOOLEAN" | "INTEGER" | "ANALYTICS_LEVEL";
export type EntitlementIntegerMode = "ADD" | "REPLACE";
export type AnalyticsLevel = "NONE" | "BASIC" | "ADVANCED" | "PRO";
export type CreditFundingSource = (typeof CREDIT_FUNDING_SOURCES)[number];
export type CreditType = (typeof CREDIT_TYPES)[number];

export type EntitlementRights = Readonly<{
  ACTIVE_JOB_LIMIT: number;
  SEAT_LIMIT: number;
  TALENT_RADAR_ACCESS: boolean;
  TALENT_CONTACT_ALLOWANCE: number;
  JOB_BOOST_ALLOWANCE: number;
  ANALYTICS_LEVEL: AnalyticsLevel;
  ENHANCED_COMPANY_PROFILE: boolean;
  EMPLOYER_IMPORT_ACCESS: boolean;
}>;

export type FundableBySource = Readonly<
  Record<CreditFundingSource, Readonly<Record<CreditType, number>>>
>;

export type PlanEntitlementRecord = Readonly<{
  key: string;
  valueType: string;
  booleanValue: boolean | null;
  integerValue: number | null;
  analyticsLevelValue: string | null;
}>;

export type PlanVersionEntitlementSource = Readonly<{
  id: string;
  planSlug: string;
  isDefaultFree: boolean;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "INACTIVE";
  validFrom: Date;
  validTo: Date | null;
  entitlements: readonly PlanEntitlementRecord[];
}>;

export type SubscriptionEntitlementSource = Readonly<{
  id: string;
  companyId: string;
  status: "SCHEDULED" | "ACTIVE" | "CANCELLING" | "EXPIRED" | "CANCELLED";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  planVersion: PlanVersionEntitlementSource;
}>;

export type EntitlementGrantRecord = Readonly<{
  id: string;
  companyId: string;
  key: string;
  valueType: string;
  booleanValue: boolean | null;
  integerValue: number | null;
  analyticsLevelValue: string | null;
  integerMode: string | null;
  validFrom: Date;
  validTo: Date;
  revokedAt: Date | null;
  createdAt: Date;
}>;

export type FundableCreditRecord = Readonly<{
  fundingSource: string;
  creditType: string;
  available: number;
}>;

export type EntitlementResolutionInput = Readonly<{
  companyId: string;
  at: Date;
  defaultFreePlanVersions: readonly PlanVersionEntitlementSource[];
  subscriptions: readonly SubscriptionEntitlementSource[];
  grants: readonly EntitlementGrantRecord[];
  fundableCredits: readonly FundableCreditRecord[];
}>;

export type EffectiveEntitlements = Readonly<{
  companyId: string;
  resolvedAt: Date;
  source: Readonly<{
    kind: "DEFAULT_FREE" | "SUBSCRIPTION";
    planSlug: string;
    planVersionId: string;
    subscriptionId: string | null;
  }>;
  planRights: EntitlementRights;
  rights: EntitlementRights;
  appliedGrantIds: readonly string[];
  fundableBySource: FundableBySource;
}>;

export type EntitlementResolutionErrorCode =
  | "INVALID_INPUT"
  | "MISSING_DEFAULT_FREE"
  | "AMBIGUOUS_DEFAULT_FREE"
  | "AMBIGUOUS_SUBSCRIPTION"
  | "MISSING_ENTITLEMENT"
  | "DUPLICATE_ENTITLEMENT"
  | "UNKNOWN_ENTITLEMENT_KEY"
  | "ENTITLEMENT_TYPE_MISMATCH"
  | "INVALID_ENTITLEMENT_VALUE"
  | "INVALID_GRANT"
  | "GRANT_SCOPE_MISMATCH"
  | "GRANT_REDUCES_ACCESS"
  | "INVALID_LEDGER_SUMMARY";

export type EntitlementResolutionResult =
  | Readonly<{ ok: true; value: EffectiveEntitlements }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: EntitlementResolutionErrorCode;
        key?: string;
      }>;
    }>;

export type EntitlementRepository = Readonly<{
  listDefaultFreePlanVersions(at: Date): Promise<readonly PlanVersionEntitlementSource[]>;
  listCompanySubscriptions(
    companyId: string,
    at: Date,
  ): Promise<readonly SubscriptionEntitlementSource[]>;
  listCompanyEntitlementGrants(
    companyId: string,
    at: Date,
  ): Promise<readonly EntitlementGrantRecord[]>;
  listFundableCredits(
    companyId: string,
    at: Date,
  ): Promise<readonly FundableCreditRecord[]>;
}>;

const ENTITLEMENT_TYPES: Readonly<Record<EntitlementKey, EntitlementValueType>> = {
  ACTIVE_JOB_LIMIT: "INTEGER",
  SEAT_LIMIT: "INTEGER",
  TALENT_RADAR_ACCESS: "BOOLEAN",
  TALENT_CONTACT_ALLOWANCE: "INTEGER",
  JOB_BOOST_ALLOWANCE: "INTEGER",
  ANALYTICS_LEVEL: "ANALYTICS_LEVEL",
  ENHANCED_COMPANY_PROFILE: "BOOLEAN",
  EMPLOYER_IMPORT_ACCESS: "BOOLEAN",
};

const ANALYTICS_LEVELS = ["NONE", "BASIC", "ADVANCED", "PRO"] as const;
const ANALYTICS_LEVEL_RANK: Readonly<Record<AnalyticsLevel, number>> = {
  NONE: 0,
  BASIC: 1,
  ADVANCED: 2,
  PRO: 3,
};
const ENTITLEMENT_KEY_SET = new Set<string>(ENTITLEMENT_KEYS_V1);
const FUNDING_SOURCE_SET = new Set<string>(CREDIT_FUNDING_SOURCES);
const CREDIT_TYPE_SET = new Set<string>(CREDIT_TYPES);
const ANALYTICS_LEVEL_SET = new Set<string>(ANALYTICS_LEVELS);

export async function getEffectiveEntitlements(
  companyId: string,
  at: Date,
  repository: EntitlementRepository,
): Promise<EntitlementResolutionResult> {
  if (!isNonEmpty(companyId) || !isValidDate(at)) {
    return failure("INVALID_INPUT");
  }

  const [defaultFreePlanVersions, subscriptions, grants, fundableCredits] =
    await Promise.all([
      repository.listDefaultFreePlanVersions(at),
      repository.listCompanySubscriptions(companyId, at),
      repository.listCompanyEntitlementGrants(companyId, at),
      repository.listFundableCredits(companyId, at),
    ]);

  return resolveEffectiveEntitlements({
    companyId,
    at,
    defaultFreePlanVersions,
    subscriptions,
    grants,
    fundableCredits,
  });
}

export function resolveEffectiveEntitlements(
  input: EntitlementResolutionInput,
): EntitlementResolutionResult {
  if (!isNonEmpty(input.companyId) || !isValidDate(input.at)) {
    return failure("INVALID_INPUT");
  }

  const defaultCandidates = input.defaultFreePlanVersions.filter(
    (planVersion) =>
      planVersion.isDefaultFree &&
      planVersion.status === "ACTIVE" &&
      containsInstant(planVersion.validFrom, planVersion.validTo, input.at),
  );
  if (defaultCandidates.length === 0) {
    return failure("MISSING_DEFAULT_FREE");
  }
  if (defaultCandidates.length !== 1) {
    return failure("AMBIGUOUS_DEFAULT_FREE");
  }

  const effectiveSubscriptions = input.subscriptions.filter(
    (subscription) =>
      subscription.companyId === input.companyId &&
      (subscription.status === "ACTIVE" ||
        subscription.status === "CANCELLING") &&
      containsInstant(
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
        input.at,
      ),
  );
  if (effectiveSubscriptions.length > 1) {
    return failure("AMBIGUOUS_SUBSCRIPTION");
  }

  const defaultPlan = defaultCandidates[0];
  if (defaultPlan === undefined) {
    return failure("MISSING_DEFAULT_FREE");
  }
  const subscription = effectiveSubscriptions[0];
  const selectedPlan = subscription?.planVersion ?? defaultPlan;
  if (!isNonEmpty(selectedPlan.id) || !isNonEmpty(selectedPlan.planSlug)) {
    return failure("INVALID_INPUT");
  }
  const decodedPlan = decodeCompletePlanEntitlements(selectedPlan.entitlements);
  if (!decodedPlan.ok) {
    return decodedPlan;
  }

  const activeGrants = input.grants.filter((grant) => {
    if (
      grant.companyId !== input.companyId &&
      containsInstant(grant.validFrom, grant.validTo, input.at) &&
      grant.revokedAt === null
    ) {
      return true;
    }
    return (
      grant.companyId === input.companyId &&
      grant.revokedAt === null &&
      containsInstant(grant.validFrom, grant.validTo, input.at)
    );
  });

  if (activeGrants.some((grant) => grant.companyId !== input.companyId)) {
    return failure("GRANT_SCOPE_MISMATCH");
  }

  const applied = applyGrants(decodedPlan.value, activeGrants);
  if (!applied.ok) {
    return applied;
  }

  const fundableBySource = buildFundableBySource(input.fundableCredits);
  if (fundableBySource === null) {
    return failure("INVALID_LEDGER_SUMMARY");
  }

  return {
    ok: true,
    value: {
      companyId: input.companyId,
      resolvedAt: new Date(input.at.getTime()),
      source: {
        kind: subscription === undefined ? "DEFAULT_FREE" : "SUBSCRIPTION",
        planSlug: selectedPlan.planSlug,
        planVersionId: selectedPlan.id,
        subscriptionId: subscription?.id ?? null,
      },
      planRights: decodedPlan.value,
      rights: applied.value.rights,
      appliedGrantIds: applied.value.appliedGrantIds,
      fundableBySource,
    },
  };
}

function decodeCompletePlanEntitlements(
  rows: readonly PlanEntitlementRecord[],
):
  | Readonly<{ ok: true; value: EntitlementRights }>
  | Extract<EntitlementResolutionResult, { ok: false }> {
  const decoded = new Map<EntitlementKey, boolean | number | AnalyticsLevel>();

  for (const row of rows) {
    if (!isEntitlementKey(row.key)) {
      return failure("UNKNOWN_ENTITLEMENT_KEY", row.key);
    }
    if (decoded.has(row.key)) {
      return failure("DUPLICATE_ENTITLEMENT", row.key);
    }

    const value = decodeTypedValue(row.key, row);
    if (!value.ok) {
      return value;
    }
    decoded.set(row.key, value.value);
  }

  for (const key of ENTITLEMENT_KEYS_V1) {
    if (!decoded.has(key)) {
      return failure("MISSING_ENTITLEMENT", key);
    }
  }

  return {
    ok: true,
    value: {
      ACTIVE_JOB_LIMIT: decoded.get("ACTIVE_JOB_LIMIT") as number,
      SEAT_LIMIT: decoded.get("SEAT_LIMIT") as number,
      TALENT_RADAR_ACCESS: decoded.get("TALENT_RADAR_ACCESS") as boolean,
      TALENT_CONTACT_ALLOWANCE: decoded.get(
        "TALENT_CONTACT_ALLOWANCE",
      ) as number,
      JOB_BOOST_ALLOWANCE: decoded.get("JOB_BOOST_ALLOWANCE") as number,
      ANALYTICS_LEVEL: decoded.get("ANALYTICS_LEVEL") as AnalyticsLevel,
      ENHANCED_COMPANY_PROFILE: decoded.get(
        "ENHANCED_COMPANY_PROFILE",
      ) as boolean,
      EMPLOYER_IMPORT_ACCESS: decoded.get(
        "EMPLOYER_IMPORT_ACCESS",
      ) as boolean,
    },
  };
}

function decodeTypedValue(
  key: EntitlementKey,
  row: Pick<
    PlanEntitlementRecord,
    | "valueType"
    | "booleanValue"
    | "integerValue"
    | "analyticsLevelValue"
  >,
):
  | Readonly<{ ok: true; value: boolean | number | AnalyticsLevel }>
  | Extract<EntitlementResolutionResult, { ok: false }> {
  if (row.valueType !== ENTITLEMENT_TYPES[key]) {
    return failure("ENTITLEMENT_TYPE_MISMATCH", key);
  }

  const populatedValues = [
    row.booleanValue !== null,
    row.integerValue !== null,
    row.analyticsLevelValue !== null,
  ].filter(Boolean).length;
  if (populatedValues !== 1) {
    return failure("INVALID_ENTITLEMENT_VALUE", key);
  }

  if (row.valueType === "BOOLEAN") {
    return typeof row.booleanValue === "boolean"
      ? { ok: true, value: row.booleanValue }
      : failure("INVALID_ENTITLEMENT_VALUE", key);
  }

  if (row.valueType === "INTEGER") {
    return isNonNegativeSafeInteger(row.integerValue)
      ? { ok: true, value: row.integerValue }
      : failure("INVALID_ENTITLEMENT_VALUE", key);
  }

  return isAnalyticsLevel(row.analyticsLevelValue)
    ? { ok: true, value: row.analyticsLevelValue }
    : failure("INVALID_ENTITLEMENT_VALUE", key);
}

function applyGrants(
  planRights: EntitlementRights,
  grants: readonly EntitlementGrantRecord[],
):
  | Readonly<{
      ok: true;
      value: Readonly<{
        rights: EntitlementRights;
        appliedGrantIds: readonly string[];
      }>;
    }>
  | Extract<EntitlementResolutionResult, { ok: false }> {
  const seenIds = new Set<string>();
  const grouped = new Map<EntitlementKey, EntitlementGrantRecord[]>();

  for (const grant of grants) {
    if (!isNonEmpty(grant.id) || seenIds.has(grant.id)) {
      return failure("INVALID_GRANT", grant.key);
    }
    seenIds.add(grant.id);
    if (!isEntitlementKey(grant.key)) {
      return failure("UNKNOWN_ENTITLEMENT_KEY", grant.key);
    }
    const existing = grouped.get(grant.key) ?? [];
    existing.push(grant);
    grouped.set(grant.key, existing);
  }

  const rights: Record<EntitlementKey, boolean | number | AnalyticsLevel> = {
    ...planRights,
  };

  for (const key of ENTITLEMENT_KEYS_V1) {
    const keyGrants = grouped.get(key) ?? [];
    if (keyGrants.length === 0) {
      continue;
    }

    if (ENTITLEMENT_TYPES[key] === "INTEGER") {
      let replacement = rights[key] as number;
      let addition = 0;
      for (const grant of keyGrants) {
        const decoded = decodeTypedValue(key, grant);
        if (!decoded.ok || typeof decoded.value !== "number") {
          return decoded.ok
            ? failure("INVALID_GRANT", key)
            : decoded;
        }
        if (grant.integerMode !== "ADD" && grant.integerMode !== "REPLACE") {
          return failure("INVALID_GRANT", key);
        }
        if (grant.integerMode === "REPLACE") {
          if (decoded.value < (planRights[key] as number)) {
            return failure("GRANT_REDUCES_ACCESS", key);
          }
          replacement = Math.max(replacement, decoded.value);
        } else {
          addition += decoded.value;
          if (!Number.isSafeInteger(addition)) {
            return failure("INVALID_GRANT", key);
          }
        }
      }
      const total = replacement + addition;
      if (!Number.isSafeInteger(total)) {
        return failure("INVALID_GRANT", key);
      }
      rights[key] = total;
      continue;
    }

    let highestAnalyticsLevel = rights[key] as AnalyticsLevel;
    for (const grant of keyGrants) {
      if (grant.integerMode !== null) {
        return failure("INVALID_GRANT", key);
      }
      const decoded = decodeTypedValue(key, grant);
      if (!decoded.ok) {
        return decoded;
      }

      if (ENTITLEMENT_TYPES[key] === "BOOLEAN") {
        if (decoded.value !== true) {
          return failure("GRANT_REDUCES_ACCESS", key);
        }
        rights[key] = true;
      } else {
        const proposed = decoded.value as AnalyticsLevel;
        if (
          ANALYTICS_LEVEL_RANK[proposed] <
          ANALYTICS_LEVEL_RANK[planRights[key] as AnalyticsLevel]
        ) {
          return failure("GRANT_REDUCES_ACCESS", key);
        }
        if (
          ANALYTICS_LEVEL_RANK[proposed] >
          ANALYTICS_LEVEL_RANK[highestAnalyticsLevel]
        ) {
          highestAnalyticsLevel = proposed;
        }
      }
    }
    if (ENTITLEMENT_TYPES[key] === "ANALYTICS_LEVEL") {
      rights[key] = highestAnalyticsLevel;
    }
  }

  return {
    ok: true,
    value: {
      rights: rights as EntitlementRights,
      appliedGrantIds: grants
        .slice()
        .sort(compareGrants)
        .map((grant) => grant.id),
    },
  };
}

function buildFundableBySource(
  records: readonly FundableCreditRecord[],
): FundableBySource | null {
  const result: Record<
    CreditFundingSource,
    Record<CreditType, number>
  > = {
    PLAN_ALLOWANCE: emptyCreditTypeRecord(),
    PURCHASED_PACK: emptyCreditTypeRecord(),
    ADMIN_GRANT: emptyCreditTypeRecord(),
  };

  for (const record of records) {
    if (
      !isCreditFundingSource(record.fundingSource) ||
      !isCreditType(record.creditType) ||
      !isNonNegativeSafeInteger(record.available)
    ) {
      return null;
    }
    const current = result[record.fundingSource][record.creditType];
    const next = current + record.available;
    if (!Number.isSafeInteger(next)) {
      return null;
    }
    result[record.fundingSource][record.creditType] = next;
  }
  return result;
}

function emptyCreditTypeRecord(): Record<CreditType, number> {
  return {
    JOB_BOOST: 0,
    TALENT_CONTACT: 0,
    NEWSLETTER: 0,
    SOCIAL_PUSH: 0,
  };
}

function compareGrants(
  left: EntitlementGrantRecord,
  right: EntitlementGrantRecord,
): number {
  return (
    left.validFrom.getTime() - right.validFrom.getTime() ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function containsInstant(
  validFrom: Date,
  validTo: Date | null,
  at: Date,
): boolean {
  if (
    !isValidDate(validFrom) ||
    (validTo !== null && !isValidDate(validTo)) ||
    (validTo !== null && validFrom.getTime() >= validTo.getTime())
  ) {
    return false;
  }
  return (
    validFrom.getTime() <= at.getTime() &&
    (validTo === null || at.getTime() < validTo.getTime())
  );
}

function isEntitlementKey(value: string): value is EntitlementKey {
  return ENTITLEMENT_KEY_SET.has(value);
}

function isAnalyticsLevel(value: string | null): value is AnalyticsLevel {
  return value !== null && ANALYTICS_LEVEL_SET.has(value);
}

function isCreditFundingSource(value: string): value is CreditFundingSource {
  return FUNDING_SOURCE_SET.has(value);
}

function isCreditType(value: string): value is CreditType {
  return CREDIT_TYPE_SET.has(value);
}

function isNonNegativeSafeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isNonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function failure(
  code: EntitlementResolutionErrorCode,
  key?: string,
): Extract<EntitlementResolutionResult, { ok: false }> {
  return {
    ok: false,
    error: {
      code,
      ...(key === undefined ? {} : { key }),
    },
  };
}
