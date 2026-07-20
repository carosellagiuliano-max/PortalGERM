// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDatabase: vi.fn() }));

import {
  PUBLIC_SALARY_DATASET_KEY,
  buildSalaryPolicyQuery,
  loadPublicSalaryRadar,
  parsePublicSalaryRadarQuery,
  toPublicSalaryRadarResult,
} from "@/lib/salary/public-radar";
import type {
  SalaryBandV1,
  SalaryDatasetVersionV1,
  SalaryRadarResultV1,
} from "@/lib/salary/policy-v1";

const NOW = new Date("2026-07-20T12:00:00.000Z");

const PUBLIC_INPUT = Object.freeze({
  jobTitle: "  <b>Senior Engineer</b><script>ignored()</script>  ",
  categorySlug: "informatik",
  cantonSlug: "zuerich",
  seniority: "SENIOR",
  workload: "80",
});

function internalFoundResult(
  overrides: Partial<Extract<SalaryRadarResultV1, { status: "FOUND" }>> = {},
): Extract<SalaryRadarResultV1, { status: "FOUND" }> {
  return {
    status: "FOUND",
    policyVersion: "v1",
    datasetId: "private-dataset-id",
    datasetKey: PUBLIC_SALARY_DATASET_KEY,
    datasetVersion: "<b>2026-v1</b>",
    source: "<b>Reviewed source</b><script>secret()</script>",
    methodology: "<i>Precomputed quantiles</i>",
    dataAsOf: new Date("2025-12-31T00:00:00.000Z"),
    scope: "CATEGORY_CANTON_ALL_SENIORITIES",
    sampleSizeBucket: "30–49",
    fteBand: { p25Chf: 90_000, medianChf: 108_000, p75Chf: 126_000 },
    workloadAdjustedBand: {
      workloadMin: 80,
      workloadMax: 80,
      atMinimum: { p25Chf: 72_000, medianChf: 86_400, p75Chf: 100_800 },
      atMaximum: { p25Chf: 72_000, medianChf: 86_400, p75Chf: 100_800 },
    },
    ...overrides,
  };
}

describe("public Salary Radar adapter", () => {
  it("strictly parses the allowlisted form and fixes the server dataset", () => {
    const result = parsePublicSalaryRadarQuery(PUBLIC_INPUT);

    expect(result).toEqual({
      datasetKey: PUBLIC_SALARY_DATASET_KEY,
      categorySlug: "informatik",
      cantonSlug: "zuerich",
      seniority: "SENIOR",
      workloadMin: 80,
      workloadMax: 80,
      jobTitle: "Senior Engineer",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("accepts a non-duplicated FormData payload", () => {
    const formData = new FormData();
    formData.set("categorySlug", "informatik");
    formData.set("cantonSlug", "zuerich");
    formData.set("seniority", "MID");
    formData.set("workload", "60");

    expect(parsePublicSalaryRadarQuery(formData)).toMatchObject({
      seniority: "MID",
      workloadMin: 60,
      workloadMax: 60,
    });
    formData.append("workload", "80");
    expect(parsePublicSalaryRadarQuery(formData)).toBeNull();
  });

  it.each([
    ["unknown field", { ...PUBLIC_INPUT, datasetKey: "attacker-controlled" }],
    ["invalid category", { ...PUBLIC_INPUT, categorySlug: "Informatik" }],
    ["invalid canton", { ...PUBLIC_INPUT, cantonSlug: "../zh" }],
    ["invalid seniority", { ...PUBLIC_INPUT, seniority: "PRINCIPAL" }],
    ["negative workload", { ...PUBLIC_INPUT, workload: "-1" }],
    ["zero workload", { ...PUBLIC_INPUT, workload: "0" }],
    ["workload below the public minimum", { ...PUBLIC_INPUT, workload: "19" }],
    ["workload over 100", { ...PUBLIC_INPUT, workload: "101" }],
    ["decimal workload", { ...PUBLIC_INPUT, workload: "80.5" }],
    ["oversized title", { ...PUBLIC_INPUT, jobTitle: "x".repeat(121) }],
  ])("rejects %s", (_label, input) => {
    expect(parsePublicSalaryRadarQuery(input)).toBeNull();
  });

  it("keeps the decorative job title out of the policy query", () => {
    const first = parsePublicSalaryRadarQuery(PUBLIC_INPUT);
    const second = parsePublicSalaryRadarQuery({
      ...PUBLIC_INPUT,
      jobTitle: "Pflegefachperson",
    });
    if (first === null || second === null) throw new Error("Invalid fixtures");
    const resolved = { categoryId: "category-1", cantonId: "canton-1", at: NOW };

    expect(buildSalaryPolicyQuery(first, resolved)).toEqual(
      buildSalaryPolicyQuery(second, resolved),
    );
    expect(buildSalaryPolicyQuery(first, resolved)).not.toHaveProperty("jobTitle");
  });

  it("exposes exactly the salary allowlist and sanitizes public metadata", () => {
    const internal = internalFoundResult();
    const result = toPublicSalaryRadarResult(internal);

    expect(result).toEqual({
      status: "FOUND",
      p25Chf: 90_000,
      medianChf: 108_000,
      p75Chf: 126_000,
      adjustedP25Chf: 72_000,
      adjustedMedianChf: 86_400,
      adjustedP75Chf: 100_800,
      period: "YEARLY_FTE",
      source: "Reviewed source",
      datasetVersion: "2026-v1",
      asOf: new Date("2025-12-31T00:00:00.000Z"),
      method: "Precomputed quantiles",
      fallbackScope: "CATEGORY_CANTON_ALL_SENIORITIES",
      sampleBucket: "30–49",
    });
    expect(Object.keys(result).sort()).toEqual([
      "adjustedMedianChf",
      "adjustedP25Chf",
      "adjustedP75Chf",
      "asOf",
      "datasetVersion",
      "fallbackScope",
      "medianChf",
      "method",
      "p25Chf",
      "p75Chf",
      "period",
      "sampleBucket",
      "source",
      "status",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /datasetId|datasetKey|sampleSize|private-dataset-id|secret/u,
    );
    expect(result.status === "FOUND" && result.asOf).not.toBe(internal.dataAsOf);
  });

  it("preserves an honest policy no-result without adding salary claims", () => {
    expect(
      toPublicSalaryRadarResult({
        status: "NO_RESULT",
        reason: "NO_QUALIFYING_BAND",
        adjacentCategoryGuidance: true,
      }),
    ).toEqual({
      status: "NO_RESULT",
      reason: "NO_QUALIFYING_BAND",
      adjacentCategoryGuidance: true,
    });
  });

  it("rejects a workload range because the public contract has one workload", () => {
    expect(() =>
      toPublicSalaryRadarResult(
        internalFoundResult({
          workloadAdjustedBand: {
            workloadMin: 60,
            workloadMax: 80,
            atMinimum: { p25Chf: 54_000, medianChf: 64_800, p75Chf: 75_600 },
            atMaximum: { p25Chf: 72_000, medianChf: 86_400, p75Chf: 100_800 },
          },
        }),
      ),
    ).toThrow(RangeError);
  });

  it("loads by canonical ids and still returns no internal ids or sample count", async () => {
    const band: SalaryBandV1 = {
      id: "private-band-id",
      categoryId: "category-1",
      cantonId: "canton-1",
      seniority: "SENIOR",
      workloadMin: 100,
      workloadMax: 100,
      period: "YEARLY",
      p25Chf: 100_000,
      medianChf: 120_000,
      p75Chf: 140_000,
      sampleSize: 50,
    };
    const dataset: SalaryDatasetVersionV1 = {
      id: "private-dataset-id",
      datasetKey: PUBLIC_SALARY_DATASET_KEY,
      version: "2026-v1",
      source: "Reviewed source",
      methodology: "Reviewed method",
      dataAsOf: new Date("2025-12-31T00:00:00.000Z"),
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: new Date("2027-01-01T00:00:00.000Z"),
      reviewStatus: "APPROVED",
      bands: [band],
    };
    const findMany = vi.fn().mockResolvedValue([dataset]);
    const database = {
      category: {
        findUnique: vi.fn().mockResolvedValue({ id: "category-1", isActive: true }),
      },
      canton: { findUnique: vi.fn().mockResolvedValue({ id: "canton-1" }) },
      salaryDatasetVersion: { findMany },
    };
    const query = parsePublicSalaryRadarQuery(PUBLIC_INPUT);
    if (query === null) throw new Error("Invalid fixture");

    const result = await loadPublicSalaryRadar(query, {
      now: NOW,
      database: database as never,
      dataContext: { liveOnly: false },
    });

    expect(result).toMatchObject({
      status: "FOUND",
      adjustedMedianChf: 96_000,
      sampleBucket: "50–99",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-band-id|private-dataset-id|sampleSize|jobTitle/u,
    );
    expect(JSON.stringify(findMany.mock.calls)).not.toContain("Senior Engineer");
  });

  it("never exposes the fictional Phase-05 dataset in a production-like context", async () => {
    const database = {
      category: { findUnique: vi.fn() },
      canton: { findUnique: vi.fn() },
      salaryDatasetVersion: { findMany: vi.fn() },
    };
    const query = parsePublicSalaryRadarQuery(PUBLIC_INPUT);
    if (query === null) throw new Error("Invalid fixture");

    await expect(
      loadPublicSalaryRadar(query, {
        now: NOW,
        database: database as never,
        dataContext: { liveOnly: true },
      }),
    ).resolves.toEqual({
      status: "NO_RESULT",
      reason: "NO_EFFECTIVE_DATASET",
      adjacentCategoryGuidance: false,
    });
    expect(database.category.findUnique).not.toHaveBeenCalled();
    expect(database.canton.findUnique).not.toHaveBeenCalled();
    expect(database.salaryDatasetVersion.findMany).not.toHaveBeenCalled();
  });
});
