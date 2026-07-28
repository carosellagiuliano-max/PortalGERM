export const COMPANY_VERIFICATION_CAPACITY_POLICY_V1 = Object.freeze({
  version: "COMPANY_VERIFICATION_CAPACITY_POLICY_V1" as const,
  launchBufferBps: 3_000,
  reviewSlaDays: 3,
  maximumOpenSandboxQueue: 100,
});

export type CompanyVerificationCapacityAssessment = Readonly<{
  policyVersion: typeof COMPANY_VERIFICATION_CAPACITY_POLICY_V1.version;
  sampleSize: number;
  p50HandlingMinutes: number;
  p95HandlingMinutes: number;
  dailyReviewCapacity: number;
  bufferedDailyCapacity: number;
  forecastOpenAtSla: number;
  oldestQueueAgeHours: number;
  admissionAllowed: boolean;
  reason: "CAPACITY_AVAILABLE" | "INSUFFICIENT_SAMPLE" | "FORECAST_EXCEEDS_BUFFERED_CAPACITY";
}>;

export function assessCompanyVerificationCapacity(input: Readonly<{
  handlingMinutes: readonly number[];
  reviewerMinutesPerDay: readonly number[];
  arrivalsPerDay: number;
  openQueueCount: number;
  oldestQueueAgeHours: number;
}>): CompanyVerificationCapacityAssessment {
  const samples = input.handlingMinutes
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 480)
    .sort((left, right) => left - right);
  const reviewerMinutes = input.reviewerMinutesPerDay.filter(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1_440,
  );
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  const dailyReviewCapacity =
    p95 === 0
      ? 0
      : Math.floor(
          reviewerMinutes.reduce((sum, value) => sum + value, 0) / p95,
        );
  const bufferedDailyCapacity = Math.floor(
    dailyReviewCapacity /
      (1 + COMPANY_VERIFICATION_CAPACITY_POLICY_V1.launchBufferBps / 10_000),
  );
  const arrivals =
    Number.isFinite(input.arrivalsPerDay) && input.arrivalsPerDay >= 0
      ? input.arrivalsPerDay
      : Number.POSITIVE_INFINITY;
  const open =
    Number.isSafeInteger(input.openQueueCount) && input.openQueueCount >= 0
      ? input.openQueueCount
      : Number.MAX_SAFE_INTEGER;
  const forecastOpenAtSla = Math.ceil(
    open +
      arrivals * COMPANY_VERIFICATION_CAPACITY_POLICY_V1.reviewSlaDays,
  );
  const capacityAtSla =
    bufferedDailyCapacity *
    COMPANY_VERIFICATION_CAPACITY_POLICY_V1.reviewSlaDays;
  const sufficientSample = samples.length >= 20;
  const admissionAllowed =
    sufficientSample &&
    forecastOpenAtSla <= capacityAtSla &&
    open < COMPANY_VERIFICATION_CAPACITY_POLICY_V1.maximumOpenSandboxQueue;
  return Object.freeze({
    policyVersion: COMPANY_VERIFICATION_CAPACITY_POLICY_V1.version,
    sampleSize: samples.length,
    p50HandlingMinutes: p50,
    p95HandlingMinutes: p95,
    dailyReviewCapacity,
    bufferedDailyCapacity,
    forecastOpenAtSla,
    oldestQueueAgeHours:
      Number.isFinite(input.oldestQueueAgeHours) &&
      input.oldestQueueAgeHours >= 0
        ? input.oldestQueueAgeHours
        : Number.POSITIVE_INFINITY,
    admissionAllowed,
    reason: !sufficientSample
      ? "INSUFFICIENT_SAMPLE"
      : admissionAllowed
        ? "CAPACITY_AVAILABLE"
        : "FORECAST_EXCEEDS_BUFFERED_CAPACITY",
  });
}

function percentile(sortedValues: readonly number[], percentileValue: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );
  return Math.round((sortedValues[index] ?? 0) * 10) / 10;
}
