export const STEP_UP_POLICY_VERSION = "STEP_UP_POLICY_V1";

export type StepUpRole = "ADMIN" | "CANDIDATE" | "EMPLOYER" | "RECRUITER";

export type StepUpPolicy = Readonly<{
  code: string;
  purpose: string;
  actionPattern: RegExp;
  roles: readonly StepUpRole[];
  tenant: "FORBIDDEN" | "OPTIONAL" | "REQUIRED";
  resource: "FORBIDDEN" | "OPTIONAL" | "REQUIRED";
  maximumAssuranceAgeMilliseconds: number;
  grantTtlMilliseconds: number;
  requiredLevel: "AAL2";
  policyVersion: typeof STEP_UP_POLICY_VERSION;
}>;

const FIVE_MINUTES = 5 * 60_000;
const TEN_MINUTES = 10 * 60_000;

export const STEP_UP_POLICIES_V1: readonly StepUpPolicy[] = Object.freeze([
  policy(
    "EMPLOYER_PAID_CHECKOUT",
    "PAID_CHECKOUT",
    /^CHECKOUT:[a-f0-9]{55}$/u,
    ["EMPLOYER", "RECRUITER"],
    "REQUIRED",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "EMPLOYER_BILLING_PROFILE",
    "EMPLOYER_BILLING",
    /^BILLING_(CHECKOUT_CREATE|PROFILE_CHANGE|PLAN_CHANGE|SUBSCRIPTION_CANCEL|PAYMENT_METHOD_CHANGE)$/u,
    ["EMPLOYER", "RECRUITER"],
    "REQUIRED",
    "REQUIRED",
    TEN_MINUTES,
  ),
  policy(
    "EMPLOYER_TEAM",
    "EMPLOYER_TEAM",
    /^TEAM_(INVITE|ROLE_CHANGE|MEMBER_REMOVE|OWNER_CHANGE)$/u,
    ["EMPLOYER", "RECRUITER"],
    "REQUIRED",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "EMPLOYER_COMPANY_TRUST",
    "EMPLOYER_COMPANY_TRUST",
    /^COMPANY_(TRUST|VERIFICATION|DOMAIN|LEGAL_NAME)_CHANGE$/u,
    ["EMPLOYER", "RECRUITER"],
    "REQUIRED",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "EMPLOYER_EXPORT",
    "EMPLOYER_EXPORT",
    /^(EMPLOYER_BULK_EXPORT|RADAR_EXPORT|RADAR_REVEAL)$/u,
    ["EMPLOYER", "RECRUITER"],
    "REQUIRED",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "ACCOUNT_LOGIN_EMAIL",
    "ACCOUNT_SECURITY",
    /^(LOGIN_EMAIL_CHANGE|ACCOUNT_RECOVERY)$/u,
    ["CANDIDATE", "EMPLOYER", "RECRUITER"],
    "OPTIONAL",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "IDENTITY_CANDIDATE_PERSONA",
    "IDENTITY_PERSONA",
    /^PERSONA_CANDIDATE_CREATE$/u,
    ["EMPLOYER", "RECRUITER", "ADMIN"],
    "FORBIDDEN",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "IDENTITY_EMPLOYER_PERSONA",
    "IDENTITY_PERSONA",
    /^PERSONA_EMPLOYER_CREATE$/u,
    ["CANDIDATE", "EMPLOYER", "RECRUITER", "ADMIN"],
    "REQUIRED",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "CANDIDATE_PRIVACY",
    "CANDIDATE_PRIVACY",
    /^PRIVACY_(EXPORT|DELETE|CORRECT)$/u,
    ["CANDIDATE"],
    "FORBIDDEN",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "CANDIDATE_CONSENT",
    "CANDIDATE_TRUST",
    /^(CONSENT_CRITICAL_CHANGE|RADAR_CONSENT_CHANGE)$/u,
    ["CANDIDATE"],
    "FORBIDDEN",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "CANDIDATE_IDENTITY_REVEAL",
    "CANDIDATE_TRUST",
    /^IDENTITY_REVEAL$/u,
    ["CANDIDATE"],
    "REQUIRED",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "ADMIN_FINANCE_REFUND",
    "FINANCE_REFUND",
    /^FINANCE_REFUND_(REQUEST|APPROVE):[A-Za-z0-9:_-]{1,70}$/u,
    ["ADMIN"],
    "REQUIRED",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "ADMIN_PRIVACY_EXECUTION",
    "ADMIN_PRIVACY",
    /^PRIVACY_(EXPORT|CORRECT|DELETE|HOLD)_(EXECUTE|RELEASE)$/u,
    ["ADMIN"],
    "OPTIONAL",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "ADMIN_TRUST_RESTORE",
    "TRUST_SAFETY",
    /^TRUST_(HOLD|REVOKE|RESOLVE|RESTORE|APPEAL_APPROVE|APPEAL_REJECT)$/u,
    ["ADMIN"],
    "OPTIONAL",
    "REQUIRED",
    FIVE_MINUTES,
  ),
  policy(
    "ADMIN_COMPANY_VERIFICATION",
    "COMPANY_VERIFICATION",
    /^COMPANY_VERIFICATION_(ASSIGN|DECIDE|REVOKE|RESTORE|APPEAL_DECIDE)$/u,
    ["ADMIN"],
    "REQUIRED",
    "REQUIRED",
    FIVE_MINUTES,
  ),
]);

export type StepUpBindingInput = Readonly<{
  actorRole: string;
  purpose: string;
  action: string;
  tenantId?: string | null;
  resourceId?: string | null;
}>;

export type StepUpPolicyDecision =
  | Readonly<{ allowed: true; policy: StepUpPolicy }>
  | Readonly<{
      allowed: false;
      reason:
        | "UNKNOWN_ACTION"
        | "ROLE_FORBIDDEN"
        | "TENANT_REQUIRED"
        | "TENANT_FORBIDDEN"
        | "RESOURCE_REQUIRED"
        | "RESOURCE_FORBIDDEN";
    }>;

export function resolveStepUpPolicy(
  input: StepUpBindingInput,
): StepUpPolicyDecision {
  const candidate = STEP_UP_POLICIES_V1.find(
    (entry) =>
      entry.purpose === input.purpose &&
      entry.actionPattern.test(input.action),
  );
  if (candidate === undefined) return denied("UNKNOWN_ACTION");
  if (!candidate.roles.some((role) => role === input.actorRole)) {
    return denied("ROLE_FORBIDDEN");
  }
  if (candidate.tenant === "REQUIRED" && input.tenantId == null) {
    return denied("TENANT_REQUIRED");
  }
  if (candidate.tenant === "FORBIDDEN" && input.tenantId != null) {
    return denied("TENANT_FORBIDDEN");
  }
  if (candidate.resource === "REQUIRED" && input.resourceId == null) {
    return denied("RESOURCE_REQUIRED");
  }
  if (candidate.resource === "FORBIDDEN" && input.resourceId != null) {
    return denied("RESOURCE_FORBIDDEN");
  }
  return Object.freeze({ allowed: true, policy: candidate });
}

function policy(
  code: string,
  purpose: string,
  actionPattern: RegExp,
  roles: readonly StepUpRole[],
  tenant: StepUpPolicy["tenant"],
  resource: StepUpPolicy["resource"],
  maximumAssuranceAgeMilliseconds: number,
): StepUpPolicy {
  return Object.freeze({
    code,
    purpose,
    actionPattern,
    roles: Object.freeze([...roles]),
    tenant,
    resource,
    maximumAssuranceAgeMilliseconds,
    grantTtlMilliseconds: FIVE_MINUTES,
    requiredLevel: "AAL2",
    policyVersion: STEP_UP_POLICY_VERSION,
  });
}

function denied(
  reason: Extract<StepUpPolicyDecision, { allowed: false }>["reason"],
): StepUpPolicyDecision {
  return Object.freeze({ allowed: false, reason });
}
