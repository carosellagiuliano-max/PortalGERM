import {
  evidenceDigest,
  gateDecision,
  isSafeRappen,
  type GateDecision,
} from "@/lib/commercial/contracts";

export type CashflowMonth = Readonly<{
  cacCashOutRappen: number;
  closingCustomerCount: number;
  fixedCashOutRappen: number;
  month: number;
  openingCustomerCount: number;
  otherVariableCashOutRappen: number;
  paymentCashInRappen: number;
  providerCashOutRappen: number;
  refundsCashOutRappen: number;
  serviceCashOutRappen: number;
}>;

export type CashflowResult = Readonly<{
  breakEvenMonth: number | null;
  closingCashRappen: number;
  decision: GateDecision;
  modelDigest: string;
  peakFundingNeedRappen: number;
}>;

export function evaluateCashflowModel(
  input: Readonly<{
    horizonMonths: 18 | 24;
    months: readonly CashflowMonth[];
    openingCashRappen: number;
    scenarioCode: string;
  }>,
): CashflowResult {
  const missing: string[] = [];
  if (
    input.months.length !== input.horizonMonths ||
    input.months.some((row, index) => row.month !== index + 1)
  ) {
    missing.push("COMPLETE_MONTHLY_HORIZON");
  }
  if (!isSafeRappen(input.openingCashRappen)) missing.push("OPENING_CASH");
  if (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.scenarioCode)) {
    missing.push("SCENARIO_CODE");
  }

  let cash = input.openingCashRappen;
  let lowestCash = cash;
  let breakEvenMonth: number | null = null;
  let previousClosingCustomers: number | null = null;
  for (const row of input.months) {
    const money = [
      row.cacCashOutRappen,
      row.fixedCashOutRappen,
      row.otherVariableCashOutRappen,
      row.paymentCashInRappen,
      row.providerCashOutRappen,
      row.refundsCashOutRappen,
      row.serviceCashOutRappen,
    ];
    if (
      money.some((amount) => !isSafeRappen(amount)) ||
      !Number.isSafeInteger(row.openingCustomerCount) ||
      row.openingCustomerCount < 0 ||
      !Number.isSafeInteger(row.closingCustomerCount) ||
      row.closingCustomerCount < 0
    ) {
      missing.push(`VALID_MONTH_${row.month}`);
      continue;
    }
    if (
      previousClosingCustomers !== null &&
      row.openingCustomerCount !== previousClosingCustomers
    ) {
      missing.push(`CUSTOMER_CONTINUITY_MONTH_${row.month}`);
    }
    previousClosingCustomers = row.closingCustomerCount;
    const totalOut =
      row.cacCashOutRappen +
      row.fixedCashOutRappen +
      row.otherVariableCashOutRappen +
      row.providerCashOutRappen +
      row.refundsCashOutRappen +
      row.serviceCashOutRappen;
    const net = row.paymentCashInRappen - totalOut;
    cash += net;
    lowestCash = Math.min(lowestCash, cash);
    if (breakEvenMonth === null && net >= 0) breakEvenMonth = row.month;
  }
  if (input.months.length === input.horizonMonths && breakEvenMonth === null) {
    missing.push("NO_BREAK_EVEN_WITHIN_HORIZON");
  }
  return Object.freeze({
    breakEvenMonth,
    closingCashRappen: cash,
    decision: gateDecision([...new Set(missing)]),
    modelDigest: evidenceDigest(input),
    peakFundingNeedRappen: Math.max(0, -lowestCash),
  });
}
