import { describe, expect, it } from "vitest";

import {
  evaluateProductionOffer,
  PHASE31_RESEARCH_COPY,
} from "@/lib/commercial/production-offer";

function validRelease() {
  return {
    accountingApproved: true,
    avgApproved: true,
    capacityReleased: true,
    cashflowReleased: true,
    clusterPublicActive: true,
    entitlementContractTested: true,
    legalApproved: true,
    offerKind: "HIRING_SPRINT" as const,
    privacyApproved: true,
    productionOfferFlag: true,
    recoveryPolicyReleased: true,
    serverPriceRappen: 149_00,
    taxApproved: true,
    wtpReleased: true,
  };
}

describe("Phase 31 production offer and copy gate", () => {
  it("keeps copy research-only and removes purchase CTA on any missing gate", () => {
    const result = evaluateProductionOffer({
      ...validRelease(),
      productionOfferFlag: false,
      avgApproved: false,
    });
    expect(result).toMatchObject({
      copyMode: "RESEARCH_ONLY",
      ctaMode: "LEAD_ONLY",
      indexable: false,
      gate: {
        allowed: false,
        missing: expect.arrayContaining([
          "PRODUCTION_OFFER_FLAG",
          "AVG_APPROVAL",
        ]),
      },
    });
    expect(PHASE31_RESEARCH_COPY.body).toContain("Testzahlung");
  });

  it("permits production copy only when every owning gate is explicit", () => {
    expect(evaluateProductionOffer(validRelease())).toMatchObject({
      copyMode: "PRODUCTION",
      ctaMode: "PURCHASE",
      indexable: true,
      gate: { allowed: true, missing: [] },
    });
  });

  it("never releases Salary or Success Fee through the generic core gate", () => {
    expect(
      evaluateProductionOffer({
        ...validRelease(),
        offerKind: "SUCCESS_FEE",
      }).gate.missing,
    ).toContain("SEPARATE_PRODUCT_GATE");
  });
});
