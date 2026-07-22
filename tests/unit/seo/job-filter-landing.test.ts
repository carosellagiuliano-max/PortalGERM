import { describe, expect, it } from "vitest";

import { parsePublicJobSearchParams } from "@/lib/public/query-params";
import {
  exactClusterFilterFromSearch,
  hasRawPublicJobQueryState,
} from "@/lib/seo/job-filter-landing";

describe("Phase 15 exact cluster-filter redirect policy", () => {
  it.each([
    [
      { canton: "zuerich" },
      { kind: "canton", cantonSlug: "zuerich" },
    ],
    [
      { category: "engineering-technik" },
      { kind: "category", categorySlug: "engineering-technik" },
    ],
    [
      { category: "engineering-technik", canton: "zuerich" },
      {
        kind: "pair",
        cantonSlug: "zuerich",
        categorySlug: "engineering-technik",
      },
    ],
    [
      {
        canton: "11111111-1111-4111-8111-111111111111",
        category: "22222222-2222-4222-8222-222222222222",
      },
      {
        kind: "pair",
        cantonSlug: "11111111-1111-4111-8111-111111111111",
        categorySlug: "22222222-2222-4222-8222-222222222222",
      },
    ],
  ] as const)("recognizes the exact clean filter %#", (raw, expected) => {
    expect(exactClusterFilterFromSearch(raw, parsePublicJobSearchParams(raw))).toEqual(
      expected,
    );
  });

  it.each([
    { canton: ["zuerich", "bern"] },
    { canton: "zuerich", keyword: "pflege" },
    { canton: "zuerich", sort: "newest" },
    { canton: "zuerich", unknown: "1" },
    { remote: "HYBRID" },
    { canton: "" },
    { canton: "nicht gültig" },
  ])("rejects non-canonical or additional state %#", (raw) => {
    expect(exactClusterFilterFromSearch(raw, parsePublicJobSearchParams(raw))).toBeNull();
  });

  it("removes duplicate/default/empty successful form controls before redirecting", () => {
    const raw = {
      keyword: "",
      canton: ["zuerich", "zuerich"],
      category: "",
      city: "",
      radius: "",
      workloadMin: "",
      workloadMax: "",
      jobType: "",
      remoteType: "",
      language: "",
      applicationEffort: "",
      salaryMin: "",
      salaryPeriod: "",
      sort: "relevance",
      pageSize: "20",
      after: "",
    } as const;

    expect(exactClusterFilterFromSearch(raw, parsePublicJobSearchParams(raw))).toEqual({
      kind: "canton",
      cantonSlug: "zuerich",
    });
  });

  it("detects even unknown or empty query parameters for noindex", () => {
    expect(hasRawPublicJobQueryState({})).toBe(false);
    expect(hasRawPublicJobQueryState({ unknown: "" })).toBe(true);
    expect(hasRawPublicJobQueryState({ unknown: undefined })).toBe(false);
  });
});
