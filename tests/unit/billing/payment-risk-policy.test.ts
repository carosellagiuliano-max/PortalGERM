import { describe, expect, it, vi } from "vitest";

import { evaluatePaymentRiskPolicyV1 } from "@/lib/billing/payment-risk-policy";

vi.mock("server-only", () => ({}));

const baseline = Object.freeze({
  activeCompanyHold: false,
  amountRappen: 16_107,
  attemptsInVelocityWindow: 1,
  failedAttemptsInWindow: 0,
  identifierConflict: false,
  openChargebacks: 0,
  refundsInWindow: 0,
  tenantMismatch: false,
});

describe("Phase-24 payment risk policy", () => {
  it("allows a low-risk checkout with explicit baseline evidence", () => {
    expect(evaluatePaymentRiskPolicyV1(baseline)).toEqual({
      kind: "ALLOW",
      riskBasisPoints: 0,
      signalCodes: ["BASELINE_ALLOW"],
    });
  });

  it("holds velocity, chargeback and inherited company risk", () => {
    expect(
      evaluatePaymentRiskPolicyV1({
        ...baseline,
        attemptsInVelocityWindow: 5,
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "HOLD",
        signalCodes: ["CHECKOUT_VELOCITY_HIGH"],
      }),
    );
    expect(
      evaluatePaymentRiskPolicyV1({
        ...baseline,
        openChargebacks: 1,
      }).kind,
    ).toBe("HOLD");
    expect(
      evaluatePaymentRiskPolicyV1({
        ...baseline,
        activeCompanyHold: true,
      }).kind,
    ).toBe("HOLD");
  });

  it("denies identity conflicts and sends borderline cases to review", () => {
    expect(
      evaluatePaymentRiskPolicyV1({
        ...baseline,
        tenantMismatch: true,
      }).kind,
    ).toBe("DENY");
    expect(
      evaluatePaymentRiskPolicyV1({
        ...baseline,
        failedAttemptsInWindow: 2,
      }).kind,
    ).toBe("REVIEW");
  });
});
