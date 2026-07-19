// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  aggregateEmployerMetricsV1,
  type EmployerMetricEventV1,
} from "@/lib/analytics/employer-metrics";

const from = new Date("2026-01-01T00:00:00.000Z");
const to = new Date("2026-02-01T00:00:00.000Z");

function event(
  index: number,
  kind: EmployerMetricEventV1["kind"],
  overrides: Partial<EmployerMetricEventV1> = {},
): EmployerMetricEventV1 {
  return {
    eventId: `${kind}-${index}`,
    kind,
    occurredAt: new Date("2026-01-15T00:00:00.000Z"),
    companyId: "company-a",
    jobId: "job-a",
    subjectId: `subject-${index}`,
    actorProvenance: "LIVE",
    companyProvenance: "LIVE",
    jobProvenance: "LIVE",
    ...overrides,
  };
}

describe("employer metrics v1", () => {
  it("denies NONE entitlement and withholds breakdowns from BASIC", () => {
    expect(
      aggregateEmployerMetricsV1([], {
        companyId: "company-a",
        from,
        to,
        analyticsLevel: "NONE",
      }),
    ).toEqual({ allowed: false, reason: "ANALYTICS_ENTITLEMENT_REQUIRED" });

    const basic = aggregateEmployerMetricsV1([event(1, "JOB_DETAIL_VIEWED")], {
      companyId: "company-a",
      from,
      to,
      analyticsLevel: "BASIC",
    });
    expect(basic.allowed).toBe(true);
    if (basic.allowed) {
      expect(basic.jobBreakdown).toBeNull();
      expect(basic.totals).toEqual({
        status: "SUPPRESSED",
        detailViews: "SUPPRESSED",
        saves: "SUPPRESSED",
        applications: "SUPPRESSED",
        employerResponses: "SUPPRESSED",
        applyRateBps: "SUPPRESSED",
      });
    }
  });

  it("scopes by tenant, separate LIVE provenance, half-open window, and event id", () => {
    const valid = Array.from({ length: 20 }, (_, index) =>
      event(index, "JOB_DETAIL_VIEWED"),
    );
    const result = aggregateEmployerMetricsV1(
      [
        ...valid,
        valid[0]!,
        event(20, "JOB_DETAIL_VIEWED", { companyId: "company-b" }),
        event(21, "JOB_DETAIL_VIEWED", { actorProvenance: "DEMO" }),
        event(22, "JOB_DETAIL_VIEWED", { companyProvenance: "TEST" }),
        event(23, "JOB_DETAIL_VIEWED", { jobProvenance: "DEMO" }),
        event(24, "JOB_DETAIL_VIEWED", { occurredAt: to }),
      ],
      { companyId: "company-a", from, to, analyticsLevel: "BASIC" },
    );
    expect(result.allowed && result.totals.detailViews).toBe(20);
  });

  it("suppresses a 19-subject job breakdown and exposes zero/20 safely", () => {
    const nineteen = Array.from({ length: 19 }, (_, index) =>
      event(index, "JOB_DETAIL_VIEWED"),
    );
    const suppressed = aggregateEmployerMetricsV1(nineteen, {
      companyId: "company-a",
      from,
      to,
      analyticsLevel: "ADVANCED",
    });
    expect(suppressed.allowed && suppressed.jobBreakdown?.[0]?.applyRate.status).toBe(
      "SUPPRESSED",
    );

    const twenty = [...nineteen, event(19, "JOB_DETAIL_VIEWED")];
    const visible = aggregateEmployerMetricsV1(twenty, {
      companyId: "company-a",
      from,
      to,
      analyticsLevel: "PRO",
    });
    if (!visible.allowed) {
      throw new Error("PRO analytics should be allowed.");
    }
    expect(visible.jobBreakdown?.[0]).toMatchObject({
      detailViews: 20,
      saves: 0,
      applications: 0,
      applyRate: {
        status: "VALUE",
        numerator: 0,
        denominator: 20,
        valueBps: 0,
      },
    });
    expect(visible.totals.status).toBe("VALUE");
  });

  it("aggregates distinct subjects without accepting message content", () => {
    const events = [
      ...Array.from({ length: 20 }, (_, index) => event(index, "JOB_DETAIL_VIEWED")),
      event(100, "APPLICATION_SUBMITTED", { subjectId: "subject-0" }),
      event(101, "APPLICATION_SUBMITTED", { subjectId: "subject-1" }),
      event(102, "JOB_SAVED", { subjectId: "subject-1" }),
      event(103, "EMPLOYER_RESPONSE_RECORDED", { subjectId: "subject-0" }),
    ];
    const result = aggregateEmployerMetricsV1(events, {
      companyId: "company-a",
      from,
      to,
      analyticsLevel: "ADVANCED",
    });
    if (!result.allowed) {
      throw new Error("ADVANCED analytics should be allowed.");
    }
    expect(result.totals).toEqual({
      status: "VALUE",
      detailViews: 20,
      saves: 1,
      applications: 2,
      employerResponses: 1,
      applyRateBps: 1_000,
    });
  });
});
