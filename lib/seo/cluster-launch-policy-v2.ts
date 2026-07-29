import { SEARCH_POLICY_RELEASE_V2 } from "@/lib/search/concepts-v2";

export const CLUSTER_LAUNCH_POLICY_V2 = Object.freeze({
  version: "CLUSTER_LAUNCH_POLICY_V2",
  minimumPrecisionAt10Bps: 8_000,
  minimumRecallAt10Bps: 8_000,
  minimumCoverageBps: 8_000,
  minimumRelevantTopKJobs: 5,
  releases: SEARCH_POLICY_RELEASE_V2,
} as const);

export type ClusterSearchQualityEvidenceV2 = Readonly<{
  selectionStatus: "DISCOVERY_ONLY" | "SELECTED" | "REVOKED";
  searchPolicyVersion: string;
  taxonomyVersion: string;
  rankingVersion: string;
  precisionAt10Bps: number;
  recallAt10Bps: number;
  coverageBps: number;
  relevantTopKJobs: number;
  expertReviewedAt: Date | null;
  expertReviewerUserId: string | null;
}>;

export type ClusterV2ActivationDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      reason:
        | "MISSING_EVIDENCE"
        | "DISCOVERY_ONLY"
        | "EXPERT_REVIEW_MISSING"
        | "RELEASE_MISMATCH"
        | "PRECISION_BELOW_THRESHOLD"
        | "RECALL_BELOW_THRESHOLD"
        | "COVERAGE_BELOW_THRESHOLD"
        | "TOP_K_BELOW_THRESHOLD";
    }>;

/**
 * V2 is a separate authorization contract. A V1 approval or a location-only
 * count can never satisfy it.
 */
export function decideClusterV2Activation(
  evidence: ClusterSearchQualityEvidenceV2 | null,
): ClusterV2ActivationDecision {
  if (evidence === null) return denied("MISSING_EVIDENCE");
  if (evidence.selectionStatus !== "SELECTED") return denied("DISCOVERY_ONLY");
  if (
    evidence.expertReviewedAt === null ||
    evidence.expertReviewerUserId === null
  )
    return denied("EXPERT_REVIEW_MISSING");
  if (
    evidence.searchPolicyVersion !==
      CLUSTER_LAUNCH_POLICY_V2.releases.searchPolicyVersion ||
    evidence.taxonomyVersion !==
      CLUSTER_LAUNCH_POLICY_V2.releases.taxonomyVersion ||
    evidence.rankingVersion !== CLUSTER_LAUNCH_POLICY_V2.releases.rankingVersion
  )
    return denied("RELEASE_MISMATCH");
  if (
    evidence.precisionAt10Bps < CLUSTER_LAUNCH_POLICY_V2.minimumPrecisionAt10Bps
  )
    return denied("PRECISION_BELOW_THRESHOLD");
  if (evidence.recallAt10Bps < CLUSTER_LAUNCH_POLICY_V2.minimumRecallAt10Bps)
    return denied("RECALL_BELOW_THRESHOLD");
  if (evidence.coverageBps < CLUSTER_LAUNCH_POLICY_V2.minimumCoverageBps)
    return denied("COVERAGE_BELOW_THRESHOLD");
  if (
    evidence.relevantTopKJobs < CLUSTER_LAUNCH_POLICY_V2.minimumRelevantTopKJobs
  )
    return denied("TOP_K_BELOW_THRESHOLD");
  return Object.freeze({ allowed: true });
}

function denied(
  reason: Extract<ClusterV2ActivationDecision, { allowed: false }>["reason"],
): ClusterV2ActivationDecision {
  return Object.freeze({ allowed: false, reason });
}
