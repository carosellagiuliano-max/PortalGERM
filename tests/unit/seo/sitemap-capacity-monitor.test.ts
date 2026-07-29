import { describe, expect, it } from "vitest";

import { evaluateSitemapCapacityV1 } from "@/lib/seo/sitemap-capacity";

describe("Phase 30 sitemap capacity policy", () => {
  it.each([
    [34_995, "HEALTHY", false],
    [35_000, "PLAN", true],
    [40_000, "DEPLOY", true],
    [45_000, "EXPANSION_BLOCKED", true],
  ] as const)("maps %s forecast URLs to %s", (urlCount, level, triggered) => {
    expect(
      evaluateSitemapCapacityV1({
        urlCount,
        estimatedBytes: 1_000,
        count30DaysAgo: urlCount,
        bytes30DaysAgo: 1_000,
        successful: true,
      }),
    ).toMatchObject({ level, shardImplementationTriggered: triggered });
  });

  it("forecasts 90 days from the positive 30-day growth and fails closed on run failure", () => {
    expect(
      evaluateSitemapCapacityV1({
        urlCount: 20_000,
        estimatedBytes: 2_000_000,
        count30DaysAgo: 15_000,
        bytes30DaysAgo: 1_500_000,
        successful: false,
      }),
    ).toMatchObject({
      level: "EXPANSION_BLOCKED",
      forecast90dCount: 35_000,
      forecast90dBytes: 3_500_000,
      reasons: ["LAST_RUN_FAILED"],
    });
  });
});
