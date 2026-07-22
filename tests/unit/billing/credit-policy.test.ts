import {
  CREDIT_FUNDING_ORDER_V1,
  allocateCreditConsumptionV1,
  allocateCreditExpiriesV1,
  buildExactCreditConsumeReversalV1,
  type AvailableCreditGrantV1,
  type ReversibleCreditLedgerEntryV1,
} from "@/lib/billing/credit-policy";
import { describe, expect, it } from "vitest";

const AT = new Date("2026-07-21T12:00:00.000Z");
const BEFORE = new Date("2026-07-01T00:00:00.000Z");
const AFTER = new Date("2026-08-01T00:00:00.000Z");

function grant(
  id: string,
  overrides: Partial<AvailableCreditGrantV1> = {},
): AvailableCreditGrantV1 {
  return {
    id,
    accountId: `account-${id}`,
    fundingSource: "PLAN_ALLOWANCE",
    creditType: "TALENT_CONTACT",
    remaining: 1,
    validFrom: BEFORE,
    validTo: AFTER,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

function reversalEntry(
  overrides: Partial<ReversibleCreditLedgerEntryV1> = {},
): ReversibleCreditLedgerEntryV1 {
  return {
    id: "consume-1",
    accountId: "account-1",
    fundingSource: "PURCHASED_PACK",
    creditType: "TALENT_CONTACT",
    kind: "CONSUME",
    amount: -3,
    validFrom: BEFORE,
    validTo: AFTER,
    reversedByEntryId: null,
    ...overrides,
  };
}

describe("deterministic credit consumption policy", () => {
  it("freezes the exact ADR-028 funding order", () => {
    expect(CREDIT_FUNDING_ORDER_V1).toEqual([
      "PLAN_ALLOWANCE",
      "PURCHASED_PACK",
      "ADMIN_GRANT",
    ]);
  });

  it("orders by source, then validTo, createdAt and stable id", () => {
    const grants = [
      grant("admin", {
        accountId: "admin-account",
        fundingSource: "ADMIN_GRANT",
        remaining: 10,
        validTo: new Date("2026-07-22T00:00:00.000Z"),
      }),
      grant("purchased", {
        accountId: "purchased-account",
        fundingSource: "PURCHASED_PACK",
        remaining: 10,
        validTo: new Date("2026-07-22T00:00:00.000Z"),
      }),
      grant("plan-late", {
        accountId: "plan-late-account",
        remaining: 10,
        validTo: new Date("2026-07-31T00:00:00.000Z"),
      }),
      grant("plan-b", {
        accountId: "plan-b-account",
        remaining: 1,
        validTo: new Date("2026-07-25T00:00:00.000Z"),
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      }),
      grant("plan-a", {
        accountId: "plan-a-account",
        remaining: 1,
        validTo: new Date("2026-07-25T00:00:00.000Z"),
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      }),
      grant("plan-oldest", {
        accountId: "plan-oldest-account",
        remaining: 1,
        validTo: new Date("2026-07-25T00:00:00.000Z"),
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ];

    const result = allocateCreditConsumptionV1({
      grants,
      creditType: "TALENT_CONTACT",
      amount: 5,
      at: AT,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        requestedAmount: 5,
        allocatedAmount: 5,
        allocations: [
          expect.objectContaining({
            sourceGrantEntryId: "plan-oldest",
            consumeAmount: 1,
            ledgerAmount: -1,
            remainingBefore: 1,
            remainingAfter: 0,
          }),
          expect.objectContaining({
            sourceGrantEntryId: "plan-a",
            consumeAmount: 1,
            ledgerAmount: -1,
          }),
          expect.objectContaining({
            sourceGrantEntryId: "plan-b",
            consumeAmount: 1,
            ledgerAmount: -1,
          }),
          expect.objectContaining({
            sourceGrantEntryId: "plan-late",
            consumeAmount: 2,
            ledgerAmount: -2,
            remainingBefore: 10,
            remainingAfter: 8,
          }),
        ],
      },
    });
    expect(grants.map(({ id }) => id)).toEqual([
      "admin",
      "purchased",
      "plan-late",
      "plan-b",
      "plan-a",
      "plan-oldest",
    ]);
  });

  it("falls through plan, purchased and admin without a partial result", () => {
    const result = allocateCreditConsumptionV1({
      grants: [
        grant("admin", { fundingSource: "ADMIN_GRANT", remaining: 3 }),
        grant("purchased", { fundingSource: "PURCHASED_PACK", remaining: 2 }),
        grant("plan", { remaining: 1 }),
        grant("empty", { remaining: 0 }),
      ],
      creditType: "TALENT_CONTACT",
      amount: 6,
      at: AT,
    });
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        allocatedAmount: 6,
        allocations: [
          expect.objectContaining({ sourceGrantEntryId: "plan", consumeAmount: 1 }),
          expect.objectContaining({ sourceGrantEntryId: "purchased", consumeAmount: 2 }),
          expect.objectContaining({ sourceGrantEntryId: "admin", consumeAmount: 3 }),
        ],
      }),
    });
  });

  it("returns insufficient credits instead of a partial allocation", () => {
    expect(
      allocateCreditConsumptionV1({
        grants: [grant("one", { remaining: 2 })],
        creditType: "TALENT_CONTACT",
        amount: 3,
        at: AT,
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INSUFFICIENT_CREDITS" }),
    });
  });

  it("uses the half-open grant interval", () => {
    const exactStart = grant("start", { validFrom: AT });
    expect(
      allocateCreditConsumptionV1({
        grants: [exactStart],
        creditType: "TALENT_CONTACT",
        amount: 1,
        at: AT,
      }),
    ).toEqual({ ok: true, value: expect.objectContaining({ allocatedAmount: 1 }) });

    const exactEnd = grant("end", { validTo: AT });
    expect(
      allocateCreditConsumptionV1({
        grants: [exactEnd],
        creditType: "TALENT_CONTACT",
        amount: 1,
        at: AT,
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "GRANT_NOT_EFFECTIVE", grantId: "end" }),
    });
  });

  it.each([
    [
      { grants: [grant("one")], creditType: "TALENT_CONTACT" as const, amount: 0, at: AT },
      "INVALID_REQUESTED_AMOUNT",
    ],
    [
      { grants: [grant("one")], creditType: "TALENT_CONTACT" as const, amount: 1.5, at: AT },
      "INVALID_REQUESTED_AMOUNT",
    ],
    [
      { grants: [grant("one")], creditType: "TALENT_CONTACT" as const, amount: 1, at: new Date(Number.NaN) },
      "INVALID_INSTANT",
    ],
    [
      { grants: [grant("one", { creditType: "JOB_BOOST" })], creditType: "TALENT_CONTACT" as const, amount: 1, at: AT },
      "FOREIGN_CREDIT_TYPE",
    ],
    [
      { grants: [grant("same"), grant("same")], creditType: "TALENT_CONTACT" as const, amount: 1, at: AT },
      "DUPLICATE_GRANT",
    ],
    [
      { grants: [grant("bad", { remaining: -1 })], creditType: "TALENT_CONTACT" as const, amount: 1, at: AT },
      "INVALID_GRANT_AMOUNT",
    ],
    [
      { grants: [grant("bad", { remaining: 1.5 })], creditType: "TALENT_CONTACT" as const, amount: 1, at: AT },
      "INVALID_GRANT_AMOUNT",
    ],
    [
      { grants: [grant("bad", { validFrom: AFTER, validTo: BEFORE })], creditType: "TALENT_CONTACT" as const, amount: 1, at: AT },
      "INVALID_GRANT_RANGE",
    ],
  ] as const)("fails closed on malformed consumption input", (input, code) => {
    expect(allocateCreditConsumptionV1(input)).toEqual({
      ok: false,
      error: expect.objectContaining({ code }),
    });
  });

  it("rejects an unknown funding source instead of silently reordering it", () => {
    const malformed = {
      ...grant("bad-source"),
      fundingSource: "FOREIGN_SOURCE",
    } as unknown as AvailableCreditGrantV1;
    expect(
      allocateCreditConsumptionV1({
        grants: [malformed],
        creditType: "TALENT_CONTACT",
        amount: 1,
        at: AT,
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INVALID_FUNDING_SOURCE" }),
    });
  });
});

describe("half-open credit expiry policy", () => {
  it("allocates nothing before validTo and the full remainder at the boundary", () => {
    const expiring = grant("expiring", {
      remaining: 4,
      validTo: AT,
    });
    expect(
      allocateCreditExpiriesV1({
        grants: [expiring],
        creditType: "TALENT_CONTACT",
        at: new Date(AT.getTime() - 1),
      }),
    ).toEqual({ ok: true, value: { totalExpired: 0, allocations: [] } });
    expect(
      allocateCreditExpiriesV1({
        grants: [expiring],
        creditType: "TALENT_CONTACT",
        at: AT,
      }),
    ).toEqual({
      ok: true,
      value: {
        totalExpired: 4,
        allocations: [
          {
            sourceGrantEntryId: "expiring",
            accountId: "account-expiring",
            fundingSource: "PLAN_ALLOWANCE",
            creditType: "TALENT_CONTACT",
            expireAmount: 4,
            ledgerAmount: -4,
            boundary: AT,
          },
        ],
      },
    });
  });

  it("is projector-lag safe, skips zero balances and orders output deterministically", () => {
    const result = allocateCreditExpiriesV1({
      grants: [
        grant("admin", { fundingSource: "ADMIN_GRANT", remaining: 2, validTo: AT }),
        grant("future", { remaining: 9, validTo: AFTER }),
        grant("plan", { remaining: 1, validTo: new Date(AT.getTime() - 1) }),
        grant("empty", { remaining: 0, validTo: AT }),
        grant("purchased", { fundingSource: "PURCHASED_PACK", remaining: 3, validTo: AT }),
      ],
      creditType: "TALENT_CONTACT",
      at: new Date(AT.getTime() + 1),
    });
    expect(result).toEqual({
      ok: true,
      value: {
        totalExpired: 6,
        allocations: [
          expect.objectContaining({ sourceGrantEntryId: "plan", ledgerAmount: -1 }),
          expect.objectContaining({ sourceGrantEntryId: "purchased", ledgerAmount: -3 }),
          expect.objectContaining({ sourceGrantEntryId: "admin", ledgerAmount: -2 }),
        ],
      },
    });
  });

  it("shares the strict duplicate/type/range validation", () => {
    expect(
      allocateCreditExpiriesV1({
        grants: [grant("same"), grant("same")],
        creditType: "TALENT_CONTACT",
        at: AT,
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "DUPLICATE_GRANT" }),
    });
    expect(
      allocateCreditExpiriesV1({
        grants: [grant("foreign", { creditType: "JOB_BOOST" })],
        creditType: "TALENT_CONTACT",
        at: AT,
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "FOREIGN_CREDIT_TYPE" }),
    });
  });
});

describe("exact credit consume reversal policy", () => {
  const command = {
    expectedAccountId: "account-1",
    expectedFundingSource: "PURCHASED_PACK" as const,
    expectedCreditType: "TALENT_CONTACT" as const,
    at: AT,
  };

  it("derives the exact positive inverse in the same account and source", () => {
    const result = buildExactCreditConsumeReversalV1({
      entry: reversalEntry(),
      ...command,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        reversalOfEntryId: "consume-1",
        accountId: "account-1",
        fundingSource: "PURCHASED_PACK",
        creditType: "TALENT_CONTACT",
        kind: "REVERSAL",
        amount: 3,
        validFrom: BEFORE,
        validTo: AFTER,
      },
    });
  });

  it.each([
    [reversalEntry({ kind: "GRANT", amount: 3 }), {}, "REVERSAL_NOT_CONSUME"],
    [reversalEntry({ amount: 3 }), {}, "INVALID_REVERSAL_ENTRY"],
    [reversalEntry({ amount: -1.5 }), {}, "INVALID_REVERSAL_ENTRY"],
    [reversalEntry({ reversedByEntryId: "reversal-1" }), {}, "ALREADY_REVERSED"],
    [reversalEntry(), { expectedAccountId: "foreign-account" }, "REVERSAL_SCOPE_MISMATCH"],
    [reversalEntry(), { expectedFundingSource: "ADMIN_GRANT" as const }, "REVERSAL_SCOPE_MISMATCH"],
    [reversalEntry(), { expectedCreditType: "JOB_BOOST" as const }, "REVERSAL_SCOPE_MISMATCH"],
    [reversalEntry(), { at: AFTER }, "REVERSAL_SOURCE_NOT_EFFECTIVE"],
  ] as const)("rejects an inexact or unsafe reversal", (entry, overrides, code) => {
    expect(
      buildExactCreditConsumeReversalV1({
        entry,
        ...command,
        ...overrides,
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code }),
    });
  });
});
