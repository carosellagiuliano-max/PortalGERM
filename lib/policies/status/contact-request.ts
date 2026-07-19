import {
  policyConflict,
  policyForbidden,
  policyOk,
  policyValidation,
  transitionDecision,
  type PolicyResult,
  type TransitionDecision,
} from "@/lib/policies/result";

export const CONTACT_REQUEST_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

export const CONTACT_REQUEST_CANCELLATION_REASONS = [
  "CANDIDATE_OPTED_OUT",
  "CANDIDATE_PROFILE_INCOMPLETE",
  "CANDIDATE_USER_UNAVAILABLE",
  "COMPANY_INACTIVE",
  "COMPANY_VERIFICATION_LOST",
] as const;

export type ContactRequestCancellationReason =
  (typeof CONTACT_REQUEST_CANCELLATION_REASONS)[number];

export const CONTACT_REQUEST_TRANSITION_ACTIONS = [
  "CREATE_PENDING",
  "ACCEPT",
  "DECLINE",
  "CANCEL_BY_REQUESTING_COMPANY",
  "CANCEL_FOR_ELIGIBILITY_LOSS",
  "EXPIRE",
] as const;

export type ContactRequestTransitionAction =
  (typeof CONTACT_REQUEST_TRANSITION_ACTIONS)[number];

export const CONTACT_REQUEST_ACTOR_CAPABILITIES = [
  "COMPANY_CONTACT_REQUESTER",
  "REQUESTING_COMPANY_MEMBER",
  "CANDIDATE_OWNER",
  "SYSTEM_ELIGIBILITY_GUARD",
  "SYSTEM_EXPIRY_PROJECTOR",
] as const;

export type ContactRequestActorCapability =
  (typeof CONTACT_REQUEST_ACTOR_CAPABILITIES)[number];

type ContactRequestPolicyReason =
  | "CONTACT_REQUEST_CAPABILITY_REQUIRED"
  | "CONTACT_REQUEST_CANCELLATION_REASON_INVALID"
  | "CONTACT_REQUEST_EXPIRY_CONTEXT_INVALID"
  | "CONTACT_REQUEST_NOT_EFFECTIVE"
  | "CONTACT_REQUEST_TRANSITION_NOT_ALLOWED";

type ContactRequestTransitionRule = Readonly<{
  allowedActors: readonly ContactRequestActorCapability[];
  allowedFrom: readonly (ContactRequestStatus | null)[];
  allowIdempotentReplay?: boolean;
  cancellationReasonRequired?: boolean;
  effectivePendingRequired?: boolean;
  expiryReachedRequired?: boolean;
  nextStatus: ContactRequestStatus;
}>;

const CONTACT_REQUEST_TRANSITION_RULES = {
  CREATE_PENDING: {
    allowedActors: ["COMPANY_CONTACT_REQUESTER"],
    allowedFrom: [null],
    allowIdempotentReplay: true,
    nextStatus: "PENDING",
  },
  ACCEPT: {
    allowedActors: ["CANDIDATE_OWNER"],
    allowedFrom: ["PENDING"],
    effectivePendingRequired: true,
    nextStatus: "ACCEPTED",
  },
  DECLINE: {
    allowedActors: ["CANDIDATE_OWNER"],
    allowedFrom: ["PENDING"],
    effectivePendingRequired: true,
    nextStatus: "DECLINED",
  },
  CANCEL_BY_REQUESTING_COMPANY: {
    allowedActors: ["REQUESTING_COMPANY_MEMBER"],
    allowedFrom: ["PENDING"],
    effectivePendingRequired: true,
    nextStatus: "CANCELLED",
  },
  CANCEL_FOR_ELIGIBILITY_LOSS: {
    allowedActors: ["SYSTEM_ELIGIBILITY_GUARD"],
    allowedFrom: ["PENDING"],
    allowIdempotentReplay: true,
    cancellationReasonRequired: true,
    effectivePendingRequired: true,
    nextStatus: "CANCELLED",
  },
  EXPIRE: {
    allowedActors: ["SYSTEM_EXPIRY_PROJECTOR"],
    allowedFrom: ["PENDING"],
    allowIdempotentReplay: true,
    expiryReachedRequired: true,
    nextStatus: "EXPIRED",
  },
} as const satisfies Record<
  ContactRequestTransitionAction,
  ContactRequestTransitionRule
>;

export function decideContactRequestTransition(input: Readonly<{
  action: ContactRequestTransitionAction;
  actor: ContactRequestActorCapability;
  cancellationReason?: string;
  createdAt?: Date;
  currentStatus: ContactRequestStatus | null;
  expiresAt?: Date;
  now?: Date;
  replay?: boolean;
}>): PolicyResult<
  TransitionDecision<ContactRequestStatus, ContactRequestTransitionAction>,
  ContactRequestPolicyReason
> {
  const rule: ContactRequestTransitionRule =
    CONTACT_REQUEST_TRANSITION_RULES[input.action];

  if (!rule.allowedActors.includes(input.actor)) {
    return policyForbidden("CONTACT_REQUEST_CAPABILITY_REQUIRED");
  }

  if (
    rule.cancellationReasonRequired &&
    !isContactRequestCancellationReason(input.cancellationReason)
  ) {
    return policyValidation("CONTACT_REQUEST_CANCELLATION_REASON_INVALID", [
      "cancellationReason",
    ]);
  }

  if (
    input.replay === true &&
    rule.allowIdempotentReplay === true &&
    input.currentStatus === rule.nextStatus
  ) {
    return accepted(input, rule.nextStatus, true);
  }

  if (!rule.allowedFrom.includes(input.currentStatus)) {
    return policyConflict("CONTACT_REQUEST_TRANSITION_NOT_ALLOWED");
  }

  if (rule.effectivePendingRequired) {
    const validity = getValidityContext(input);
    if (validity === undefined) {
      return policyValidation("CONTACT_REQUEST_EXPIRY_CONTEXT_INVALID");
    }
    if (!(validity.createdAt <= validity.now && validity.now < validity.expiresAt)) {
      return policyConflict("CONTACT_REQUEST_NOT_EFFECTIVE");
    }
  }

  if (rule.expiryReachedRequired) {
    if (!isValidDate(input.now) || !isValidDate(input.expiresAt)) {
      return policyValidation("CONTACT_REQUEST_EXPIRY_CONTEXT_INVALID");
    }
    if (input.now.getTime() < input.expiresAt.getTime()) {
      return policyConflict("CONTACT_REQUEST_NOT_EFFECTIVE");
    }
  }

  return accepted(input, rule.nextStatus);
}

export function isContactRequestCancellationReason(
  value: string | undefined,
): value is ContactRequestCancellationReason {
  return CONTACT_REQUEST_CANCELLATION_REASONS.some(
    (reason) => reason === value,
  );
}

function accepted(
  input: Readonly<{
    action: ContactRequestTransitionAction;
    currentStatus: ContactRequestStatus | null;
  }>,
  nextStatus: ContactRequestStatus,
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

function getValidityContext(input: Readonly<{
  createdAt?: Date;
  expiresAt?: Date;
  now?: Date;
}>) {
  if (
    !isValidDate(input.createdAt) ||
    !isValidDate(input.expiresAt) ||
    !isValidDate(input.now)
  ) {
    return undefined;
  }

  return {
    createdAt: input.createdAt.getTime(),
    expiresAt: input.expiresAt.getTime(),
    now: input.now.getTime(),
  };
}

function isValidDate(value: Date | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
