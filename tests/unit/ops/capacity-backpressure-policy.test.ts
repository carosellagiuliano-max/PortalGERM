import { describe, expect, it } from "vitest";

import { resolveCapacityBackpressure } from "@/lib/ops/capacity-backpressure-policy";

describe("Phase-23 capacity and backpressure policy", () => {
  it("requires at least 50 percent headroom for normal operation", () => {
    expect(
      resolveCapacityBackpressure({
        arrivalP95PerMinute: 100,
        sustainablePerMinute: 150,
        downstreamHealthy: true,
      }),
    ).toMatchObject({
      state: "NORMAL",
      intakeAllowed: true,
      claimBatchMultiplier: 1,
    });
    expect(
      resolveCapacityBackpressure({
        arrivalP95PerMinute: 100,
        sustainablePerMinute: 140,
        downstreamHealthy: true,
      }),
    ).toMatchObject({
      state: "HEADROOM_LOW",
      claimBatchMultiplier: 0.5,
    });
  });

  it("throttles at 80 percent and pauses intake at 90 percent", () => {
    expect(
      resolveCapacityBackpressure({
        arrivalP95PerMinute: 80,
        sustainablePerMinute: 100,
        downstreamHealthy: true,
      }),
    ).toMatchObject({
      state: "THROTTLED",
      intakeAllowed: true,
      claimBatchMultiplier: 0.5,
    });
    expect(
      resolveCapacityBackpressure({
        arrivalP95PerMinute: 90,
        sustainablePerMinute: 100,
        downstreamHealthy: true,
      }),
    ).toMatchObject({
      state: "PAUSED",
      intakeAllowed: false,
      claimBatchMultiplier: 0,
    });
  });

  it("uses the worst downstream utilization and fails closed without capacity", () => {
    expect(
      resolveCapacityBackpressure({
        arrivalP95PerMinute: 10,
        sustainablePerMinute: 100,
        providerQuotaBasisPoints: 9_100,
        databasePoolBasisPoints: 2_000,
        downstreamHealthy: true,
      }),
    ).toMatchObject({ state: "PAUSED", utilizationBasisPoints: 9_100 });
    expect(
      resolveCapacityBackpressure({
        arrivalP95PerMinute: 1,
        sustainablePerMinute: 0,
        downstreamHealthy: true,
      }),
    ).toMatchObject({
      state: "PAUSED",
      reasonCode: "CAPACITY_UNMEASURED",
    });
    expect(
      resolveCapacityBackpressure({
        arrivalP95PerMinute: 1,
        sustainablePerMinute: 100,
        downstreamHealthy: false,
      }),
    ).toMatchObject({
      state: "DEGRADED",
      reasonCode: "DOWNSTREAM_DEGRADED",
    });
  });
});
