import {
  policyConflict,
  policyForbidden,
  policyOk,
  transitionDecision,
  type PolicyResult,
  type TransitionDecision,
} from "@/lib/policies/result";

export const ORDER_STATUSES = [
  "DRAFT",
  "PENDING",
  "PAID",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITION_ACTIONS = [
  "CREATE_DRAFT",
  "OPEN_CHECKOUT",
  "CONFIRM_PAID",
  "CONFIRM_FAILED",
  "CANCEL",
  "EXPIRE",
] as const;

export type OrderTransitionAction = (typeof ORDER_TRANSITION_ACTIONS)[number];

export const ORDER_ACTOR_CAPABILITIES = [
  "AUTHORIZED_CHECKOUT",
  "PAYMENT_PROCESSOR",
  "PLATFORM_BILLING_OPERATOR",
  "SYSTEM_ORDER_LIFECYCLE",
] as const;

export type OrderActorCapability =
  (typeof ORDER_ACTOR_CAPABILITIES)[number];

type OrderPolicyReason =
  | "ORDER_CAPABILITY_REQUIRED"
  | "ORDER_TRANSITION_NOT_ALLOWED";

type OrderTransitionRule = Readonly<{
  allowedActors: readonly OrderActorCapability[];
  allowedFrom: readonly (OrderStatus | null)[];
  allowIdempotentReplay: boolean;
  nextStatus: OrderStatus;
}>;

const PAYMENT_CONFIRMERS = [
  "PAYMENT_PROCESSOR",
  "PLATFORM_BILLING_OPERATOR",
] as const satisfies readonly OrderActorCapability[];

const ORDER_TRANSITION_RULES = {
  CREATE_DRAFT: {
    allowedActors: ["AUTHORIZED_CHECKOUT"],
    allowedFrom: [null],
    allowIdempotentReplay: true,
    nextStatus: "DRAFT",
  },
  OPEN_CHECKOUT: {
    allowedActors: ["AUTHORIZED_CHECKOUT"],
    allowedFrom: ["DRAFT"],
    allowIdempotentReplay: true,
    nextStatus: "PENDING",
  },
  CONFIRM_PAID: {
    allowedActors: PAYMENT_CONFIRMERS,
    allowedFrom: ["PENDING"],
    allowIdempotentReplay: true,
    nextStatus: "PAID",
  },
  CONFIRM_FAILED: {
    allowedActors: PAYMENT_CONFIRMERS,
    allowedFrom: ["PENDING"],
    allowIdempotentReplay: true,
    nextStatus: "FAILED",
  },
  CANCEL: {
    allowedActors: ["AUTHORIZED_CHECKOUT", ...PAYMENT_CONFIRMERS],
    allowedFrom: ["PENDING"],
    allowIdempotentReplay: true,
    nextStatus: "CANCELLED",
  },
  EXPIRE: {
    allowedActors: ["SYSTEM_ORDER_LIFECYCLE"],
    allowedFrom: ["PENDING"],
    allowIdempotentReplay: true,
    nextStatus: "EXPIRED",
  },
} as const satisfies Record<OrderTransitionAction, OrderTransitionRule>;

export function decideOrderTransition(input: Readonly<{
  action: OrderTransitionAction;
  actor: OrderActorCapability;
  currentStatus: OrderStatus | null;
  replay?: boolean;
}>): PolicyResult<
  TransitionDecision<OrderStatus, OrderTransitionAction>,
  OrderPolicyReason
> {
  const rule: OrderTransitionRule = ORDER_TRANSITION_RULES[input.action];

  if (!rule.allowedActors.includes(input.actor)) {
    return policyForbidden("ORDER_CAPABILITY_REQUIRED");
  }

  if (
    input.replay === true &&
    rule.allowIdempotentReplay &&
    input.currentStatus === rule.nextStatus
  ) {
    return accepted(input, rule.nextStatus, true);
  }

  if (!rule.allowedFrom.includes(input.currentStatus)) {
    return policyConflict("ORDER_TRANSITION_NOT_ALLOWED");
  }

  return accepted(input, rule.nextStatus);
}

function accepted(
  input: Readonly<{
    action: OrderTransitionAction;
    currentStatus: OrderStatus | null;
  }>,
  nextStatus: OrderStatus,
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
