import {
  getPlanCheckoutCandidateV1,
  getProductCheckoutCandidateV1,
  phase08CheckoutDecision,
} from "@/lib/billing/checkout-eligibility";
import type {
  PublicPlanCatalogRow,
  PublicProductCatalogRow,
} from "@/lib/billing/public-catalog-core";
import { describe, expect, it } from "vitest";

const AT = new Date("2026-07-20T12:00:00.000Z");
const VALID_FROM = new Date("2026-01-01T00:00:00.000Z");

function planRow(
  code: "FREE_BASIC" | "STARTER" | "PRO" | "BUSINESS" | "ENTERPRISE_CONTRACT",
  overrides: Partial<PublicPlanCatalogRow> = {},
): PublicPlanCatalogRow {
  const isEnterprise = code === "ENTERPRISE_CONTRACT";
  const netPriceRappen = isEnterprise ? null : 20_000;

  return {
    id: `plan-version-${code.toLowerCase()}`,
    version: 1,
    status: "ACTIVE",
    priceMode: isEnterprise ? "CONTRACT" : "FIXED",
    billingInterval: "MONTHLY",
    termMonths: isEnterprise ? 12 : 1,
    netPriceRappen,
    monthlyEquivalentRappen: netPriceRappen,
    currency: "CHF",
    isPublic: !isEnterprise,
    isSelfService: code === "STARTER" || code === "PRO",
    validFrom: new Date(VALID_FROM),
    validTo: null,
    plan: {
      code,
      name: code,
      isDefaultFree: code === "FREE_BASIC",
    },
    entitlements: validEntitlements(),
    ...overrides,
  };
}

function validEntitlements(): PublicPlanCatalogRow["entitlements"] {
  return [
    entitlement("ACTIVE_JOB_LIMIT", "INTEGER", 3),
    entitlement("SEAT_LIMIT", "INTEGER", 2),
    entitlement("TALENT_RADAR_ACCESS", "BOOLEAN", false),
    entitlement("TALENT_CONTACT_ALLOWANCE", "INTEGER", 0),
    entitlement("JOB_BOOST_ALLOWANCE", "INTEGER", 0),
    entitlement("ANALYTICS_LEVEL", "ANALYTICS_LEVEL", "BASIC"),
    entitlement("ENHANCED_COMPANY_PROFILE", "BOOLEAN", false),
    entitlement("EMPLOYER_IMPORT_ACCESS", "BOOLEAN", false),
  ];
}

function entitlement(
  key: string,
  valueType: "INTEGER" | "BOOLEAN" | "ANALYTICS_LEVEL",
  value: number | boolean | string,
) {
  return {
    key,
    valueType,
    booleanValue: valueType === "BOOLEAN" ? value as boolean : null,
    integerValue: valueType === "INTEGER" ? value as number : null,
    analyticsLevelValue: valueType === "ANALYTICS_LEVEL" ? value as string : null,
  };
}

function productRow(
  type: string,
  overrides: Partial<PublicProductCatalogRow> = {},
): PublicProductCatalogRow {
  const isContactPack = type === "CONTACT_PACK";
  return {
    id: `product-version-${type.toLowerCase()}`,
    version: 1,
    status: "ACTIVE",
    netPriceRappen: 10_000,
    currency: "CHF",
    durationDays: isContactPack ? null : 7,
    creditType: isContactPack ? "TALENT_CONTACT" : null,
    creditAmount: isContactPack ? 10 : null,
    isPublic: true,
    isSelfService: true,
    priority: 10,
    requiresLegalReview: false,
    validFrom: new Date(VALID_FROM),
    validTo: null,
    product: {
      code: isContactPack ? "contact-pack-10" : "boost-7d",
      name: type,
      type,
    },
    ...overrides,
  };
}

const NO_PRODUCT_CAPABILITIES = {
  hasTalentRadarAccess: false,
  phase13BoostHandlerRegistered: false,
  hasEligibleOwnedJobTarget: false,
} as const;

describe("Phase 08 checkout eligibility", () => {
  it("globally denies checkout in Phase 08", () => {
    expect(phase08CheckoutDecision()).toEqual({
      eligible: false,
      reason: "PHASE_08_NO_CHECKOUT",
    });
  });

  it.each(["STARTER", "PRO"] as const)(
    "marks the valid %s plan as a later checkout candidate",
    (code) => {
      expect(getPlanCheckoutCandidateV1(planRow(code), AT)).toEqual({
        eligible: true,
        kind: "PLAN",
      });
    },
  );

  it.each(["FREE_BASIC", "BUSINESS", "ENTERPRISE_CONTRACT"] as const)(
    "denies the %s plan for self-service checkout",
    (code) => {
      expect(getPlanCheckoutCandidateV1(planRow(code), AT)).toEqual({
        eligible: false,
        reason: "PLAN_NOT_P0_SELF_SERVICE",
      });
    },
  );

  it("fails closed for malformed or non-effective plan candidates", () => {
    expect(
      getPlanCheckoutCandidateV1(
        planRow("STARTER", { monthlyEquivalentRappen: 19_999 }),
        AT,
      ),
    ).toEqual({
      eligible: false,
      reason: "PLAN_NOT_P0_SELF_SERVICE",
    });

    for (const malformed of [
      planRow("STARTER", { version: 0 }),
      planRow("STARTER", { netPriceRappen: 0, monthlyEquivalentRappen: 0 }),
      planRow("PRO", { plan: { code: "PRO", name: "Pro", isDefaultFree: true } }),
      planRow("PRO", { entitlements: [] }),
    ]) {
      expect(getPlanCheckoutCandidateV1(malformed, AT)).toEqual({
        eligible: false,
        reason: "PLAN_NOT_P0_SELF_SERVICE",
      });
    }

    expect(
      getPlanCheckoutCandidateV1(
        planRow("PRO", { validTo: new Date(AT) }),
        AT,
      ),
    ).toEqual({
      eligible: false,
      reason: "CATALOG_VERSION_NOT_EFFECTIVE",
    });
  });

  it("allows a contact pack only with Talent Radar access", () => {
    const contactPack = productRow("CONTACT_PACK");

    expect(
      getProductCheckoutCandidateV1(contactPack, AT, {
        ...NO_PRODUCT_CAPABILITIES,
        hasTalentRadarAccess: true,
      }),
    ).toEqual({ eligible: true, kind: "CONTACT_PACK" });

    expect(
      getProductCheckoutCandidateV1(
        contactPack,
        AT,
        NO_PRODUCT_CAPABILITIES,
      ),
    ).toEqual({
      eligible: false,
      reason: "TALENT_RADAR_PLAN_REQUIRED",
      suggestedPlanSlug: "pro",
    });
  });

  it("rejects malformed and unknown contact packs before the Radar plan gate", () => {
    expect(
      getProductCheckoutCandidateV1(
        productRow("CONTACT_PACK", { creditAmount: 0 }),
        AT,
        { ...NO_PRODUCT_CAPABILITIES, hasTalentRadarAccess: true },
      ),
    ).toEqual({
      eligible: false,
      reason: "PRODUCT_NOT_RELEASED",
    });

    expect(
      getProductCheckoutCandidateV1(
        productRow("CONTACT_PACK", {
          product: {
            code: "contact-pack-20",
            name: "Unknown contact pack",
            type: "CONTACT_PACK",
          },
        }),
        AT,
        { ...NO_PRODUCT_CAPABILITIES, hasTalentRadarAccess: true },
      ),
    ).toEqual({
      eligible: false,
      reason: "PRODUCT_NOT_RELEASED",
    });
  });

  it("requires both the Phase 13 handler and an eligible owned job for boosts", () => {
    const boost = productRow("JOB_BOOST");

    expect(
      getProductCheckoutCandidateV1(boost, AT, {
        ...NO_PRODUCT_CAPABILITIES,
        hasEligibleOwnedJobTarget: true,
      }),
    ).toEqual({
      eligible: false,
      reason: "PHASE_13_HANDLER_REQUIRED",
    });

    expect(
      getProductCheckoutCandidateV1(boost, AT, {
        ...NO_PRODUCT_CAPABILITIES,
        phase13BoostHandlerRegistered: true,
      }),
    ).toEqual({
      eligible: false,
      reason: "ELIGIBLE_OWNED_JOB_REQUIRED",
    });

    expect(
      getProductCheckoutCandidateV1(boost, AT, {
        ...NO_PRODUCT_CAPABILITIES,
        phase13BoostHandlerRegistered: true,
        hasEligibleOwnedJobTarget: true,
      }),
    ).toEqual({ eligible: true, kind: "JOB_BOOST" });

    expect(
      getProductCheckoutCandidateV1(
        productRow("JOB_BOOST", {
          durationDays: 30,
          product: {
            code: "boost-30d",
            name: "30-day boost",
            type: "JOB_BOOST",
          },
        }),
        AT,
        {
          ...NO_PRODUCT_CAPABILITIES,
          phase13BoostHandlerRegistered: true,
          hasEligibleOwnedJobTarget: true,
        },
      ),
    ).toEqual({ eligible: true, kind: "JOB_BOOST" });
  });

  it("rejects malformed or unknown boost versions before handler checks", () => {
    const context = {
      ...NO_PRODUCT_CAPABILITIES,
      phase13BoostHandlerRegistered: true,
      hasEligibleOwnedJobTarget: true,
    };

    for (const row of [
      productRow("JOB_BOOST", { durationDays: 8 }),
      productRow("JOB_BOOST", { currency: "EUR" }),
      productRow("JOB_BOOST", { netPriceRappen: 0 }),
      productRow("JOB_BOOST", {
        product: {
          code: "boost-14d",
          name: "Unknown boost",
          type: "JOB_BOOST",
        },
      }),
    ]) {
      expect(getProductCheckoutCandidateV1(row, AT, context)).toEqual({
        eligible: false,
        reason: "PRODUCT_NOT_RELEASED",
      });
    }
  });

  it("denies unreleased, unknown, and non-effective products", () => {
    expect(
      getProductCheckoutCandidateV1(
        productRow("CONTACT_PACK", { requiresLegalReview: true }),
        AT,
        { ...NO_PRODUCT_CAPABILITIES, hasTalentRadarAccess: true },
      ),
    ).toEqual({ eligible: false, reason: "PRODUCT_NOT_RELEASED" });

    expect(
      getProductCheckoutCandidateV1(
        productRow("SUCCESS_FEE"),
        AT,
        NO_PRODUCT_CAPABILITIES,
      ),
    ).toEqual({ eligible: false, reason: "PRODUCT_NOT_RELEASED" });

    expect(
      getProductCheckoutCandidateV1(
        productRow("JOB_BOOST", { validTo: new Date(AT) }),
        AT,
        {
          ...NO_PRODUCT_CAPABILITIES,
          phase13BoostHandlerRegistered: true,
          hasEligibleOwnedJobTarget: true,
        },
      ),
    ).toEqual({
      eligible: false,
      reason: "CATALOG_VERSION_NOT_EFFECTIVE",
    });
  });
});
