import { describe, expect, it } from "vitest";

import {
  evaluateCapacityModel,
  REQUIRED_CAPACITY_WORK_TYPES,
} from "@/lib/commercial/capacity-model";

function validModel() {
  return {
    maximumConciergeCogsRappenPerCustomer: 40_000,
    maximumUtilizationBps: 8_000,
    measuredConciergeCogsRappenPerCustomer: 30_000,
    workloads: REQUIRED_CAPACITY_WORK_TYPES.map((workType) => ({
      arrivalRatePerWeek: 2,
      backlogCount: 0,
      availableMinutesPerWeek: 600,
      onCallCovered: true,
      p50Minutes: 30,
      p95Minutes: 60,
      slaMinutes: 120,
      workType,
    })),
  };
}

describe("Phase 31 capacity and unit-cost model", () => {
  it("requires all six work types and keeps measured utilization below 80%", () => {
    const result = evaluateCapacityModel(validModel());
    expect(result.decision).toMatchObject({ allowed: true, missing: [] });
    expect(result.maximumUtilizationBps).toBe(2_000);
    expect(result.modelDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed when a work type, on-call coverage or headroom is missing", () => {
    const model = validModel();
    const result = evaluateCapacityModel({
      ...model,
      workloads: model.workloads.slice(0, -1).map((row) => ({
        ...row,
        availableMinutesPerWeek: 30,
        onCallCovered: false,
      })),
    });
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.missing).toEqual(
      expect.arrayContaining([
        "ALL_REQUIRED_WORK_TYPES",
        "SUPPORT_OR_FRAUD_ON_CALL",
        "CAPACITY_HEADROOM",
      ]),
    );
  });

  it("blocks Concierge when measured COGS exceeds its pre-registered cap", () => {
    const model = validModel();
    expect(
      evaluateCapacityModel({
        ...model,
        measuredConciergeCogsRappenPerCustomer: 40_001,
      }).decision.missing,
    ).toContain("CONCIERGE_COGS_CAP");
  });
});
