import { describe, expect, it } from "vitest";

import {
  basisPoints,
  calculateClusterLaunchMetricsV1,
  clusterLaunchEvidenceHashV1,
  CLUSTER_LAUNCH_POLICY_V1,
  medianTimes2,
  promotedQueriesForClusterV1,
  type ClusterLaunchEvidenceV1,
} from "@/lib/seo/cluster-launch-policy";

describe("CLUSTER_LAUNCH_POLICY_V1", () => {
  it("uses an exact ordinary median representation for odd and even samples", () => {
    expect(medianTimes2([1, 3, 9])).toBe(6);
    expect(medianTimes2([1, 3, 5, 9])).toBe(8);
    expect(medianTimes2([])).toBe(0);
  });

  it("fails closed for zero or invalid denominators", () => {
    expect(basisPoints(0, 0)).toBe(0);
    expect(basisPoints(7, 10)).toBe(7_000);
    expect(basisPoints(2, 1)).toBe(0);
  });

  it("marks a complete LIVE cohort READY", () => {
    const metrics = calculateClusterLaunchMetricsV1(passingEvidence());

    expect(metrics).toMatchObject({
      ready: true,
      liveJobCount: 50,
      activeEmployerCount: 15,
      activeCandidateCount: 200,
      medianApplicationsTimes2: 6,
      responseRateBasisPoints: 7_000,
      contentCoverageBasisPoints: 8_000,
    });
    expect(metrics.failedThresholds).toEqual([]);
  });

  it.each([
    ["LIVE_JOBS", { liveJobCount: 49 }],
    ["ACTIVE_EMPLOYERS", { activeEmployerCount: 14 }],
    ["ACTIVE_CANDIDATES", { activeCandidateCount: 199 }],
    ["MEDIAN_APPLICATIONS", { applicationCountsByEligibleJob: Array(50).fill(2) }],
    ["RESPONSE_RATE", { onTimeResponseCount: 69 }],
    ["PROMOTED_QUERY_COVERAGE", {
      promotedQueryResultCounts: [
        { query: "one", relevantJobCount: 5 },
        { query: "two", relevantJobCount: 5 },
        { query: "three", relevantJobCount: 5 },
        { query: "four", relevantJobCount: 4 },
        { query: "five", relevantJobCount: 4 },
      ],
    }],
    ["LIVE_PROVENANCE", { dataProvenance: "DEMO" }],
  ] as const)("fails the %s threshold at minus one", (threshold, override) => {
    const metrics = calculateClusterLaunchMetricsV1({
      ...passingEvidence(),
      ...override,
    } as ClusterLaunchEvidenceV1);

    expect(metrics.ready).toBe(false);
    expect(metrics.failedThresholds).toContain(threshold);
  });

  it("requires non-zero response and promoted-query denominators", () => {
    const noResponses = calculateClusterLaunchMetricsV1({
      ...passingEvidence(),
      dueApplicationCount: 0,
      onTimeResponseCount: 0,
    });
    const noQueries = calculateClusterLaunchMetricsV1({
      ...passingEvidence(),
      promotedQueryResultCounts: [],
    });

    expect(noResponses.failedThresholds).toContain("RESPONSE_RATE");
    expect(noQueries.failedThresholds).toContain("PROMOTED_QUERY_COVERAGE");
  });

  it("hashes canonical evidence independent of count and query ordering", () => {
    const evidence = passingEvidence();
    const reordered = {
      ...evidence,
      applicationCountsByEligibleJob: [...evidence.applicationCountsByEligibleJob].reverse(),
      promotedQueryResultCounts: [...evidence.promotedQueryResultCounts].reverse(),
    };

    expect(clusterLaunchEvidenceHashV1(reordered)).toBe(
      clusterLaunchEvidenceHashV1(evidence),
    );
    expect(clusterLaunchEvidenceHashV1({ ...evidence, liveJobCount: 51 })).not.toBe(
      clusterLaunchEvidenceHashV1(evidence),
    );
  });

  it("freezes a non-empty, versioned promoted-query set", () => {
    const queries = promotedQueriesForClusterV1({
      cantonName: "Zürich",
      cantonCode: "ZH",
      categoryName: "Gesundheit & Pflege",
    });

    expect(CLUSTER_LAUNCH_POLICY_V1.version).toBe("CLUSTER_LAUNCH_POLICY_V1");
    expect(queries).toHaveLength(5);
    expect(queries).toContain("gesundheit & pflege zürich");
  });
});

function passingEvidence(): ClusterLaunchEvidenceV1 {
  return Object.freeze({
    policyVersion: "CLUSTER_LAUNCH_POLICY_V1",
    cantonId: "11111111-1111-4111-8111-111111111111",
    categoryId: "22222222-2222-4222-8222-222222222222",
    evaluatedAt: "2026-07-22T12:00:00.000Z",
    evidenceWindowStart: "2026-06-22T12:00:00.000Z",
    evidenceWindowEnd: "2026-07-22T12:00:00.000Z",
    candidateActivityWindowStart: "2026-04-23T12:00:00.000Z",
    liveJobCount: 50,
    activeCandidateCount: 200,
    activeEmployerCount: 15,
    applicationCountsByEligibleJob: Object.freeze(Array(50).fill(3) as number[]),
    dueApplicationCount: 100,
    onTimeResponseCount: 70,
    promotedQueryResultCounts: Object.freeze([
      { query: "one", relevantJobCount: 5 },
      { query: "two", relevantJobCount: 5 },
      { query: "three", relevantJobCount: 5 },
      { query: "four", relevantJobCount: 5 },
      { query: "five", relevantJobCount: 4 },
    ]),
    dataProvenance: "LIVE",
  });
}
