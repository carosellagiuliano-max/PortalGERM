import {
  gateDecision,
  isSha256,
  isValidDate,
  type GateDecision,
} from "@/lib/commercial/contracts";

export type CommercialClusterCandidate = Readonly<{
  assessmentStatus: string;
  assessmentValidUntil: Date;
  corpusDigest: string;
  expertReviewedAt: Date | null;
  expertReviewerUserId: string | null;
  opsApprovedByUserId: string | null;
  precisionAt10Bps: number;
  productApprovedByUserId: string | null;
  recallAt10Bps: number;
  coverageBps: number;
  relevantTopKJobs: number;
  selectionStatus: "DISCOVERY_ONLY" | "SELECTED" | "REVOKED";
  searchPolicyVersion: string;
}>;

/**
 * Phase 31 does not replace the Phase-30 quality gate. It adds a commercial
 * first-cluster boundary and requires two independent launch approvers.
 */
export function evaluateFirstPublicClusterGate(
  input: Readonly<{
    candidate: CommercialClusterCandidate;
    now: Date;
    publicActiveClusterCount: number;
    productionOfferReleased: boolean;
    capacityReleased: boolean;
    cashflowReleased: boolean;
    servicePolicyReleased: boolean;
    externalApprovalsComplete: boolean;
  }>,
): GateDecision {
  const missing: string[] = [];
  const candidate = input.candidate;
  if (!isValidDate(input.now)) missing.push("VALID_CLOCK");
  if (input.publicActiveClusterCount !== 0) missing.push("FIRST_CLUSTER_SLOT");
  if (candidate.assessmentStatus !== "ACTIVATED") {
    missing.push("PHASE30_ASSESSMENT_ACTIVATED");
  }
  if (
    !isValidDate(candidate.assessmentValidUntil) ||
    candidate.assessmentValidUntil <= input.now
  ) {
    missing.push("CURRENT_ASSESSMENT");
  }
  if (candidate.selectionStatus !== "SELECTED") {
    missing.push("SELECTED_CORPUS");
  }
  if (!isSha256(candidate.corpusDigest)) missing.push("CORPUS_DIGEST");
  if (
    candidate.expertReviewedAt === null ||
    candidate.expertReviewerUserId === null
  ) {
    missing.push("EXPERT_REVIEW");
  }
  if (
    candidate.productApprovedByUserId === null ||
    candidate.opsApprovedByUserId === null ||
    candidate.productApprovedByUserId === candidate.opsApprovedByUserId
  ) {
    missing.push("SEPARATE_PRODUCT_OPS_APPROVALS");
  }
  if (
    candidate.precisionAt10Bps < 8_000 ||
    candidate.recallAt10Bps < 8_000 ||
    candidate.coverageBps < 8_000 ||
    candidate.relevantTopKJobs < 5
  ) {
    missing.push("PHASE30_SEARCH_QUALITY");
  }
  if (candidate.searchPolicyVersion.trim().length === 0) {
    missing.push("SEARCH_POLICY_VERSION");
  }
  if (!input.productionOfferReleased) missing.push("PRODUCTION_OFFER_RELEASE");
  if (!input.capacityReleased) missing.push("CAPACITY_RELEASE");
  if (!input.cashflowReleased) missing.push("CASHFLOW_RELEASE");
  if (!input.servicePolicyReleased) missing.push("SERVICE_POLICY_RELEASE");
  if (!input.externalApprovalsComplete) missing.push("EXTERNAL_APPROVALS");
  return gateDecision(missing);
}
