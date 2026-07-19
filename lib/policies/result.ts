export type PolicyIssue<TCode extends string = string> = Readonly<{
  code: TCode;
  path: readonly string[];
}>;

export type PolicyOk<TValue> = Readonly<{
  type: "OK";
  value: TValue;
}>;

export type PolicyValidation<TReason extends string = string> = Readonly<{
  type: "VALIDATION";
  reason: TReason;
  issues: readonly PolicyIssue<TReason>[];
}>;

export type PolicyForbidden<TReason extends string = string> = Readonly<{
  type: "FORBIDDEN";
  reason: TReason;
}>;

export type PolicyNotFound = Readonly<{
  type: "NOT_FOUND";
  reason: "RESOURCE_NOT_FOUND";
}>;

export type PolicyConflict<TReason extends string = string> = Readonly<{
  type: "CONFLICT";
  reason: TReason;
}>;

export type PolicyLimit<TReason extends string = string> = Readonly<{
  type: "LIMIT";
  reason: TReason;
  suggestedPlanSlug?: string;
  suggestedProductSlug?: string;
}>;

export type PolicyRateLimited<TReason extends string = string> = Readonly<{
  type: "RATE_LIMITED";
  reason: TReason;
  retryAfterSeconds: number;
}>;

export type PolicyResult<TValue, TReason extends string = string> =
  | PolicyOk<TValue>
  | PolicyValidation<TReason>
  | PolicyForbidden<TReason>
  | PolicyNotFound
  | PolicyConflict<TReason>
  | PolicyLimit<TReason>
  | PolicyRateLimited<TReason>;

export type TransitionDecision<
  TStatus extends string,
  TAction extends string,
> = Readonly<{
  action: TAction;
  changed: boolean;
  currentStatus: TStatus | null;
  idempotent: boolean;
  nextStatus: TStatus;
}>;

export function policyOk<TValue>(value: TValue): PolicyOk<TValue> {
  return Object.freeze({ type: "OK", value });
}

export function policyValidation<TReason extends string>(
  reason: TReason,
  path: readonly string[] = [],
): PolicyValidation<TReason> {
  const issue = Object.freeze({ code: reason, path: Object.freeze([...path]) });
  return Object.freeze({
    type: "VALIDATION",
    reason,
    issues: Object.freeze([issue]),
  });
}

export function policyForbidden<TReason extends string>(
  reason: TReason,
): PolicyForbidden<TReason> {
  return Object.freeze({ type: "FORBIDDEN", reason });
}

export function policyNotFound(): PolicyNotFound {
  return Object.freeze({
    type: "NOT_FOUND",
    reason: "RESOURCE_NOT_FOUND",
  });
}

export function policyConflict<TReason extends string>(
  reason: TReason,
): PolicyConflict<TReason> {
  return Object.freeze({ type: "CONFLICT", reason });
}

export function policyLimit<TReason extends string>(
  reason: TReason,
  suggestions: Readonly<{
    suggestedPlanSlug?: string;
    suggestedProductSlug?: string;
  }> = {},
): PolicyLimit<TReason> {
  return Object.freeze({ type: "LIMIT", reason, ...suggestions });
}

export function policyRateLimited<TReason extends string>(
  reason: TReason,
  retryAfterSeconds: number,
): PolicyRateLimited<TReason> {
  if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1) {
    throw new RangeError("retryAfterSeconds must be a positive safe integer");
  }

  return Object.freeze({
    type: "RATE_LIMITED",
    reason,
    retryAfterSeconds,
  });
}

export function transitionDecision<
  TStatus extends string,
  TAction extends string,
>(input: {
  action: TAction;
  currentStatus: TStatus | null;
  nextStatus: TStatus;
  idempotent?: boolean;
}): TransitionDecision<TStatus, TAction> {
  const idempotent = input.idempotent ?? false;
  return Object.freeze({
    action: input.action,
    changed: input.currentStatus !== input.nextStatus,
    currentStatus: input.currentStatus,
    idempotent,
    nextStatus: input.nextStatus,
  });
}
