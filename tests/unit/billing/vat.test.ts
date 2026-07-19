import { computeVat } from "@/lib/billing/vat";
import { describe, expect, it } from "vitest";

describe("computeVat", () => {
  it("matches the frozen CHF 8.1 percent golden fixture", () => {
    expect(computeVat(10_000, 810)).toEqual({
      net: 10_000,
      vatAmount: 810,
      total: 10_810,
    });
  });

  it.each([
    [0, 810, 0],
    [1, 4_999, 0],
    [1, 5_000, 1],
    [3, 5_000, 2],
    [100, 0, 0],
  ] as const)(
    "uses integer half-up for net=%s and rate=%s",
    (net, rate, expectedVat) => {
      const result = computeVat(net, rate);
      expect(result.vatAmount).toBe(expectedVat);
      expect(result.net + result.vatAmount).toBe(result.total);
    },
  );

  it.each([
    [-1, 810],
    [1.5, 810],
    [1, -1],
    [1, 810.5],
    [Number.NaN, 810],
    [Number.MAX_VALUE, 810],
  ])("rejects non-integer or negative input (%s, %s)", (net, rate) => {
    expect(() => computeVat(net, rate)).toThrow("non-negative safe integer");
  });

  it("fails instead of overflowing JavaScript integer money", () => {
    expect(() => computeVat(Number.MAX_SAFE_INTEGER, 10_000)).toThrow(
      "safe integer range",
    );
  });

  it("rejects a rate outside the versioned 0..10000 basis-point range", () => {
    expect(() => computeVat(100, 10_001)).toThrow("must not exceed 10000");
  });
});
