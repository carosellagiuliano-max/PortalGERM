export const PERSONA_KINDS_V2 = ["CANDIDATE", "EMPLOYER"] as const;
export type PersonaKindV2 = (typeof PERSONA_KINDS_V2)[number];

export const PORTAL_CONTEXTS_V2 = [
  "CANDIDATE",
  "EMPLOYER",
  "ADMIN",
] as const;
export type PortalContextV2 = (typeof PORTAL_CONTEXTS_V2)[number];

export type LegacyIdentityRole =
  | "CANDIDATE"
  | "EMPLOYER"
  | "RECRUITER"
  | "ADMIN";

export type PersonaAssignmentView = Readonly<{
  id: string;
  kind: PersonaKindV2;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  version: number;
}>;

export type CompanyMembershipView = Readonly<{
  companyId: string;
  role: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
  status: "ACTIVE" | "SUSPENDED" | "REMOVED";
}>;

export function legacyPortalForRole(
  role: LegacyIdentityRole,
): PortalContextV2 {
  if (role === "CANDIDATE") return "CANDIDATE";
  if (role === "ADMIN") return "ADMIN";
  return "EMPLOYER";
}

export function personaKindForPortal(
  portal: PortalContextV2,
): PersonaKindV2 | null {
  return portal === "ADMIN" ? null : portal;
}

export function listAvailablePortalContexts(
  identityRole: LegacyIdentityRole,
  assignments: readonly PersonaAssignmentView[],
): readonly PortalContextV2[] {
  const available = new Set<PortalContextV2>();
  for (const assignment of assignments) {
    if (assignment.status === "ACTIVE") available.add(assignment.kind);
  }
  if (identityRole === "ADMIN") available.add("ADMIN");
  return Object.freeze(
    PORTAL_CONTEXTS_V2.filter((portal) => available.has(portal)),
  );
}

export function resolveDefaultPortalContext(
  identityRole: LegacyIdentityRole,
  assignments: readonly PersonaAssignmentView[],
): PortalContextV2 | null {
  const available = listAvailablePortalContexts(identityRole, assignments);
  const legacy = legacyPortalForRole(identityRole);
  if (available.includes(legacy)) return legacy;
  return available[0] ?? null;
}

export function isPortalContextAuthorized(input: Readonly<{
  identityRole: LegacyIdentityRole;
  userStatus: "ACTIVE" | "SUSPENDED" | "DELETED";
  portal: PortalContextV2;
  assignments: readonly PersonaAssignmentView[];
  hasCandidateProfile?: boolean;
}>): boolean {
  if (input.userStatus !== "ACTIVE") return false;
  if (input.portal === "ADMIN") return input.identityRole === "ADMIN";
  const assignment = input.assignments.find(
    ({ kind }) => kind === input.portal,
  );
  if (assignment?.status !== "ACTIVE") return false;
  return input.portal !== "CANDIDATE" || input.hasCandidateProfile !== false;
}

export function isCompanyTenantAuthorized(input: Readonly<{
  portalAuthorized: boolean;
  activeCompanyId: string | null;
  memberships: readonly CompanyMembershipView[];
}>): boolean {
  if (!input.portalAuthorized || input.activeCompanyId === null) return false;
  return input.memberships.some(
    (membership) =>
      membership.companyId === input.activeCompanyId &&
      membership.status === "ACTIVE",
  );
}

/**
 * Existing domain policies still accept the Phase-01 global role shape. During
 * dual read this adapter supplies the role of exactly the active request
 * context; it never unions capabilities across personas.
 */
export function effectiveLegacyRoleForContext(input: Readonly<{
  identityRole: LegacyIdentityRole;
  portal: PortalContextV2;
  membershipRole?: CompanyMembershipView["role"] | null;
}>): LegacyIdentityRole {
  if (input.portal === "CANDIDATE") return "CANDIDATE";
  if (input.portal === "ADMIN") {
    return input.identityRole === "ADMIN" ? "ADMIN" : input.identityRole;
  }
  return input.membershipRole === "RECRUITER" ? "RECRUITER" : "EMPLOYER";
}
