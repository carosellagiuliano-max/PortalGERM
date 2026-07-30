import { describe, expect, it } from "vitest";

import {
  evaluateBoostReleaseGate,
  evaluatePaidRadarReleaseGate,
} from "@/lib/commercial/addon-gates";

describe("Phase 31 add-on gates", () => {
  it("releases Boost only with organic inventory, measured reach and fairness", () => {
    expect(
      evaluateBoostReleaseGate({
        coreWtpReleased: true,
        deliveryContractReleased: true,
        eligibilityUnaffected: true,
        fairnessPolicyPassed: true,
        measuredIncrementalReachBps: 1_500,
        minimumIncrementalReachBps: 1_000,
        organicEligibleJobCount: 20,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateBoostReleaseGate({
        coreWtpReleased: true,
        deliveryContractReleased: true,
        eligibilityUnaffected: false,
        fairnessPolicyPassed: false,
        measuredIncrementalReachBps: 1_500,
        minimumIncrementalReachBps: 1_000,
        organicEligibleJobCount: 20,
      }),
    ).toMatchObject({
      allowed: false,
      missing: expect.arrayContaining(["FAIRNESS_AND_ELIGIBILITY"]),
    });
  });

  it("releases paid Radar only after density, funnel, privacy and revoke gates", () => {
    expect(
      evaluatePaidRadarReleaseGate({
        acceptCount: 30,
        activeOptInCandidateCount: 250,
        contactCount: 100,
        coreWtpReleased: true,
        eligibilityRevocationPassed: true,
        minimumAcceptRateBps: 2_000,
        minimumActiveOptIns: 200,
        minimumRevealRateBps: 5_000,
        privacyApproved: true,
        revealCount: 20,
        trustApproved: true,
      }),
    ).toMatchObject({ allowed: true });
  });

  it("blocks bought access from bypassing privacy or candidate acceptance", () => {
    expect(
      evaluatePaidRadarReleaseGate({
        acceptCount: 0,
        activeOptInCandidateCount: 250,
        contactCount: 100,
        coreWtpReleased: true,
        eligibilityRevocationPassed: false,
        minimumAcceptRateBps: 2_000,
        minimumActiveOptIns: 200,
        minimumRevealRateBps: 5_000,
        privacyApproved: false,
        revealCount: 0,
        trustApproved: true,
      }).missing,
    ).toEqual(
      expect.arrayContaining([
        "PRIVACY_AND_TRUST",
        "ELIGIBILITY_REVOCATION",
        "CONTACT_ACCEPT_EVIDENCE",
        "ACCEPT_REVEAL_EVIDENCE",
      ]),
    );
  });
});
