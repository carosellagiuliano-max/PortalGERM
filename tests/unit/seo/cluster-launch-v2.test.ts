import { describe, expect, it } from "vitest";

import {
  CLUSTER_LAUNCH_POLICY_V2,
  decideClusterV2Activation,
  type ClusterSearchQualityEvidenceV2,
} from "@/lib/seo/cluster-launch-policy-v2";

const reviewedAt = new Date("2026-07-29T12:00:00.000Z");
const passing: ClusterSearchQualityEvidenceV2 = {
  selectionStatus: "SELECTED",
  ...CLUSTER_LAUNCH_POLICY_V2.releases,
  precisionAt10Bps: 8_000,
  recallAt10Bps: 8_000,
  coverageBps: 8_000,
  relevantTopKJobs: 5,
  expertReviewedAt: reviewedAt,
  expertReviewerUserId: "30000000-0000-4000-8000-000000000001",
};

describe("Phase 30 cluster V2 activation policy", () => {
  it("accepts every threshold exactly at 80 percent", () => {
    expect(decideClusterV2Activation(passing)).toEqual({ allowed: true });
  });

  it.each([
    ["precisionAt10Bps", "PRECISION_BELOW_THRESHOLD"],
    ["recallAt10Bps", "RECALL_BELOW_THRESHOLD"],
    ["coverageBps", "COVERAGE_BELOW_THRESHOLD"],
  ] as const)("rejects %s at 79.99 percent", (field, reason) => {
    expect(decideClusterV2Activation({ ...passing, [field]: 7_999 })).toEqual({
      allowed: false,
      reason,
    });
  });

  it("keeps discovery, expert review and release binding fail-closed", () => {
    expect(
      decideClusterV2Activation({
        ...passing,
        selectionStatus: "DISCOVERY_ONLY",
      }),
    ).toEqual({ allowed: false, reason: "DISCOVERY_ONLY" });
    expect(
      decideClusterV2Activation({ ...passing, expertReviewedAt: null }),
    ).toEqual({ allowed: false, reason: "EXPERT_REVIEW_MISSING" });
    expect(
      decideClusterV2Activation({ ...passing, rankingVersion: "ranking-v1" }),
    ).toEqual({ allowed: false, reason: "RELEASE_MISMATCH" });
    expect(
      decideClusterV2Activation({ ...passing, relevantTopKJobs: 4 }),
    ).toEqual({ allowed: false, reason: "TOP_K_BELOW_THRESHOLD" });
  });
});
