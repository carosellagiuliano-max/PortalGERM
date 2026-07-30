import { gateDecision, type GateDecision } from "@/lib/commercial/contracts";

export function evaluateBoostReleaseGate(
  input: Readonly<{
    coreWtpReleased: boolean;
    deliveryContractReleased: boolean;
    eligibilityUnaffected: boolean;
    fairnessPolicyPassed: boolean;
    measuredIncrementalReachBps: number;
    minimumIncrementalReachBps: number;
    organicEligibleJobCount: number;
  }>,
): GateDecision {
  const missing: string[] = [];
  if (!input.coreWtpReleased) missing.push("CORE_WTP");
  if (!input.deliveryContractReleased) missing.push("DELIVERY_CONTRACT");
  if (!input.eligibilityUnaffected || !input.fairnessPolicyPassed) {
    missing.push("FAIRNESS_AND_ELIGIBILITY");
  }
  if (
    !Number.isSafeInteger(input.organicEligibleJobCount) ||
    input.organicEligibleJobCount < 1
  ) {
    missing.push("ORGANIC_INVENTORY");
  }
  if (
    !Number.isSafeInteger(input.measuredIncrementalReachBps) ||
    !Number.isSafeInteger(input.minimumIncrementalReachBps) ||
    input.minimumIncrementalReachBps <= 0 ||
    input.measuredIncrementalReachBps < input.minimumIncrementalReachBps
  ) {
    missing.push("MEASURED_INCREMENTAL_REACH");
  }
  return gateDecision(missing);
}

export function evaluatePaidRadarReleaseGate(
  input: Readonly<{
    acceptCount: number;
    activeOptInCandidateCount: number;
    contactCount: number;
    coreWtpReleased: boolean;
    eligibilityRevocationPassed: boolean;
    minimumAcceptRateBps: number;
    minimumActiveOptIns: number;
    minimumRevealRateBps: number;
    privacyApproved: boolean;
    revealCount: number;
    trustApproved: boolean;
  }>,
): GateDecision {
  const missing: string[] = [];
  if (!input.coreWtpReleased) missing.push("CORE_WTP");
  if (!input.privacyApproved || !input.trustApproved) {
    missing.push("PRIVACY_AND_TRUST");
  }
  if (!input.eligibilityRevocationPassed) {
    missing.push("ELIGIBILITY_REVOCATION");
  }
  if (
    !Number.isSafeInteger(input.activeOptInCandidateCount) ||
    input.activeOptInCandidateCount < input.minimumActiveOptIns ||
    input.minimumActiveOptIns < 1
  ) {
    missing.push("OPT_IN_DENSITY");
  }
  const acceptRateBps =
    input.contactCount > 0
      ? Math.floor((input.acceptCount * 10_000) / input.contactCount)
      : 0;
  const revealRateBps =
    input.acceptCount > 0
      ? Math.floor((input.revealCount * 10_000) / input.acceptCount)
      : 0;
  if (
    input.contactCount < 1 ||
    input.acceptCount < 0 ||
    input.acceptCount > input.contactCount ||
    acceptRateBps < input.minimumAcceptRateBps
  ) {
    missing.push("CONTACT_ACCEPT_EVIDENCE");
  }
  if (
    input.revealCount < 0 ||
    input.revealCount > input.acceptCount ||
    revealRateBps < input.minimumRevealRateBps
  ) {
    missing.push("ACCEPT_REVEAL_EVIDENCE");
  }
  return gateDecision(missing);
}
