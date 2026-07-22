export const BILLING_POLICY_V1 = Object.freeze({
  version: "BILLING_POLICY_V1" as const,
  calendarTimeZone: "Europe/Zurich" as const,
  membershipRoleOrder: Object.freeze([
    "OWNER",
    "ADMIN",
    "RECRUITER",
    "VIEWER",
  ] as const),
});

export type BillingPolicyErrorCode =
  | "DEFAULT_OWNER_REQUIRED"
  | "DUPLICATE_MEMBERSHIP"
  | "INSTANT_OUTSIDE_PERIOD"
  | "INVALID_ALLOWANCE"
  | "INVALID_HALF_OPEN_PERIOD"
  | "INVALID_INSTANT"
  | "INVALID_MEMBERSHIP"
  | "INVALID_MONTH_COUNT"
  | "INVALID_RAPPEN_AMOUNT"
  | "INVALID_SEAT_LIMIT"
  | "NON_POSITIVE_PLAN_PRICE_DELTA"
  | "TIME_ZONE_RESOLUTION_FAILED";

export type BillingPolicyResult<TValue> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: BillingPolicyErrorCode;
        field?: string;
      }>;
    }>;

export type HalfOpenBillingPeriodV1 = Readonly<{
  start: Date;
  end: Date;
}>;

export type ValidatedHalfOpenBillingPeriodV1 = HalfOpenBillingPeriodV1 &
  Readonly<{ durationMilliseconds: number }>;

export type ProratedPlanDeltaV1 = Readonly<{
  amountRappen: number;
  fullPriceDeltaRappen: number;
  periodSeconds: number;
  remainingSeconds: number;
}>;

export type ProratedAllowanceV1 = Readonly<{
  allowance: number;
  fullAllowance: number;
  periodSeconds: number;
  remainingSeconds: number;
}>;

export type RetainedSeatRoleV1 =
  (typeof BILLING_POLICY_V1.membershipRoleOrder)[number];

export type RetainedSeatMembershipV1 = Readonly<{
  id: string;
  userId: string;
  role: RetainedSeatRoleV1;
  status: "ACTIVE" | "SUSPENDED" | "REMOVED";
  joinedAt: Date;
}>;

export type RetainedSeatSelectionV1 = Readonly<{
  defaultOwnerMembershipId: string;
  defaultOwnerUserId: string;
  retainedMembershipIds: readonly string[];
  nonRetainedActiveMembershipIds: readonly string[];
}>;

type ZurichCalendarParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}>;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1_000;
const MAX_CALENDAR_MONTHS = 120;
const ROLE_RANK = new Map<RetainedSeatRoleV1, number>(
  BILLING_POLICY_V1.membershipRoleOrder.map((role, index) => [role, index]),
);
const ZURICH_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: BILLING_POLICY_V1.calendarTimeZone,
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hourCycle: "h23",
});

/**
 * Adds whole Europe/Zurich calendar months while preserving local wall time.
 * The day is clamped to the target month's last day. DST gaps use the first
 * compatible later wall time; DST overlaps choose the earlier instant.
 */
export function addZurichCalendarMonthsClampedV1(
  instant: Date,
  months: number,
): BillingPolicyResult<Date> {
  if (!isValidDate(instant)) return failure("INVALID_INSTANT", "instant");
  if (
    !Number.isSafeInteger(months) ||
    months < 1 ||
    months > MAX_CALENDAR_MONTHS
  ) {
    return failure("INVALID_MONTH_COUNT", "months");
  }

  try {
    const source = getZurichParts(instant);
    const monthIndex = source.year * 12 + source.month - 1 + months;
    const targetYear = Math.floor(monthIndex / 12);
    const targetMonth = modulo(monthIndex, 12) + 1;
    const targetDay = Math.min(
      source.day,
      daysInGregorianMonth(targetYear, targetMonth),
    );
    const resolved = resolveZurichParts({
      ...source,
      year: targetYear,
      month: targetMonth,
      day: targetDay,
    });
    return resolved === null
      ? failure("TIME_ZONE_RESOLUTION_FAILED", "instant")
      : success(resolved);
  } catch {
    return failure("TIME_ZONE_RESOLUTION_FAILED", "instant");
  }
}

export function validateHalfOpenBillingPeriodV1(
  period: HalfOpenBillingPeriodV1,
): BillingPolicyResult<ValidatedHalfOpenBillingPeriodV1> {
  if (!isValidDate(period.start)) return failure("INVALID_INSTANT", "start");
  if (!isValidDate(period.end)) return failure("INVALID_INSTANT", "end");
  const durationMilliseconds = period.end.getTime() - period.start.getTime();
  if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds <= 0) {
    return failure("INVALID_HALF_OPEN_PERIOD", "period");
  }
  return success(
    Object.freeze({
      start: new Date(period.start.getTime()),
      end: new Date(period.end.getTime()),
      durationMilliseconds,
    }),
  );
}

export function isInstantInHalfOpenBillingPeriodV1(
  period: HalfOpenBillingPeriodV1,
  instant: Date,
): BillingPolicyResult<boolean> {
  const validated = validateHalfOpenBillingPeriodV1(period);
  if (!validated.ok) return validated;
  if (!isValidDate(instant)) return failure("INVALID_INSTANT", "instant");
  return success(
    validated.value.start.getTime() <= instant.getTime() &&
      instant.getTime() < validated.value.end.getTime(),
  );
}

/**
 * ADR-028 upgrade price: round-half-up((target-current) * remaining / full period).
 * Both terms are the persisted whole-second snapshot required by ADR-028, so
 * the quoted Rappen amount is reproducible from the immutable OrderLine data.
 */
export function computeProratedPlanDeltaV1(input: Readonly<{
  currentPlanNetRappen: number;
  targetPlanNetRappen: number;
  period: HalfOpenBillingPeriodV1;
  at: Date;
}>): BillingPolicyResult<ProratedPlanDeltaV1> {
  if (!isNonNegativeSafeInteger(input.currentPlanNetRappen)) {
    return failure("INVALID_RAPPEN_AMOUNT", "currentPlanNetRappen");
  }
  if (!isNonNegativeSafeInteger(input.targetPlanNetRappen)) {
    return failure("INVALID_RAPPEN_AMOUNT", "targetPlanNetRappen");
  }
  if (input.targetPlanNetRappen <= input.currentPlanNetRappen) {
    return failure("NON_POSITIVE_PLAN_PRICE_DELTA", "targetPlanNetRappen");
  }
  const timing = getProrationTiming(input.period, input.at);
  if (!timing.ok) return timing;

  const fullPriceDeltaRappen =
    input.targetPlanNetRappen - input.currentPlanNetRappen;
  const amountRappen = roundHalfUpRatio(
    fullPriceDeltaRappen,
    timing.value.remainingSeconds,
    timing.value.periodSeconds,
  );
  return success(
    Object.freeze({
      amountRappen,
      fullPriceDeltaRappen,
      ...timing.value,
    }),
  );
}

export function computeProratedAllowanceV1(input: Readonly<{
  targetAllowance: number;
  period: HalfOpenBillingPeriodV1;
  at: Date;
}>): BillingPolicyResult<ProratedAllowanceV1> {
  if (!isNonNegativeSafeInteger(input.targetAllowance)) {
    return failure("INVALID_ALLOWANCE", "targetAllowance");
  }
  const timing = getProrationTiming(input.period, input.at);
  if (!timing.ok) return timing;
  const allowance = floorRatio(
    input.targetAllowance,
    timing.value.remainingSeconds,
    timing.value.periodSeconds,
  );
  return success(
    Object.freeze({
      allowance,
      fullAllowance: input.targetAllowance,
      ...timing.value,
    }),
  );
}

/**
 * Builds ADR-028's deterministic fallback seat snapshot. Only ACTIVE rows are
 * eligible. The oldest OWNER is retained first, followed by role, joinedAt,
 * then id. Existing inactive rows are not projected again.
 */
export function selectDefaultRetainedSeatsV1(input: Readonly<{
  seatLimit: number;
  memberships: readonly RetainedSeatMembershipV1[];
}>): BillingPolicyResult<RetainedSeatSelectionV1> {
  if (!Number.isSafeInteger(input.seatLimit) || input.seatLimit < 1) {
    return failure("INVALID_SEAT_LIMIT", "seatLimit");
  }

  const seenIds = new Set<string>();
  const seenUserIds = new Set<string>();
  for (const membership of input.memberships) {
    if (!isValidMembership(membership)) {
      return failure("INVALID_MEMBERSHIP", "memberships");
    }
    if (seenIds.has(membership.id) || seenUserIds.has(membership.userId)) {
      return failure("DUPLICATE_MEMBERSHIP", "memberships");
    }
    seenIds.add(membership.id);
    seenUserIds.add(membership.userId);
  }

  const active = input.memberships
    .filter((membership) => membership.status === "ACTIVE")
    .slice()
    .sort(compareMemberships);
  const defaultOwner = active.find((membership) => membership.role === "OWNER");
  if (defaultOwner === undefined) {
    return failure("DEFAULT_OWNER_REQUIRED", "memberships");
  }

  const ordered = [
    defaultOwner,
    ...active.filter((membership) => membership.id !== defaultOwner.id),
  ];
  const retained = ordered.slice(0, input.seatLimit);
  const retainedIds = new Set(retained.map((membership) => membership.id));
  return success(
    Object.freeze({
      defaultOwnerMembershipId: defaultOwner.id,
      defaultOwnerUserId: defaultOwner.userId,
      retainedMembershipIds: Object.freeze(
        retained.map((membership) => membership.id),
      ),
      nonRetainedActiveMembershipIds: Object.freeze(
        active
          .filter((membership) => !retainedIds.has(membership.id))
          .map((membership) => membership.id),
      ),
    }),
  );
}

function getProrationTiming(
  period: HalfOpenBillingPeriodV1,
  at: Date,
): BillingPolicyResult<
  Readonly<{ periodSeconds: number; remainingSeconds: number }>
> {
  const validated = validateHalfOpenBillingPeriodV1(period);
  if (!validated.ok) return validated;
  if (!isValidDate(at)) return failure("INVALID_INSTANT", "at");
  if (
    at.getTime() < validated.value.start.getTime() ||
    at.getTime() >= validated.value.end.getTime()
  ) {
    return failure("INSTANT_OUTSIDE_PERIOD", "at");
  }
  const periodSeconds = Math.floor(validated.value.durationMilliseconds / 1_000);
  const remainingSeconds = Math.floor(
    (validated.value.end.getTime() - at.getTime()) / 1_000,
  );
  if (!Number.isSafeInteger(periodSeconds) || periodSeconds <= 0) {
    return failure("INVALID_HALF_OPEN_PERIOD", "period");
  }
  return success(Object.freeze({ periodSeconds, remainingSeconds }));
}

function floorRatio(value: number, numerator: number, denominator: number): number {
  return Number(
    (BigInt(value) * BigInt(numerator)) / BigInt(denominator),
  );
}

function roundHalfUpRatio(
  value: number,
  numerator: number,
  denominator: number,
): number {
  const scaled = BigInt(value) * BigInt(numerator);
  const divisor = BigInt(denominator);
  return Number((scaled * 2n + divisor) / (divisor * 2n));
}

function compareMemberships(
  left: RetainedSeatMembershipV1,
  right: RetainedSeatMembershipV1,
): number {
  return (
    (ROLE_RANK.get(left.role) ?? Number.MAX_SAFE_INTEGER) -
      (ROLE_RANK.get(right.role) ?? Number.MAX_SAFE_INTEGER) ||
    left.joinedAt.getTime() - right.joinedAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function isValidMembership(value: RetainedSeatMembershipV1): boolean {
  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.userId === "string" &&
    value.userId.trim().length > 0 &&
    ROLE_RANK.has(value.role) &&
    (value.status === "ACTIVE" ||
      value.status === "SUSPENDED" ||
      value.status === "REMOVED") &&
    isValidDate(value.joinedAt)
  );
}

function resolveZurichParts(target: ZurichCalendarParts): Date | null {
  const localEpoch = partsAsUtcEpoch(target);
  if (!Number.isFinite(localEpoch)) return null;

  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const probe = new Date(localEpoch + hours * MILLISECONDS_PER_HOUR);
    if (!isValidDate(probe)) continue;
    const probeParts = getZurichParts(probe);
    offsets.add(partsAsUtcEpoch(probeParts) - probe.getTime());
  }

  const candidates = [...offsets]
    .map((offset) => new Date(localEpoch - offset))
    .filter(isValidDate)
    .map((instant) => ({
      instant,
      wallDelta: partsAsUtcEpoch(getZurichParts(instant)) - localEpoch,
    }));
  const exact = candidates
    .filter(({ wallDelta }) => wallDelta === 0)
    .sort((left, right) => left.instant.getTime() - right.instant.getTime());
  if (exact[0] !== undefined) return exact[0].instant;

  // Compatible Temporal-style gap handling: advance by the DST gap.
  const shiftedForward = candidates
    .filter(({ wallDelta }) => wallDelta > 0)
    .sort(
      (left, right) =>
        left.wallDelta - right.wallDelta ||
        left.instant.getTime() - right.instant.getTime(),
    );
  return shiftedForward[0]?.instant ?? null;
}

function getZurichParts(instant: Date): ZurichCalendarParts {
  const values: Record<string, number> = {};
  for (const part of ZURICH_FORMATTER.formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const result = {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: values.fractionalSecond,
  };
  if (Object.values(result).some((value) => !Number.isInteger(value))) {
    throw new RangeError("Europe/Zurich calendar parts could not be resolved.");
  }
  return result as ZurichCalendarParts;
}

function partsAsUtcEpoch(parts: ZurichCalendarParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function daysInGregorianMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function success<TValue>(value: TValue): BillingPolicyResult<TValue> {
  return Object.freeze({ ok: true, value });
}

function failure(
  code: BillingPolicyErrorCode,
  field?: string,
): Extract<BillingPolicyResult<never>, { ok: false }> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, ...(field === undefined ? {} : { field }) }),
  });
}
