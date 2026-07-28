import "server-only";

import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  ADMIN_CAPABILITIES_V1,
  type AdminCapability,
  type AdminCapabilityActor,
} from "@/lib/admin/capabilities";

export const ADMIN_GRANTS_POLICY_V2 = "ADMIN_GRANTS_POLICY_V2";

export const ADMIN_ROLE_CATALOG_V2 = Object.freeze({
  PLATFORM_OPERATOR: Object.freeze({
    duty: "PLATFORM",
    capabilities: Object.freeze([
      "ADMIN_OVERVIEW_READ",
      "ADMIN_GLOBAL_SEARCH",
      "ADMIN_USER_MODERATE",
      "ADMIN_COMPANY_REVIEW",
      "ADMIN_LEAD_MANAGE",
      "ADMIN_COCKPIT_READ",
      "ADMIN_OPS_READ",
      "ADMIN_AUDIT_READ",
      "ADMIN_SYSTEM_TASK_MANAGE",
      "ADMIN_ANALYTICS_READ",
    ] satisfies readonly AdminCapability[]),
  }),
  JOB_MODERATOR: Object.freeze({
    duty: "MODERATION",
    capabilities: Object.freeze([
      "ADMIN_JOB_REVIEW",
      "ADMIN_JOB_PUBLISH",
      "ADMIN_JOB_BOOST_MANAGE",
      "ADMIN_COMPANY_MODERATE",
      "ADMIN_CLAIM_REVIEW",
      "ADMIN_REPORT_REVIEW",
      "ADMIN_RESTRICTION_MANAGE",
      "ADMIN_SLA_PROJECT",
    ] satisfies readonly AdminCapability[]),
  }),
  SUPPORT_AGENT: Object.freeze({
    duty: "SUPPORT",
    capabilities: Object.freeze([
      "ADMIN_SUPPORT_MANAGE",
    ] satisfies readonly AdminCapability[]),
  }),
  CONTENT_SUPPLY_OPERATOR: Object.freeze({
    duty: "CONTENT_SUPPLY",
    capabilities: Object.freeze([
      "ADMIN_TAXONOMY_MANAGE",
      "ADMIN_LICENSED_IMPORT",
      "ADMIN_IMPORT_SETUP_APPROVE",
      "ADMIN_CONTENT_MANAGE",
      "ADMIN_CLUSTER_PRODUCT_APPROVE",
      "ADMIN_CLUSTER_OPS_APPROVE",
      "ADMIN_CLUSTER_ACTIVATE",
    ] satisfies readonly AdminCapability[]),
  }),
  FINANCE_OPERATOR: Object.freeze({
    duty: "FINANCE",
    capabilities: Object.freeze([
      "ADMIN_BILLING_READ",
      "ADMIN_BILLING_MUTATE",
      "ADMIN_CATALOG_READ",
      "ADMIN_CATALOG_MUTATE",
      "ADMIN_INVOICE_MUTATE",
      "ADMIN_CREDITS_GRANT",
      "ADMIN_CREDIT_REVERSE",
    ] satisfies readonly AdminCapability[]),
  }),
  PRIVACY_VERIFIER: Object.freeze({
    duty: "PRIVACY_VERIFY",
    capabilities: Object.freeze([
      "ADMIN_LEGAL_READ",
      "ADMIN_LEGAL_REVIEW",
      "PRIVACY_CASE_READ",
      "PRIVACY_CASE_VERIFY",
      "PRIVACY_HOLD_MANAGE",
    ] satisfies readonly AdminCapability[]),
  }),
  PRIVACY_PROCESSOR: Object.freeze({
    duty: "PRIVACY_PROCESS",
    capabilities: Object.freeze([
      "ADMIN_LEGAL_READ",
      "ADMIN_LEGAL_DRAFT",
      "ADMIN_LEGAL_PUBLISH",
      "PRIVACY_CASE_READ",
      "PRIVACY_CASE_PROCESS",
      "PRIVACY_EXECUTION_APPROVE",
    ] satisfies readonly AdminCapability[]),
  }),
  SECURITY_ADMIN: Object.freeze({
    duty: "SECURITY",
    capabilities: Object.freeze([
      "ADMIN_SECURITY_READ",
      "ADMIN_SECURITY_GRANT",
      "ADMIN_SECURITY_APPROVE",
      "ADMIN_AUTHENTICATOR_RESET",
      "ADMIN_BREAK_GLASS_MANAGE",
      "ADMIN_AUDIT_READ",
    ] satisfies readonly AdminCapability[]),
  }),
  TRUST_SAFETY_REVIEWER: Object.freeze({
    duty: "TRUST_SAFETY",
    capabilities: Object.freeze([
      "TRUST_SAFETY_READ",
      "TRUST_SAFETY_REVIEW",
      "COMPANY_VERIFICATION_REVIEW",
      "ADMIN_REPORT_REVIEW",
      "ADMIN_RESTRICTION_MANAGE",
    ] satisfies readonly AdminCapability[]),
  }),
  TRUST_SAFETY_APPROVER: Object.freeze({
    duty: "SECURITY",
    capabilities: Object.freeze([
      "TRUST_SAFETY_READ",
      "TRUST_SAFETY_RESTORE",
      "COMPANY_VERIFICATION_APPROVE",
      "ADMIN_SECURITY_APPROVE",
      "ADMIN_AUDIT_READ",
    ] satisfies readonly AdminCapability[]),
  }),
} as const);

export type AdminRoleCode = keyof typeof ADMIN_ROLE_CATALOG_V2;
export type AdminDutyV2 =
  (typeof ADMIN_ROLE_CATALOG_V2)[AdminRoleCode]["duty"];

export const ADMIN_DUTY_CONFLICTS_V2 = Object.freeze([
  Object.freeze(["PRIVACY_VERIFY", "PRIVACY_PROCESS"] as const),
  Object.freeze(["FINANCE", "SECURITY"] as const),
  Object.freeze(["TRUST_SAFETY", "SECURITY"] as const),
] as const);

export type ResolvedAdminActor = AdminCapabilityActor &
  Readonly<{
    capabilities: readonly AdminCapability[];
    duties: readonly AdminDutyV2[];
    breakGlassGrantIds: readonly string[];
    policyVersion: typeof ADMIN_GRANTS_POLICY_V2;
  }>;

export async function resolveAdminActor(
  database: DatabaseClient | Prisma.TransactionClient,
  actor: Readonly<{ userId: string; role: string; status: string }>,
  now = new Date(),
): Promise<ResolvedAdminActor> {
  if (
    actor.role !== "ADMIN" ||
    actor.status !== "ACTIVE" ||
    !Number.isFinite(now.getTime())
  ) {
    return emptyResolvedActor(actor);
  }

  const [assignments, directGrants, breakGlass] = await Promise.all([
    database.adminRoleAssignment.findMany({
      where: {
        userId: actor.userId,
        revokedAt: null,
        validFrom: { lte: now },
        validTo: { gt: now },
        adminRole: { active: true, policyVersion: ADMIN_GRANTS_POLICY_V2 },
      },
      orderBy: [{ adminRole: { code: "asc" } }, { id: "asc" }],
      select: {
        adminRole: {
          select: {
            duty: true,
            capabilities: {
              orderBy: { capability: "asc" },
              select: { capability: true },
            },
          },
        },
      },
    }),
    database.adminCapabilityGrant.findMany({
      where: {
        userId: actor.userId,
        revokedAt: null,
        validFrom: { lte: now },
        validTo: { gt: now },
      },
      orderBy: [{ capability: "asc" }, { id: "asc" }],
      select: { capability: true, duty: true },
    }),
    database.breakGlassGrant.findMany({
      where: {
        userId: actor.userId,
        status: "ACTIVE",
        revokedAt: null,
        validFrom: { lte: now },
        validTo: { gt: now },
      },
      orderBy: { id: "asc" },
      select: { id: true, capabilities: true },
    }),
  ]);

  const knownCapabilities = new Set<string>(ADMIN_CAPABILITIES_V1);
  const capabilities = new Set<AdminCapability>();
  const duties = new Set<AdminDutyV2>();

  for (const assignment of assignments) {
    duties.add(assignment.adminRole.duty as AdminDutyV2);
    for (const row of assignment.adminRole.capabilities) {
      if (knownCapabilities.has(row.capability)) {
        capabilities.add(row.capability as AdminCapability);
      }
    }
  }
  for (const grant of directGrants) {
    if (knownCapabilities.has(grant.capability)) {
      capabilities.add(grant.capability as AdminCapability);
      duties.add(grant.duty as AdminDutyV2);
    }
  }
  for (const grant of breakGlass) {
    for (const capability of grant.capabilities) {
      if (knownCapabilities.has(capability)) {
        capabilities.add(capability as AdminCapability);
      }
    }
  }

  return Object.freeze({
    ...actor,
    capabilities: Object.freeze([...capabilities].sort()),
    duties: Object.freeze([...duties].sort()),
    breakGlassGrantIds: Object.freeze(breakGlass.map(({ id }) => id)),
    policyVersion: ADMIN_GRANTS_POLICY_V2,
  });
}

export function dutiesConflict(
  existing: readonly AdminDutyV2[],
  requested: AdminDutyV2,
): boolean {
  return ADMIN_DUTY_CONFLICTS_V2.some(
    ([left, right]) =>
      (requested === left && existing.includes(right)) ||
      (requested === right && existing.includes(left)),
  );
}

function emptyResolvedActor(
  actor: Readonly<{ userId: string; role: string; status: string }>,
): ResolvedAdminActor {
  return Object.freeze({
    ...actor,
    capabilities: Object.freeze([]),
    duties: Object.freeze([]),
    breakGlassGrantIds: Object.freeze([]),
    policyVersion: ADMIN_GRANTS_POLICY_V2,
  });
}
