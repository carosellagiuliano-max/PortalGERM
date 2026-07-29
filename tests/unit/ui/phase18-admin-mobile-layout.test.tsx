import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  listAdminAuditEntries: vi.fn(),
  listAdminInvoices: vi.fn(),
  listAdminOrders: vi.fn(),
  requireAdminPage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/audit-read", () => ({
  listAdminAuditEntries: mocks.listAdminAuditEntries,
}));
vi.mock("@/lib/auth/route-guards", () => ({
  requireAdminPage: mocks.requireAdminPage,
}));
vi.mock("@/lib/billing/admin-billing", () => ({
  listAdminInvoices: mocks.listAdminInvoices,
  listAdminOrders: mocks.listAdminOrders,
}));
vi.mock("@/lib/db/client", () => ({
  getDatabase: mocks.getDatabase,
}));

import AdminAuditPage from "@/app/admin/audit/page";
import AdminInvoicesPage from "@/app/admin/invoices/page";
import AdminOrdersPage from "@/app/admin/orders/page";

describe("Phase-18 admin mobile layout", () => {
  beforeEach(() => {
    mocks.getDatabase.mockReturnValue({});
    mocks.requireAdminPage.mockResolvedValue({
      id: "admin-mobile",
      email: "admin@example.test",
      role: "ADMIN",
      status: "ACTIVE",
    });
    mocks.listAdminAuditEntries.mockResolvedValue({
      invalidFilter: false,
      entries: [
        {
          id: "audit-mobile",
          result: "SUCCEEDED",
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
          action: "USER_REGISTERED",
          capability: "ADMIN_AUDIT_READ",
          reasonCode: null,
          actor: { name: "Demo Admin", email: "admin@example.test" },
          actorKind: "USER",
          targetType: "USER",
          targetId: "user-mobile",
          company: null,
          companyId: null,
          correlationId: "phase18-mobile",
          retainUntil: new Date("2027-07-20T10:00:00.000Z"),
        },
      ],
    });
    mocks.listAdminInvoices.mockResolvedValue([
      {
        id: "invoice-mobile",
        number: "STH-2026-000001",
        status: "ISSUED",
        netTotalRappen: 10_000,
        totalRappen: 10_810,
        dueAt: new Date("2026-08-20T10:00:00.000Z"),
        issuedAt: new Date("2026-07-20T10:00:00.000Z"),
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
        company: { id: "company-mobile", name: "Beispiel AG" },
      },
    ]);
    mocks.listAdminOrders.mockResolvedValue([
      {
        id: "order-mobile",
        status: "PAID",
        netTotalRappen: 10_000,
        totalRappen: 10_810,
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
        company: { id: "company-mobile", name: "Beispiel AG" },
        lines: [{ descriptionSnapshot: "Pro Monatsplan" }],
      },
    ]);
  });

  it("allows audit filters to shrink without widening the viewport", async () => {
    render(await AdminAuditPage({ searchParams: Promise.resolve({}) }));

    for (const name of ["Aktion", "Zieltyp", "Ergebnis"]) {
      expect(screen.getByRole("combobox", { name })).toHaveClass(
        "w-full",
        "min-w-0",
      );
    }
    const correlation = screen.getByRole("textbox", {
      name: "Correlation-ID",
    });
    expect(correlation).toHaveClass("w-full", "min-w-0");
    expect(correlation.closest("form")).toHaveClass("min-w-0");
    expect(
      screen.getByRole("region", { name: "Audit-Evidenz" }),
    ).toHaveAttribute("data-responsive-table-region", "true");
  });

  it("keeps invoice actions reachable in a named responsive region", async () => {
    render(await AdminInvoicesPage());

    const region = screen.getByRole("region", {
      name: "Rechnungen und Belege",
    });
    expect(region).toHaveAttribute("data-responsive-table-region", "true");
    const action = screen.getByRole("link", { name: "Anzeigen" });
    expect(action).toHaveClass("whitespace-nowrap");
    expect(action.closest("td")).toHaveAttribute(
      "data-responsive-actions",
      "true",
    );
  });

  it("contains order links and keeps the primary action reachable", async () => {
    render(await AdminOrdersPage());

    const region = screen.getByRole("region", {
      name: "Bestellungen und Belege",
    });
    expect(region).toHaveAttribute("data-responsive-table-region", "true");
    expect(
      screen.getByRole("link", { name: "Beispiel AG" }).closest(
        '[data-responsive-table-region="true"]',
      ),
    ).toBe(region);
    const action = screen.getByRole("link", { name: "Prüfen" });
    expect(action).toHaveClass("whitespace-nowrap");
    expect(action.closest("td")).toHaveAttribute(
      "data-responsive-actions",
      "true",
    );
  });
});
