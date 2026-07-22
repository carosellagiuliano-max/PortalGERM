import {
  BILLING_POLICY_V1,
  addZurichCalendarMonthsClampedV1,
  computeProratedAllowanceV1,
  computeProratedPlanDeltaV1,
  isInstantInHalfOpenBillingPeriodV1,
  selectDefaultRetainedSeatsV1,
  validateHalfOpenBillingPeriodV1,
  type RetainedSeatMembershipV1,
} from "@/lib/billing/billing-policy-v1";
import { describe, expect, it } from "vitest";

const START = new Date("2026-07-01T00:00:00.000Z");
const END = new Date("2026-07-01T00:01:40.000Z");
const PERIOD = Object.freeze({ start: START, end: END });

describe("BILLING_POLICY_V1 Zurich calendar math", () => {
  it("publishes the frozen policy identity", () => {
    expect(BILLING_POLICY_V1).toEqual({
      version: "BILLING_POLICY_V1",
      calendarTimeZone: "Europe/Zurich",
      membershipRoleOrder: ["OWNER", "ADMIN", "RECRUITER", "VIEWER"],
    });
  });

  it.each([
    ["2026-01-31T11:15:12.345Z", 1, "2026-02-28T11:15:12.345Z"],
    ["2024-01-31T11:15:12.345Z", 1, "2024-02-29T11:15:12.345Z"],
    ["2026-11-30T11:15:12.345Z", 14, "2028-01-30T11:15:12.345Z"],
  ] as const)(
    "clamps %s plus %s Zurich month(s) to %s",
    (source, months, expected) => {
      const result = addZurichCalendarMonthsClampedV1(new Date(source), months);
      expect(result).toEqual({ ok: true, value: new Date(expected) });
    },
  );

  it("preserves Zurich wall time across the normal DST offset change", () => {
    const result = addZurichCalendarMonthsClampedV1(
      new Date("2026-03-15T11:00:00.000Z"), // 12:00 CET
      1,
    );
    expect(result).toEqual({
      ok: true,
      value: new Date("2026-04-15T10:00:00.000Z"), // 12:00 CEST
    });
  });

  it("moves a nonexistent spring-forward wall time forward by the DST gap", () => {
    const result = addZurichCalendarMonthsClampedV1(
      new Date("2026-01-29T01:30:00.000Z"), // 02:30 CET
      2,
    );
    expect(result).toEqual({
      ok: true,
      value: new Date("2026-03-29T01:30:00.000Z"), // 03:30 CEST
    });
  });

  it("chooses the earlier instant for an ambiguous autumn wall time", () => {
    const result = addZurichCalendarMonthsClampedV1(
      new Date("2026-09-25T00:30:00.000Z"), // 02:30 CEST
      1,
    );
    expect(result).toEqual({
      ok: true,
      value: new Date("2026-10-25T00:30:00.000Z"), // first 02:30
    });
  });

  it.each([
    [new Date(Number.NaN), 1, "INVALID_INSTANT"],
    [new Date("2026-01-01T00:00:00.000Z"), 0, "INVALID_MONTH_COUNT"],
    [new Date("2026-01-01T00:00:00.000Z"), 1.5, "INVALID_MONTH_COUNT"],
    [new Date("2026-01-01T00:00:00.000Z"), 121, "INVALID_MONTH_COUNT"],
  ] as const)("fails closed for invalid calendar input", (instant, months, code) => {
    expect(addZurichCalendarMonthsClampedV1(instant, months)).toEqual({
      ok: false,
      error: expect.objectContaining({ code }),
    });
  });
});

describe("BILLING_POLICY_V1 half-open periods and proration", () => {
  it("validates and clones a positive half-open period", () => {
    const result = validateHalfOpenBillingPeriodV1(PERIOD);
    expect(result).toEqual({
      ok: true,
      value: {
        start: START,
        end: END,
        durationMilliseconds: 100_000,
      },
    });
    if (result.ok) {
      expect(result.value.start).not.toBe(START);
      expect(result.value.end).not.toBe(END);
    }
  });

  it("includes the start and excludes the exact end", () => {
    expect(isInstantInHalfOpenBillingPeriodV1(PERIOD, START)).toEqual({
      ok: true,
      value: true,
    });
    expect(
      isInstantInHalfOpenBillingPeriodV1(
        PERIOD,
        new Date(END.getTime() - 1),
      ),
    ).toEqual({ ok: true, value: true });
    expect(isInstantInHalfOpenBillingPeriodV1(PERIOD, END)).toEqual({
      ok: true,
      value: false,
    });
  });

  it.each([
    [{ start: END, end: START }, "INVALID_HALF_OPEN_PERIOD"],
    [{ start: START, end: START }, "INVALID_HALF_OPEN_PERIOD"],
    [{ start: new Date(Number.NaN), end: END }, "INVALID_INSTANT"],
  ] as const)("rejects malformed half-open periods", (period, code) => {
    expect(validateHalfOpenBillingPeriodV1(period)).toEqual({
      ok: false,
      error: expect.objectContaining({ code }),
    });
  });

  it("rounds the positive plan-price delta half-up by the exact remaining ratio", () => {
    expect(
      computeProratedPlanDeltaV1({
        currentPlanNetRappen: 14_900,
        targetPlanNetRappen: 39_900,
        period: PERIOD,
        at: new Date(START.getTime() + 25_000),
      }),
    ).toEqual({
      ok: true,
      value: {
        amountRappen: 18_750,
        fullPriceDeltaRappen: 25_000,
        periodSeconds: 100,
        remainingSeconds: 75,
      },
    });
  });

  it("rounds an exact half-Rappen upgrade charge up", () => {
    expect(
      computeProratedPlanDeltaV1({
        currentPlanNetRappen: 100,
        targetPlanNetRappen: 101,
        period: { start: new Date(0), end: new Date(2_000) },
        at: new Date(1_000),
      }),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({ amountRappen: 1 }),
    });
  });

  it("uses the persisted whole-second ratio at sub-second rounding boundaries", () => {
    expect(
      computeProratedPlanDeltaV1({
        currentPlanNetRappen: 100,
        targetPlanNetRappen: 101,
        period: { start: new Date(0), end: new Date(2_500) },
        at: new Date(1_499),
      }),
    ).toEqual({
      ok: true,
      value: {
        amountRappen: 1,
        fullPriceDeltaRappen: 1,
        periodSeconds: 2,
        remainingSeconds: 1,
      },
    });
  });

  it("floors target allowances and preserves the full amount at period start", () => {
    expect(
      computeProratedAllowanceV1({
        targetAllowance: 10,
        period: PERIOD,
        at: new Date(START.getTime() + 25_000),
      }),
    ).toEqual({
      ok: true,
      value: {
        allowance: 7,
        fullAllowance: 10,
        periodSeconds: 100,
        remainingSeconds: 75,
      },
    });
    expect(
      computeProratedAllowanceV1({
        targetAllowance: 10,
        period: PERIOD,
        at: START,
      }),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({ allowance: 10 }),
    });
  });

  it.each([
    [
      {
        currentPlanNetRappen: 100,
        targetPlanNetRappen: 100,
        period: PERIOD,
        at: START,
      },
      "NON_POSITIVE_PLAN_PRICE_DELTA",
    ],
    [
      {
        currentPlanNetRappen: 101,
        targetPlanNetRappen: 100,
        period: PERIOD,
        at: START,
      },
      "NON_POSITIVE_PLAN_PRICE_DELTA",
    ],
    [
      {
        currentPlanNetRappen: -1,
        targetPlanNetRappen: 100,
        period: PERIOD,
        at: START,
      },
      "INVALID_RAPPEN_AMOUNT",
    ],
    [
      {
        currentPlanNetRappen: 100,
        targetPlanNetRappen: 200,
        period: PERIOD,
        at: END,
      },
      "INSTANT_OUTSIDE_PERIOD",
    ],
  ] as const)("fails closed for invalid plan proration", (input, code) => {
    expect(computeProratedPlanDeltaV1(input)).toEqual({
      ok: false,
      error: expect.objectContaining({ code }),
    });
  });

  it("fails closed for malformed allowance input and expired periods", () => {
    expect(
      computeProratedAllowanceV1({
        targetAllowance: 1.5,
        period: PERIOD,
        at: START,
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INVALID_ALLOWANCE" }),
    });
    expect(
      computeProratedAllowanceV1({
        targetAllowance: 10,
        period: PERIOD,
        at: END,
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INSTANT_OUTSIDE_PERIOD" }),
    });
  });
});

describe("BILLING_POLICY_V1 retained-seat fallback", () => {
  const created = (day: number) => new Date(`2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`);
  const member = (
    id: string,
    role: RetainedSeatMembershipV1["role"],
    day: number,
    status: RetainedSeatMembershipV1["status"] = "ACTIVE",
  ): RetainedSeatMembershipV1 => ({
    id,
    userId: `user-${id}`,
    role,
    status,
    joinedAt: created(day),
  });

  it("retains the oldest active owner first, then role/joinedAt/id order", () => {
    const memberships = [
      member("viewer", "VIEWER", 1),
      member("admin-b", "ADMIN", 3),
      member("owner-new", "OWNER", 2),
      member("recruiter", "RECRUITER", 1),
      member("admin-a", "ADMIN", 3),
      member("owner-old", "OWNER", 1),
      member("owner-suspended", "OWNER", 1, "SUSPENDED"),
    ];
    const result = selectDefaultRetainedSeatsV1({ seatLimit: 4, memberships });
    expect(result).toEqual({
      ok: true,
      value: {
        defaultOwnerMembershipId: "owner-old",
        defaultOwnerUserId: "user-owner-old",
        retainedMembershipIds: [
          "owner-old",
          "owner-new",
          "admin-a",
          "admin-b",
        ],
        nonRetainedActiveMembershipIds: ["recruiter", "viewer"],
      },
    });
    expect(memberships.map(({ id }) => id)).toEqual([
      "viewer",
      "admin-b",
      "owner-new",
      "recruiter",
      "admin-a",
      "owner-old",
      "owner-suspended",
    ]);
  });

  it("retains all active memberships when the limit is larger", () => {
    expect(
      selectDefaultRetainedSeatsV1({
        seatLimit: 10,
        memberships: [
          member("admin", "ADMIN", 1),
          member("owner", "OWNER", 2),
        ],
      }),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({
        retainedMembershipIds: ["owner", "admin"],
        nonRetainedActiveMembershipIds: [],
      }),
    });
  });

  it.each([
    [
      { seatLimit: 0, memberships: [member("owner", "OWNER", 1)] },
      "INVALID_SEAT_LIMIT",
    ],
    [
      { seatLimit: 1, memberships: [member("admin", "ADMIN", 1)] },
      "DEFAULT_OWNER_REQUIRED",
    ],
    [
      {
        seatLimit: 1,
        memberships: [member("owner", "OWNER", 1), member("owner", "OWNER", 2)],
      },
      "DUPLICATE_MEMBERSHIP",
    ],
    [
      {
        seatLimit: 1,
        memberships: [
          { ...member("owner", "OWNER", 1), joinedAt: new Date(Number.NaN) },
        ],
      },
      "INVALID_MEMBERSHIP",
    ],
  ] as const)("fails closed for invalid seat input", (input, code) => {
    expect(selectDefaultRetainedSeatsV1(input)).toEqual({
      ok: false,
      error: expect.objectContaining({ code }),
    });
  });
});
