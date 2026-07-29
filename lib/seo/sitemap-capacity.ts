export const SITEMAP_CAPACITY_POLICY_V1 = Object.freeze({
  version: "SITEMAP_CAPACITY_POLICY_V1",
  maximumUrls: 50_000,
  maximumUncompressedBytes: 50 * 1_024 * 1_024,
  planAtBps: 7_000,
  deployAtBps: 8_000,
  blockExpansionAtBps: 9_000,
  owner: "SEO / Platform Operations",
} as const);

export type SitemapCapacityDecisionV1 = Readonly<{
  level: "HEALTHY" | "PLAN" | "DEPLOY" | "EXPANSION_BLOCKED";
  utilizationBps: number;
  forecast90dCount: number;
  forecast90dBytes: number;
  shardImplementationTriggered: boolean;
  reasons: readonly string[];
}>;

export function evaluateSitemapCapacityV1(
  input: Readonly<{
    urlCount: number;
    estimatedBytes: number;
    count30DaysAgo: number;
    bytes30DaysAgo: number;
    successful: boolean;
  }>,
): SitemapCapacityDecisionV1 {
  for (const value of [
    input.urlCount,
    input.estimatedBytes,
    input.count30DaysAgo,
    input.bytes30DaysAgo,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(
        "Sitemap capacity values must be non-negative integers.",
      );
    }
  }
  const forecast90dCount = forecastLinear90Days(
    input.urlCount,
    input.count30DaysAgo,
  );
  const forecast90dBytes = forecastLinear90Days(
    input.estimatedBytes,
    input.bytes30DaysAgo,
  );
  const utilizationBps = Math.max(
    basisPoints(forecast90dCount, SITEMAP_CAPACITY_POLICY_V1.maximumUrls),
    basisPoints(
      forecast90dBytes,
      SITEMAP_CAPACITY_POLICY_V1.maximumUncompressedBytes,
    ),
  );
  const reasons: string[] = [];
  if (!input.successful) reasons.push("LAST_RUN_FAILED");
  if (forecast90dCount >= SITEMAP_CAPACITY_POLICY_V1.maximumUrls) {
    reasons.push("URL_FORECAST_REACHES_CAP");
  }
  if (forecast90dBytes >= SITEMAP_CAPACITY_POLICY_V1.maximumUncompressedBytes)
    reasons.push("BYTE_FORECAST_REACHES_CAP");
  const level =
    !input.successful ||
    utilizationBps >= SITEMAP_CAPACITY_POLICY_V1.blockExpansionAtBps
      ? "EXPANSION_BLOCKED"
      : utilizationBps >= SITEMAP_CAPACITY_POLICY_V1.deployAtBps
        ? "DEPLOY"
        : utilizationBps >= SITEMAP_CAPACITY_POLICY_V1.planAtBps
          ? "PLAN"
          : "HEALTHY";
  return Object.freeze({
    level,
    utilizationBps,
    forecast90dCount,
    forecast90dBytes,
    shardImplementationTriggered: level !== "HEALTHY",
    reasons: Object.freeze(reasons),
  });
}

function forecastLinear90Days(current: number, previous30: number): number {
  const growth30 = Math.max(0, current - previous30);
  return Math.ceil(current + growth30 * 3);
}

function basisPoints(value: number, capacity: number): number {
  return Math.floor((value * 10_000) / capacity);
}
