import { describe, expect, it } from "vitest";

import { deriveAdminMockRenewalPeriodV1 } from "@/lib/billing/admin-renewal-policy";

describe("ADR-004 Admin mock-renewal period policy", () => {
  it("anchors a due month-end renewal to the predecessor boundary", () => {
    const boundary = new Date("2026-01-31T22:45:30.000Z");

    expect(
      deriveAdminMockRenewalPeriodV1({
        currentPeriodEnd: boundary,
        termMonthsSnapshot: 1,
        now: boundary,
      }),
    ).toEqual({
      ok: true,
      value: {
        periodStart: boundary,
        periodEnd: new Date("2026-02-28T22:45:30.000Z"),
      },
    });
  });

  it("preserves Zurich wall time across the DST change", () => {
    const boundary = new Date("2026-03-29T00:30:00.000Z");

    expect(
      deriveAdminMockRenewalPeriodV1({
        currentPeriodEnd: boundary,
        termMonthsSnapshot: 1,
        now: new Date("2026-03-29T00:30:01.000Z"),
      }),
    ).toEqual({
      ok: true,
      value: {
        periodStart: boundary,
        periodEnd: new Date("2026-04-28T23:30:00.000Z"),
      },
    });
  });

  it("is due-only and refuses to backfill more than one elapsed term", () => {
    expect(
      deriveAdminMockRenewalPeriodV1({
        currentPeriodEnd: new Date("2026-08-01T10:00:00.000Z"),
        termMonthsSnapshot: 1,
        now: new Date("2026-07-31T10:00:00.000Z"),
      }),
    ).toEqual({ ok: false, code: "NOT_DUE" });

    expect(
      deriveAdminMockRenewalPeriodV1({
        currentPeriodEnd: new Date("2026-06-01T10:00:00.000Z"),
        termMonthsSnapshot: 1,
        now: new Date("2026-07-01T10:00:00.000Z"),
      }),
    ).toEqual({ ok: false, code: "RENEWAL_WINDOW_ELAPSED" });
  });
});
