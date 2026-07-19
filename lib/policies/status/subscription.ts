import {
  policyConflict,
  policyForbidden,
  policyOk,
  policyValidation,
  transitionDecision,
  type PolicyResult,
  type TransitionDecision,
} from "@/lib/policies/result";

export const SUBSCRIPTION_STATUSES = [
  "SCHEDULED",
  "ACTIVE",
  "CANCELLING",
  "EXPIRED",
  "CANCELLED",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_TRANSITION_ACTIONS = [
  "CREATE_ACTIVE",
  "CREATE_SCHEDULED",
  "ACTIVATE_SCHEDULED",
  "SCHEDULE_CANCELLATION",
  "APPLY_CANCELLATION",
  "EXPIRE_NATURALLY",
  "EXPIRE_REPLACED",
] as const;

export type SubscriptionTransitionAction =
  (typeof SUBSCRIPTION_TRANSITION_ACTIONS)[number];

export const SUBSCRIPTION_ACTOR_CAPABILITIES = [
  "BILLING_FULFILLMENT",
  "COMPANY_OWNER",
  "PLATFORM_BILLING_OPERATOR",
  "SYSTEM_SUBSCRIPTION_PROJECTOR",
] as const;

export type SubscriptionActorCapability =
  (typeof SUBSCRIPTION_ACTOR_CAPABILITIES)[number];

type SubscriptionPolicyReason =
  | "SUBSCRIPTION_BOUNDARY_CONTEXT_INVALID"
  | "SUBSCRIPTION_BOUNDARY_NOT_REACHED"
  | "SUBSCRIPTION_CAPABILITY_REQUIRED"
  | "SUBSCRIPTION_TRANSITION_NOT_ALLOWED";

type SubscriptionTransitionRule = Readonly<{
  allowedActors: readonly SubscriptionActorCapability[];
  allowedFrom: readonly (SubscriptionStatus | null)[];
  allowIdempotentReplay: boolean;
  boundaryRequired?: boolean;
  nextStatus: SubscriptionStatus;
}>;

const SUBSCRIPTION_TRANSITION_RULES = {
  CREATE_ACTIVE: {
    allowedActors: ["BILLING_FULFILLMENT"],
    allowedFrom: [null],
    allowIdempotentReplay: true,
    nextStatus: "ACTIVE",
  },
  CREATE_SCHEDULED: {
    allowedActors: ["BILLING_FULFILLMENT"],
    allowedFrom: [null],
    allowIdempotentReplay: true,
    nextStatus: "SCHEDULED",
  },
  ACTIVATE_SCHEDULED: {
    allowedActors: ["SYSTEM_SUBSCRIPTION_PROJECTOR"],
    allowedFrom: ["SCHEDULED"],
    allowIdempotentReplay: true,
    boundaryRequired: true,
    nextStatus: "ACTIVE",
  },
  SCHEDULE_CANCELLATION: {
    allowedActors: ["COMPANY_OWNER", "PLATFORM_BILLING_OPERATOR"],
    allowedFrom: ["ACTIVE"],
    allowIdempotentReplay: true,
    nextStatus: "CANCELLING",
  },
  APPLY_CANCELLATION: {
    allowedActors: ["SYSTEM_SUBSCRIPTION_PROJECTOR"],
    allowedFrom: ["CANCELLING"],
    allowIdempotentReplay: true,
    boundaryRequired: true,
    nextStatus: "CANCELLED",
  },
  EXPIRE_NATURALLY: {
    allowedActors: ["SYSTEM_SUBSCRIPTION_PROJECTOR"],
    allowedFrom: ["ACTIVE"],
    allowIdempotentReplay: true,
    boundaryRequired: true,
    nextStatus: "EXPIRED",
  },
  EXPIRE_REPLACED: {
    allowedActors: [
      "BILLING_FULFILLMENT",
      "SYSTEM_SUBSCRIPTION_PROJECTOR",
    ],
    allowedFrom: ["ACTIVE"],
    allowIdempotentReplay: true,
    nextStatus: "EXPIRED",
  },
} as const satisfies Record<
  SubscriptionTransitionAction,
  SubscriptionTransitionRule
>;

export function decideSubscriptionTransition(input: Readonly<{
  action: SubscriptionTransitionAction;
  actor: SubscriptionActorCapability;
  at?: Date;
  boundaryAt?: Date;
  currentStatus: SubscriptionStatus | null;
  replay?: boolean;
}>): PolicyResult<
  TransitionDecision<SubscriptionStatus, SubscriptionTransitionAction>,
  SubscriptionPolicyReason
> {
  const rule: SubscriptionTransitionRule =
    SUBSCRIPTION_TRANSITION_RULES[input.action];

  if (!rule.allowedActors.includes(input.actor)) {
    return policyForbidden("SUBSCRIPTION_CAPABILITY_REQUIRED");
  }

  if (
    input.replay === true &&
    rule.allowIdempotentReplay &&
    input.currentStatus === rule.nextStatus
  ) {
    return accepted(input, rule.nextStatus, true);
  }

  if (!rule.allowedFrom.includes(input.currentStatus)) {
    return policyConflict("SUBSCRIPTION_TRANSITION_NOT_ALLOWED");
  }

  if (rule.boundaryRequired) {
    if (!isValidDate(input.at) || !isValidDate(input.boundaryAt)) {
      return policyValidation("SUBSCRIPTION_BOUNDARY_CONTEXT_INVALID");
    }
    if (input.at.getTime() < input.boundaryAt.getTime()) {
      return policyConflict("SUBSCRIPTION_BOUNDARY_NOT_REACHED");
    }
  }

  return accepted(input, rule.nextStatus);
}

function accepted(
  input: Readonly<{
    action: SubscriptionTransitionAction;
    currentStatus: SubscriptionStatus | null;
  }>,
  nextStatus: SubscriptionStatus,
  idempotent = false,
) {
  return policyOk(
    transitionDecision({
      action: input.action,
      currentStatus: input.currentStatus,
      nextStatus,
      idempotent,
    }),
  );
}

function isValidDate(value: Date | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
