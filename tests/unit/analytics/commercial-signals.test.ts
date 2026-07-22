import { describe, expect, it } from "vitest";

import {
  reachesUsageThreshold,
  zurichCalendarDayDistance,
} from "@/lib/analytics/commercial-signals-policy";

describe("COMMERCIAL_LIFECYCLE_POLICY_V1", () => {
  it("uses Zurich calendar dates across the spring DST boundary", () => {
    expect(
      zurichCalendarDayDistance(
        new Date("2026-03-28T22:30:00.000Z"),
        new Date("2026-04-27T21:30:00.000Z"),
      ),
    ).toBe(30);
  });

  it("uses Zurich calendar dates across the autumn DST boundary", () => {
    expect(
      zurichCalendarDayDistance(
        new Date("2026-10-24T22:30:00.000Z"),
        new Date("2026-11-07T23:30:00.000Z"),
      ),
    ).toBe(14);
  });

  it("treats exactly 80 percent as near-limit and fails closed", () => {
    expect(reachesUsageThreshold(4, 5)).toBe(true);
    expect(reachesUsageThreshold(3, 5)).toBe(false);
    expect(reachesUsageThreshold(1, 0)).toBe(false);
    expect(reachesUsageThreshold(-1, 5)).toBe(false);
  });
});
