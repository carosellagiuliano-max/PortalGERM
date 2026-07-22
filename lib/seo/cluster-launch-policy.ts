import { createHash } from "node:crypto";

export const CLUSTER_LAUNCH_POLICY_V1 = Object.freeze({
  version: "CLUSTER_LAUNCH_POLICY_V1",
  evidenceWindowDays: 30,
  candidateActivityWindowDays: 90,
  validityDays: 7,
  minimumActiveEmployers: 15,
  minimumLiveJobs: 50,
  minimumActiveCandidates: 200,
  minimumMedianApplicationsTimes2: 6,
  minimumResponseRateBasisPoints: 7_000,
  minimumContentCoverageBasisPoints: 8_000,
  minimumRelevantJobsPerPromotedQuery: 5,
} as const);

export type ClusterLaunchEvidenceV1 = Readonly<{
  policyVersion: typeof CLUSTER_LAUNCH_POLICY_V1.version;
  cantonId: string;
  categoryId: string;
  evaluatedAt: string;
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  candidateActivityWindowStart: string;
  liveJobCount: number;
  activeCandidateCount: number;
  activeEmployerCount: number;
  applicationCountsByEligibleJob: readonly number[];
  dueApplicationCount: number;
  onTimeResponseCount: number;
  promotedQueryResultCounts: readonly Readonly<{
    query: string;
    relevantJobCount: number;
  }>[];
  dataProvenance: "LIVE" | "DEMO" | "TEST";
}>;

export type ClusterLaunchMetricsV1 = Readonly<{
  liveJobCount: number;
  activeCandidateCount: number;
  activeEmployerCount: number;
  medianApplicationsTimes2: number;
  responseRateBasisPoints: number;
  contentCoverageBasisPoints: number;
  responseDenominator: number;
  promotedQueryDenominator: number;
  ready: boolean;
  failedThresholds: readonly ClusterLaunchThresholdV1[];
}>;

export type ClusterLaunchThresholdV1 =
  | "LIVE_JOBS"
  | "ACTIVE_CANDIDATES"
  | "ACTIVE_EMPLOYERS"
  | "MEDIAN_APPLICATIONS"
  | "RESPONSE_RATE"
  | "PROMOTED_QUERY_COVERAGE"
  | "LIVE_PROVENANCE";

export function calculateClusterLaunchMetricsV1(
  evidence: ClusterLaunchEvidenceV1,
): ClusterLaunchMetricsV1 {
  const medianApplicationsTimes2 = medianTimes2(
    evidence.applicationCountsByEligibleJob,
  );
  const responseRateBasisPoints = basisPoints(
    evidence.onTimeResponseCount,
    evidence.dueApplicationCount,
  );
  const promotedQueryDenominator = evidence.promotedQueryResultCounts.length;
  const passingPromotedQueries = evidence.promotedQueryResultCounts.filter(
    ({ relevantJobCount }) =>
      relevantJobCount >=
      CLUSTER_LAUNCH_POLICY_V1.minimumRelevantJobsPerPromotedQuery,
  ).length;
  const contentCoverageBasisPoints = basisPoints(
    passingPromotedQueries,
    promotedQueryDenominator,
  );
  const failedThresholds: ClusterLaunchThresholdV1[] = [];

  if (evidence.liveJobCount < CLUSTER_LAUNCH_POLICY_V1.minimumLiveJobs) {
    failedThresholds.push("LIVE_JOBS");
  }
  if (
    evidence.activeCandidateCount <
    CLUSTER_LAUNCH_POLICY_V1.minimumActiveCandidates
  ) {
    failedThresholds.push("ACTIVE_CANDIDATES");
  }
  if (
    evidence.activeEmployerCount <
    CLUSTER_LAUNCH_POLICY_V1.minimumActiveEmployers
  ) {
    failedThresholds.push("ACTIVE_EMPLOYERS");
  }
  if (
    medianApplicationsTimes2 <
    CLUSTER_LAUNCH_POLICY_V1.minimumMedianApplicationsTimes2
  ) {
    failedThresholds.push("MEDIAN_APPLICATIONS");
  }
  if (
    evidence.dueApplicationCount === 0 ||
    responseRateBasisPoints <
      CLUSTER_LAUNCH_POLICY_V1.minimumResponseRateBasisPoints
  ) {
    failedThresholds.push("RESPONSE_RATE");
  }
  if (
    promotedQueryDenominator === 0 ||
    contentCoverageBasisPoints <
      CLUSTER_LAUNCH_POLICY_V1.minimumContentCoverageBasisPoints
  ) {
    failedThresholds.push("PROMOTED_QUERY_COVERAGE");
  }
  if (evidence.dataProvenance !== "LIVE") {
    failedThresholds.push("LIVE_PROVENANCE");
  }

  return Object.freeze({
    liveJobCount: evidence.liveJobCount,
    activeCandidateCount: evidence.activeCandidateCount,
    activeEmployerCount: evidence.activeEmployerCount,
    medianApplicationsTimes2,
    responseRateBasisPoints,
    contentCoverageBasisPoints,
    responseDenominator: evidence.dueApplicationCount,
    promotedQueryDenominator,
    ready: failedThresholds.length === 0,
    failedThresholds: Object.freeze(failedThresholds),
  });
}

/** Ordinary median persisted exactly as twice its value, including even samples. */
export function medianTimes2(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.map(assertNonNegativeInteger).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return (sorted[middle] ?? 0) * 2;
  return (sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0);
}

export function basisPoints(numerator: number, denominator: number): number {
  const safeNumerator = assertNonNegativeInteger(numerator);
  const safeDenominator = assertNonNegativeInteger(denominator);
  if (safeDenominator === 0 || safeNumerator > safeDenominator) return 0;
  return Math.floor((safeNumerator * 10_000) / safeDenominator);
}

export function clusterLaunchEvidenceHashV1(
  evidence: ClusterLaunchEvidenceV1,
): string {
  const canonical = {
    ...evidence,
    applicationCountsByEligibleJob: [...evidence.applicationCountsByEligibleJob]
      .map(assertNonNegativeInteger)
      .sort((left, right) => left - right),
    promotedQueryResultCounts: [...evidence.promotedQueryResultCounts]
      .map(({ query, relevantJobCount }) => ({
        query: query.trim().normalize("NFKC").toLowerCase(),
        relevantJobCount: assertNonNegativeInteger(relevantJobCount),
      }))
      .sort((left, right) => left.query.localeCompare(right.query, "de-CH")),
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export function promotedQueriesForClusterV1(input: Readonly<{
  cantonName: string;
  cantonCode: string;
  categoryName: string;
}>): readonly string[] {
  const category = cleanQuery(input.categoryName);
  const cantonName = cleanQuery(input.cantonName);
  const cantonCode = cleanQuery(input.cantonCode);
  return Object.freeze(
    [...new Set([
      category,
      `${category} ${cantonName}`,
      `${category} ${cantonCode}`,
      `${category} jobs`,
      `${category} stellen`,
    ])].filter(Boolean),
  );
}

function cleanQuery(value: string): string {
  return value.trim().normalize("NFKC").replace(/\s+/gu, " ").toLowerCase();
}

function assertNonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Cluster evidence counts must be non-negative integers.");
  }
  return value;
}
