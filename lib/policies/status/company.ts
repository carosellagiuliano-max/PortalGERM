import {
  policyConflict,
  policyForbidden,
  policyOk,
  policyValidation,
  transitionDecision,
  type PolicyResult,
  type TransitionDecision,
} from "@/lib/policies/result";

export const COMPANY_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "SUSPENDED",
  "CLOSED",
] as const;

export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const COMPANY_TRANSITION_ACTIONS = [
  "CREATE_DRAFT",
  "COMPLETE_ONBOARDING",
  "SUSPEND",
  "REACTIVATE",
  "CLOSE",
] as const;

export type CompanyTransitionAction =
  (typeof COMPANY_TRANSITION_ACTIONS)[number];

export const COMPANY_ACTOR_CAPABILITIES = [
  "AUTH_REGISTRATION",
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "PLATFORM_COMPANY_MODERATOR",
] as const;

export type CompanyActorCapability =
  (typeof COMPANY_ACTOR_CAPABILITIES)[number];

type CompanyPolicyReason =
  | "COMPANY_CAPABILITY_REQUIRED"
  | "COMPANY_ONBOARDING_INCOMPLETE"
  | "COMPANY_REASON_REQUIRED"
  | "COMPANY_TRANSITION_NOT_ALLOWED";

type CompanyTransitionRule = Readonly<{
  allowedActors: readonly CompanyActorCapability[];
  allowedFrom: readonly (CompanyStatus | null)[];
  nextStatus: CompanyStatus;
  onboardingRequired?: boolean;
  reasonRequired?: boolean;
}>;

const COMPANY_TRANSITION_RULES = {
  CREATE_DRAFT: {
    allowedActors: ["AUTH_REGISTRATION"],
    allowedFrom: [null],
    nextStatus: "DRAFT",
  },
  COMPLETE_ONBOARDING: {
    allowedActors: ["COMPANY_OWNER", "COMPANY_ADMIN"],
    allowedFrom: ["DRAFT"],
    nextStatus: "ACTIVE",
    onboardingRequired: true,
  },
  SUSPEND: {
    allowedActors: ["PLATFORM_COMPANY_MODERATOR"],
    allowedFrom: ["ACTIVE"],
    nextStatus: "SUSPENDED",
    reasonRequired: true,
  },
  REACTIVATE: {
    allowedActors: ["PLATFORM_COMPANY_MODERATOR"],
    allowedFrom: ["SUSPENDED"],
    nextStatus: "ACTIVE",
    reasonRequired: true,
  },
  CLOSE: {
    allowedActors: ["PLATFORM_COMPANY_MODERATOR"],
    allowedFrom: ["SUSPENDED"],
    nextStatus: "CLOSED",
    reasonRequired: true,
  },
} as const satisfies Record<CompanyTransitionAction, CompanyTransitionRule>;

export function decideCompanyTransition(input: Readonly<{
  action: CompanyTransitionAction;
  actor: CompanyActorCapability;
  currentStatus: CompanyStatus | null;
  onboardingComplete?: boolean;
  reasonCode?: string;
}>): PolicyResult<
  TransitionDecision<CompanyStatus, CompanyTransitionAction>,
  CompanyPolicyReason
> {
  const rule: CompanyTransitionRule = COMPANY_TRANSITION_RULES[input.action];

  if (!rule.allowedActors.includes(input.actor)) {
    return policyForbidden("COMPANY_CAPABILITY_REQUIRED");
  }

  if (rule.onboardingRequired && input.onboardingComplete !== true) {
    return policyValidation("COMPANY_ONBOARDING_INCOMPLETE");
  }

  if (rule.reasonRequired && !hasReason(input.reasonCode)) {
    return policyValidation("COMPANY_REASON_REQUIRED", ["reasonCode"]);
  }

  if (!rule.allowedFrom.includes(input.currentStatus)) {
    return policyConflict("COMPANY_TRANSITION_NOT_ALLOWED");
  }

  return policyOk(
    transitionDecision({
      action: input.action,
      currentStatus: input.currentStatus,
      nextStatus: rule.nextStatus,
    }),
  );
}

function hasReason(value: string | undefined) {
  return value !== undefined && value.trim().length > 0;
}
