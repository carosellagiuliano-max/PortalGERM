import {
  ENTITLEMENT_KEYS,
  PLAN_ENTITLEMENT_FIXTURES,
  PLAN_FIXTURES,
  PLAN_VERSION_FIXTURES,
} from "@/prisma/seed/fixtures/plans";
import {
  PRODUCT_FIXTURES,
  PRODUCT_VERSION_FIXTURES,
} from "@/prisma/seed/fixtures/products";
import { describe, expect, it } from "vitest";

const EXPECTED_ENTITLEMENTS = {
  FREE_BASIC: [1, 1, false, 0, 0, "NONE", false, false],
  STARTER: [3, 2, false, 0, 0, "BASIC", false, false],
  PRO: [10, 5, true, 10, 3, "ADVANCED", true, false],
  BUSINESS: [30, 15, true, 50, 10, "PRO", true, false],
  ENTERPRISE_CONTRACT: [100, 50, true, 100, 20, "PRO", true, false],
} as const;

function entitlementValue(entitlement: (typeof PLAN_ENTITLEMENT_FIXTURES)[number]) {
  switch (entitlement.valueType) {
    case "BOOLEAN":
      return entitlement.booleanValue;
    case "INTEGER":
      return entitlement.integerValue;
    case "ANALYTICS_LEVEL":
      return entitlement.analyticsLevelValue;
  }
}

describe("plan catalog fixtures", () => {
  it("contains five plans and the exact eight immutable price versions", () => {
    expect(PLAN_FIXTURES).toHaveLength(5);
    expect(PLAN_VERSION_FIXTURES).toHaveLength(8);
    expect(PLAN_FIXTURES.filter(({ isDefaultFree }) => isDefaultFree)).toEqual([
      expect.objectContaining({ code: "FREE_BASIC" }),
    ]);
    expect(new Set(PLAN_FIXTURES.map(({ code }) => code)).size).toBe(5);
    expect(
      new Set(PLAN_VERSION_FIXTURES.map(({ naturalKey }) => naturalKey)).size,
    ).toBe(8);

    const annualVersions = PLAN_VERSION_FIXTURES.filter(
      ({ billingInterval }) => billingInterval === "ANNUAL",
    );
    expect(annualVersions).toHaveLength(3);
    for (const version of annualVersions) {
      expect(version).toMatchObject({
        status: "INACTIVE",
        termMonths: 12,
        isPublic: false,
        isSelfService: false,
      });
      expect(version.monthlyEquivalentRappen).toBe(
        Math.floor((version.netPriceRappen ?? 0) / 12 + 0.5),
      );
    }

    expect(
      PLAN_VERSION_FIXTURES.filter(({ isSelfService }) => isSelfService).map(
        ({ naturalKey }) => naturalKey,
      ),
    ).toEqual(["STARTER:v1", "PRO:v1"]);
    expect(
      PLAN_VERSION_FIXTURES.find(
        ({ naturalKey }) => naturalKey === "ENTERPRISE_CONTRACT:v1",
      ),
    ).toMatchObject({
      priceMode: "CONTRACT",
      billingInterval: "MONTHLY",
      termMonths: 12,
      netPriceRappen: null,
      monthlyEquivalentRappen: null,
      isPublic: false,
    });
    expect(Object.isFrozen(PLAN_FIXTURES)).toBe(true);
    expect(Object.isFrozen(PLAN_VERSION_FIXTURES)).toBe(true);
    expect(PLAN_FIXTURES.every(Object.isFrozen)).toBe(true);
    expect(PLAN_VERSION_FIXTURES.every(Object.isFrozen)).toBe(true);
  });

  it("has all eight correctly typed entitlements on every plan version", () => {
    expect(PLAN_ENTITLEMENT_FIXTURES).toHaveLength(64);
    expect(
      new Set(PLAN_ENTITLEMENT_FIXTURES.map(({ naturalKey }) => naturalKey)).size,
    ).toBe(64);

    for (const version of PLAN_VERSION_FIXTURES) {
      const entitlements = PLAN_ENTITLEMENT_FIXTURES.filter(
        ({ planVersionNaturalKey }) =>
          planVersionNaturalKey === version.naturalKey,
      );
      expect(entitlements.map(({ key }) => key)).toEqual(ENTITLEMENT_KEYS);
      expect(entitlements.map(entitlementValue)).toEqual(
        EXPECTED_ENTITLEMENTS[version.planCode],
      );

      for (const entitlement of entitlements) {
        const nonNullValueCount = [
          entitlement.booleanValue,
          entitlement.integerValue,
          entitlement.analyticsLevelValue,
        ].filter((value) => value !== null).length;
        expect(nonNullValueCount).toBe(1);
        expect(Object.isFrozen(entitlement)).toBe(true);
      }
    }
    expect(Object.isFrozen(PLAN_ENTITLEMENT_FIXTURES)).toBe(true);
  });
});

describe("one-time product catalog fixtures", () => {
  it("contains exactly 11 products and versions with four active P0 entries", () => {
    expect(PRODUCT_FIXTURES).toHaveLength(11);
    expect(PRODUCT_VERSION_FIXTURES).toHaveLength(11);
    expect(new Set(PRODUCT_FIXTURES.map(({ code }) => code)).size).toBe(11);
    expect(
      new Set(PRODUCT_VERSION_FIXTURES.map(({ naturalKey }) => naturalKey)).size,
    ).toBe(11);

    const activeCodes = PRODUCT_VERSION_FIXTURES.filter(
      ({ status }) => status === "ACTIVE",
    ).map(({ productCode }) => productCode);
    expect(activeCodes).toEqual([
      "boost-7d",
      "boost-30d",
      "contact-pack-10",
      "contact-pack-50",
    ]);
    expect(
      PRODUCT_VERSION_FIXTURES.filter(({ isPublic }) => isPublic).map(
        ({ productCode }) => productCode,
      ),
    ).toEqual(activeCodes);
    expect(
      PRODUCT_VERSION_FIXTURES.find(
        ({ productCode }) => productCode === "success-fee",
      ),
    ).toMatchObject({
      status: "INACTIVE",
      netPriceRappen: 0,
      requiresLegalReview: true,
      isPublic: false,
      isSelfService: false,
    });
    expect(Object.isFrozen(PRODUCT_FIXTURES)).toBe(true);
    expect(Object.isFrozen(PRODUCT_VERSION_FIXTURES)).toBe(true);
    expect(PRODUCT_FIXTURES.every(Object.isFrozen)).toBe(true);
    expect(PRODUCT_VERSION_FIXTURES.every(Object.isFrozen)).toBe(true);
  });

  it("stores the exact P0 prices, durations and contact credits", () => {
    expect(
      PRODUCT_VERSION_FIXTURES.map(
        ({ productCode, netPriceRappen, durationDays, creditType, creditAmount }) =>
          [productCode, netPriceRappen, durationDays, creditType, creditAmount],
      ),
    ).toEqual([
      ["boost-7d", 7_900, 7, null, null],
      ["boost-30d", 19_900, 30, null, null],
      ["featured-job", 29_900, 14, null, null],
      ["featured-employer", 49_900, 30, null, null],
      ["newsletter-placement", 24_900, null, "NEWSLETTER", 1],
      ["social-push", 39_000, null, "SOCIAL_PUSH", 1],
      ["import-setup", 75_000, null, null, null],
      ["additional-job-30d", 12_900, 30, null, null],
      ["contact-pack-10", 9_900, null, "TALENT_CONTACT", 10],
      ["contact-pack-50", 29_900, null, "TALENT_CONTACT", 50],
      ["success-fee", 0, null, null, null],
    ]);
  });
});
