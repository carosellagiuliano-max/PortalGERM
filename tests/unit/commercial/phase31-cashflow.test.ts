import { describe, expect, it } from "vitest";

import {
  evaluateCashflowModel,
  type CashflowMonth,
} from "@/lib/commercial/cashflow";

function months(count: 18 | 24): CashflowMonth[] {
  return Array.from({ length: count }, (_, index) => ({
    cacCashOutRappen: index === 0 ? 100_000 : 10_000,
    closingCustomerCount: index + 2,
    fixedCashOutRappen: 200_000,
    month: index + 1,
    openingCustomerCount: index + 1,
    otherVariableCashOutRappen: 10_000,
    paymentCashInRappen: index < 2 ? 250_000 : 500_000,
    providerCashOutRappen: 20_000,
    refundsCashOutRappen: 5_000,
    serviceCashOutRappen: 100_000,
  }));
}

describe("Phase 31 exact-Rappen cashflow model", () => {
  it.each([18, 24] as const)(
    "models every month of the %s-month horizon with cash timing",
    (horizonMonths) => {
      const result = evaluateCashflowModel({
        horizonMonths,
        months: months(horizonMonths),
        openingCashRappen: 1_000_000,
        scenarioCode: "BASE_CASE",
      });
      expect(result.decision).toMatchObject({ allowed: true });
      expect(result.breakEvenMonth).toBe(3);
      expect(result.modelDigest).toMatch(/^[a-f0-9]{64}$/u);
    },
  );

  it("rejects missing months and broken customer continuity", () => {
    const rows = months(18).slice(0, -1);
    rows[1] = { ...rows[1]!, openingCustomerCount: 99 };
    expect(
      evaluateCashflowModel({
        horizonMonths: 18,
        months: rows,
        openingCashRappen: 0,
        scenarioCode: "BASE_CASE",
      }).decision.missing,
    ).toEqual(
      expect.arrayContaining([
        "COMPLETE_MONTHLY_HORIZON",
        "CUSTOMER_CONTINUITY_MONTH_2",
      ]),
    );
  });

  it("keeps CAC as explicit cash-out instead of subtracting it twice", () => {
    const withCac = evaluateCashflowModel({
      horizonMonths: 18,
      months: months(18),
      openingCashRappen: 0,
      scenarioCode: "BASE_CASE",
    });
    const withoutCacRows = months(18).map((row) => ({
      ...row,
      cacCashOutRappen: 0,
    }));
    const withoutCac = evaluateCashflowModel({
      horizonMonths: 18,
      months: withoutCacRows,
      openingCashRappen: 0,
      scenarioCode: "NO_CAC_CONTROL",
    });
    const totalCac = months(18).reduce(
      (sum, row) => sum + row.cacCashOutRappen,
      0,
    );
    expect(withoutCac.closingCashRappen - withCac.closingCashRappen).toBe(
      totalCac,
    );
  });
});
