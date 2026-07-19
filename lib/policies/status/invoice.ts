import {
  policyConflict,
  policyForbidden,
  policyOk,
  policyValidation,
  transitionDecision,
  type PolicyResult,
  type TransitionDecision,
} from "@/lib/policies/result";

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PAID", "VOID"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_TRANSITION_ACTIONS = [
  "CREATE_DRAFT",
  "ISSUE",
  "MARK_PAID",
  "VOID",
] as const;

export type InvoiceTransitionAction =
  (typeof INVOICE_TRANSITION_ACTIONS)[number];

export const INVOICE_ACTOR_CAPABILITIES = [
  "BILLING_FULFILLMENT",
  "PLATFORM_BILLING_OPERATOR",
] as const;

export type InvoiceActorCapability =
  (typeof INVOICE_ACTOR_CAPABILITIES)[number];

type InvoicePolicyReason =
  | "INVOICE_CAPABILITY_REQUIRED"
  | "INVOICE_REASON_REQUIRED"
  | "INVOICE_TRANSITION_NOT_ALLOWED";

type InvoiceTransitionRule = Readonly<{
  allowedActors: readonly InvoiceActorCapability[];
  allowedFrom: readonly (InvoiceStatus | null)[];
  allowIdempotentReplay: boolean;
  nextStatus: InvoiceStatus;
  reasonRequired?: boolean;
}>;

const INVOICE_TRANSITION_RULES = {
  CREATE_DRAFT: {
    allowedActors: ["BILLING_FULFILLMENT"],
    allowedFrom: [null],
    allowIdempotentReplay: true,
    nextStatus: "DRAFT",
  },
  ISSUE: {
    allowedActors: ["BILLING_FULFILLMENT", "PLATFORM_BILLING_OPERATOR"],
    allowedFrom: ["DRAFT"],
    allowIdempotentReplay: true,
    nextStatus: "ISSUED",
  },
  MARK_PAID: {
    allowedActors: ["BILLING_FULFILLMENT", "PLATFORM_BILLING_OPERATOR"],
    allowedFrom: ["ISSUED"],
    allowIdempotentReplay: true,
    nextStatus: "PAID",
  },
  VOID: {
    allowedActors: ["PLATFORM_BILLING_OPERATOR"],
    allowedFrom: ["ISSUED"],
    allowIdempotentReplay: true,
    nextStatus: "VOID",
    reasonRequired: true,
  },
} as const satisfies Record<InvoiceTransitionAction, InvoiceTransitionRule>;

export function decideInvoiceTransition(input: Readonly<{
  action: InvoiceTransitionAction;
  actor: InvoiceActorCapability;
  currentStatus: InvoiceStatus | null;
  reasonCode?: string;
  replay?: boolean;
}>): PolicyResult<
  TransitionDecision<InvoiceStatus, InvoiceTransitionAction>,
  InvoicePolicyReason
> {
  const rule: InvoiceTransitionRule =
    INVOICE_TRANSITION_RULES[input.action];

  if (!rule.allowedActors.includes(input.actor)) {
    return policyForbidden("INVOICE_CAPABILITY_REQUIRED");
  }

  if (rule.reasonRequired && !hasReason(input.reasonCode)) {
    return policyValidation("INVOICE_REASON_REQUIRED", ["reasonCode"]);
  }

  if (
    input.replay === true &&
    rule.allowIdempotentReplay &&
    input.currentStatus === rule.nextStatus
  ) {
    return accepted(input, rule.nextStatus, true);
  }

  if (!rule.allowedFrom.includes(input.currentStatus)) {
    return policyConflict("INVOICE_TRANSITION_NOT_ALLOWED");
  }

  return accepted(input, rule.nextStatus);
}

function accepted(
  input: Readonly<{
    action: InvoiceTransitionAction;
    currentStatus: InvoiceStatus | null;
  }>,
  nextStatus: InvoiceStatus,
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

function hasReason(value: string | undefined) {
  return value !== undefined && value.trim().length > 0;
}
