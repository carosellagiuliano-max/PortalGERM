import { z } from "zod";

import {
  PrivacyCorrectionFieldCode,
  PrivacyCorrectionOutcomeCode,
  PrivacyDeletionDependencyCode,
  PrivacyDeletionOutcomeCode,
  PrivacyRequestRejectionCode,
  PrivacyRequestStatus,
  PrivacyRequestType,
  type PrivacyCorrectionFieldCode as PrivacyCorrectionFieldCodeType,
  type PrivacyRequestStatus as PrivacyRequestStatusType,
  type PrivacyRequestType as PrivacyRequestTypeType,
} from "@/lib/generated/prisma/enums";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const UUID = z.string().uuid();
const IDEMPOTENCY_KEY = z.string().trim().min(8).max(128);
const SAFE_TEXT = /^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u;

export const PRIVACY_REQUEST_POLICY_V1 = Object.freeze({
  noticeVersion: "privacy-request-v1" as const,
  dueCalendarDays: 30,
  timezone: "Europe/Zurich" as const,
  deleteConfirmationPhrase: "KONTO-LÖSCHUNG BEANTRAGEN" as const,
  maximumOpenPerType: 1,
  rollingThirtyDayLimit: 5,
  challengeLifetimeMinutes: 15,
  challengeMaximumAttempts: 5,
  supportPath: "/candidate/support" as const,
});

const correctionTextSchema = z
  .string()
  .trim()
  .refine((value) => unicodeLength(value) >= 20, "Correction text is too short.")
  .refine((value) => unicodeLength(value) <= 1_000, "Correction text is too long.")
  .regex(SAFE_TEXT, "Correction text must be plain text.");

const correctionFieldCodesSchema = z
  .array(z.enum(PrivacyCorrectionFieldCode))
  .min(1)
  .max(5)
  .refine((values) => new Set(values).size === values.length, {
    message: "Correction fields must be unique.",
  });

const requestBase = {
  noticeVersion: z.literal(PRIVACY_REQUEST_POLICY_V1.noticeVersion),
  idempotencyKey: IDEMPOTENCY_KEY,
} as const;

export const privacyRequestInputSchema = z.discriminatedUnion("type", [
  z.object({
    ...requestBase,
    type: z.literal(PrivacyRequestType.EXPORT),
  }).strict(),
  z.object({
    ...requestBase,
    type: z.literal(PrivacyRequestType.DELETE),
    deleteConfirmation: z.literal(PRIVACY_REQUEST_POLICY_V1.deleteConfirmationPhrase),
  }).strict(),
  z.object({
    ...requestBase,
    type: z.literal(PrivacyRequestType.CORRECT),
    correctionFieldCodes: correctionFieldCodesSchema,
    correctionText: correctionTextSchema,
  }).strict(),
]);

export type PrivacyRequestInput = z.infer<typeof privacyRequestInputSchema>;

export type PrivacyRequestActor = Readonly<{
  userId: string;
  userStatus: "ACTIVE" | "PENDING" | "SUSPENDED" | "DELETED";
}>;

export type PrivacyRequestSummary = Readonly<{
  id: string;
  type: PrivacyRequestTypeType;
  status: PrivacyRequestStatusType;
  dueAt: Date;
  createdAt: Date;
}>;

export type AtomicPrivacyRequestIntakeResult =
  | Readonly<{
      outcome: "CREATED" | "IDEMPOTENT_RETRY" | "OPEN_TYPE_LINKED";
      request: PrivacyRequestSummary;
    }>
  | Readonly<{ outcome: "RATE_LIMITED" }>
  | Readonly<{ outcome: "UNAUTHORIZED" }>;

export type PrivacyRequestCreationResult =
  | Readonly<{
      ok: true;
      created: boolean;
      requestId: string;
      type: PrivacyRequestTypeType;
      status: PrivacyRequestStatusType;
      dueAt: Date;
    }>
  | Readonly<{ ok: false; code: "UNAUTHORIZED" }>
  | Readonly<{
      ok: false;
      code: "RATE_LIMITED";
      supportPath: typeof PRIVACY_REQUEST_POLICY_V1.supportPath;
    }>;

export interface PrivacyRequestRepository {
  /**
   * One transaction/lock boundary: idempotency, open-type duplicate, rolling
   * count, request, CREATED event and redacted Audit either commit together or
   * not at all. An adapter must lock a requester-specific key before checking.
   */
  intakeAtomically(input: Readonly<{
    userId: string;
    request: PrivacyRequestInput;
    createdAt: Date;
    dueAt: Date;
    rollingWindowStart: Date;
    rollingThirtyDayLimit: number;
    maximumOpenPerType: number;
    eventKind: "CREATED";
    auditAction: "PRIVACY_REQUEST_CREATED";
  }>): Promise<AtomicPrivacyRequestIntakeResult>;
  findOwned(
    requestId: string,
    userId: string,
  ): Promise<PrivacyRequestSummary | null>;
}

/**
 * Intake policy. `actor` is server-derived session state, never request input.
 * The sole repository intake operation atomically decides all duplicate/limit
 * controls and writes the request, CREATED event and redacted audit evidence.
 */
export async function createPrivacyRequest(
  actor: PrivacyRequestActor,
  input: unknown,
  now: Date,
  repository: PrivacyRequestRepository,
): Promise<PrivacyRequestCreationResult> {
  const request = privacyRequestInputSchema.parse(input);
  assertValidDate(now, "Privacy request clock");
  if (!UUID.safeParse(actor.userId).success || actor.userStatus !== "ACTIVE") {
    return Object.freeze({ ok: false, code: "UNAUTHORIZED" });
  }

  const rollingWindowStart = new Date(now.getTime() - 30 * DAY_MILLISECONDS);
  const dueAt = addZurichCalendarDays(now, PRIVACY_REQUEST_POLICY_V1.dueCalendarDays);
  const intake = await repository.intakeAtomically({
    userId: actor.userId,
    request,
    createdAt: new Date(now),
    dueAt,
    rollingWindowStart,
    rollingThirtyDayLimit: PRIVACY_REQUEST_POLICY_V1.rollingThirtyDayLimit,
    maximumOpenPerType: PRIVACY_REQUEST_POLICY_V1.maximumOpenPerType,
    eventKind: "CREATED",
    auditAction: "PRIVACY_REQUEST_CREATED",
  });
  if (intake.outcome === "UNAUTHORIZED") {
    return Object.freeze({ ok: false, code: "UNAUTHORIZED" });
  }
  if (intake.outcome === "RATE_LIMITED") {
    return Object.freeze({
      ok: false,
      code: "RATE_LIMITED",
      supportPath: PRIVACY_REQUEST_POLICY_V1.supportPath,
    });
  }
  assertAtomicIntakeResult(intake, request, now);
  return creationSuccess(intake.request, intake.outcome === "CREATED");
}

export async function getOwnedPrivacyRequestStatus(
  requestId: string,
  actor: Pick<PrivacyRequestActor, "userId">,
  repository: PrivacyRequestRepository,
): Promise<PrivacyRequestSummary | null> {
  if (!UUID.safeParse(requestId).success || !UUID.safeParse(actor.userId).success) {
    return null;
  }
  return repository.findOwned(requestId, actor.userId);
}

export function addZurichCalendarDays(now: Date, days: number): Date {
  assertValidDate(now, "Privacy request clock");
  if (!Number.isInteger(days) || days < 0 || days > 366) {
    throw new RangeError("Privacy request calendar-day offset is invalid.");
  }

  const local = zonedParts(now, PRIVACY_REQUEST_POLICY_V1.timezone);
  const nominalUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day + days,
    local.hour,
    local.minute,
    local.second,
    now.getUTCMilliseconds(),
  );
  let projected = nominalUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const offset = zoneOffsetMilliseconds(
      new Date(projected),
      PRIVACY_REQUEST_POLICY_V1.timezone,
    );
    const next = nominalUtc - offset;
    if (next === projected) break;
    projected = next;
  }
  return new Date(projected);
}

const safeNoteSchema = z
  .string()
  .refine((value) => unicodeLength(value) <= 500, "Safe note is too long.")
  .regex(SAFE_TEXT, "Safe note must be plain text.")
  .optional();

const internalNoteSchema = z
  .string()
  .refine((value) => unicodeLength(value) <= 1_000, "Internal note is too long.")
  .regex(SAFE_TEXT, "Internal note must be plain text.");

const dependencyCodesSchema = z
  .array(z.enum(PrivacyDeletionDependencyCode))
  .min(1)
  .max(Object.keys(PrivacyDeletionDependencyCode).length)
  .refine((values) => new Set(values).size === values.length, "Dependencies must be unique.")
  .refine(
    (values) =>
      !values.includes(PrivacyDeletionDependencyCode.NONE) || values.length === 1,
    "NONE is mutually exclusive.",
  );

const reviewedFieldCodesSchema = correctionFieldCodesSchema;
const domainEventRefsSchema = z
  .array(UUID)
  .max(5)
  .refine((values) => new Set(values).size === values.length, "Domain event references must be unique.")
  .optional();

const caseCommandBase = {
  requestId: UUID,
  version: z.number().int().nonnegative(),
  idempotencyKey: IDEMPOTENCY_KEY,
} as const;

const completeCorrectionCommandSchema = z.object({
  ...caseCommandBase,
  action: z.literal("COMPLETE_CORRECTION"),
  reviewedFieldCodes: reviewedFieldCodesSchema,
  outcomeCode: z.enum(PrivacyCorrectionOutcomeCode),
  domainEventRefs: domainEventRefsSchema,
  safeNote: safeNoteSchema,
}).strict().superRefine((input, context) => {
  if (
    input.outcomeCode === PrivacyCorrectionOutcomeCode.CORRECTED_VIA_CANONICAL_COMMAND &&
    (!input.domainEventRefs || input.domainEventRefs.length === 0)
  ) {
    context.addIssue({
      code: "custom",
      path: ["domainEventRefs"],
      message: "Canonical corrections require at least one domain event reference.",
    });
  }
});

export const privacyCaseCommandSchema = z.discriminatedUnion("action", [
  z.object({
    ...caseCommandBase,
    action: z.literal("START_IDENTITY_CHECK"),
  }).strict(),
  z.object({
    ...caseCommandBase,
    action: z.literal("COMPLETE_CHALLENGE"),
  }).strict(),
  z.object({
    ...caseCommandBase,
    action: z.literal("VERIFY_IDENTITY"),
  }).strict(),
  z.object({
    ...caseCommandBase,
    action: z.literal("CANCEL"),
  }).strict(),
  z.object({
    ...caseCommandBase,
    action: z.literal("COMPLETE_EXPORT"),
  }).strict(),
  z.object({
    ...caseCommandBase,
    action: z.literal("COMPLETE_DELETE"),
    dependencyCodes: dependencyCodesSchema,
    outcomeCode: z.literal(PrivacyDeletionOutcomeCode.ASSESSMENT_COMPLETED_NO_ERASURE),
    safeNote: safeNoteSchema,
  }).strict(),
  completeCorrectionCommandSchema,
  z.object({
    ...caseCommandBase,
    action: z.literal("REJECT"),
    reasonCode: z.enum(PrivacyRequestRejectionCode),
    safeNote: safeNoteSchema,
  }).strict(),
  z.object({
    ...caseCommandBase,
    action: z.literal("ADD_NOTE"),
    note: internalNoteSchema,
  }).strict(),
]);

export type PrivacyCaseCommand = z.infer<typeof privacyCaseCommandSchema>;
export type PrivacyCaseAction = PrivacyCaseCommand["action"];
export type PrivacyCaseCapability =
  | "PRIVACY_CASE_VERIFY"
  | "PRIVACY_CASE_PROCESS";

export type PrivacyIdentityChallengeState = Readonly<{
  requestId: string;
  requesterUserId: string;
  expiresAt: Date;
  attempts: number;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}>;

export type StoredPrivacyCaseResult = Readonly<{
  action: PrivacyCaseAction;
  idempotencyKey: string;
  fromStatus: PrivacyRequestStatusType;
  toStatus: PrivacyRequestStatusType;
  outcome: "TRANSITION" | "NO_STATUS_CHANGE";
}>;

export type PrivacyCaseState = Readonly<{
  requestId: string;
  requesterUserId: string;
  requesterUserStatus: "ACTIVE" | "PENDING" | "SUSPENDED" | "DELETED";
  type: PrivacyRequestTypeType;
  status: PrivacyRequestStatusType;
  version: number;
  correctionFieldCodes: readonly PrivacyCorrectionFieldCodeType[];
  challenge: PrivacyIdentityChallengeState | null;
  lastResult?: StoredPrivacyCaseResult;
}>;

export type PrivacyCaseActor = Readonly<{
  userId: string;
  emailVerified: boolean;
  capabilities: readonly PrivacyCaseCapability[];
}>;

/** Evidence produced by server-owned credential/domain checks, never client input. */
export type PrivacyCaseServerEvidence = Readonly<{
  credentialVerified?: boolean;
}>;

export type PrivacyCaseDecision =
  | Readonly<{
      allowed: true;
      idempotent: boolean;
      action: PrivacyCaseAction;
      fromStatus: PrivacyRequestStatusType;
      toStatus: PrivacyRequestStatusType;
      outcome: "TRANSITION" | "NO_STATUS_CHANGE";
    }>
  | Readonly<{
      allowed: false;
      reason:
        | "INVALID_COMMAND"
        | "REQUEST_MISMATCH"
        | "IDEMPOTENCY_KEY_REUSED"
        | "STALE_VERSION"
        | "TERMINAL_STATE"
        | "INVALID_TRANSITION"
        | "CAPABILITY_REQUIRED"
        | "OWNER_REQUIRED"
        | "USER_INELIGIBLE"
        | "CHALLENGE_UNAVAILABLE"
        | "TYPE_MISMATCH"
        | "OUTCOME_MISMATCH";
    }>;

/** Pure, fail-closed policy. Persistence applies an allowed decision atomically. */
export function decidePrivacyCaseTransitionV1(
  state: PrivacyCaseState,
  actor: PrivacyCaseActor,
  commandInput: unknown,
  now: Date,
  serverEvidence: PrivacyCaseServerEvidence = Object.freeze({}),
): PrivacyCaseDecision {
  const parsed = privacyCaseCommandSchema.safeParse(commandInput);
  if (!parsed.success || !isValidState(state) || !isValidActor(actor) || !isValidDate(now)) {
    return denied("INVALID_COMMAND");
  }
  const command = parsed.data;
  if (command.requestId !== state.requestId) return denied("REQUEST_MISMATCH");

  if (state.lastResult?.idempotencyKey === command.idempotencyKey) {
    if (state.lastResult.action !== command.action) {
      return denied("IDEMPOTENCY_KEY_REUSED");
    }
    return Object.freeze({
      allowed: true,
      idempotent: true,
      action: state.lastResult.action,
      fromStatus: state.lastResult.fromStatus,
      toStatus: state.lastResult.toStatus,
      outcome: state.lastResult.outcome,
    });
  }
  if (command.version !== state.version) return denied("STALE_VERSION");
  if (isTerminal(state.status)) return denied("TERMINAL_STATE");

  switch (command.action) {
    case "START_IDENTITY_CHECK":
      if (!hasCapability(actor, "PRIVACY_CASE_VERIFY")) return denied("CAPABILITY_REQUIRED");
      return transitionFrom(state, command.action, [PrivacyRequestStatus.PENDING], PrivacyRequestStatus.IDENTITY_CHECK);

    case "COMPLETE_CHALLENGE": {
      if (state.status !== PrivacyRequestStatus.IDENTITY_CHECK) return denied("INVALID_TRANSITION");
      if (actor.userId !== state.requesterUserId) return denied("OWNER_REQUIRED");
      if (state.requesterUserStatus !== "ACTIVE" || !actor.emailVerified) {
        return denied("USER_INELIGIBLE");
      }
      if (serverEvidence.credentialVerified !== true || !challengeCanBeCompleted(state, now)) {
        return denied("CHALLENGE_UNAVAILABLE");
      }
      return allowed(state, command.action, state.status, "NO_STATUS_CHANGE");
    }

    case "VERIFY_IDENTITY":
      if (!hasCapability(actor, "PRIVACY_CASE_VERIFY")) return denied("CAPABILITY_REQUIRED");
      if (state.status !== PrivacyRequestStatus.IDENTITY_CHECK) return denied("INVALID_TRANSITION");
      if (state.requesterUserStatus !== "ACTIVE") return denied("USER_INELIGIBLE");
      if (!challengeCanBeConsumed(state, now)) return denied("CHALLENGE_UNAVAILABLE");
      return allowed(state, command.action, PrivacyRequestStatus.IN_PROGRESS, "TRANSITION");

    case "CANCEL":
      if (actor.userId !== state.requesterUserId) return denied("OWNER_REQUIRED");
      return transitionFrom(
        state,
        command.action,
        [PrivacyRequestStatus.PENDING, PrivacyRequestStatus.IDENTITY_CHECK],
        PrivacyRequestStatus.CANCELLED,
      );

    case "COMPLETE_EXPORT":
      return completeCase(state, actor, command.action, PrivacyRequestType.EXPORT);

    case "COMPLETE_DELETE":
      return completeCase(state, actor, command.action, PrivacyRequestType.DELETE);

    case "COMPLETE_CORRECTION":
      if (!command.reviewedFieldCodes.every((field) => state.correctionFieldCodes.includes(field))) {
        return denied("OUTCOME_MISMATCH");
      }
      return completeCase(state, actor, command.action, PrivacyRequestType.CORRECT);

    case "REJECT":
      if (!hasCapability(actor, "PRIVACY_CASE_PROCESS")) return denied("CAPABILITY_REQUIRED");
      return transitionFrom(
        state,
        command.action,
        [
          PrivacyRequestStatus.PENDING,
          PrivacyRequestStatus.IDENTITY_CHECK,
          PrivacyRequestStatus.IN_PROGRESS,
        ],
        PrivacyRequestStatus.REJECTED,
      );

    case "ADD_NOTE":
      if (!hasCapability(actor, "PRIVACY_CASE_PROCESS")) return denied("CAPABILITY_REQUIRED");
      return allowed(state, command.action, state.status, "NO_STATUS_CHANGE");
  }
}

function completeCase(
  state: PrivacyCaseState,
  actor: PrivacyCaseActor,
  action: PrivacyCaseAction,
  expectedType: PrivacyRequestTypeType,
): PrivacyCaseDecision {
  if (!hasCapability(actor, "PRIVACY_CASE_PROCESS")) return denied("CAPABILITY_REQUIRED");
  if (state.type !== expectedType) return denied("TYPE_MISMATCH");
  return transitionFrom(
    state,
    action,
    [PrivacyRequestStatus.IN_PROGRESS],
    PrivacyRequestStatus.COMPLETED,
  );
}

function transitionFrom(
  state: PrivacyCaseState,
  action: PrivacyCaseAction,
  from: readonly PrivacyRequestStatusType[],
  to: PrivacyRequestStatusType,
): PrivacyCaseDecision {
  if (!from.includes(state.status)) return denied("INVALID_TRANSITION");
  return allowed(state, action, to, "TRANSITION");
}

function allowed(
  state: PrivacyCaseState,
  action: PrivacyCaseAction,
  toStatus: PrivacyRequestStatusType,
  outcome: "TRANSITION" | "NO_STATUS_CHANGE",
): PrivacyCaseDecision {
  return Object.freeze({
    allowed: true,
    idempotent: false,
    action,
    fromStatus: state.status,
    toStatus,
    outcome,
  });
}

function denied(reason: Extract<PrivacyCaseDecision, { allowed: false }>["reason"]): PrivacyCaseDecision {
  return Object.freeze({ allowed: false, reason });
}

function hasCapability(actor: PrivacyCaseActor, capability: PrivacyCaseCapability) {
  return actor.capabilities.includes(capability);
}

function challengeCanBeCompleted(state: PrivacyCaseState, now: Date) {
  const challenge = state.challenge;
  return challenge !== null &&
    challenge.requestId === state.requestId &&
    challenge.requesterUserId === state.requesterUserId &&
    challenge.expiresAt.getTime() > now.getTime() &&
    challenge.attempts >= 0 &&
    challenge.attempts < PRIVACY_REQUEST_POLICY_V1.challengeMaximumAttempts &&
    challenge.verifiedAt === null &&
    challenge.consumedAt === null;
}

function challengeCanBeConsumed(state: PrivacyCaseState, now: Date) {
  const challenge = state.challenge;
  return challenge !== null &&
    challenge.requestId === state.requestId &&
    challenge.requesterUserId === state.requesterUserId &&
    challenge.expiresAt.getTime() > now.getTime() &&
    challenge.attempts >= 0 &&
    challenge.attempts <= PRIVACY_REQUEST_POLICY_V1.challengeMaximumAttempts &&
    challenge.verifiedAt !== null &&
    challenge.verifiedAt.getTime() <= now.getTime() &&
    challenge.consumedAt === null;
}

function isTerminal(status: PrivacyRequestStatusType) {
  return status === PrivacyRequestStatus.COMPLETED ||
    status === PrivacyRequestStatus.REJECTED ||
    status === PrivacyRequestStatus.CANCELLED;
}

function isValidState(state: PrivacyCaseState) {
  const correctionFieldsAreValid = state.correctionFieldCodes.length <= 5 &&
    new Set(state.correctionFieldCodes).size === state.correctionFieldCodes.length &&
    state.correctionFieldCodes.every((field) =>
      z.enum(PrivacyCorrectionFieldCode).safeParse(field).success
    );
  return UUID.safeParse(state.requestId).success &&
    UUID.safeParse(state.requesterUserId).success &&
    ["ACTIVE", "PENDING", "SUSPENDED", "DELETED"].includes(state.requesterUserStatus) &&
    z.enum(PrivacyRequestType).safeParse(state.type).success &&
    z.enum(PrivacyRequestStatus).safeParse(state.status).success &&
    Number.isInteger(state.version) &&
    state.version >= 0 &&
    correctionFieldsAreValid &&
    (state.type === PrivacyRequestType.CORRECT
      ? state.correctionFieldCodes.length >= 1
      : state.correctionFieldCodes.length === 0) &&
    isValidChallengeState(state.challenge) &&
    isValidStoredResult(state.lastResult);
}

function isValidActor(actor: PrivacyCaseActor) {
  return UUID.safeParse(actor.userId).success &&
    typeof actor.emailVerified === "boolean" &&
    actor.capabilities.every((capability) =>
      capability === "PRIVACY_CASE_VERIFY" || capability === "PRIVACY_CASE_PROCESS"
    );
}

function isValidChallengeState(challenge: PrivacyIdentityChallengeState | null) {
  return challenge === null || (
    UUID.safeParse(challenge.requestId).success &&
    UUID.safeParse(challenge.requesterUserId).success &&
    isValidDate(challenge.expiresAt) &&
    Number.isInteger(challenge.attempts) &&
    challenge.attempts >= 0 &&
    challenge.attempts <= PRIVACY_REQUEST_POLICY_V1.challengeMaximumAttempts &&
    (challenge.verifiedAt === null || isValidDate(challenge.verifiedAt)) &&
    (challenge.consumedAt === null || isValidDate(challenge.consumedAt))
  );
}

function isValidStoredResult(result: StoredPrivacyCaseResult | undefined) {
  return result === undefined || (
    privacyCaseCommandSchema.options.some((schema) => {
      const action = schema.shape.action.value;
      return action === result.action;
    }) &&
    IDEMPOTENCY_KEY.safeParse(result.idempotencyKey).success &&
    z.enum(PrivacyRequestStatus).safeParse(result.fromStatus).success &&
    z.enum(PrivacyRequestStatus).safeParse(result.toStatus).success &&
    (result.outcome === "TRANSITION" || result.outcome === "NO_STATUS_CHANGE")
  );
}

function creationSuccess(
  request: PrivacyRequestSummary,
  created: boolean,
): Extract<PrivacyRequestCreationResult, { ok: true }> {
  return Object.freeze({
    ok: true,
    created,
    requestId: request.id,
    type: request.type,
    status: request.status,
    dueAt: new Date(request.dueAt),
  });
}

function assertAtomicIntakeResult(
  intake: Extract<AtomicPrivacyRequestIntakeResult, { request: PrivacyRequestSummary }>,
  command: PrivacyRequestInput,
  now: Date,
) {
  const result = intake.request;
  if (
    !UUID.safeParse(result.id).success ||
    !z.enum(PrivacyRequestType).safeParse(result.type).success ||
    !z.enum(PrivacyRequestStatus).safeParse(result.status).success ||
    !isValidDate(result.createdAt) ||
    !isValidDate(result.dueAt) ||
    (intake.outcome === "CREATED" && (
      result.type !== command.type ||
      result.status !== PrivacyRequestStatus.PENDING ||
      result.createdAt.getTime() !== now.getTime()
    )) ||
    (intake.outcome === "OPEN_TYPE_LINKED" && (
      result.type !== command.type ||
      isTerminal(result.status)
    ))
  ) {
    throw new Error("Atomic privacy request intake returned an invalid result.");
  }
}

function unicodeLength(value: string) {
  return [...value].length;
}

function assertValidDate(value: Date, label: string): asserts value is Date {
  if (!isValidDate(value)) throw new TypeError(`${label} is invalid.`);
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const raw = parts.find((part) => part.type === type)?.value;
    if (raw === undefined) throw new TypeError("Timezone projection failed.");
    return Number(raw);
  };
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zoneOffsetMilliseconds(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const instantWithoutMilliseconds = Math.trunc(date.getTime() / 1_000) * 1_000;
  return localAsUtc - instantWithoutMilliseconds;
}
