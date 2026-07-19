// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_PARENT_DIMENSION_V1,
  buildProtectedComplementMetricCellV1,
  buildSuppressedMetricCellV1,
  isInHalfOpenWindow,
  medianInteger,
  ratioToBasisPoints,
  roundHalfUp,
  selectSafeParentRollupV1,
  type AnalyticsMetricSegmentV1,
} from "@/lib/analytics/metric-contracts";

function observations(prefix: string, count: number, qualifies = 0) {
  return Array.from({ length: count }, (_, index) => ({
    subjectId: `${prefix}-${index}`,
    qualifies: index < qualifies,
  }));
}

function segment(
  overrides: Partial<AnalyticsMetricSegmentV1> = {},
): AnalyticsMetricSegmentV1 {
  return {
    dimension: "JOB",
    key: "job-a",
    parentKey: "company-a",
    observations: observations("subject", 19),
    ...overrides,
  };
}

describe("analytics metric primitives v1", () => {
  it("uses half-up integer arithmetic for ratios and medians", () => {
    expect(roundHalfUp(12.5)).toBe(13);
    expect(ratioToBasisPoints(1, 8)).toBe(1_250);
    expect(medianInteger([5, 1, 3])).toBe(3);
    expect(medianInteger([10, 11])).toBe(11);
    expect(medianInteger([])).toBeNull();
  });

  it("uses half-open windows", () => {
    const window = {
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-02-01T00:00:00.000Z"),
    };
    expect(isInHalfOpenWindow(window.from, window)).toBe(true);
    expect(isInHalfOpenWindow(new Date("2026-01-31T23:59:59.999Z"), window)).toBe(true);
    expect(isInHalfOpenWindow(window.to, window)).toBe(false);
  });

  it("suppresses 19 distinct subjects, including their values", () => {
    const result = buildSuppressedMetricCellV1(
      Array.from({ length: 19 }, (_, index) => ({
        subjectId: `subject-${index}`,
        qualifies: index === 0,
      })),
    );
    expect(result).toEqual({
      status: "SUPPRESSED",
      numerator: "SUPPRESSED",
      denominator: "SUPPRESSED",
      valueBps: "SUPPRESSED",
    });
  });

  it("shows a real zero only at 20 distinct denominator subjects", () => {
    const result = buildSuppressedMetricCellV1(
      Array.from({ length: 20 }, (_, index) => ({
        subjectId: `subject-${index}`,
        qualifies: false,
      })),
    );
    expect(result).toEqual({
      status: "VALUE",
      numerator: 0,
      denominator: 20,
      valueBps: 0,
    });
  });

  it("does not let duplicate subjects inflate the denominator", () => {
    const result = buildSuppressedMetricCellV1(
      Array.from({ length: 20 }, () => ({
        subjectId: "same-subject",
        qualifies: true,
      })),
    );
    expect(result.status).toBe("SUPPRESSED");
  });

  it("rolls a suppressed child only into its independently visible declared parent", () => {
    expect(ANALYTICS_PARENT_DIMENSION_V1.JOB).toBe("COMPANY");
    const child = segment({ observations: observations("child", 19, 1) });
    const parent = segment({
      dimension: "COMPANY",
      key: "company-a",
      parentKey: "all",
      observations: [
        ...child.observations,
        ...observations("parent", 20, 4),
      ],
    });
    expect(selectSafeParentRollupV1(child, parent)).toMatchObject({
      dimension: "COMPANY",
      key: "company-a",
      rolledUpFrom: { dimension: "JOB", key: "job-a" },
      cell: { status: "VALUE", denominator: 39, numerator: 5 },
    });
    expect(selectSafeParentRollupV1(child, undefined).cell.status).toBe(
      "SUPPRESSED",
    );

    const adHocParent = segment({
      dimension: "ALL",
      key: "all",
      parentKey: null,
      observations: parent.observations,
    });
    expect(selectSafeParentRollupV1(child, adHocParent).cell.status).toBe(
      "SUPPRESSED",
    );
  });

  it("blocks a parent roll-up when visible siblings make the child derivable", () => {
    const child = segment({ observations: observations("hidden", 19, 1) });
    const sibling = segment({
      key: "job-b",
      observations: observations("visible", 20, 5),
    });
    const parent = segment({
      dimension: "COMPANY",
      key: "company-a",
      parentKey: "all",
      observations: [...child.observations, ...sibling.observations],
    });
    expect(selectSafeParentRollupV1(child, parent, [sibling])).toEqual({
      dimension: "JOB",
      key: "job-a",
      rolledUpFrom: null,
      cell: {
        status: "SUPPRESSED",
        numerator: "SUPPRESSED",
        denominator: "SUPPRESSED",
        valueBps: "SUPPRESSED",
      },
    });
  });

  it("does not treat overlapping subjects as an exact subtractable partition", () => {
    const child = segment({ observations: observations("shared", 19, 1) });
    const sibling = segment({
      key: "job-b",
      observations: [
        ...observations("shared", 1, 1),
        ...observations("sibling", 19, 4),
      ],
    });
    const parent = segment({
      dimension: "COMPANY",
      key: "company-a",
      parentKey: "all",
      observations: [...child.observations, ...sibling.observations],
    });
    expect(selectSafeParentRollupV1(child, parent, [sibling]).cell.status).toBe(
      "VALUE",
    );
  });

  it("suppresses complements that could disclose a suppressed child", () => {
    const hidden = segment({ observations: observations("hidden", 19, 1) });
    const visible = segment({
      key: "job-b",
      observations: observations("visible", 20, 5),
    });
    const remainder = observations("remainder", 20, 2);
    const parent = segment({
      dimension: "COMPANY",
      key: "company-a",
      parentKey: "all",
      observations: [...hidden.observations, ...visible.observations, ...remainder],
    });

    expect(buildProtectedComplementMetricCellV1(parent, [hidden]).status).toBe(
      "SUPPRESSED",
    );
    expect(buildProtectedComplementMetricCellV1(parent, [visible])).toMatchObject({
      status: "VALUE",
      denominator: 39,
    });
  });
});
