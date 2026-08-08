import { ANALYTICS_MINIMUM_COHORT_SIZE_V1 } from "@/lib/analytics/metric-contracts";
import { EMPLOYER_RESPONSE_POLICY_V1 } from "@/lib/analytics/response-policy-v1";
import {
  isIsolatedSandboxEnvironment,
  type ApplicationEnvironment,
} from "@/lib/config/application-environment";
import type { PublicResponseEvidence } from "@/lib/public/types";

export const PUBLIC_RESPONSE_EVIDENCE_POLICY_V1 = Object.freeze({
  version: "PUBLIC_RESPONSE_EVIDENCE_POLICY_V1",
  minimumSampleSize: ANALYTICS_MINIMUM_COHORT_SIZE_V1,
  validTargetDays: Object.freeze({
    minimum: EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min,
    maximum: EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max,
  }),
  productionProjectionState: "UNAVAILABLE" as const,
});

export const UNKNOWN_PUBLIC_RESPONSE_EVIDENCE: PublicResponseEvidence =
  Object.freeze({
    known: false,
    targetDays: null,
    onTimeRateBps: null,
    sampleSizeBucket: null,
  });

export type PublicResponseProjection = Readonly<{
  responseTargetDays: number | null;
  responseSampleSize: number;
  responseWithinTargetBps: number | null;
}>;

/**
 * Company response fields are currently seed/test projections, not a durable
 * live read model. Only isolated Local/CI environments may consume them. A
 * Preview, Staging or Production caller therefore cannot turn a populated
 * Company row into public evidence merely by forging a query parameter.
 */
export function canUseSyntheticPublicResponseEvidence(
  environment: ApplicationEnvironment,
): boolean {
  return isIsolatedSandboxEnvironment(environment);
}

export function projectSyntheticPublicResponseEvidence(
  projection: PublicResponseProjection,
  environment: ApplicationEnvironment | undefined,
): PublicResponseEvidence {
  if (
    environment === undefined ||
    !canUseSyntheticPublicResponseEvidence(environment)
  ) {
    return UNKNOWN_PUBLIC_RESPONSE_EVIDENCE;
  }

  const targetDays = projection.responseTargetDays;
  const sampleSize = projection.responseSampleSize;
  const onTimeRateBps = projection.responseWithinTargetBps;
  if (
    !Number.isInteger(targetDays) ||
    targetDays === null ||
    targetDays < PUBLIC_RESPONSE_EVIDENCE_POLICY_V1.validTargetDays.minimum ||
    targetDays > PUBLIC_RESPONSE_EVIDENCE_POLICY_V1.validTargetDays.maximum ||
    !Number.isSafeInteger(sampleSize) ||
    sampleSize < PUBLIC_RESPONSE_EVIDENCE_POLICY_V1.minimumSampleSize ||
    !Number.isInteger(onTimeRateBps) ||
    onTimeRateBps === null ||
    onTimeRateBps < 0 ||
    onTimeRateBps > 10_000
  ) {
    return UNKNOWN_PUBLIC_RESPONSE_EVIDENCE;
  }

  return Object.freeze({
    known: true,
    targetDays,
    onTimeRateBps,
    sampleSizeBucket: sampleSize >= 50 ? "50+" : "20–49",
  });
}
