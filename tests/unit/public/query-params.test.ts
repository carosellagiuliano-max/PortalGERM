import { describe, expect, it } from "vitest";

import {
  hasBlockingPublicJobSearchIssue,
  parsePublicJobSearchParams,
  publicJobSearchQuery,
} from "@/lib/public/query-params";

describe("public job query parameters", () => {
  it("normalizes and allowlists the canonical public search contract", () => {
    const parsed = parsePublicJobSearchParams({
      keyword: "  Data Engineer  ",
      canton: ["zuerich,bern", "zuerich"],
      city: "winterthur",
      radius: "25",
      category: ["it-software", "gesundheit"],
      workloadMin: "60",
      workloadMax: "100",
      jobType: "permanent,temporary",
      remoteType: "hybrid,remote",
      language: ["de", "EN"],
      applicationEffort: "simple,long",
      salaryMin: "120000",
      salaryPeriod: "yearly",
      salaryDisclosed: "true",
      evidence: "response",
      companyVerified: "true",
      sort: "salary",
      pageSize: "30",
      after: "signed-cursor",
    });

    expect(parsed).toEqual({
      keyword: "Data Engineer",
      cantonSlugs: ["zuerich", "bern"],
      citySlugs: ["winterthur"],
      radiusKm: 25,
      categorySlugs: ["it-software", "gesundheit"],
      workloadMin: 60,
      workloadMax: 100,
      jobTypes: ["PERMANENT", "TEMPORARY"],
      remoteTypes: ["HYBRID", "REMOTE"],
      languages: ["DE", "EN"],
      efforts: ["SIMPLE", "LONG"],
      salaryMin: 120_000,
      salaryPeriod: "YEARLY",
      salaryDisclosedOnly: true,
      responseEvidenceOnly: true,
      companyVerifiedOnly: true,
      sort: "salary",
      pageSize: 30,
      after: "signed-cursor",
      validationIssues: [],
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.cantonSlugs)).toBe(true);
    expect(Object.isFrozen(parsed.validationIssues)).toBe(true);
  });

  it("accepts legacy aliases but emits only canonical parameter names", () => {
    const input = parsePublicJobSearchParams({
      workload: "80",
      remote: "hybrid",
      effort: "medium",
      salary: "100000",
      salaryPeriod: "YEARLY",
      sort: "fair-score",
      cursor: "old-cursor",
    });

    expect(input).toMatchObject({
      workloadMin: 80,
      workloadMax: 80,
      remoteTypes: ["HYBRID"],
      efforts: ["MEDIUM"],
      salaryMin: 100_000,
      salaryPeriod: "YEARLY",
      sort: "fair-score",
      after: "old-cursor",
      validationIssues: [],
    });

    const serialized = publicJobSearchQuery(input, { after: "next-cursor" });
    const params = new URLSearchParams(serialized.slice(1));
    expect(params.get("workloadMin")).toBe("80");
    expect(params.get("workloadMax")).toBe("80");
    expect(params.get("remoteType")).toBe("HYBRID");
    expect(params.get("applicationEffort")).toBe("MEDIUM");
    expect(params.get("salaryMin")).toBe("100000");
    expect(params.get("sort")).toBe("fairjobscore");
    expect(params.get("after")).toBe("next-cursor");
    expect(serialized).not.toMatch(/[?&](?:workload|remote|effort|salary|cursor)=/u);
    expect(publicJobSearchQuery(input, { after: null })).not.toContain("after=");
  });

  it("serializes multi-value filters in one stable canonical order", () => {
    const input = parsePublicJobSearchParams({
      canton: ["zuerich", "bern"],
      category: ["technik", "administration"],
      jobType: ["TEMPORARY", "PERMANENT"],
    });

    expect(publicJobSearchQuery(input)).toBe(
      "?canton=bern&canton=zuerich&category=administration&category=technik&jobType=PERMANENT&jobType=TEMPORARY",
    );
  });

  it("preserves a typed blocking prompt when salary values are not comparable", () => {
    const parsed = parsePublicJobSearchParams({
      salaryMin: "120000",
      sort: "salary-desc",
    });

    expect(parsed.salaryPeriod).toBeUndefined();
    expect(parsed.validationIssues).toContainEqual({
      field: "salaryPeriod",
      code: "REQUIRED",
    });
    expect(hasBlockingPublicJobSearchIssue(parsed)).toBe(true);
  });

  it("requires exactly one City for a bounded radius and serializes it canonically", () => {
    const valid = parsePublicJobSearchParams({ city: "winterthur", radius: "25" });
    expect(valid).toMatchObject({
      citySlugs: ["winterthur"],
      radiusKm: 25,
      validationIssues: [],
    });
    expect(publicJobSearchQuery(valid)).toBe("?city=winterthur&radius=25");

    const missingCity = parsePublicJobSearchParams({ radius: "25" });
    expect(missingCity.validationIssues).toContainEqual({
      field: "city",
      code: "REQUIRED",
    });
    expect(hasBlockingPublicJobSearchIssue(missingCity)).toBe(true);

    const multipleCities = parsePublicJobSearchParams({
      city: ["winterthur", "zuerich-stadt"],
      radius: "25",
    });
    expect(multipleCities.validationIssues).toContainEqual({
      field: "city",
      code: "CONFLICT",
    });
    expect(hasBlockingPublicJobSearchIssue(multipleCities)).toBe(true);

    const outOfRange = parsePublicJobSearchParams({ city: "winterthur", radius: "201" });
    expect(outOfRange.radiusKm).toBeUndefined();
    expect(outOfRange.validationIssues).toContainEqual({
      field: "radius",
      code: "OUT_OF_RANGE",
    });
    expect(hasBlockingPublicJobSearchIssue(outOfRange)).toBe(true);
  });

  it("fails closed and retains typed issues for malformed values", () => {
    const parsed = parsePublicJobSearchParams({
      keyword: "x".repeat(121),
      canton: ["../admin", "zürich", "valid-slug"],
      workloadMin: "90",
      workloadMax: "20",
      jobType: "OWNER",
      remoteType: "EVERYWHERE",
      language: "ES",
      applicationEffort: "INSTANT",
      salaryMin: "0",
      salaryPeriod: "WEEKLY",
      salaryDisclosed: "yes",
      evidence: "true",
      companyVerified: "1",
      sort: "random",
      pageSize: "500",
      after: "x".repeat(4_097),
    });

    expect(parsed).toMatchObject({
      cantonSlugs: ["valid-slug"],
      jobTypes: [],
      remoteTypes: [],
      languages: [],
      efforts: [],
      salaryDisclosedOnly: false,
      responseEvidenceOnly: false,
      companyVerifiedOnly: false,
      sort: "relevance",
      pageSize: 20,
    });
    expect(parsed.workloadMin).toBeUndefined();
    expect(parsed.workloadMax).toBeUndefined();
    expect(parsed.after).toBeUndefined();
    expect(parsed.validationIssues).toEqual(expect.arrayContaining([
      { field: "keyword", code: "OUT_OF_RANGE" },
      { field: "canton", code: "INVALID_VALUE" },
      { field: "workloadMin", code: "CONFLICT" },
      { field: "salaryPeriod", code: "INVALID_VALUE" },
      { field: "pageSize", code: "OUT_OF_RANGE" },
      { field: "after", code: "OUT_OF_RANGE" },
    ]));
  });

  it("does not add a question mark for the default query", () => {
    const parsed = parsePublicJobSearchParams({});
    expect(parsed).toMatchObject({
      sort: "relevance",
      pageSize: 20,
      validationIssues: [],
    });
    expect(publicJobSearchQuery(parsed)).toBe("");
  });
});
