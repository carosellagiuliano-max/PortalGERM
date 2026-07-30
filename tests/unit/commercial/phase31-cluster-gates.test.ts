import { describe, expect, it } from "vitest";

import { evaluateFirstPublicClusterGate } from "@/lib/commercial/cluster-gates";

const NOW = new Date("2026-07-30T12:00:00.000Z");

function validInput() {
  return {
    candidate: {
      assessmentStatus: "ACTIVATED",
      assessmentValidUntil: new Date("2026-08-15T12:00:00.000Z"),
      corpusDigest: "a".repeat(64),
      expertReviewedAt: new Date("2026-07-29T12:00:00.000Z"),
      expertReviewerUserId: "expert",
      opsApprovedByUserId: "ops",
      precisionAt10Bps: 8_000,
      productApprovedByUserId: "product",
      recallAt10Bps: 8_000,
      coverageBps: 8_000,
      relevantTopKJobs: 5,
      selectionStatus: "SELECTED" as const,
      searchPolicyVersion: "search-v2",
    },
    now: NOW,
    publicActiveClusterCount: 0,
    productionOfferReleased: true,
    capacityReleased: true,
    cashflowReleased: true,
    servicePolicyReleased: true,
    externalApprovalsComplete: true,
  };
}

describe("Phase 31 first public cluster gate", () => {
  it("allows exactly one current V2-quality cluster with separate approvals", () => {
    expect(evaluateFirstPublicClusterGate(validInput())).toEqual({
      allowed: true,
      missing: [],
      policyVersion: "phase31-v1",
    });
  });

  it("blocks a second public cluster", () => {
    const input = validInput();
    expect(
      evaluateFirstPublicClusterGate({
        ...input,
        publicActiveClusterCount: 1,
      }),
    ).toMatchObject({
      allowed: false,
      missing: expect.arrayContaining(["FIRST_CLUSTER_SLOT"]),
    });
  });

  it("blocks stale, discovery-only and same-approver evidence", () => {
    const input = validInput();
    expect(
      evaluateFirstPublicClusterGate({
        ...input,
        candidate: {
          ...input.candidate,
          assessmentValidUntil: NOW,
          selectionStatus: "DISCOVERY_ONLY",
          opsApprovedByUserId: "product",
        },
      }),
    ).toMatchObject({
      allowed: false,
      missing: expect.arrayContaining([
        "CURRENT_ASSESSMENT",
        "SELECTED_CORPUS",
        "SEPARATE_PRODUCT_OPS_APPROVALS",
      ]),
    });
  });
});
