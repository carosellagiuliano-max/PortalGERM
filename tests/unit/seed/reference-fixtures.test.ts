import { CANTON_FIXTURES } from "@/prisma/seed/fixtures/cantons";
import { CATEGORY_FIXTURES } from "@/prisma/seed/fixtures/categories";
import { CITY_FIXTURES } from "@/prisma/seed/fixtures/cities";
import { SKILL_FIXTURES } from "@/prisma/seed/fixtures/skills";
import { describe, expect, it } from "vitest";

const EXPECTED_CANTON_CODES = [
  "AG", "AR", "AI", "BL", "BS", "BE", "FR", "GE", "GL", "GR", "JU",
  "LU", "NE", "NW", "OW", "SH", "SZ", "SO", "SG", "TG", "TI", "UR",
  "VS", "VD", "ZG", "ZH",
];

const EXPECTED_CATEGORY_NAMES = [
  "Informatik",
  "Gesundheit/Pflege",
  "Bau/Handwerk",
  "KV/Administration",
  "Verkauf",
  "Gastronomie/Hotellerie",
  "Bildung/Soziales",
  "Finanzen/Treuhand/Recht",
  "Logistik/Transport",
  "Engineering/Technik",
  "Marketing/Kommunikation",
  "Reinigung/Facility",
  "Management/Kader",
  "Lehrstellen",
  "Temporärarbeit",
  "Produktion/Industrie",
  "HR/Recruiting",
  "Kundendienst/Callcenter",
];

function expectFrozenRecords(records: readonly object[]) {
  expect(Object.isFrozen(records)).toBe(true);
  for (const record of records) {
    expect(Object.isFrozen(record)).toBe(true);
  }
}

describe("Swiss reference fixtures", () => {
  it("contains exactly all 26 cantons with stable unique natural keys", () => {
    expect(CANTON_FIXTURES.map(({ code }) => code)).toEqual(
      EXPECTED_CANTON_CODES,
    );
    expect(new Set(CANTON_FIXTURES.map(({ code }) => code)).size).toBe(26);
    expect(new Set(CANTON_FIXTURES.map(({ slug }) => slug)).size).toBe(26);
    expect(CANTON_FIXTURES.find(({ code }) => code === "GE")?.slug).toBe(
      "geneve",
    );
    expect(CANTON_FIXTURES.find(({ code }) => code === "ZH")?.slug).toBe(
      "zuerich",
    );
    expectFrozenRecords(CANTON_FIXTURES);
  });

  it("contains the 29 required Swiss cities with plausible coordinates", () => {
    const cantonCodes = new Set(CANTON_FIXTURES.map(({ code }) => code));
    const naturalKeys = CITY_FIXTURES.map(
      ({ cantonCode, slug }) => `${cantonCode}:${slug}`,
    );

    expect(CITY_FIXTURES).toHaveLength(29);
    expect(new Set(naturalKeys).size).toBe(29);
    expect(CITY_FIXTURES.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "Zürich",
        "Winterthur",
        "Basel",
        "Bern",
        "Luzern",
        "St. Gallen",
        "Chur",
        "Aarau",
        "Zug",
        "Schaffhausen",
        "Lausanne",
        "Genève",
        "Fribourg",
        "Neuchâtel",
        "Sion",
        "Lugano",
        "Bellinzona",
        "Biel/Bienne",
        "Thun",
        "Köniz",
        "Rapperswil-Jona",
        "Wil",
        "Frauenfeld",
        "Baden",
        "Olten",
        "Solothurn",
        "Uster",
        "Wetzikon",
        "Dietikon",
      ]),
    );
    for (const city of CITY_FIXTURES) {
      expect(cantonCodes.has(city.cantonCode)).toBe(true);
      expect(city.latitude).toBeGreaterThanOrEqual(45.8);
      expect(city.latitude).toBeLessThanOrEqual(47.9);
      expect(city.longitude).toBeGreaterThanOrEqual(5.9);
      expect(city.longitude).toBeLessThanOrEqual(10.6);
    }
    expectFrozenRecords(CITY_FIXTURES);
  });

  it("contains exactly 18 ordered categories and four unique skills each", () => {
    expect(CATEGORY_FIXTURES.map(({ name }) => name)).toEqual(
      EXPECTED_CATEGORY_NAMES,
    );
    expect(CATEGORY_FIXTURES.map(({ sortOrder }) => sortOrder)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
    expect(new Set(CATEGORY_FIXTURES.map(({ slug }) => slug)).size).toBe(18);

    const categorySlugs = new Set(CATEGORY_FIXTURES.map(({ slug }) => slug));
    expect(SKILL_FIXTURES).toHaveLength(72);
    expect(new Set(SKILL_FIXTURES.map(({ name }) => name)).size).toBe(72);
    expect(new Set(SKILL_FIXTURES.map(({ slug }) => slug)).size).toBe(72);
    for (const categorySlug of categorySlugs) {
      expect(
        SKILL_FIXTURES.filter((skill) => skill.categorySlug === categorySlug),
      ).toHaveLength(4);
    }
    expect(
      SKILL_FIXTURES.every(({ categorySlug }) => categorySlugs.has(categorySlug)),
    ).toBe(true);
    expectFrozenRecords(CATEGORY_FIXTURES);
    expectFrozenRecords(SKILL_FIXTURES);
  });
});
