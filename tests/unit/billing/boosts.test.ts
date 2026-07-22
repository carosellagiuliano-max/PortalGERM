// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  computeBoostStatus,
  getEffectiveBoostStatus,
  isBoostActiveAt,
  jobHasActiveBoost,
} from "@/lib/billing/boosts";
import {
  calculateFairJobScoreV2,
  type FairJobInput,
} from "@/lib/scoring/fair-job-score";

const START = new Date("2026-07-22T10:00:00.000Z");
const END = new Date("2026-07-29T10:00:00.000Z");
const ACTIVE = Object.freeze({
  status: "ACTIVE" as const,
  startsAt: START,
  endsAt: END,
});

describe("Phase 13 boost lifecycle policy", () => {
  it("uses the exact half-open [startsAt, endsAt) boundary", () => {
    expect(computeBoostStatus(ACTIVE, new Date(START.getTime() - 1))).toBe("SCHEDULED");
    expect(computeBoostStatus(ACTIVE, START)).toBe("ACTIVE");
    expect(isBoostActiveAt(ACTIVE, new Date(END.getTime() - 1))).toBe(true);
    expect(getEffectiveBoostStatus(ACTIVE, END)).toBe("EXPIRED");
    expect(isBoostActiveAt(ACTIVE, END)).toBe(false);
  });

  it("permits an adjacent window without treating the boundary as overlap", () => {
    const adjacent = Object.freeze({
      status: "SCHEDULED" as const,
      startsAt: END,
      endsAt: new Date(END.getTime() + 7 * 86_400_000),
    });
    expect(isBoostActiveAt(ACTIVE, END)).toBe(false);
    expect(isBoostActiveAt(adjacent, END)).toBe(true);
    expect(jobHasActiveBoost([ACTIVE, adjacent], END)).toBe(true);
  });

  it("keeps explicit cancellation authoritative inside an otherwise active window", () => {
    const cancelled = Object.freeze({
      ...ACTIVE,
      status: "CANCELLED" as const,
      cancelledAt: new Date(START.getTime() + 1),
    });
    expect(computeBoostStatus(cancelled, new Date(START.getTime() + 2))).toBe("CANCELLED");
    expect(jobHasActiveBoost([cancelled], new Date(START.getTime() + 2))).toBe(false);
  });

  it("rejects malformed windows instead of silently inventing a status", () => {
    expect(() => computeBoostStatus({
      status: "ACTIVE",
      startsAt: START,
      endsAt: START,
    }, START)).toThrow("half-open time window");
  });
});

describe("Phase 13 Fair-Job-Score independence", () => {
  it("has no boost input and produces the same value with untrusted paid extras", () => {
    type ForbiddenBoostKey = Extract<keyof FairJobInput, "boost" | "activeBoost" | "jobBoost">;
    const boostKeysAreAbsent: ForbiddenBoostKey extends never ? true : false = true;
    const input: FairJobInput = {
      salaryRange: { minChf: 90_000, maxChf: 110_000, period: "YEARLY" },
      tasksAndRequirementsClarity: "CLEAR",
      workloadContractAndStartDefined: true,
      locationAndRemoteDefined: true,
      applicationProcessDefined: true,
      responseTargetDays: 7,
      concreteBenefitsCount: 2,
      inclusionAndContactDefined: true,
      validThrough: new Date("2026-08-01T00:00:00.000Z"),
    };
    const clock = { now: new Date("2026-07-22T00:00:00.000Z") };
    const baseline = calculateFairJobScoreV2(input, clock);
    const withRuntimeExtras = calculateFairJobScoreV2({
      ...input,
      activeBoost: true,
      paidProduct: "boost-30d",
    } as FairJobInput, clock);

    expect(boostKeysAreAbsent).toBe(true);
    expect(withRuntimeExtras).toEqual(baseline);
  });
});
