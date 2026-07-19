import {
  policyConflict,
  policyForbidden,
  policyOk,
  policyValidation,
  transitionDecision,
  type PolicyResult,
  type TransitionDecision,
} from "@/lib/policies/result";

export const VERIFICATION_STATUSES = [
  "DRAFT",
  "PENDING",
  "CHANGES_REQUESTED",
  "VERIFIED",
  "REJECTED",
  "REVOKED",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_TRANSITION_ACTIONS = [
  "CREATE_DRAFT",
  "SUBMIT",
  "REQUEST_CHANGES",
  "RESUBMIT",
  "VERIFY",
  "REJECT",
  "REVOKE",
] as const;

export type VerificationTransitionAction =
  (typeof VERIFICATION_TRANSITION_ACTIONS)[number];

export const VERIFICATION_ACTOR_CAPABILITIES = [
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "PLATFORM_VERIFICATION_REVIEWER",
] as const;

export type VerificationActorCapability =
  (typeof VERIFICATION_ACTOR_CAPABILITIES)[number];

type VerificationPolicyReason =
  | "VERIFICATION_CAPABILITY_REQUIRED"
  | "VERIFICATION_REASON_REQUIRED"
  | "VERIFICATION_TRANSITION_NOT_ALLOWED";

type VerificationTransitionRule = Readonly<{
  allowedActors: readonly VerificationActorCapability[];
  allowedFrom: readonly (VerificationStatus | null)[];
  nextStatus: VerificationStatus;
  reasonRequired?: boolean;
}>;

const COMPANY_VERIFICATION_ACTORS = [
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
] as const satisfies readonly VerificationActorCapability[];

const VERIFICATION_TRANSITION_RULES = {
  CREATE_DRAFT: {
    allowedActors: COMPANY_VERIFICATION_ACTORS,
    allowedFrom: [null],
    nextStatus: "DRAFT",
  },
  SUBMIT: {
    allowedActors: COMPANY_VERIFICATION_ACTORS,
    allowedFrom: ["DRAFT"],
    nextStatus: "PENDING",
  },
  REQUEST_CHANGES: {
    allowedActors: ["PLATFORM_VERIFICATION_REVIEWER"],
    allowedFrom: ["PENDING"],
    nextStatus: "CHANGES_REQUESTED",
    reasonRequired: true,
  },
  RESUBMIT: {
    allowedActors: COMPANY_VERIFICATION_ACTORS,
    allowedFrom: ["CHANGES_REQUESTED"],
    nextStatus: "PENDING",
  },
  VERIFY: {
    allowedActors: ["PLATFORM_VERIFICATION_REVIEWER"],
    allowedFrom: ["PENDING"],
    nextStatus: "VERIFIED",
  },
  REJECT: {
    allowedActors: ["PLATFORM_VERIFICATION_REVIEWER"],
    allowedFrom: ["PENDING"],
    nextStatus: "REJECTED",
    reasonRequired: true,
  },
  REVOKE: {
    allowedActors: ["PLATFORM_VERIFICATION_REVIEWER"],
    allowedFrom: ["VERIFIED"],
    nextStatus: "REVOKED",
    reasonRequired: true,
  },
} as const satisfies Record<
  VerificationTransitionAction,
  VerificationTransitionRule
>;

export function decideVerificationTransition(input: Readonly<{
  action: VerificationTransitionAction;
  actor: VerificationActorCapability;
  currentStatus: VerificationStatus | null;
  reasonCode?: string;
}>): PolicyResult<
  TransitionDecision<VerificationStatus, VerificationTransitionAction>,
  VerificationPolicyReason
> {
  const rule: VerificationTransitionRule =
    VERIFICATION_TRANSITION_RULES[input.action];

  if (!rule.allowedActors.includes(input.actor)) {
    return policyForbidden("VERIFICATION_CAPABILITY_REQUIRED");
  }

  if (rule.reasonRequired && !hasReason(input.reasonCode)) {
    return policyValidation("VERIFICATION_REASON_REQUIRED", ["reasonCode"]);
  }

  if (!rule.allowedFrom.includes(input.currentStatus)) {
    return policyConflict("VERIFICATION_TRANSITION_NOT_ALLOWED");
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
