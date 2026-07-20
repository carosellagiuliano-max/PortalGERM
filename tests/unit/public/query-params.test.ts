import { describe, expect, it } from "vitest";

import {
  parsePublicJobSearchParams,
  publicJobSearchQuery,
} from "@/lib/public/query-params";

describe("public job query parameters", () => {
  it("normalizes and allowlists every public filter", () => {
    const parsed = parsePublicJobSearchParams({
      keyword: "  Data Engineer  ",
      canton: ["zuerich,bern", "zuerich", "Not Valid!"],
      city: "winterthur",
      category: ["it-software", "gesundheit"],
      workload: "60-100",
      jobType: ["permanent,temporary", "unknown"],
      remote: "hybrid,remote",
      language: ["de", "EN", "xx"],
      effort: "simple,long",
      salary: "120000",
      salaryDisclosed: "true",
      evidence: "response",
      companyVerified: "true",
      sort: "salary-desc",
      cursor: "signed-cursor",
    });

    expect(parsed).toEqual({
      keyword: "Data Engineer",
      cantonSlugs: ["zuerich", "bern"],
      citySlugs: ["winterthur"],
      categorySlugs: ["it-software", "gesundheit"],
      workloadMin: 60,
      workloadMax: 100,
      jobTypes: ["PERMANENT", "TEMPORARY"],
      remoteTypes: ["HYBRID", "REMOTE"],
      languages: ["DE", "EN"],
      efforts: ["SIMPLE", "LONG"],
      salaryMin: 120_000,
      salaryDisclosedOnly: true,
      responseEvidenceOnly: true,
      companyVerifiedOnly: true,
      sort: "salary",
      cursor: "signed-cursor",
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.cantonSlugs)).toBe(true);
  });

  it("fails closed for malformed, oversized and unknown values", () => {
    const parsed = parsePublicJobSearchParams({
      keyword: "x".repeat(121),
      canton: ["../admin", "zürich", "-bern", "valid-slug"],
      workload: "90-20",
      jobType: "OWNER",
      remote: "EVERYWHERE",
      language: "ES",
      effort: "INSTANT",
      salary: "0",
      salaryDisclosed: "yes",
      evidence: "true",
      companyVerified: "1",
      sort: "random",
      cursor: "x".repeat(4_097),
    });

    expect(parsed).toEqual({
      cantonSlugs: ["valid-slug"],
      citySlugs: [],
      categorySlugs: [],
      jobTypes: [],
      remoteTypes: [],
      languages: [],
      efforts: [],
      salaryDisclosedOnly: false,
      responseEvidenceOnly: false,
      companyVerifiedOnly: false,
      sort: "relevance",
    });
  });

  it("serializes only canonical filters and supports cursor replacement", () => {
    const input = parsePublicJobSearchParams({
      keyword: "Data Engineer",
      canton: ["zuerich", "bern"],
      workload: "80",
      jobType: "permanent",
      remote: "hybrid",
      language: "de",
      effort: "medium",
      salary: "100000",
      salaryDisclosed: "true",
      evidence: "response",
      companyVerified: "true",
      sort: "fair-score",
      cursor: "old-cursor",
    });

    const serialized = publicJobSearchQuery(input, { cursor: "next-cursor" });
    const params = new URLSearchParams(serialized.slice(1));

    expect(params.get("keyword")).toBe("Data Engineer");
    expect(params.getAll("canton")).toEqual(["zuerich", "bern"]);
    expect(params.get("workload")).toBe("80-80");
    expect(params.get("jobType")).toBe("PERMANENT");
    expect(params.get("remote")).toBe("HYBRID");
    expect(params.get("language")).toBe("DE");
    expect(params.get("effort")).toBe("MEDIUM");
    expect(params.get("salary")).toBe("100000");
    expect(params.get("salaryDisclosed")).toBe("true");
    expect(params.get("evidence")).toBe("response");
    expect(params.get("companyVerified")).toBe("true");
    expect(params.get("sort")).toBe("fair");
    expect(params.get("cursor")).toBe("next-cursor");
    expect(publicJobSearchQuery(input, { cursor: null })).not.toContain("cursor=");
  });

  it("does not add a question mark for the default query", () => {
    expect(parsePublicJobSearchParams({}).sort).toBe("relevance");
    expect(publicJobSearchQuery(parsePublicJobSearchParams({}))).toBe("");
  });
});
