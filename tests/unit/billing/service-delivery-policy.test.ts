import { describe, expect, it, vi } from "vitest";

import { evaluateServiceDeliveryPolicyV1 } from "@/lib/billing/service-delivery-policy";

vi.mock("server-only", () => ({}));

describe("Phase-24 paid service-delivery policy", () => {
  it("restores exactly the consumed credit for a proven platform failure", () => {
    expect(
      evaluateServiceDeliveryPolicyV1({
        classification: "PLATFORM_FAILURE",
        deliveryStillPossible: true,
        evidenceComplete: true,
        fundingMode: "CREDIT",
        paidAmountRappen: 0,
        serviceKind: "RADAR_CONTACT",
      }),
    ).toEqual({
      status: "APPROVED",
      remedyKind: "CREDIT_RESTORE",
      remedyAmount: null,
    });
  });

  it("extends a deliverable paid boost and escalates a refund instead of auto-booking it", () => {
    expect(
      evaluateServiceDeliveryPolicyV1({
        classification: "PLATFORM_FAILURE",
        deliveryStillPossible: true,
        evidenceComplete: true,
        fundingMode: "PAID_ORDER_LINE",
        paidAmountRappen: 8_540,
        serviceKind: "JOB_BOOST",
      }).remedyKind,
    ).toBe("SERVICE_EXTENSION");
    expect(
      evaluateServiceDeliveryPolicyV1({
        classification: "PLATFORM_FAILURE",
        deliveryStillPossible: false,
        evidenceComplete: true,
        fundingMode: "PAID_ORDER_LINE",
        paidAmountRappen: 8_540,
        serviceKind: "JOB_BOOST",
      }),
    ).toEqual({
      status: "ESCALATED",
      remedyKind: "REFUND",
      remedyAmount: 8_540,
    });
  });

  it.each([
    "EXPECTED_MARKET_OUTCOME",
    "USER_ACTION",
    "PROVIDER_PAYMENT_FAILURE",
  ] as const)(
    "never compensates %s as a platform failure",
    (classification) => {
      expect(
        evaluateServiceDeliveryPolicyV1({
          classification,
          deliveryStillPossible: false,
          evidenceComplete: true,
          fundingMode: "CREDIT",
          paidAmountRappen: 0,
          serviceKind: "RADAR_CONTACT",
        }),
      ).toEqual({
        status: "DENIED",
        remedyKind: "NONE",
        remedyAmount: null,
      });
    },
  );
});
