// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  listPublicJobs: vi.fn(),
  loadPublicSalaryRadar: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/jobs/public-read-model", () => ({
  emptyPublicJobSearchInput: () => ({
    cantonSlugs: [], citySlugs: [], categorySlugs: [], jobTypes: [],
    remoteTypes: [], languages: [], efforts: [], salaryDisclosedOnly: false,
    responseEvidenceOnly: false, companyVerifiedOnly: false, sort: "relevance",
  }),
  listPublicJobs: mocks.listPublicJobs,
}));
vi.mock("@/lib/salary/public-radar", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/salary/public-radar")>();
  return { ...original, loadPublicSalaryRadar: mocks.loadPublicSalaryRadar };
});

import { calculatePublicSalaryRadarAction } from "@/app/(public)/salary-radar/actions";

describe("public Salary Radar action", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getAuthRequestContext.mockResolvedValue({ sourceIp: "192.0.2.44" });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.listPublicJobs.mockResolvedValue({
      jobs: [], nextCursor: null, totalEligible: 0, invalidCursor: false,
    });
  });

  it("rejects invalid origins before parsing or querying salary data", async () => {
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);

    const result = await calculatePublicSalaryRadarAction(
      { status: "idle" },
      validFormData(),
    );

    expect(result).toMatchObject({ status: "error" });
    expect(mocks.loadPublicSalaryRadar).not.toHaveBeenCalled();
    expect(mocks.listPublicJobs).not.toHaveBeenCalled();
  });

  it.each(["0", "19", "101"])(
    "rejects a forged workload of %s before any database use case",
    async (workload) => {
      const formData = validFormData();
      formData.set("workload", workload);

      const result = await calculatePublicSalaryRadarAction(
        { status: "idle" },
        formData,
      );

      expect(result).toMatchObject({ status: "error" });
      expect(mocks.loadPublicSalaryRadar).not.toHaveBeenCalled();
      expect(mocks.listPublicJobs).not.toHaveBeenCalled();
    },
  );

  it("returns an honest sparse result without inventing adjacent jobs", async () => {
    mocks.loadPublicSalaryRadar.mockResolvedValue({
      status: "NO_RESULT",
      reason: "NO_QUALIFYING_BAND",
      adjacentCategoryGuidance: true,
    });

    const result = await calculatePublicSalaryRadarAction(
      { status: "idle" },
      validFormData(),
    );

    expect(result).toEqual({
      status: "result",
      result: {
        status: "NO_RESULT",
        reason: "NO_QUALIFYING_BAND",
        adjacentCategoryGuidance: true,
      },
      jobs: [],
    });
    expect(mocks.listPublicJobs).not.toHaveBeenCalled();
  });

  it("loads at most four eligible overlapping jobs for a found band", async () => {
    mocks.loadPublicSalaryRadar.mockResolvedValue(foundResult());
    mocks.listPublicJobs.mockResolvedValue({
      jobs: [
        salaryJob("inside", 90_000, 110_000),
        salaryJob("overlap", 119_000, 130_000),
        salaryJob("below", 50_000, 79_999),
        salaryJob("missing", null, null),
      ],
      nextCursor: null,
      totalEligible: 4,
      invalidCursor: false,
    });

    const result = await calculatePublicSalaryRadarAction(
      { status: "idle" },
      validFormData(),
    );

    expect(mocks.listPublicJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlugs: ["engineering-technik"],
        cantonSlugs: ["zuerich"],
        salaryMin: 80_000,
        sort: "salary",
      }),
      { pageSize: 20 },
    );
    expect(result).toMatchObject({
      status: "result",
      jobs: [{ slug: "inside" }, { slug: "overlap" }],
    });
  });
});

function validFormData() {
  const formData = new FormData();
  formData.set("jobTitle", "Ingenieur:in");
  formData.set("categorySlug", "engineering-technik");
  formData.set("cantonSlug", "zuerich");
  formData.set("seniority", "SENIOR");
  formData.set("workload", "80");
  return formData;
}

function foundResult() {
  return {
    status: "FOUND",
    p25Chf: 100_000,
    medianChf: 125_000,
    p75Chf: 150_000,
    adjustedP25Chf: 80_000,
    adjustedMedianChf: 100_000,
    adjustedP75Chf: 120_000,
    period: "YEARLY_FTE",
    source: "Geprüfter Datensatz",
    datasetVersion: "2026-v1",
    asOf: new Date("2026-06-30T00:00:00.000Z"),
    method: "Vorberechnete Quantile",
    fallbackScope: "CATEGORY_CANTON_SENIORITY",
    sampleBucket: "50–99",
  };
}

function salaryJob(slug: string, salaryMin: number | null, salaryMax: number | null) {
  return { slug, salaryMin, salaryMax };
}
