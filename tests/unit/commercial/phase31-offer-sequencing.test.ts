import { describe, expect, it } from "vitest";

import {
  evaluateOfferSequence,
  summarizeNetWtp,
  type WtpEvidence,
} from "@/lib/commercial/offer-sequencing";

function evidence(
  overrides: Partial<WtpEvidence> = {},
): WtpEvidence {
  return {
    buyerCompanyId: "buyer-1",
    buyerIsIndependent: true,
    deliveryStatus: "STARTED",
    environment: "MANUAL_RECONCILED",
    grossPaidRappen: 50_000,
    offerKind: "HIRING_SPRINT",
    refundRappen: 0,
    reversalRappen: 0,
    reconciled: true,
    sellerControlledBuyer: false,
    ...overrides,
  };
}

describe("Phase 31 WTP-first offer sequencing", () => {
  it("counts only net paid, independent and delivered core evidence", () => {
    const result = summarizeNetWtp([
      evidence(),
      evidence({
        buyerCompanyId: "buyer-2",
        environment: "LIVE_PROVIDER",
        grossPaidRappen: 70_000,
        refundRappen: 10_000,
      }),
      evidence({ buyerCompanyId: "demo", environment: "DEMO" }),
      evidence({ buyerCompanyId: "free", environment: "FREE" }),
      evidence({ buyerCompanyId: "loi", environment: "LOI" }),
      evidence({ buyerCompanyId: "lead", environment: "LEAD" }),
      evidence({ buyerCompanyId: "self", sellerControlledBuyer: true }),
      evidence({ buyerCompanyId: "undelivered", deliveryStatus: "NOT_STARTED" }),
    ]);
    expect(result).toEqual({
      buyerCount: 2,
      evidenceCount: 2,
      netPaidRappen: 110_000,
    });
  });

  it("does not count a fully refunded payment", () => {
    expect(
      summarizeNetWtp([
        evidence({ grossPaidRappen: 50_000, refundRappen: 50_000 }),
      ]),
    ).toEqual({ buyerCount: 0, evidenceCount: 0, netPaidRappen: 0 });
  });

  it("blocks add-ons until the pre-registered core threshold is met", () => {
    expect(
      evaluateOfferSequence({
        offerKind: "BOOST",
        coreWtp: { buyerCount: 1, evidenceCount: 1, netPaidRappen: 50_000 },
        minimumIndependentBuyers: 2,
        minimumNetPaidRappen: 100_000,
      }),
    ).toMatchObject({
      allowed: false,
      missing: ["CORE_WTP_BEFORE_ADDON"],
    });
  });
});
