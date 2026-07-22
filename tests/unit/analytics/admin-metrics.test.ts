import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ADMIN_FINANCIAL_METRICS_V1, getAdminFinancialMetrics, getZurichMonthWindow } from "@/lib/analytics/admin-metrics";

describe("ADMIN_FINANCIAL_METRICS_V1 Zurich window", () => {
  it("uses a half-open Zurich calendar month across spring DST", () => {
    const window = getZurichMonthWindow(new Date("2026-03-29T01:30:00.000Z"));
    expect(window).toEqual({
      label: "2026-03",
      start: new Date("2026-02-28T23:00:00.000Z"),
      end: new Date("2026-03-31T22:00:00.000Z"),
    });
    expect(window.end.getTime() - window.start.getTime()).toBe(31 * 86_400_000 - 3_600_000);
  });

  it("attributes the exact UTC boundary to the next Zurich month", () => {
    expect(getZurichMonthWindow(new Date("2026-07-31T21:59:59.999Z")).label).toBe("2026-07");
    const august = getZurichMonthWindow(new Date("2026-07-31T22:00:00.000Z"));
    expect(august.label).toBe("2026-08");
    expect(august.start).toEqual(new Date("2026-07-31T22:00:00.000Z"));
    expect(august.end).toEqual(new Date("2026-08-31T22:00:00.000Z"));
  });

  it("keeps MRR and Mock cash-basis definitions explicitly separate", () => {
    expect(ADMIN_FINANCIAL_METRICS_V1.timeZone).toBe("Europe/Zurich");
    expect(ADMIN_FINANCIAL_METRICS_V1.mrrDefinition).toMatch(/Monthly-Equivalent/u);
    expect(ADMIN_FINANCIAL_METRICS_V1.revenueDefinition).toMatch(/erst.*PAID/iu);
    expect(ADMIN_FINANCIAL_METRICS_V1.revenueDefinition).toMatch(/MWST.*VOID.*Duplikate/iu);
  });

  it("rejects invalid measurement instants", () => {
    expect(() => getZurichMonthWindow(new Date(Number.NaN))).toThrow(TypeError);
  });

  it("reconciles MRR separately from first-paid Plan and Product lines", async () => {
    const monthStart = new Date("2026-06-30T22:00:00.000Z");
    const transaction = {
      employerSubscription: { findMany: vi.fn().mockResolvedValue([
        { companyId: "company-1", monthlyEquivalentRappenSnapshot: 14_900, recurringNetRappenSnapshot: 14_900 },
        { companyId: "company-2", monthlyEquivalentRappenSnapshot: 39_900, recurringNetRappenSnapshot: 39_900 },
        { companyId: "company-3", monthlyEquivalentRappenSnapshot: 0, recurringNetRappenSnapshot: 0 },
      ]) },
      company: { count: vi.fn().mockResolvedValue(4) },
      invoice: {
        findMany: vi.fn().mockResolvedValue([
          { id: "invoice-current", order: { paymentEvents: [{ id: "paid-current", createdAt: monthStart }] }, lines: [
            { netRappen: 14_900, orderLine: { planVersionId: "plan", productVersion: null } },
            { netRappen: 9_900, orderLine: { planVersionId: null, productVersion: { product: { type: "CONTACT_PACK" } } } },
          ] },
          { id: "invoice-retry", order: { paymentEvents: [{ id: "paid-before", createdAt: new Date(monthStart.getTime() - 1) }, { id: "duplicate-in-month", createdAt: new Date(monthStart.getTime() + 1) }] }, lines: [{ netRappen: 99_999, orderLine: { planVersionId: "plan", productVersion: null } }] },
        ]),
        groupBy: vi.fn().mockResolvedValue([{ status: "PAID", _count: { _all: 1 }, _sum: { totalRappen: 26_809 } }]),
      },
    };
    const database = {
      ...transaction,
      $transaction: vi.fn(
        async (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const result = await getAdminFinancialMetrics({ actor: { userId: "11000000-0000-4000-8000-000000000001", email: "admin@example.ch", role: "ADMIN", status: "ACTIVE" }, correlationId: "22000000-0000-4000-8000-000000000001", database: database as never, now: new Date("2026-07-21T12:00:00.000Z") });
    expect(result).toEqual(expect.objectContaining({ mrrRappen: 54_800, customContractsWithoutValue: 1, monthlyMockPaidNetRappen: 24_800, monthlyMockPaidPlanNetRappen: 14_900, monthlyMockPaidProductNetRappen: 9_900, activeSubscriptions: 3, paidEmployers: 3, freeEmployers: 1, contactPackSales: { count: 1, netRappen: 9_900 } }));
    expect(database.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "RepeatableRead" },
    );
    expect(transaction.employerSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ company: { status: "ACTIVE" } }),
      }),
    );
  });
});
