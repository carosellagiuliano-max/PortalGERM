export const ADMIN_CAPABILITIES_V1 = [
  "ADMIN_OVERVIEW_READ",
  "ADMIN_GLOBAL_SEARCH",
  "ADMIN_JOB_REVIEW",
  "ADMIN_JOB_PUBLISH",
  "ADMIN_COMPANY_REVIEW",
  "ADMIN_COMPANY_MODERATE",
  "ADMIN_CLAIM_REVIEW",
  "ADMIN_USER_MODERATE",
  "ADMIN_TAXONOMY_MANAGE",
  "ADMIN_REPORT_REVIEW",
  "ADMIN_RESTRICTION_MANAGE",
  "ADMIN_LICENSED_IMPORT",
  "ADMIN_IMPORT_SETUP_APPROVE",
  "ADMIN_SUPPORT_MANAGE",
  "ADMIN_CONTENT_MANAGE",
  "ADMIN_CLUSTER_PRODUCT_APPROVE",
  "ADMIN_CLUSTER_OPS_APPROVE",
  "ADMIN_CLUSTER_ACTIVATE",
  "ADMIN_LEAD_MANAGE",
  "ADMIN_COCKPIT_READ",
  "ADMIN_SLA_PROJECT",
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES_V1)[number];

export type AdminCapabilityActor = Readonly<{
  userId: string;
  role: string;
  status: string;
}>;

/**
 * Phase 11 deliberately has one global Platform-Admin role, but every use case
 * still names its capability so a later Support/Moderator/Sales split can be
 * introduced without changing domain commands or audit evidence.
 */
export function hasAdminCapability(
  actor: AdminCapabilityActor,
  capability: AdminCapability,
): boolean {
  return (
    actor.role === "ADMIN" &&
    actor.status === "ACTIVE" &&
    ADMIN_CAPABILITIES_V1.includes(capability)
  );
}

export const PHASE_11_FORBIDDEN_ADMIN_CAPABILITIES = Object.freeze([
  "ADMIN_BILLING_MUTATE",
  "ADMIN_CATALOG_MUTATE",
  "ADMIN_INVOICE_MUTATE",
  "ADMIN_CREDITS_GRANT",
  "ADMIN_GLOBAL_ROLE_MUTATE",
] as const);

export function canRunLicensedSupplyImport(actor: AdminCapabilityActor): boolean {
  return hasAdminCapability(actor, "ADMIN_LICENSED_IMPORT");
}

/** Commercial employer imports are not packaged for any P0 plan. */
export function canUseEmployerImport(): false {
  return false;
}
