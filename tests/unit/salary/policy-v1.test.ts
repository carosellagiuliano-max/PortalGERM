// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  selectSalaryRadarBandV1,
  type SalaryBandV1,
  type SalaryDatasetVersionV1,
} from "@/lib/salary/policy-v1";

const at = new Date("2026-06-01T00:00:00.000Z");

function band(overrides: Partial<SalaryBandV1> = {}): SalaryBandV1 {
  return {
    id: "band",
    categoryId: "category-it",
    cantonId: "canton-zh",
    seniority: "SENIOR",
    workloadMin: 100,
    workloadMax: 100,
    period: "YEARLY",
    p25Chf: 80_001,
    medianChf: 100_001,
    p75Chf: 120_001,
    sampleSize: 30,
    ...overrides,
  };
}

function dataset(
  bands: readonly SalaryBandV1[],
  overrides: Partial<SalaryDatasetVersionV1> = {},
): SalaryDatasetVersionV1 {
  return {
    id: "dataset",
    datasetKey: "swiss-salary",
    version: "2026-v1",
    source: "Reviewed Swiss salary fixture",
    methodology: "Precomputed YEARLY/FTE quantiles",
    dataAsOf: new Date("2025-12-31T00:00:00.000Z"),
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validTo: new Date("2027-01-01T00:00:00.000Z"),
    reviewStatus: "APPROVED",
    bands,
    ...overrides,
  };
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    datasetKey: "swiss-salary",
    categoryId: "category-it",
    cantonId: "canton-zh",
    seniority: "SENIOR" as const,
    workloadMin: 50,
    workloadMax: 80,
    at,
    ...overrides,
  };
}

describe("SALARY_RADAR_POLICY_V1", () => {
  it("selects exactly one APPROVED dataset in a half-open interval", () => {
    const source = dataset([band()]);
    expect(
      selectSalaryRadarBandV1([source], query({ at: source.validFrom })).status,
    ).toBe("FOUND");
    expect(
      selectSalaryRadarBandV1([source], query({ at: source.validTo })),
    ).toEqual({
        status: "NO_RESULT",
        reason: "NO_EFFECTIVE_DATASET",
        adjacentCategoryGuidance: true,
      });
    expect(
      selectSalaryRadarBandV1(
        [source, dataset([band()], { id: "dataset-2", version: "2026-v2" })],
        query(),
      ),
    ).toEqual({
      status: "NO_RESULT",
      reason: "AMBIGUOUS_DATASET",
      adjacentCategoryGuidance: false,
    });
  });

  it.each([
    ["CATEGORY_CANTON_SENIORITY", band()],
    ["CATEGORY_CANTON_ALL_SENIORITIES", band({ seniority: null })],
    ["CATEGORY_SWITZERLAND_SENIORITY", band({ cantonId: null })],
    ["CATEGORY_SWITZERLAND_ALL", band({ cantonId: null, seniority: null })],
  ] as const)("uses the exact %s fallback scope", (scope, selectedBand) => {
    const result = selectSalaryRadarBandV1([dataset([selectedBand])], query());
    expect(result.status === "FOUND" && result.scope).toBe(scope);
  });

  it("skips sample 29 and accepts sample 30 at the next fallback", () => {
    const result = selectSalaryRadarBandV1(
      [
        dataset([
          band({ id: "exact-29", sampleSize: 29 }),
          band({ id: "canton-30", seniority: null, sampleSize: 30 }),
        ]),
      ],
      query(),
    );
    expect(result.status === "FOUND" && result.scope).toBe(
      "CATEGORY_CANTON_ALL_SENIORITIES",
    );
    expect(result.status === "FOUND" && result.sampleSizeBucket).toBe("30–49");
  });

  it.each([
    [49, "30–49"],
    [50, "50–99"],
    [99, "50–99"],
    [100, "100+"],
  ] as const)("maps sample %i to %s", (sampleSize, expectedBucket) => {
    const result = selectSalaryRadarBandV1(
      [dataset([band({ sampleSize })])],
      query(),
    );
    expect(result.status === "FOUND" && result.sampleSizeBucket).toBe(expectedBucket);
  });

  it("returns source/method/scope and half-up workload values per bound", () => {
    const result = selectSalaryRadarBandV1([dataset([band()])], query());
    if (result.status !== "FOUND") {
      throw new Error("The salary fixture should produce a result.");
    }
    expect(result).toMatchObject({
      datasetVersion: "2026-v1",
      source: "Reviewed Swiss salary fixture",
      methodology: "Precomputed YEARLY/FTE quantiles",
      scope: "CATEGORY_CANTON_SENIORITY",
      fteBand: { p25Chf: 80_001, medianChf: 100_001, p75Chf: 120_001 },
      workloadAdjustedBand: {
        workloadMin: 50,
        workloadMax: 80,
        atMinimum: { p25Chf: 40_001, medianChf: 50_001, p75Chf: 60_001 },
        atMaximum: { p25Chf: 64_001, medianChf: 80_001, p75Chf: 96_001 },
      },
    });
  });

  it("never crosses Category and returns honest no-result guidance", () => {
    expect(
      selectSalaryRadarBandV1(
        [dataset([band({ categoryId: "category-health", sampleSize: 1_000 })])],
        query(),
      ),
    ).toEqual({
      status: "NO_RESULT",
      reason: "NO_QUALIFYING_BAND",
      adjacentCategoryGuidance: true,
    });
  });

  it("fails closed on ambiguous bands, invalid quantiles, and workload", () => {
    expect(
      selectSalaryRadarBandV1(
        [dataset([band({ id: "one" }), band({ id: "two" })])],
        query(),
      ),
    ).toEqual({
      status: "NO_RESULT",
      reason: "AMBIGUOUS_BAND",
      adjacentCategoryGuidance: false,
    });
    expect(
      selectSalaryRadarBandV1(
        [dataset([band({ p25Chf: 120_000, medianChf: 100_000 })])],
        query(),
      ).status,
    ).toBe("NO_RESULT");
    expect(
      selectSalaryRadarBandV1([dataset([band()])], query({ workloadMin: 81, workloadMax: 80 })),
    ).toEqual({
      status: "NO_RESULT",
      reason: "INVALID_QUERY",
      adjacentCategoryGuidance: false,
    });
  });
});
