import type {
  EffectiveEntitlements,
  FundableBySource,
} from "@/lib/billing/entitlements";

export type FeatureGateReason =
  | "INVALID_INPUT"
  | "ACTIVE_JOB_LIMIT_REACHED"
  | "ADDITIONAL_JOB_PERMIT_REQUIRED"
  | "ADDITIONAL_JOB_PERMIT_INVALID"
  | "REVISION_VALIDITY_INVALID"
  | "TALENT_RADAR_NOT_INCLUDED"
  | "CONTACT_FUNDING_UNAVAILABLE"
  | "PLATFORM_IMPORT_CAPABILITY_REQUIRED"
  | "SOURCE_RIGHTS_REQUIRED"
  | "EMPLOYER_IMPORT_DISABLED"
  | "EMPLOYER_IMPORT_PLAN_REQUIRED"
  | "EMPLOYER_IMPORT_GRANT_REQUIRED"
  | "ADVANCED_ANALYTICS_NOT_INCLUDED";

export type FeatureGateResult = Readonly<{
  allowed: boolean;
  reason?: FeatureGateReason;
  suggestedProductSlug?: string;
  suggestedPlanSlug?: string;
}>;

export type AdditionalJobPermitSummary = Readonly<{
  companyId: string;
  targetJobId: string;
  status: "SCHEDULED" | "ACTIVE" | "CONSUMED" | "EXPIRED" | "REVOKED";
  validFrom: Date;
  validTo: Date;
  revokedAt: Date | null;
}>;

export type ImportAccessGrantSummary = Readonly<{
  companyId: string;
  sourceId: string;
  status: "SCHEDULED" | "ACTIVE" | "EXPIRED" | "REVOKED";
  validFrom: Date;
  validTo: Date;
  revokedAt: Date | null;
}>;

export type PlatformImportCapabilities = Readonly<{
  canRunLicensedSupplyImport: boolean;
}>;

export type LicensedSourceRights = Readonly<{
  sourceId: string;
  hasDocumentedLicense: boolean;
  hasDocumentedProvenance: boolean;
  validFrom: Date;
  validTo: Date | null;
  revokedAt: Date | null;
  at: Date;
}>;

const MAXIMUM_PUBLICATION_DAYS = 90;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const EMPLOYER_IMPORT_PLAN_SLUGS = new Set(["business", "enterprise"]);

export function canPublishJob({
  effectiveEntitlements,
  currentActiveCount,
  jobId,
  revisionValidThrough,
  additionalJobPermit,
}: Readonly<{
  effectiveEntitlements: EffectiveEntitlements;
  currentActiveCount: number;
  jobId: string;
  revisionValidThrough: Date | null;
  additionalJobPermit?: AdditionalJobPermitSummary | null;
}>): FeatureGateResult {
  const now = effectiveEntitlements.resolvedAt;
  if (
    !Number.isSafeInteger(currentActiveCount) ||
    currentActiveCount < 0 ||
    jobId.trim().length === 0
  ) {
    return denied("INVALID_INPUT");
  }
  if (
    !isValidDate(revisionValidThrough) ||
    revisionValidThrough.getTime() <= now.getTime() ||
    revisionValidThrough.getTime() >
      now.getTime() + MAXIMUM_PUBLICATION_DAYS * MILLISECONDS_PER_DAY
  ) {
    return denied("REVISION_VALIDITY_INVALID");
  }

  const limit = effectiveEntitlements.rights.ACTIVE_JOB_LIMIT;
  if (currentActiveCount < limit) {
    return allowed();
  }

  if (additionalJobPermit === undefined || additionalJobPermit === null) {
    return denied("ACTIVE_JOB_LIMIT_REACHED", {
      suggestedProductSlug: "additional-job-30d",
      suggestedPlanSlug: "pro",
    });
  }

  if (currentActiveCount > limit) {
    return denied("ADDITIONAL_JOB_PERMIT_REQUIRED", {
      suggestedPlanSlug: "pro",
    });
  }

  const permitIsCurrent =
    additionalJobPermit.companyId === effectiveEntitlements.companyId &&
    additionalJobPermit.targetJobId === jobId &&
    additionalJobPermit.status === "ACTIVE" &&
    additionalJobPermit.revokedAt === null &&
    isValidHalfOpenRange(
      additionalJobPermit.validFrom,
      additionalJobPermit.validTo,
      now,
    ) &&
    revisionValidThrough.getTime() <= additionalJobPermit.validTo.getTime();
  return permitIsCurrent
    ? allowed()
    : denied("ADDITIONAL_JOB_PERMIT_INVALID", {
        suggestedProductSlug: "additional-job-30d",
        suggestedPlanSlug: "pro",
      });
}

export function canUseTalentRadar(
  effectiveEntitlements: EffectiveEntitlements,
): FeatureGateResult {
  return effectiveEntitlements.rights.TALENT_RADAR_ACCESS
    ? allowed()
    : denied("TALENT_RADAR_NOT_INCLUDED", { suggestedPlanSlug: "pro" });
}

export function canRequestContact(
  effectiveEntitlements: EffectiveEntitlements,
  fundableGrantSummary: FundableBySource,
): FeatureGateResult {
  const radarGate = canUseTalentRadar(effectiveEntitlements);
  if (!radarGate.allowed) {
    return radarGate;
  }

  const balances = [
    fundableGrantSummary.PLAN_ALLOWANCE.TALENT_CONTACT,
    fundableGrantSummary.PURCHASED_PACK.TALENT_CONTACT,
    fundableGrantSummary.ADMIN_GRANT.TALENT_CONTACT,
  ];
  const balancesAreValid = balances.every(
    (balance) => Number.isSafeInteger(balance) && balance >= 0,
  );
  const available = balances.reduce((sum, balance) => sum + balance, 0);
  return balancesAreValid && Number.isSafeInteger(available) && available > 0
    ? allowed()
    : denied("CONTACT_FUNDING_UNAVAILABLE", {
        suggestedProductSlug: "contact-pack-10",
      });
}

export function canRunLicensedSupplyImport(
  platformCapabilities: PlatformImportCapabilities,
  sourceRights: LicensedSourceRights,
): FeatureGateResult {
  if (!platformCapabilities.canRunLicensedSupplyImport) {
    return denied("PLATFORM_IMPORT_CAPABILITY_REQUIRED");
  }

  const rightsAreCurrent =
    sourceRights.sourceId.trim().length > 0 &&
    sourceRights.hasDocumentedLicense &&
    sourceRights.hasDocumentedProvenance &&
    sourceRights.revokedAt === null &&
    isValidOpenEndedHalfOpenRange(
      sourceRights.validFrom,
      sourceRights.validTo,
      sourceRights.at,
    );
  return rightsAreCurrent ? allowed() : denied("SOURCE_RIGHTS_REQUIRED");
}

export function canUseEmployerImport({
  effectiveEntitlements,
  currentPlanSlug,
  companyId,
  sourceId,
  accessGrant,
}: Readonly<{
  effectiveEntitlements: EffectiveEntitlements;
  currentPlanSlug: string;
  companyId: string;
  sourceId: string;
  accessGrant?: ImportAccessGrantSummary | null;
}>): FeatureGateResult {
  if (
    effectiveEntitlements.companyId !== companyId ||
    companyId.trim().length === 0 ||
    sourceId.trim().length === 0
  ) {
    return denied("INVALID_INPUT");
  }

  // Only the selected PlanVersion may supply this plan right. A global
  // EntitlementGrant deliberately cannot substitute for an eligible plan.
  if (!effectiveEntitlements.planRights.EMPLOYER_IMPORT_ACCESS) {
    return denied("EMPLOYER_IMPORT_DISABLED", { suggestedPlanSlug: "business" });
  }
  const normalizedPlanSlug = currentPlanSlug.trim().toLowerCase();
  if (
    normalizedPlanSlug !==
      effectiveEntitlements.source.planSlug.trim().toLowerCase() ||
    !EMPLOYER_IMPORT_PLAN_SLUGS.has(normalizedPlanSlug)
  ) {
    return denied("EMPLOYER_IMPORT_PLAN_REQUIRED", {
      suggestedPlanSlug: "business",
    });
  }

  const now = effectiveEntitlements.resolvedAt;
  const grantIsCurrent =
    accessGrant !== undefined &&
    accessGrant !== null &&
    accessGrant.companyId === companyId &&
    accessGrant.sourceId === sourceId &&
    accessGrant.status === "ACTIVE" &&
    accessGrant.revokedAt === null &&
    isValidHalfOpenRange(accessGrant.validFrom, accessGrant.validTo, now);
  return grantIsCurrent
    ? allowed()
    : denied("EMPLOYER_IMPORT_GRANT_REQUIRED", {
        suggestedProductSlug: "import-setup",
        suggestedPlanSlug: "business",
      });
}

export function canUseAdvancedAnalytics(
  effectiveEntitlements: EffectiveEntitlements,
): FeatureGateResult {
  const level = effectiveEntitlements.rights.ANALYTICS_LEVEL;
  return level === "ADVANCED" || level === "PRO"
    ? allowed()
    : denied("ADVANCED_ANALYTICS_NOT_INCLUDED", {
        suggestedPlanSlug: "pro",
      });
}

function allowed(): FeatureGateResult {
  return { allowed: true };
}

function denied(
  reason: FeatureGateReason,
  suggestions: Readonly<{
    suggestedProductSlug?: string;
    suggestedPlanSlug?: string;
  }> = {},
): FeatureGateResult {
  return { allowed: false, reason, ...suggestions };
}

function isValidHalfOpenRange(
  validFrom: Date,
  validTo: Date,
  at: Date,
): boolean {
  return (
    isValidDate(validFrom) &&
    isValidDate(validTo) &&
    validFrom.getTime() < validTo.getTime() &&
    validFrom.getTime() <= at.getTime() &&
    at.getTime() < validTo.getTime()
  );
}

function isValidOpenEndedHalfOpenRange(
  validFrom: Date,
  validTo: Date | null,
  at: Date,
): boolean {
  return (
    isValidDate(validFrom) &&
    isValidDate(at) &&
    (validTo === null ||
      (isValidDate(validTo) && validFrom.getTime() < validTo.getTime())) &&
    validFrom.getTime() <= at.getTime() &&
    (validTo === null || at.getTime() < validTo.getTime())
  );
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
