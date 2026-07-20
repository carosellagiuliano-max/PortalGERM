import { describe, expect, it } from "vitest";

import {
  createSeedRandom,
  deterministicSample,
  deterministicShuffle,
  exactRange,
  expandExactDistribution,
} from "@/prisma/seed/utils";

describe("deterministic seed utilities", () => {
  it("replays a scoped shuffle without mutating its input", () => {
    const input = ["a", "b", "c", "d", "e"] as const;
    const first = deterministicShuffle(input, createSeedRandom("jobs.languages"));
    const second = deterministicShuffle(input, createSeedRandom("jobs.languages"));

    expect(first).toEqual(second);
    expect(input).toEqual(["a", "b", "c", "d", "e"]);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("keeps semantic random scopes independent", () => {
    const first = createSeedRandom("jobs.languages");
    const second = createSeedRandom("jobs.statuses");

    expect([first.next(), first.next()]).not.toEqual([
      second.next(),
      second.next(),
    ]);
  });

  it("samples exact unique members and validates bounds", () => {
    const values = exactRange(20);
    const sampled = deterministicSample(
      values,
      7,
      createSeedRandom("candidates.cantons"),
    );

    expect(sampled).toHaveLength(7);
    expect(new Set(sampled).size).toBe(7);
    expect(sampled.every((value) => values.includes(value))).toBe(true);
    expect(() =>
      deterministicSample(values, 21, createSeedRandom("invalid.sample")),
    ).toThrow(RangeError);
  });

  it("expands an exact distribution in stable label order", () => {
    expect(
      expandExactDistribution({ PUBLISHED: 3, DRAFT: 2, CLOSED: 1 }),
    ).toEqual([
      "CLOSED",
      "DRAFT",
      "DRAFT",
      "PUBLISHED",
      "PUBLISHED",
      "PUBLISHED",
    ]);
  });

  it.each(["", "MixedCase", "contains space"])(
    "rejects a non-semantic random scope (%s)",
    (scope) => {
      expect(() => createSeedRandom(scope)).toThrow(TypeError);
    },
  );
});
