import { describe, expect, it } from "vitest";

import {
  CanonicalJsonError,
  canonicalJson,
  sha256CanonicalJson,
} from "@/prisma/seed/canonical-json";

describe("canonical seed JSON", () => {
  it("is independent of object insertion order at every depth", () => {
    const first = {
      z: [{ beta: 2, alpha: 1 }],
      a: { two: true, one: null },
    };
    const second = {
      a: { one: null, two: true },
      z: [{ alpha: 1, beta: 2 }],
    };

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(sha256CanonicalJson(first)).toBe(sha256CanonicalJson(second));
  });

  it("preserves semantic array order and changes the hash when data changes", () => {
    const baseline = { values: ["a", "b", 3] };

    expect(sha256CanonicalJson(baseline)).not.toBe(
      sha256CanonicalJson({ values: ["b", "a", 3] }),
    );
    expect(sha256CanonicalJson(baseline)).not.toBe(
      sha256CanonicalJson({ values: ["a", "b", 4] }),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite JSON numbers (%s)",
    (value) => {
      expect(() => canonicalJson({ value })).toThrow(CanonicalJsonError);
    },
  );

  it("rejects circular, accessor and symbol-bearing objects", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "hidden",
    });
    const symbolBearing = { value: 1 } as Record<PropertyKey, unknown>;
    symbolBearing[Symbol("hidden")] = 2;

    expect(() => canonicalJson(circular as never)).toThrow(
      "circular reference",
    );
    expect(() => canonicalJson(accessor as never)).toThrow(
      "enumerable data property",
    );
    expect(() => canonicalJson(symbolBearing as never)).toThrow(
      "symbol properties",
    );
  });
});
