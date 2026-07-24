import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireEmployerBillingPage: vi.fn(),
  getEmployerBillingOverview: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/employer-page-access", () => ({
  requireEmployerBillingPage: mocks.requireEmployerBillingPage,
}));
vi.mock("@/lib/billing/employer-read-model", () => ({
  getEmployerBillingOverview: mocks.getEmployerBillingOverview,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));

import EmployerBillingPage from "@/app/employer/billing/page";

describe("employer Billing overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEmployerBillingPage.mockResolvedValue({
      context: {
        companyId: "20000000-0000-4000-8000-000000000001",
        membershipRole: "ADMIN",
      },
    });
    mocks.getDatabase.mockReturnValue({});
    mocks.getEmployerBillingOverview.mockResolvedValue({
      plan: {
        code: "FREE_BASIC",
        name: "Free Basic",
        monthlyNetRappen: 0,
        periodEnd: null,
        status: "FREE",
        cancellationEffectiveAt: null,
        pendingChange: null,
      },
      usage: {
        talentRadarAccess: false,
        activeJobs: { used: 1, limit: 1 },
        seats: { used: 1, limit: 1, pendingInvitations: 0 },
        includedContacts: { used: 0, remaining: 0, granted: 0 },
        includedBoosts: { used: 0, remaining: 0, granted: 0 },
        purchasedAndGranted: [
          {
            id: "credit-1",
            creditType: "TALENT_CONTACT",
            fundingSource: "ADMIN_GRANT",
            remaining: 2,
            validTo: new Date("2026-08-01T10:00:00.000Z"),
            expiringSoon: true,
          },
        ],
        totalFundable: { talentContacts: 2, jobBoosts: 0 },
        ledgerHistory: [
          {
            id: "ledger-1",
            createdAt: new Date("2026-07-20T10:00:00.000Z"),
            creditType: "TALENT_CONTACT",
            fundingSource: "ADMIN_GRANT",
            kind: "GRANT",
            amount: 2,
          },
        ],
      },
      openInvoiceCount: 0,
      openInvoiceTotalRappen: 0,
      recentOrders: [
        {
          id: "order-1",
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
          label: "Contact Pack",
          status: "PAID",
          totalRappen: 9_900,
        },
      ],
      cancellationRetentionOptions: [],
      profileComplete: true,
    });
  });

  it("shows separated credit sources and keeps an Admin off Owner-only checkout", async () => {
    render(await EmployerBillingPage());

    expect(
      screen.getByRole("heading", { name: "Guthaben nach Finanzierungsquelle" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Admin-Gutschrift · gültig bis 01.08.2026")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Planoptionen ansehen" }),
    ).toHaveAttribute("href", "/pricing");
    expect(
      screen.queryByRole("link", { name: "Talent Radar mit Pro freischalten" }),
    ).not.toBeInTheDocument();
    const orders = screen.getByRole("region", {
      name: "Letzte Bestellungen",
    });
    const ledger = screen.getByRole("region", {
      name: "Letzte Guthabenbewegungen",
    });
    expect(orders).toHaveAttribute("data-e2e-horizontal-scroll", "true");
    expect(ledger).toHaveAttribute("data-e2e-horizontal-scroll", "true");
    expect(orders).toHaveClass("contain-paint");
    expect(ledger).toHaveClass("contain-paint");
    expect(orders.closest('[data-slot="card-content"]')).toHaveClass("min-w-0");
    expect(ledger.closest('[data-slot="card"]')).toHaveClass("min-w-0");
  });
});
