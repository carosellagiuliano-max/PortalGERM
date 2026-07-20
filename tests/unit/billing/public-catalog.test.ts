import type {
  EntitlementRights,
  PlanEntitlementRecord,
} from "@/lib/billing/entitlements";
import {
  buildPublicPricingCatalogV1,
  PUBLIC_PLAN_ORDER_V1,
  PUBLIC_PRODUCT_CODES_V1,
  type PublicPlanCatalogRow,
  type PublicPlanCode,
  type PublicProductCatalogRow,
  type PublicProductCode,
  type PublicTaxCatalogRow,
} from "@/lib/billing/public-catalog-core";
import { describe, expect, it } from "vitest";

import { entitlementRows } from "./fixtures";

const AT = new Date("2026-07-20T12:00:00.000Z");
const VALID_FROM = new Date("2026-01-01T00:00:00.000Z");

const CATALOG_RIGHTS: EntitlementRights = {
  ACTIVE_JOB_LIMIT: 7,
  SEAT_LIMIT: 3,
  TALENT_RADAR_ACCESS: true,
  TALENT_CONTACT_ALLOWANCE: 5,
  JOB_BOOST_ALLOWANCE: 2,
  ANALYTICS_LEVEL: "ADVANCED",
  ENHANCED_COMPANY_PROFILE: true,
  EMPLOYER_IMPORT_ACCESS: false,
};

const PLAN_PRICES = {
  FREE_BASIC: 0,
  STARTER: 15_123,
  PRO: 40_567,
  BUSINESS: 91_234,
} as const;

const PRODUCT_CONFIGURATION: Readonly<
  Record<
    PublicProductCode,
    Readonly<{
      type: "JOB_BOOST" | "CONTACT_PACK";
      price: number;
      priority: number;
      durationDays: number | null;
      creditType: "TALENT_CONTACT" | null;
      creditAmount: number | null;
    }>
  >
> = {
  "boost-7d": {
    type: "JOB_BOOST",
    price: 8_001,
    priority: 10,
    durationDays: 7,
    creditType: null,
    creditAmount: null,
  },
  "boost-30d": {
    type: "JOB_BOOST",
    price: 20_002,
    priority: 20,
    durationDays: 30,
    creditType: null,
    creditAmount: null,
  },
  "contact-pack-10": {
    type: "CONTACT_PACK",
    price: 10_003,
    priority: 30,
    durationDays: null,
    creditType: "TALENT_CONTACT",
    creditAmount: 10,
  },
  "contact-pack-50": {
    type: "CONTACT_PACK",
    price: 30_004,
    priority: 40,
    durationDays: null,
    creditType: "TALENT_CONTACT",
    creditAmount: 50,
  },
};

type CatalogInput = Parameters<typeof buildPublicPricingCatalogV1>[0];

function planRow(
  code: PublicPlanCode,
  overrides: Partial<PublicPlanCatalogRow> = {},
): PublicPlanCatalogRow {
  const isEnterprise = code === "ENTERPRISE_CONTRACT";
  const netPriceRappen = isEnterprise ? null : PLAN_PRICES[code];

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
      name: `Internal ${code}`,
      isDefaultFree: code === "FREE_BASIC",
    },
    entitlements: entitlementRows(CATALOG_RIGHTS),
    ...overrides,
  };
}

function validPlanRows(): PublicPlanCatalogRow[] {
  return [
    planRow("BUSINESS"),
    planRow("FREE_BASIC"),
    planRow("ENTERPRISE_CONTRACT"),
    planRow("PRO"),
    planRow("STARTER"),
  ];
}

function productRow(
  code: PublicProductCode,
  overrides: Partial<PublicProductCatalogRow> = {},
): PublicProductCatalogRow {
  const configuration = PRODUCT_CONFIGURATION[code];
  return {
    id: `product-version-${code}`,
    version: 1,
    status: "ACTIVE",
    netPriceRappen: configuration.price,
    currency: "CHF",
    durationDays: configuration.durationDays,
    creditType: configuration.creditType,
    creditAmount: configuration.creditAmount,
    isPublic: true,
    isSelfService: true,
    priority: configuration.priority,
    requiresLegalReview: false,
    validFrom: new Date(VALID_FROM),
    validTo: null,
    product: {
      code,
      name: `Internal ${code}`,
      type: configuration.type,
    },
    ...overrides,
  };
}

function validProductRows(): PublicProductCatalogRow[] {
  return [
    productRow("contact-pack-50"),
    productRow("boost-30d"),
    productRow("contact-pack-10"),
    productRow("boost-7d"),
  ];
}

function successFeeRow(
  overrides: Partial<PublicProductCatalogRow> = {},
): PublicProductCatalogRow {
  return {
    id: "product-version-success-fee",
    version: 1,
    status: "INACTIVE",
    netPriceRappen: 0,
    currency: "CHF",
    durationDays: null,
    creditType: null,
    creditAmount: null,
    isPublic: false,
    isSelfService: false,
    priority: 100,
    requiresLegalReview: true,
    validFrom: new Date(VALID_FROM),
    validTo: null,
    product: {
      code: "success-fee",
      name: "Success Fee",
      type: "SUCCESS_FEE",
    },
    ...overrides,
  };
}

function demoTaxRow(
  overrides: Partial<PublicTaxCatalogRow> = {},
): PublicTaxCatalogRow {
  return {
    jurisdiction: "CH",
    taxType: "MWST_STANDARD_DEMO",
    rateBasisPoints: 810,
    validFrom: new Date(VALID_FROM),
    validTo: null,
    source: "Fiktive, freigegebene Planungsannahme",
    reviewStatus: "APPROVED",
    ...overrides,
  };
}

function catalogInput(overrides: Partial<CatalogInput> = {}): CatalogInput {
  return {
    at: new Date(AT),
    productionLike: false,
    planVersions: validPlanRows(),
    productVersions: validProductRows(),
    successFeeVersions: [successFeeRow()],
    taxRates: [demoTaxRow()],
    ...overrides,
  };
}

function expectFailure(
  input: CatalogInput,
  code:
    | "INVALID_CLOCK"
    | "PLAN_SET_INVALID"
    | "PLAN_VERSION_INVALID"
    | "PLAN_ENTITLEMENTS_INVALID"
    | "PRODUCT_SET_INVALID"
    | "PRODUCT_VERSION_INVALID"
    | "SUCCESS_FEE_INVALID"
    | "TAX_CONFIGURATION_INVALID",
) {
  expect(buildPublicPricingCatalogV1(input)).toEqual({
    ok: false,
    error: { code },
  });
}

describe("buildPublicPricingCatalogV1", () => {
  it("publishes exactly five ordered plan cards and four ordered products from the input prices", () => {
    const result = buildPublicPricingCatalogV1(catalogInput());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);

    expect(result.value.policyVersion).toBe("public-pricing-v1");
    expect(result.value.plans).toHaveLength(5);
    expect(result.value.plans.map(({ code }) => code)).toEqual([
      ...PUBLIC_PLAN_ORDER_V1,
    ]);
    expect(result.value.plans.map(({ sortOrder }) => sortOrder)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(result.value.plans.map(({ code, cta }) => [code, cta])).toEqual([
      [
        "FREE_BASIC",
        { kind: "REGISTER", href: "/register/employer", label: "Kostenlos starten" },
      ],
      [
        "STARTER",
        { kind: "QUALIFIED_LEAD", href: "/employers/demo?interest=starter", label: "Starter anfragen" },
      ],
      [
        "PRO",
        { kind: "QUALIFIED_LEAD", href: "/employers/demo?interest=pro", label: "Pro anfragen" },
      ],
      [
        "BUSINESS",
        { kind: "DEMO", href: "/employers/demo?interest=business", label: "Business besprechen" },
      ],
      [
        "ENTERPRISE_CONTRACT",
        { kind: "DEMO", href: "/employers/demo?interest=enterprise", label: "Enterprise besprechen" },
      ],
    ]);

    expect(result.value.plans.map(({ code, price }) => [code, price])).toEqual([
      [
        "FREE_BASIC",
        { kind: "MONTHLY_FIXED", netRappen: 0, currency: "CHF" },
      ],
      [
        "STARTER",
        { kind: "MONTHLY_FIXED", netRappen: 15_123, currency: "CHF" },
      ],
      [
        "PRO",
        { kind: "MONTHLY_FIXED", netRappen: 40_567, currency: "CHF" },
      ],
      [
        "BUSINESS",
        { kind: "MONTHLY_FIXED", netRappen: 91_234, currency: "CHF" },
      ],
      ["ENTERPRISE_CONTRACT", { kind: "INDIVIDUAL", currency: "CHF" }],
    ]);

    const enterprise = result.value.plans[4];
    expect(enterprise).toMatchObject({
      code: "ENTERPRISE_CONTRACT",
      slug: "enterprise",
      name: "Enterprise",
      entitlements: null,
      catalogDisclosure: "PRIVATE_CONTRACT_TEMPLATE",
      cta: { kind: "DEMO" },
    });
    expect(
      result.value.plans.slice(0, 4).map(({ catalogDisclosure }) =>
        catalogDisclosure
      ),
    ).toEqual(["PUBLIC_VERSION", "PUBLIC_VERSION", "PUBLIC_VERSION", "PUBLIC_VERSION"]);

    expect(result.value.products).toHaveLength(4);
    expect(result.value.products.map(({ code }) => code)).toEqual([
      ...PUBLIC_PRODUCT_CODES_V1,
    ]);
    expect(
      result.value.products.map(({ code, netPriceRappen, availability }) => ({
        code,
        netPriceRappen,
        availability,
      })),
    ).toEqual([
      { code: "boost-7d", netPriceRappen: 8_001, availability: "INFORMATION_ONLY" },
      { code: "boost-30d", netPriceRappen: 20_002, availability: "INFORMATION_ONLY" },
      { code: "contact-pack-10", netPriceRappen: 10_003, availability: "INFORMATION_ONLY" },
      { code: "contact-pack-50", netPriceRappen: 30_004, availability: "INFORMATION_ONLY" },
    ]);
    expect(result.value.successFee).toEqual({
      title: "Erfolgsbasierte Vermittlung",
      availability: "DISABLED_LEGAL_REVIEW",
    });
  });

  it("uses the approved demo tax assumption outside production", () => {
    const result = buildPublicPricingCatalogV1(catalogInput());

    expect(result).toMatchObject({
      ok: true,
      value: {
        taxNotice: { kind: "DEMO_PLANNING_ASSUMPTION" },
      },
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.taxNotice.text).toContain("8,1 % MWST");
    expect(result.value.taxNotice.text).toContain("Demo-Annahme");
  });

  it("uses the generic review notice in production without trusting demo tax rows", () => {
    const result = buildPublicPricingCatalogV1(
      catalogInput({
        productionLike: true,
        taxRates: [
          demoTaxRow({
            rateBasisPoints: -1,
            source: "not reviewed and not fictional",
            reviewStatus: "REJECTED",
          }),
          demoTaxRow(),
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        taxNotice: {
          kind: "REVIEW_BEFORE_CONTRACT",
          text: "Preise zzgl. anwendbarer MWST; Steuerbehandlung und Satz vor Vertragsabschluss prüfen.",
        },
      },
    });
  });

  it.each([
    ["missing", validPlanRows().slice(0, -1)],
    [
      "duplicate",
      validPlanRows().map((row) =>
        row.plan.code === "PRO" ? planRow("STARTER") : row
      ),
    ],
  ])("fails closed for a %s plan version", (_case, planVersions) => {
    expectFailure(catalogInput({ planVersions }), "PLAN_SET_INVALID");
  });

  it("fails closed for a malformed plan version", () => {
    const planVersions = validPlanRows().map((row) =>
      row.plan.code === "STARTER"
        ? { ...row, isSelfService: false }
        : row
    );

    expectFailure(catalogInput({ planVersions }), "PLAN_VERSION_INVALID");
  });

  it("fails closed for an annual Enterprise contract template", () => {
    const planVersions = validPlanRows().map((row) =>
      row.plan.code === "ENTERPRISE_CONTRACT"
        ? { ...row, billingInterval: "ANNUAL" }
        : row
    );

    expectFailure(catalogInput({ planVersions }), "PLAN_VERSION_INVALID");
  });

  it.each(["missing", "duplicate"] as const)(
    "fails closed for %s plan entitlements",
    (malformation) => {
      const planVersions = validPlanRows().map((row) => {
        if (row.plan.code !== "PRO") return row;
        const entitlements = [...row.entitlements];
        if (malformation === "missing") entitlements.pop();
        else entitlements.push(entitlements[0] as PlanEntitlementRecord);
        return { ...row, entitlements };
      });

      expectFailure(
        catalogInput({ planVersions }),
        "PLAN_ENTITLEMENTS_INVALID",
      );
    },
  );

  it.each([
    ["missing", validProductRows().slice(0, -1), "PRODUCT_SET_INVALID"],
    [
      "duplicate",
      validProductRows().map((row) =>
        row.product.code === "boost-30d" ? productRow("boost-7d") : row
      ),
      "PRODUCT_VERSION_INVALID",
    ],
  ] as const)(
    "fails closed for a %s product version",
    (_case, productVersions, errorCode) => {
      expectFailure(catalogInput({ productVersions }), errorCode);
    },
  );

  it("fails closed for malformed products, including duplicate priorities", () => {
    const wrongDuration = validProductRows().map((row) =>
      row.product.code === "boost-7d" ? { ...row, durationDays: 8 } : row
    );
    expectFailure(
      catalogInput({ productVersions: wrongDuration }),
      "PRODUCT_VERSION_INVALID",
    );

    const duplicatePriority = validProductRows().map((row) =>
      row.product.code === "boost-30d" ? { ...row, priority: 10 } : row
    );
    expectFailure(
      catalogInput({ productVersions: duplicatePriority }),
      "PRODUCT_VERSION_INVALID",
    );
  });

  it.each([
    ["missing", []],
    ["duplicate", [successFeeRow(), successFeeRow({ id: "success-fee-2" })]],
    ["released", [successFeeRow({ status: "ACTIVE" })]],
    ["not legal-gated", [successFeeRow({ requiresLegalReview: false })]],
  ])("keeps the success-fee gate fail-closed when it is %s", (_case, rows) => {
    expectFailure(
      catalogInput({ successFeeVersions: rows }),
      "SUCCESS_FEE_INVALID",
    );
  });

  it.each([
    ["missing", []],
    ["duplicate", [demoTaxRow(), demoTaxRow()]],
    ["malformed", [demoTaxRow({ source: "real production source" })]],
  ])("fails closed for a %s demo tax configuration", (_case, taxRates) => {
    expectFailure(
      catalogInput({ taxRates }),
      "TAX_CONFIGURATION_INVALID",
    );
  });

  it("fails closed for an invalid evaluation clock", () => {
    expectFailure(
      catalogInput({ at: new Date(Number.NaN) }),
      "INVALID_CLOCK",
    );
  });
});
