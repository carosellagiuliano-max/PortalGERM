import { describe, expect, it } from "vitest";

import { evaluateSalaryRelease } from "@/lib/commercial/salary-gate";

const NOW = new Date("2026-07-30T12:00:00.000Z");

describe("Phase 31 Salary release gate", () => {
  it("keeps mock or synthetic salary data unavailable and noindex", () => {
    expect(
      evaluateSalaryRelease({
        approvedByLegal: false,
        approvedByMethodOwner: false,
        datasetDigest: "mock",
        datasetSource: "MOCK",
        disclosurePublished: false,
        grossRegionMapped: false,
        iscoMapped: false,
        nextReviewAt: null,
        now: NOW,
        salaryReleaseFlag: false,
        sourceRightsApproved: false,
      }),
    ).toMatchObject({
      publicAvailable: false,
      indexable: false,
      sitemapEligible: false,
      gate: {
        allowed: false,
        missing: expect.arrayContaining([
          "REAL_APPROVED_DATASET",
          "SOURCE_RIGHTS",
        ]),
      },
    });
  });

  it("requires a current, approved source, method, mappings and disclosure", () => {
    expect(
      evaluateSalaryRelease({
        approvedByLegal: true,
        approvedByMethodOwner: true,
        datasetDigest: "a".repeat(64),
        datasetSource: "BFS_LSE",
        disclosurePublished: true,
        grossRegionMapped: true,
        iscoMapped: true,
        nextReviewAt: new Date("2027-01-01T00:00:00.000Z"),
        now: NOW,
        salaryReleaseFlag: true,
        sourceRightsApproved: true,
      }),
    ).toMatchObject({
      publicAvailable: true,
      indexable: true,
      sitemapEligible: true,
      gate: { allowed: true },
    });
  });
});
