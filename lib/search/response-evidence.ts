import {
  ANALYTICS_MINIMUM_COHORT_SIZE_V1,
} from "@/lib/analytics/metric-contracts";
import {
  calculateEmployerResponseHistoryV1,
  EMPLOYER_RESPONSE_POLICY_V1,
  type EmployerResponseCaseV1,
} from "@/lib/analytics/response-policy-v1";

export type CanonicalCompanyResponseProjection = Readonly<{
  responseTargetDays: number | null;
  responseSampleSize: number;
  responseWithinTargetBps: number | null;
}>;

/**
 * Releases a sortable response median only when the public Company projection
 * and the underlying canonical response cases describe the same >=20-case
 * cohort. Any missing, undersized or internally inconsistent evidence fails
 * closed to `null`; no application-level value crosses the public boundary.
 */
export function projectCanonicalResponseMedianMinutes(
  projection: CanonicalCompanyResponseProjection,
  cases: readonly EmployerResponseCaseV1[],
  now: Date,
): number | null {
  if (!isKnownCompanyResponseProjection(projection)) return null;
  const history = calculateEmployerResponseHistoryV1(cases, { now });
  if (history.status !== "KNOWN" ||
      history.dueCases !== projection.responseSampleSize ||
      history.onTimeRateBps !== projection.responseWithinTargetBps ||
      typeof history.medianFirstResponseMinutes !== "number") {
    return null;
  }
  return history.medianFirstResponseMinutes;
}

function isKnownCompanyResponseProjection(
  projection: CanonicalCompanyResponseProjection,
): boolean {
  return Number.isSafeInteger(projection.responseSampleSize) &&
    projection.responseSampleSize >= ANALYTICS_MINIMUM_COHORT_SIZE_V1 &&
    Number.isInteger(projection.responseTargetDays) &&
    projection.responseTargetDays !== null &&
    projection.responseTargetDays >= EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min &&
    projection.responseTargetDays <= EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max &&
    Number.isInteger(projection.responseWithinTargetBps) &&
    projection.responseWithinTargetBps !== null &&
    projection.responseWithinTargetBps >= 0 &&
    projection.responseWithinTargetBps <= 10_000;
}
