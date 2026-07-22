export const COMMERCIAL_LIFECYCLE_POLICY_V1 = Object.freeze({
  version: "COMMERCIAL_LIFECYCLE_V1" as const,
  timeZone: "Europe/Zurich" as const,
  subscriptionWindowsDays: Object.freeze([30, 14, 7] as const),
  creditWindowsDays: Object.freeze([14, 7] as const),
  inactivityDays: 30,
  usageThresholdBasisPoints: 8_000,
  smallCohortSuppressionThreshold: 5,
});

const ZURICH_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: COMMERCIAL_LIFECYCLE_POLICY_V1.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function zurichCalendarDayDistance(from: Date, to: Date): number {
  const left = zurichDateParts(normalizeCommercialSignalInstant(from));
  const right = zurichDateParts(normalizeCommercialSignalInstant(to));
  return Math.trunc(
    (Date.UTC(right.year, right.month - 1, right.day) -
      Date.UTC(left.year, left.month - 1, left.day)) /
      86_400_000,
  );
}

export function reachesUsageThreshold(used: number, limit: number): boolean {
  return (
    Number.isSafeInteger(used) &&
    Number.isSafeInteger(limit) &&
    used >= 0 &&
    limit > 0 &&
    used * 10_000 >=
      limit * COMMERCIAL_LIFECYCLE_POLICY_V1.usageThresholdBasisPoints
  );
}

export function zurichDateKeyV1(value: Date) {
  const parts = zurichDateParts(normalizeCommercialSignalInstant(value));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function normalizeCommercialSignalInstant(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("A valid commercial lifecycle clock is required.");
  }
  return new Date(Math.floor(value.getTime() / 1_000) * 1_000);
}

function zurichDateParts(value: Date) {
  const parts: Record<string, number> = {};
  for (const part of ZURICH_DATE_FORMATTER.formatToParts(value)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  if (
    !Number.isInteger(parts.year) ||
    !Number.isInteger(parts.month) ||
    !Number.isInteger(parts.day)
  ) {
    throw new RangeError("Europe/Zurich date could not be resolved.");
  }
  return {
    year: parts.year as number,
    month: parts.month as number,
    day: parts.day as number,
  };
}
