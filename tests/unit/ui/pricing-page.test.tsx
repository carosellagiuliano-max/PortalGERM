import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pricingCatalog = vi.hoisted(() => ({
  getPublicPricingCatalog: vi.fn(),
  getEmployerContext: vi.fn(),
  getEffectiveEntitlements: vi.fn(),
  findCurrentSubscriptions: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/public-catalog", () => ({
  getPublicPricingCatalog: pricingCatalog.getPublicPricingCatalog,
}));
vi.mock("@/lib/auth/employer-context", () => ({
  getEmployerContext: pricingCatalog.getEmployerContext,
}));
vi.mock("@/lib/billing/prisma-publish-quota", () => ({
  getPrismaEffectiveEntitlements: pricingCatalog.getEffectiveEntitlements,
}));
vi.mock("@/lib/db/client", () => ({
  getDatabase: () => ({
    employerSubscription: {
      findMany: pricingCatalog.findCurrentSubscriptions,
    },
  }),
}));

import PricingPage from "@/app/(public)/pricing/page";
import type { EntitlementRights } from "@/lib/billing/entitlements";
import type { PublicPricingCatalogResult } from "@/lib/billing/public-catalog-core";
import { formatChfFromRappen } from "@/lib/utils/format";

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

function rights(overrides: Partial<EntitlementRights> = {}): EntitlementRights {
  return { ...BASE_RIGHTS, ...overrides };
}

function displayedChf(amountRappen: number): string {
  return formatChfFromRappen(amountRappen).replaceAll("\u00a0", " ");
}

function successfulCatalog(): Extract<PublicPricingCatalogResult, { ok: true }> {
  return {
    ok: true,
    value: {
      policyVersion: "public-pricing-v1",
      plans: [
        {
          code: "FREE_BASIC",
          slug: "free",
          name: "Free Basic",
          sortOrder: 0,
          price: { kind: "MONTHLY_FIXED", netRappen: 12_345, currency: "CHF" },
          entitlements: rights(),
          cta: {
            kind: "REGISTER",
            href: "/register/employer",
            label: "Kostenlos starten",
          },
          catalogDisclosure: "PUBLIC_VERSION",
        },
        {
          code: "STARTER",
          slug: "starter",
          name: "Starter",
          sortOrder: 1,
          price: { kind: "MONTHLY_FIXED", netRappen: 23_456, currency: "CHF" },
          entitlements: rights({ ACTIVE_JOB_LIMIT: 3, SEAT_LIMIT: 2 }),
          cta: {
            kind: "QUALIFIED_LEAD",
            href: "/employers/demo?interest=starter",
            label: "Starter anfragen",
          },
          catalogDisclosure: "PUBLIC_VERSION",
        },
        {
          code: "PRO",
          slug: "pro",
          name: "Pro",
          sortOrder: 2,
          price: { kind: "MONTHLY_FIXED", netRappen: 34_567, currency: "CHF" },
          entitlements: rights({
            ACTIVE_JOB_LIMIT: 10,
            SEAT_LIMIT: 5,
            TALENT_RADAR_ACCESS: true,
            TALENT_CONTACT_ALLOWANCE: 10,
            JOB_BOOST_ALLOWANCE: 3,
            ANALYTICS_LEVEL: "ADVANCED",
            ENHANCED_COMPANY_PROFILE: true,
          }),
          cta: {
            kind: "QUALIFIED_LEAD",
            href: "/employers/demo?interest=pro",
            label: "Pro anfragen",
          },
          catalogDisclosure: "PUBLIC_VERSION",
        },
        {
          code: "BUSINESS",
          slug: "business",
          name: "Business",
          sortOrder: 3,
          price: { kind: "MONTHLY_FIXED", netRappen: 45_678, currency: "CHF" },
          entitlements: rights({
            ACTIVE_JOB_LIMIT: 25,
            SEAT_LIMIT: 12,
            TALENT_RADAR_ACCESS: true,
            TALENT_CONTACT_ALLOWANCE: 30,
            JOB_BOOST_ALLOWANCE: 8,
            ANALYTICS_LEVEL: "PRO",
            ENHANCED_COMPANY_PROFILE: true,
            EMPLOYER_IMPORT_ACCESS: true,
          }),
          cta: {
            kind: "DEMO",
            href: "/employers/demo?interest=business",
            label: "Business besprechen",
          },
          catalogDisclosure: "PUBLIC_VERSION",
        },
        {
          code: "ENTERPRISE_CONTRACT",
          slug: "enterprise",
          name: "Enterprise",
          sortOrder: 4,
          price: { kind: "INDIVIDUAL", currency: "CHF" },
          entitlements: null,
          cta: {
            kind: "DEMO",
            href: "/employers/demo?interest=enterprise",
            label: "Enterprise besprechen",
          },
          catalogDisclosure: "PRIVATE_CONTRACT_TEMPLATE",
        },
      ],
      products: [
        {
          code: "boost-7d",
          name: "7-Tage Boost",
          priority: 10,
          netPriceRappen: 5_432,
          currency: "CHF",
          kind: "JOB_BOOST",
          durationDays: 7,
          creditAmount: null,
          availability: "INFORMATION_ONLY",
        },
        {
          code: "boost-30d",
          name: "30-Tage Boost",
          priority: 20,
          netPriceRappen: 16_543,
          currency: "CHF",
          kind: "JOB_BOOST",
          durationDays: 30,
          creditAmount: null,
          availability: "INFORMATION_ONLY",
        },
        {
          code: "contact-pack-10",
          name: "Kontaktpaket 10",
          priority: 30,
          netPriceRappen: 27_654,
          currency: "CHF",
          kind: "CONTACT_PACK",
          durationDays: null,
          creditAmount: 10,
          availability: "INFORMATION_ONLY",
        },
        {
          code: "contact-pack-50",
          name: "Kontaktpaket 50",
          priority: 40,
          netPriceRappen: 38_765,
          currency: "CHF",
          kind: "CONTACT_PACK",
          durationDays: null,
          creditAmount: 50,
          availability: "INFORMATION_ONLY",
        },
      ],
      successFee: {
        title: "Erfolgsbasierte Vermittlung",
        availability: "DISABLED_LEGAL_REVIEW",
      },
      taxNotice: {
        kind: "DEMO_PLANNING_ASSUMPTION",
        text: "Preise zzgl. aktuell als Demo-Annahme geplant 8.1 % MWST; Steuerbehandlung vor Vertragsabschluss prüfen.",
      },
    },
  };
}

describe("public pricing page", () => {
  beforeEach(() => {
    pricingCatalog.getPublicPricingCatalog.mockReset();
    pricingCatalog.getPublicPricingCatalog.mockResolvedValue(successfulCatalog());
    pricingCatalog.getEmployerContext.mockReset();
    pricingCatalog.getEmployerContext.mockResolvedValue(null);
    pricingCatalog.getEffectiveEntitlements.mockReset();
    pricingCatalog.findCurrentSubscriptions.mockReset();
    pricingCatalog.findCurrentSubscriptions.mockResolvedValue([]);
  });

  it("renders the hero and exactly five ordered plan cards from catalog Rappen values", async () => {
    render(await PricingPage());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Wähle den Plan, der dein Recruiting wachsen lässt",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Lokaler Mock-Checkout/)).toBeInTheDocument();

    const plans = screen.getByRole("region", { name: "Arbeitgeberpläne" });
    expect(within(plans).getAllByRole("article")).toHaveLength(5);
    expect(
      within(plans)
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["Free Basic", "Starter", "Pro", "Business", "Enterprise"]);

    for (const amount of [12_345, 23_456, 34_567, 45_678]) {
      expect(
        within(plans).getByText(displayedChf(amount)),
      ).toBeInTheDocument();
    }
    expect(within(plans).getByText("Individuell")).toBeInTheDocument();
    expect(
      within(plans).getByText(/nicht bestellbaren Vertragsvorlage/),
    ).toBeInTheDocument();
  });

  it("renders exactly four active informational products with catalog prices", async () => {
    render(await PricingPage());

    const productsHeading = screen.getByRole("heading", {
      level: 2,
      name: "Transparente einmalige Produkte mit klaren Freigabegrenzen.",
    });
    const products = productsHeading.closest("section");
    expect(products).not.toBeNull();
    if (products === null) throw new Error("Product section is missing.");

    expect(within(products).getAllByText("Auf einer Stelle auswählen")).toHaveLength(2);
    expect(within(products).getAllByText("Zugang erforderlich")).toHaveLength(2);
    for (const name of [
      "7-Tage Boost",
      "30-Tage Boost",
      "Kontaktpaket 10",
      "Kontaktpaket 50",
    ]) {
      expect(
        within(products).getByRole("heading", { level: 3, name }),
      ).toBeInTheDocument();
    }
    for (const amount of [5_432, 16_543, 27_654, 38_765]) {
      expect(
        within(products).getByText(`${displayedChf(amount)} netto`),
      ).toBeInTheDocument();
    }
  });

  it("keeps success fee coming soon, disabled, and behind explicit legal review", async () => {
    render(await PricingPage());

    const successFeeHeading = screen.getByRole("heading", {
      level: 3,
      name: "Erfolgsbasierte Vermittlung",
    });
    const successFeeCard = successFeeHeading.closest<HTMLElement>(
      '[data-slot="card"]',
    );
    expect(successFeeCard).not.toBeNull();
    if (successFeeCard === null) throw new Error("Success-fee card is missing.");

    expect(within(successFeeCard).getByText("Coming soon")).toBeInTheDocument();
    expect(
      within(successFeeCard).getByText(/erst nach rechtlicher Prüfung aktiviert/),
    ).toBeInTheDocument();
    expect(
      within(successFeeCard).getByRole("button", { name: "Nicht verfügbar" }),
    ).toBeDisabled();
  });

  it("shows the demo MWST notice and at least six FAQ entries", async () => {
    const { container } = render(await PricingPage());

    expect(
      screen.getByText(
        "Preise zzgl. aktuell als Demo-Annahme geplant 8.1 % MWST; Steuerbehandlung vor Vertragsabschluss prüfen.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Vor dem Start verständlich geklärt." }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("details").length).toBeGreaterThanOrEqual(6);
  });

  it("links every plan and product CTA to its intended Phase 08 destination", async () => {
    render(await PricingPage());

    const expectedPlanTargets = [
      ["Kostenlos starten", "/register/employer"],
      ["Starter anfragen", "/employers/demo?interest=starter"],
      ["Pro anfragen", "/employers/demo?interest=pro"],
      ["Business besprechen", "/employers/demo?interest=business"],
      ["Enterprise besprechen", "/employers/demo?interest=enterprise"],
    ] as const;
    for (const [label, href] of expectedPlanTargets) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }

    for (const link of screen.getAllByRole("link", {
      name: "Eigene Stellen ansehen",
    })) {
      expect(link).toHaveAttribute("href", "/employers/post-job");
    }
    for (const link of screen.getAllByRole("link", {
      name: "Talent Radar verstehen",
    })) {
      expect(link).toHaveAttribute("href", "/employers/talent-radar");
    }
    expect(screen.getByRole("link", { name: "Demo anfragen" })).toHaveAttribute(
      "href",
      "/employers/demo",
    );
  });

  it("links an eligible signed-in owner only to working checkout or sales routes", async () => {
    pricingCatalog.getEmployerContext.mockResolvedValue({
      user: { id: "owner", role: "EMPLOYER" },
      memberships: [],
      needsSelection: false,
      current: {
        membershipId: "membership",
        membershipRole: "OWNER",
        companyId: "company",
        companyName: "Demo AG",
        companySlug: "demo-ag",
        companyStatus: "ACTIVE",
      },
    });
    pricingCatalog.getEffectiveEntitlements.mockResolvedValue({
      ok: true,
      value: {
        source: { planSlug: "PRO" },
        rights: { ...BASE_RIGHTS, TALENT_RADAR_ACCESS: true },
      },
    });

    render(await PricingPage());

    expect(
      screen.getByRole("link", { name: "Starter im Mock wählen" }),
    ).toHaveAttribute("href", "/employer/billing/checkout?plan=starter");
    expect(screen.getByRole("link", { name: "Aktueller Plan" })).toHaveAttribute(
      "href",
      "/employer/billing",
    );
    for (const link of screen.getAllByRole("link", {
      name: "Contact Pack im Mock kaufen",
    })) {
      expect(link.getAttribute("href")).toMatch(
        /^\/employer\/billing\/checkout\?product=contact-pack-(10|50)$/u,
      );
    }
    expect(screen.getByRole("link", { name: "Business besprechen" })).toHaveAttribute(
      "href",
      "/employers/demo?interest=business",
    );
  });

  it("routes a cancelling owner to the existing Plan change instead of a new checkout", async () => {
    pricingCatalog.getEmployerContext.mockResolvedValue({
      user: { id: "owner", role: "EMPLOYER" },
      memberships: [],
      needsSelection: false,
      current: {
        membershipId: "membership",
        membershipRole: "OWNER",
        companyId: "company",
        companyName: "Demo AG",
        companySlug: "demo-ag",
        companyStatus: "ACTIVE",
      },
    });
    pricingCatalog.getEffectiveEntitlements.mockResolvedValue({
      ok: true,
      value: {
        source: { planSlug: "STARTER" },
        rights: BASE_RIGHTS,
      },
    });
    pricingCatalog.findCurrentSubscriptions.mockResolvedValue([
      {
        status: "CANCELLING",
        currentChangeSchedules: [{ id: "pending-cancel" }],
      },
    ]);

    render(await PricingPage());

    expect(
      screen.getByRole("link", { name: "Aktueller Plan · Änderung ansehen" }),
    ).toHaveAttribute("href", "/employer/billing");
    expect(
      screen.getByRole("link", { name: "Vorgemerkte Planänderung ansehen" }),
    ).toHaveAttribute("href", "/employer/billing");
    expect(screen.queryByText(/im Mock wählen/u)).not.toBeInTheDocument();
  });

  it("fails closed without rendering fallback plans, products, or prices", async () => {
    pricingCatalog.getPublicPricingCatalog.mockResolvedValue({
      ok: false,
      error: { code: "PLAN_SET_INVALID" },
    });

    render(await PricingPage());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Preise momentan nicht verfügbar",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Wir zeigen deshalb keine Ersatzpreise an/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Angebot besprechen" })).toHaveAttribute(
      "href",
      "/employers/demo",
    );
    expect(screen.queryByRole("region", { name: "Arbeitgeberpläne" })).not.toBeInTheDocument();
    expect(screen.queryByText("Free Basic")).not.toBeInTheDocument();
    expect(screen.queryByText("7-Tage Boost")).not.toBeInTheDocument();
    expect(screen.queryByText(/CHF/)).not.toBeInTheDocument();
  });
});
