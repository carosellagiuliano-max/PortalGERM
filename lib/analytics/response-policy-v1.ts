import {
  ANALYTICS_MINIMUM_COHORT_SIZE_V1,
  isInHalfOpenWindow,
  medianInteger,
  ratioToBasisPoints,
} from "@/lib/analytics/metric-contracts";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export const EMPLOYER_RESPONSE_POLICY_V1 = Object.freeze({
  version: "v1",
  rollingWindowDays: 90,
  minimumDueCases: ANALYTICS_MINIMUM_COHORT_SIZE_V1,
  minimumMedianResponses: ANALYTICS_MINIMUM_COHORT_SIZE_V1,
  reliableThresholdBps: 8_000,
  cockpitRiskThresholdBps: 7_000,
  validResponseTargetDays: Object.freeze({ min: 1, max: 30 }),
});

export type EmployerResponseCaseV1 = Readonly<{
  applicationId: string;
  submittedAt: Date;
  responseTargetDays: number | null;
  firstResponseAt: Date | null;
}>;

export type EmployerResponseHistoryV1 =
  | Readonly<{
      status: "KNOWN";
      dueCases: number;
      respondedCases: number;
      onTimeCases: number;
      onTimeRateBps: number;
      medianFirstResponseMinutes: number | "SUPPRESSED";
      reliability: "RELIABLE" | "NOT_RELIABLE";
      cockpitRisk: boolean;
    }>
  | Readonly<{
      status: "UNKNOWN";
      dueCases: "SUPPRESSED";
      respondedCases: "SUPPRESSED";
      onTimeCases: "SUPPRESSED";
      onTimeRateBps: "SUPPRESSED";
      medianFirstResponseMinutes: "SUPPRESSED";
      reliability: "UNKNOWN";
      cockpitRisk: null;
    }>;

export type ResponseSortableJobV1 = Readonly<{
  id: string;
  publishedAt: Date;
  response: EmployerResponseHistoryV1;
}>;

export function calculateEmployerResponseHistoryV1(
  cases: readonly EmployerResponseCaseV1[],
  clock: Readonly<{ now: Date }>,
): EmployerResponseHistoryV1 {
  const nowMs = clock.now.getTime();
  const window = {
    from: new Date(nowMs - EMPLOYER_RESPONSE_POLICY_V1.rollingWindowDays * DAY_MS),
    to: clock.now,
  };
  const dueCases = distinctApplicationCases(cases).filter((entry) => {
    if (!isValidResponseTarget(entry.responseTargetDays)) {
      return false;
    }
    if (!isInHalfOpenWindow(entry.submittedAt, window)) {
      return false;
    }
    const dueAt = entry.submittedAt.getTime() + entry.responseTargetDays * DAY_MS;
    return dueAt <= nowMs;
  });

  const responded = dueCases.filter(
    (entry) =>
      entry.firstResponseAt !== null &&
      entry.firstResponseAt.getTime() >= entry.submittedAt.getTime(),
  );
  const onTime = responded.filter((entry) => {
    const target = entry.responseTargetDays;
    if (!isValidResponseTarget(target) || entry.firstResponseAt === null) {
      return false;
    }
    return entry.firstResponseAt.getTime() <=
      entry.submittedAt.getTime() + target * DAY_MS;
  });
  const responseMinutes = responded
    .map((entry) => entry.firstResponseAt === null
      ? null
      : Math.max(
          0,
          Math.floor(
            (entry.firstResponseAt.getTime() - entry.submittedAt.getTime()) /
              MINUTE_MS,
          ),
        ))
    .filter((value): value is number => value !== null);

  if (dueCases.length < EMPLOYER_RESPONSE_POLICY_V1.minimumDueCases) {
    return Object.freeze({
      status: "UNKNOWN",
      dueCases: "SUPPRESSED",
      respondedCases: "SUPPRESSED",
      onTimeCases: "SUPPRESSED",
      onTimeRateBps: "SUPPRESSED",
      medianFirstResponseMinutes: "SUPPRESSED",
      reliability: "UNKNOWN",
      cockpitRisk: null,
    });
  }

  const onTimeRateBps = ratioToBasisPoints(onTime.length, dueCases.length);
  return Object.freeze({
    status: "KNOWN",
    dueCases: dueCases.length,
    respondedCases: responded.length,
    onTimeCases: onTime.length,
    onTimeRateBps,
    medianFirstResponseMinutes:
      responseMinutes.length < EMPLOYER_RESPONSE_POLICY_V1.minimumMedianResponses
        ? "SUPPRESSED"
        : medianInteger(responseMinutes) ?? "SUPPRESSED",
    reliability: onTimeRateBps >= EMPLOYER_RESPONSE_POLICY_V1.reliableThresholdBps
      ? "RELIABLE"
      : "NOT_RELIABLE",
    cockpitRisk: onTimeRateBps < EMPLOYER_RESPONSE_POLICY_V1.cockpitRiskThresholdBps,
  });
}

export function compareJobsByEmployerResponseV1(
  left: ResponseSortableJobV1,
  right: ResponseSortableJobV1,
) {
  const knownComparison = Number(right.response.status === "KNOWN") -
    Number(left.response.status === "KNOWN");
  if (knownComparison !== 0) {
    return knownComparison;
  }

  if (left.response.status === "KNOWN" && right.response.status === "KNOWN") {
    const rateComparison = right.response.onTimeRateBps -
      left.response.onTimeRateBps;
    if (rateComparison !== 0) {
      return rateComparison;
    }

    const leftMedian = left.response.medianFirstResponseMinutes;
    const rightMedian = right.response.medianFirstResponseMinutes;
    const visibleMedianComparison = Number(typeof rightMedian === "number") -
      Number(typeof leftMedian === "number");
    if (visibleMedianComparison !== 0) {
      return visibleMedianComparison;
    }
    if (
      typeof leftMedian === "number" &&
      typeof rightMedian === "number" &&
      leftMedian !== rightMedian
    ) {
      return leftMedian - rightMedian;
    }
  }

  const publishedComparison = right.publishedAt.getTime() - left.publishedAt.getTime();
  return publishedComparison !== 0 ? publishedComparison : left.id.localeCompare(right.id);
}

function distinctApplicationCases(
  cases: readonly EmployerResponseCaseV1[],
) {
  const distinct = new Map<string, EmployerResponseCaseV1>();
  for (const entry of cases) {
    if (entry.applicationId.length > 0 && !distinct.has(entry.applicationId)) {
      distinct.set(entry.applicationId, entry);
    }
  }
  return [...distinct.values()];
}

function isValidResponseTarget(value: number | null): value is number {
  return Number.isInteger(value) &&
    value !== null &&
    value >= EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min &&
    value <= EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max;
}
