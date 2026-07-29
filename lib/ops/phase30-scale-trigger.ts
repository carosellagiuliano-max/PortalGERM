export const PHASE30_SCALE_TRIGGER_POLICY_V1 = Object.freeze({
  queueCapUtilizationBps: 7_000,
  p95Milliseconds: 400,
  recommendationQueryCount: 20,
} as const);

export type Phase30ScaleDecisionV1 = Readonly<{
  triggered: boolean;
  priority: "P3_DEFERRED" | "P1_MIGRATE" | "P0_BLOCKING";
  reasons: readonly string[];
}>;

export function evaluatePhase30ScaleTriggerV1(
  input: Readonly<{
    maximumQueueUtilizationBps: number;
    p95Milliseconds: number;
    recommendationQueryCount: number;
    forecast90DaysReachesCap: boolean;
    capacityAlreadyReached?: boolean;
  }>,
): Phase30ScaleDecisionV1 {
  const reasons: string[] = [];
  if (
    input.maximumQueueUtilizationBps >=
    PHASE30_SCALE_TRIGGER_POLICY_V1.queueCapUtilizationBps
  )
    reasons.push("QUEUE_AT_OR_ABOVE_70_PERCENT");
  if (input.p95Milliseconds > PHASE30_SCALE_TRIGGER_POLICY_V1.p95Milliseconds) {
    reasons.push("P95_ABOVE_400_MS");
  }
  if (
    input.recommendationQueryCount >
    PHASE30_SCALE_TRIGGER_POLICY_V1.recommendationQueryCount
  )
    reasons.push("RECOMMENDATION_QUERY_COUNT_ABOVE_20");
  if (input.forecast90DaysReachesCap) reasons.push("FORECAST_REACHES_CAP");
  if (input.capacityAlreadyReached) reasons.push("CAPACITY_ALREADY_REACHED");
  return Object.freeze({
    triggered: reasons.length > 0,
    priority: input.capacityAlreadyReached
      ? "P0_BLOCKING"
      : reasons.length > 0
        ? "P1_MIGRATE"
        : "P3_DEFERRED",
    reasons: Object.freeze(reasons),
  });
}
