import { describe, expect, it } from "vitest";

import {
  formatChf,
  formatDate,
  formatSalaryRange,
  formatWorkload,
} from "@/lib/utils/format";

describe("Swiss format utilities", () => {
  it("formats CHF with the pinned de-CH locale", () => {
    expect(formatChf(12_345.5)).toMatch(/^CHF[\s\u00a0]12[\u2019']345\.50$/);
  });

  it("formats workload ranges and validates their boundaries", () => {
    expect(formatWorkload(60, 80)).toBe("60%–80%");
    expect(formatWorkload(100, 100)).toBe("100%");
    expect(() => formatWorkload(80, 60)).toThrow(RangeError);
  });

  it("formats positive whole-CHF salary ranges", () => {
    expect(formatSalaryRange(90_000, 110_000, "Jahr")).toMatch(
      /^CHF 90[\u2019']000–110[\u2019']000 \/ Jahr$/,
    );
    expect(() => formatSalaryRange(100, 99)).toThrow(RangeError);
  });

  it("formats dates in Europe/Zurich", () => {
    expect(formatDate(new Date("2026-01-02T23:30:00.000Z"))).toBe("03.01.2026");
    expect(() => formatDate(new Date(Number.NaN))).toThrow(TypeError);
  });
});
