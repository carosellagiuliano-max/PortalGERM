import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireEmployerBillingPage: vi.fn(),
  getPublicPricingCatalog: vi.fn(),
  getCheckoutPreview: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/employer-page-access", () => ({
  requireEmployerBillingPage: mocks.requireEmployerBillingPage,
}));
vi.mock("@/lib/billing/public-catalog", () => ({
  getPublicPricingCatalog: mocks.getPublicPricingCatalog,
}));
vi.mock("@/lib/billing/employer-read-model", () => ({
  getCheckoutPreview: mocks.getCheckoutPreview,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));

import EmployerBillingCheckoutPage from "@/app/employer/billing/checkout/page";
import type { EntitlementRights } from "@/lib/billing/entitlements";
import type { PublicPricingCatalog } from "@/lib/billing/public-catalog-core";
import { formatChfFromRappen } from "@/lib/utils/format";

const RIGHTS: EntitlementRights = {
  ACTIVE_JOB_LIMIT: 7,
  SEAT_LIMIT: 4,
  TALENT_RADAR_ACCESS: false,
  TALENT_CONTACT_ALLOWANCE: 0,
  JOB_BOOST_ALLOWANCE: 0,
  ANALYTICS_LEVEL: "BASIC",
  ENHANCED_COMPANY_PROFILE: false,
  EMPLOYER_IMPORT_ACCESS: false,
};

describe("employer checkout choice page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEmployerBillingPage.mockResolvedValue({
      context: {
        companyId: "20000000-0000-4000-8000-000000000001",
        membershipRole: "OWNER",
      },
    });
    mocks.getPublicPricingCatalog.mockResolvedValue({
      ok: true,
      value: catalog(),
    });
  });

  it("renders catalog names, prices and entitlement limits without fallback values", async () => {
    render(await renderChoicePage());

    expect(screen.getByRole("heading", { name: "Starter Katalog UI" })).toBeInTheDocument();
    expect(screen.getByText("7 aktive Jobs · 4 Sitzplätze")).toBeInTheDocument();
    expect(screen.getByText(`${displayedChf(23_456)} netto`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kontaktpaket Katalog UI" })).toBeInTheDocument();
    expect(screen.getByText("14 zusätzliche Talent-Kontakte")).toBeInTheDocument();
    expect(screen.getByText(`${displayedChf(12_345)} netto`)).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Prüfen" }).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual([
      "/employer/billing/checkout?plan=starter",
      "/employer/billing/checkout?plan=pro",
      "/employer/billing/checkout?product=contact-pack-10",
      "/employer/billing/checkout?product=contact-pack-50",
    ]);
    expect(mocks.getCheckoutPreview).not.toHaveBeenCalled();
  });

  it("shows an Admin only released Contact Packs, never plan checkout links", async () => {
    mocks.requireEmployerBillingPage.mockResolvedValue({
      context: {
        companyId: "20000000-0000-4000-8000-000000000001",
        membershipRole: "ADMIN",
      },
    });

    render(await renderChoicePage());

    expect(screen.queryByRole("heading", { name: "Starter Katalog UI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pro Katalog UI" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Prüfen" })).toHaveLength(2);
    expect(mocks.requireEmployerBillingPage).toHaveBeenCalledWith(false);
  });

  it.each([
    {
      role: "OWNER" as const,
      label: "Pro prüfen",
      href: "/employer/billing/checkout?plan=pro",
    },
    {
      role: "ADMIN" as const,
      label: "Planoptionen ansehen",
      href: "/pricing",
    },
  ])(
    "routes a $role without Talent Radar to a role-safe next step",
    async ({ role, label, href }) => {
      mocks.requireEmployerBillingPage.mockResolvedValue({
        context: {
          companyId: "20000000-0000-4000-8000-000000000001",
          membershipRole: role,
        },
      });
      mocks.getCheckoutPreview.mockResolvedValue({
        ok: false,
        code: "TALENT_RADAR_REQUIRED",
      });

      render(
        await EmployerBillingCheckoutPage({
          searchParams: Promise.resolve({ product: "contact-pack-10" }),
        }),
      );

      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
      expect(
        screen.queryByRole("link", {
          name: role === "OWNER" ? "Planoptionen ansehen" : "Pro prüfen",
        }),
      ).not.toBeInTheDocument();
    },
  );

  it("fails closed when the effective catalog is unavailable", async () => {
    mocks.getPublicPricingCatalog.mockResolvedValue({
      ok: false,
      error: { code: "PLAN_SET_INVALID" },
    });

    render(await renderChoicePage());

    expect(
      screen.getByText("Checkout-Auswahl momentan nicht verfügbar"),
    ).toBeInTheDocument();
    expect(screen.getByText(/keine Ersatzpreise oder Ersatzlimiten/u)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Prüfen" })).not.toBeInTheDocument();
    expect(screen.queryByText(/CHF/u)).not.toBeInTheDocument();
  });
});

async function renderChoicePage() {
  return EmployerBillingCheckoutPage({
    searchParams: Promise.resolve({}),
  });
}

function catalog(): PublicPricingCatalog {
  return {
    policyVersion: "public-pricing-v1",
    plans: [
      plan("STARTER", "starter", "Starter Katalog UI", 23_456, RIGHTS),
      plan("PRO", "pro", "Pro Katalog UI", 45_678, {
        ...RIGHTS,
        ACTIVE_JOB_LIMIT: 17,
        SEAT_LIMIT: 8,
        TALENT_RADAR_ACCESS: true,
        TALENT_CONTACT_ALLOWANCE: 13,
        JOB_BOOST_ALLOWANCE: 6,
      }),
    ],
    products: [
      product("contact-pack-10", "Kontaktpaket Katalog UI", 12_345, 14, 30),
      product("contact-pack-50", "Kontaktpaket Gross UI", 34_567, 64, 40),
    ],
    successFee: {
      title: "Erfolgsbasierte Vermittlung",
      availability: "DISABLED_LEGAL_REVIEW",
    },
    taxNotice: { kind: "REVIEW_BEFORE_CONTRACT", text: "MWST wird geprüft." },
  };
}

function plan(
  code: "STARTER" | "PRO",
  slug: "starter" | "pro",
  name: string,
  netRappen: number,
  entitlements: EntitlementRights,
): PublicPricingCatalog["plans"][number] {
  return {
    code,
    slug,
    name,
    sortOrder: code === "STARTER" ? 1 : 2,
    price: { kind: "MONTHLY_FIXED", netRappen, currency: "CHF" },
    entitlements,
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

function displayedChf(amountRappen: number) {
  return formatChfFromRappen(amountRappen).replaceAll("\u00a0", " ");
}
