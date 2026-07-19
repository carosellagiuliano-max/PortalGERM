import { describe, expect, it } from "vitest";

import { deduplicateSlug, slugify } from "@/lib/utils/slug";

describe("slug utilities", () => {
  it.each([
    ["Zürich", "zuerich"],
    ["Genève", "geneve"],
    ["  Grösse & Qualität! ", "groesse-qualitaet"],
  ])("slugifies %s", (value, expected) => {
    expect(slugify(value)).toBe(expected);
  });

  it("uses the first available deterministic suffix", () => {
    expect(deduplicateSlug("Zürich", ["zuerich", "zuerich-2", "other"])).toBe(
      "zuerich-3",
    );
    expect(deduplicateSlug("Bern", ["zuerich"])).toBe("bern");
  });

  it("rejects an empty slug base", () => {
    expect(() => deduplicateSlug("---", [])).toThrow(TypeError);
  });
});
