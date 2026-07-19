// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  calculateEmployerResponseHistoryV1,
  compareJobsByEmployerResponseV1,
  type EmployerResponseCaseV1,
  type EmployerResponseHistoryV1,
} from "@/lib/analytics/response-policy-v1";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const now = new Date("2026-04-01T00:00:00.000Z");

function dueCases(count: number, onTime: number): EmployerResponseCaseV1[] {
  return Array.from({ length: count }, (_, index) => {
    const submittedAt = new Date(now.getTime() - 10 * DAY_MS - index * MINUTE_MS);
    return {
      applicationId: `application-${index}`,
      submittedAt,
      responseTargetDays: 1,
      firstResponseAt: index < onTime
        ? new Date(submittedAt.getTime() + 60 * MINUTE_MS)
        : index === onTime
          ? new Date(submittedAt.getTime() + 2 * DAY_MS)
          : null,
    };
  });
}

describe("EMPLOYER_RESPONSE_POLICY_V1", () => {
  it("returns UNKNOWN below 20 due cases and KNOWN at 20", () => {
    const unknown = calculateEmployerResponseHistoryV1(dueCases(19, 19), { now });
    expect(unknown).toEqual({
      status: "UNKNOWN",
      dueCases: "SUPPRESSED",
      respondedCases: "SUPPRESSED",
      onTimeCases: "SUPPRESSED",
      onTimeRateBps: "SUPPRESSED",
      medianFirstResponseMinutes: "SUPPRESSED",
      reliability: "UNKNOWN",
      cockpitRisk: null,
    });
    expect(Object.values(unknown).some((value) => typeof value === "number")).toBe(
      false,
    );
    const known = calculateEmployerResponseHistoryV1(dueCases(20, 20), { now });
    expect(known.status).toBe("KNOWN");
    expect(known.onTimeRateBps).toBe(10_000);
    expect(known.reliability).toBe("RELIABLE");
  });

  it("counts distinct applications so duplicates cannot bypass suppression", () => {
    const duplicate = dueCases(1, 1)[0]!;
    expect(
      calculateEmployerResponseHistoryV1(
        Array.from({ length: 20 }, () => ({ ...duplicate })),
        { now },
      ).status,
    ).toBe("UNKNOWN");
  });

  it("uses 8000 bps for RELIABLE and a separate strict 7000 bps risk", () => {
    const reliable = calculateEmployerResponseHistoryV1(dueCases(20, 16), { now });
    expect(reliable.onTimeRateBps).toBe(8_000);
    expect(reliable.reliability).toBe("RELIABLE");

    const atRiskBoundary = calculateEmployerResponseHistoryV1(dueCases(20, 14), { now });
    expect(atRiskBoundary.onTimeRateBps).toBe(7_000);
    expect(atRiskBoundary.reliability).toBe("NOT_RELIABLE");
    expect(atRiskBoundary.cockpitRisk).toBe(false);

    const risk = calculateEmployerResponseHistoryV1(dueCases(20, 13), { now });
    expect(risk.onTimeRateBps).toBe(6_500);
    expect(risk.cockpitRisk).toBe(true);
  });

  it("uses the rolling half-open window and only valid due targets", () => {
    const entries: EmployerResponseCaseV1[] = [
      ...dueCases(20, 20),
      {
        applicationId: "lower-bound",
        submittedAt: new Date(now.getTime() - 90 * DAY_MS),
        responseTargetDays: 1,
        firstResponseAt: new Date(now.getTime() - 89 * DAY_MS),
      },
      {
        applicationId: "upper-bound",
        submittedAt: now,
        responseTargetDays: 1,
        firstResponseAt: now,
      },
      {
        applicationId: "not-due",
        submittedAt: new Date(now.getTime() - DAY_MS + 1),
        responseTargetDays: 1,
        firstResponseAt: null,
      },
      {
        applicationId: "invalid-target",
        submittedAt: new Date(now.getTime() - 10 * DAY_MS),
        responseTargetDays: 31,
        firstResponseAt: null,
      },
    ];
    expect(calculateEmployerResponseHistoryV1(entries, { now }).dueCases).toBe(21);
  });

  it("suppresses a median backed by fewer than 20 responses", () => {
    const entries = dueCases(20, 20).map((entry, index) => ({
      ...entry,
      firstResponseAt: index === 19 ? null : entry.firstResponseAt,
    }));
    expect(
      calculateEmployerResponseHistoryV1(entries, { now }).medianFirstResponseMinutes,
    ).toBe("SUPPRESSED");
  });

  it("stores a 20-response even-sample median with half-up integer minutes", () => {
    const entries = dueCases(20, 20).map((entry, index) => ({
      ...entry,
      firstResponseAt: new Date(
        entry.submittedAt.getTime() + (index < 10 ? 10 : 11) * MINUTE_MS,
      ),
    }));
    expect(
      calculateEmployerResponseHistoryV1(entries, { now }).medianFirstResponseMinutes,
    ).toBe(11);
  });

  it("excludes a firstResponseAt that predates submission", () => {
    const entries = dueCases(20, 0).map((entry, index) => ({
      ...entry,
      firstResponseAt: index === 0
        ? new Date(entry.submittedAt.getTime() - MINUTE_MS)
        : null,
    }));
    expect(calculateEmployerResponseHistoryV1(entries, { now })).toMatchObject({
      dueCases: 20,
      respondedCases: 0,
      onTimeCases: 0,
      medianFirstResponseMinutes: "SUPPRESSED",
    });
  });

  it("sorts known before unknown", () => {
    const knownFast = calculateEmployerResponseHistoryV1(dueCases(20, 20), { now });
    const unknown = calculateEmployerResponseHistoryV1(dueCases(19, 19), { now });
    const jobs = [
      { id: "unknown", publishedAt: now, response: unknown },
      { id: "known", publishedAt: new Date(now.getTime() - DAY_MS), response: knownFast },
    ];
    expect(jobs.sort(compareJobsByEmployerResponseV1).map((job) => job.id)).toEqual([
      "known",
      "unknown",
    ]);
  });

  it("never sorts UNKNOWN jobs by hidden rate or median runtime extras", () => {
    const unknown = calculateEmployerResponseHistoryV1(dueCases(19, 19), { now });
    const withHiddenFastValues = {
      ...unknown,
      onTimeRateBps: 10_000,
      medianFirstResponseMinutes: 1,
    } as unknown as EmployerResponseHistoryV1;
    const withHiddenSlowValues = {
      ...unknown,
      onTimeRateBps: 0,
      medianFirstResponseMinutes: 100_000,
    } as unknown as EmployerResponseHistoryV1;
    const jobs = [
      {
        id: "older-hidden-fast",
        publishedAt: new Date(now.getTime() - DAY_MS),
        response: withHiddenFastValues,
      },
      {
        id: "newer-hidden-slow",
        publishedAt: now,
        response: withHiddenSlowValues,
      },
    ];

    expect(jobs.sort(compareJobsByEmployerResponseV1).map((job) => job.id)).toEqual([
      "newer-hidden-slow",
      "older-hidden-fast",
    ]);
  });

  it("sorts KNOWN jobs by rate and only then by a visible median", () => {
    const known = (
      overrides: Partial<Extract<EmployerResponseHistoryV1, { status: "KNOWN" }>>,
    ): EmployerResponseHistoryV1 => ({
      status: "KNOWN",
      dueCases: 20,
      respondedCases: 20,
      onTimeCases: 16,
      onTimeRateBps: 8_000,
      medianFirstResponseMinutes: 60,
      reliability: "RELIABLE",
      cockpitRisk: false,
      ...overrides,
    });
    const jobs = [
      { id: "slow", publishedAt: now, response: known({ medianFirstResponseMinutes: 120 }) },
      { id: "fast", publishedAt: now, response: known({ medianFirstResponseMinutes: 30 }) },
      { id: "suppressed", publishedAt: now, response: known({ medianFirstResponseMinutes: "SUPPRESSED" }) },
      { id: "higher-rate", publishedAt: now, response: known({ onTimeRateBps: 9_000 }) },
    ];

    expect(jobs.sort(compareJobsByEmployerResponseV1).map((job) => job.id)).toEqual([
      "higher-rate",
      "fast",
      "slow",
      "suppressed",
    ]);
  });
});
