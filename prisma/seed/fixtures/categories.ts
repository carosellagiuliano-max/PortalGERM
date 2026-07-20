export interface CategoryFixture {
  readonly name: string;
  readonly slug: string;
  readonly sortOrder: number;
  readonly isActive: true;
}

const CATEGORY_NAMES = [
  ["Informatik", "informatik"],
  ["Gesundheit/Pflege", "gesundheit-pflege"],
  ["Bau/Handwerk", "bau-handwerk"],
  ["KV/Administration", "kv-administration"],
  ["Verkauf", "verkauf"],
  ["Gastronomie/Hotellerie", "gastronomie-hotellerie"],
  ["Bildung/Soziales", "bildung-soziales"],
  ["Finanzen/Treuhand/Recht", "finanzen-treuhand-recht"],
  ["Logistik/Transport", "logistik-transport"],
  ["Engineering/Technik", "engineering-technik"],
  ["Marketing/Kommunikation", "marketing-kommunikation"],
  ["Reinigung/Facility", "reinigung-facility"],
  ["Management/Kader", "management-kader"],
  ["Lehrstellen", "lehrstellen"],
  ["Temporärarbeit", "temporaerarbeit"],
  ["Produktion/Industrie", "produktion-industrie"],
  ["HR/Recruiting", "hr-recruiting"],
  ["Kundendienst/Callcenter", "kundendienst-callcenter"],
] as const;

export const CATEGORY_FIXTURES: readonly Readonly<CategoryFixture>[] =
  Object.freeze(
    CATEGORY_NAMES.map(([name, slug], index) =>
      Object.freeze({ name, slug, sortOrder: index + 1, isActive: true as const }),
    ),
  );
