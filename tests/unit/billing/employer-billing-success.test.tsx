import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireEmployerBillingPage: vi.fn(),
  getCompanyOrder: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/employer-page-access", () => ({
  requireEmployerBillingPage: mocks.requireEmployerBillingPage,
}));
vi.mock("@/lib/billing/employer-read-model", () => ({
  getCompanyOrder: mocks.getCompanyOrder,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));

import BillingSuccessPage from "@/app/employer/billing/success/page";

const ORDER_ID = "10000000-0000-4000-8000-000000000001";

describe("employer Billing success page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEmployerBillingPage.mockResolvedValue({
      context: { companyId: "20000000-0000-4000-8000-000000000001" },
    });
    mocks.getDatabase.mockReturnValue({});
  });

  it("labels a paid downgrade as scheduled instead of already activated", async () => {
    mocks.getCompanyOrder.mockResolvedValue({
      id: ORDER_ID,
      status: "PAID",
      paidAt: new Date("2026-07-21T10:00:00.000Z"),
      totalRappen: 16_107,
      invoice: {
        id: "30000000-0000-4000-8000-000000000001",
        number: "STH-2026-00001",
      },
      lines: [
        {
          descriptionSnapshot: "Starter Monatsplan",
          subscriptionSnapshot: {
            changeKind: "DOWNGRADE",
            fulfillmentPeriodStart: new Date("2026-08-21T10:00:00.000Z"),
            activeJobLimitSnapshot: 3,
            seatLimitSnapshot: 2,
            talentContactAllowanceSnapshot: 0,
            jobBoostAllowanceSnapshot: 0,
          },
        },
      ],
    });

    render(
      await BillingSuccessPage({
        searchParams: Promise.resolve({ order: ORDER_ID }),
      }),
    );

    expect(
      screen.getByText(/Der Planwechsel ist per 21\.08\.2026 vorgemerkt/u),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Ziel-Limiten ab 21.08.2026" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Bis zu diesem Termin bleiben der aktuelle Plan/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Neue, beim Kauf gespeicherte Planlimiten"),
    ).not.toBeInTheDocument();
  });
});
