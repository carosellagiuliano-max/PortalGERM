import { describe, expect, it } from "vitest";

import { buildEmployerCheckoutChoices } from "@/lib/billing/employer-checkout-choice";
import type { EntitlementRights } from "@/lib/billing/entitlements";
import type { PublicPricingCatalog } from "@/lib/billing/public-catalog-core";

const BASE_RIGHTS: EntitlementRights = {
  ACTIVE_JOB_LIMIT: 1,
  SEAT_LIMIT: 1,
  TALENT_RADAR_ACCESS: false,
  TALENT_CONTACT_ALLOWANCE: 0,
  JOB_BOOST_ALLOWANCE: 0,
  ANALYTICS_LEVEL: "NONE",
  ENHANCED_COMPANY_PROFILE: false,
  EMPLOYER_IMPORT_ACCESS: false,
};

describe("buildEmployerCheckoutChoices", () => {
  it("derives names, prices and details exclusively from the effective catalog read model", () => {
    expect(buildEmployerCheckoutChoices(catalog(), "OWNER")).toEqual({
      ok: true,
      value: [
        {
          kind: "PLAN",
          code: "STARTER",
          href: "/employer/billing/checkout?plan=starter",
          name: "Starter Katalog Juli",
          detail: "7 aktive Jobs · 4 Sitzplätze",
          netPriceRappen: 23_456,
        },
        {
          kind: "PLAN",
          code: "PRO",
          href: "/employer/billing/checkout?plan=pro",
          name: "Pro Katalog Juli",
          detail:
            "17 aktive Jobs · 8 Sitzplätze · Talent Radar · 13 Talent-Kontakte pro Monat · 6 Boost-Credits pro Monat",
          netPriceRappen: 45_678,
        },
        {
          kind: "PRODUCT",
          code: "contact-pack-10",
          href: "/employer/billing/checkout?product=contact-pack-10",
          name: "Kontaktpaket Klein Juli",
          detail: "14 zusätzliche Talent-Kontakte",
          netPriceRappen: 12_345,
        },
        {
          kind: "PRODUCT",
          code: "contact-pack-50",
          href: "/employer/billing/checkout?product=contact-pack-50",
          name: "Kontaktpaket Gross Juli",
          detail: "64 zusätzliche Talent-Kontakte",
          netPriceRappen: 34_567,
        },
      ],
    });
  });

  it("hides Owner-only plan checkout choices from an Admin", () => {
    const result = buildEmployerCheckoutChoices(catalog(), "ADMIN");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.value.map(({ kind, code }) => [kind, code])).toEqual([
      ["PRODUCT", "contact-pack-10"],
      ["PRODUCT", "contact-pack-50"],
    ]);
  });

  it.each([
    {
      label: "missing effective Pro version",
      mutate: (value: PublicPricingCatalog): PublicPricingCatalog => ({
        ...value,
        plans: value.plans.filter((plan) => plan.code !== "PRO"),
      }),
    },
    {
      label: "ambiguous effective Contact Pack version",
      mutate: (value: PublicPricingCatalog): PublicPricingCatalog => ({
        ...value,
        products: [...value.products, value.products[0]!],
      }),
    },
    {
      label: "invalid non-fixed Starter version",
      mutate: (value: PublicPricingCatalog): PublicPricingCatalog => ({
        ...value,
        plans: value.plans.map((plan) =>
          plan.code === "STARTER"
            ? { ...plan, price: { kind: "INDIVIDUAL", currency: "CHF" } }
            : plan,
        ),
      }),
    },
    {
      label: "invalid Contact Pack credits",
      mutate: (value: PublicPricingCatalog): PublicPricingCatalog => ({
        ...value,
        products: value.products.map((product) =>
          product.code === "contact-pack-10"
            ? { ...product, creditAmount: null }
            : product,
        ),
      }),
    },
  ])("fails closed for $label", ({ mutate }) => {
    expect(buildEmployerCheckoutChoices(mutate(catalog()), "OWNER")).toEqual({
      ok: false,
      code: "CATALOG_UNAVAILABLE",
    });
  });
});

function catalog(): PublicPricingCatalog {
  return {
    policyVersion: "public-pricing-v1",
    plans: [
      plan("STARTER", "starter", "Starter Katalog Juli", 23_456, {
        ACTIVE_JOB_LIMIT: 7,
        SEAT_LIMIT: 4,
      }),
      plan("PRO", "pro", "Pro Katalog Juli", 45_678, {
        ACTIVE_JOB_LIMIT: 17,
        SEAT_LIMIT: 8,
        TALENT_RADAR_ACCESS: true,
        TALENT_CONTACT_ALLOWANCE: 13,
        JOB_BOOST_ALLOWANCE: 6,
      }),
    ],
    products: [
      product("contact-pack-10", "Kontaktpaket Klein Juli", 12_345, 14, 30),
      product("contact-pack-50", "Kontaktpaket Gross Juli", 34_567, 64, 40),
    ],
    successFee: {
      title: "Erfolgsbasierte Vermittlung",
      availability: "DISABLED_LEGAL_REVIEW",
    },
    taxNotice: {
      kind: "REVIEW_BEFORE_CONTRACT",
      text: "MWST wird geprüft.",
    },
  };
}

function plan(
  code: "STARTER" | "PRO",
  slug: "starter" | "pro",
  name: string,
  netRappen: number,
  overrides: Partial<EntitlementRights>,
): PublicPricingCatalog["plans"][number] {
  return {
    code,
    slug,
    name,
    sortOrder: code === "STARTER" ? 1 : 2,
    price: { kind: "MONTHLY_FIXED", netRappen, currency: "CHF" },
    entitlements: { ...BASE_RIGHTS, ...overrides },
    cta: {
      kind: "QUALIFIED_LEAD",
      href: `/employers/demo?interest=${slug}`,
      label: `${name} anfragen`,
    },
    catalogDisclosure: "PUBLIC_VERSION",
  };
}

function product(
  code: "contact-pack-10" | "contact-pack-50",
  name: string,
  netPriceRappen: number,
  creditAmount: number,
  priority: number,
): PublicPricingCatalog["products"][number] {
  return {
    code,
    name,
    priority,
    netPriceRappen,
    currency: "CHF",
    kind: "CONTACT_PACK",
    durationDays: null,
    creditAmount,
    availability: "INFORMATION_ONLY",
  };
}
