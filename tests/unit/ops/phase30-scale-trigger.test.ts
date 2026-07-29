import { describe, expect, it } from "vitest";

import { evaluatePhase30ScaleTriggerV1 } from "@/lib/ops/phase30-scale-trigger";

describe("Phase 30 search and sitemap scale trigger", () => {
  it("keeps migration deferred below every measured threshold", () => {
    expect(
      evaluatePhase30ScaleTriggerV1({
        maximumQueueUtilizationBps: 6_999,
        p95Milliseconds: 400,
        recommendationQueryCount: 20,
        forecast90DaysReachesCap: false,
      }),
    ).toEqual({ triggered: false, priority: "P3_DEFERRED", reasons: [] });
  });

  it("triggers at the exact queue boundary and only above the other strict boundaries", () => {
    expect(
      evaluatePhase30ScaleTriggerV1({
        maximumQueueUtilizationBps: 7_000,
        p95Milliseconds: 401,
        recommendationQueryCount: 21,
        forecast90DaysReachesCap: true,
      }),
    ).toEqual({
      triggered: true,
      priority: "P1_MIGRATE",
      reasons: [
        "QUEUE_AT_OR_ABOVE_70_PERCENT",
        "P95_ABOVE_400_MS",
        "RECOMMENDATION_QUERY_COUNT_ABOVE_20",
        "FORECAST_REACHES_CAP",
      ],
    });
  });

  it("raises an already-reached hard capacity to P0", () => {
    expect(
      evaluatePhase30ScaleTriggerV1({
        maximumQueueUtilizationBps: 0,
        p95Milliseconds: 0,
        recommendationQueryCount: 0,
        forecast90DaysReachesCap: false,
        capacityAlreadyReached: true,
      }),
    ).toMatchObject({
      triggered: true,
      priority: "P0_BLOCKING",
      reasons: ["CAPACITY_ALREADY_REACHED"],
    });
  });
});
