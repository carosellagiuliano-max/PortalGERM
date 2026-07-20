export type CantonLanguage = "DE" | "FR" | "IT" | "EN";

export interface CantonFixture {
  readonly code: string;
  readonly name: string;
  readonly slug: string;
  readonly language: CantonLanguage;
}

export const CANTON_FIXTURES: readonly Readonly<CantonFixture>[] = Object.freeze(
  ([
    { code: "AG", name: "Aargau", slug: "aargau", language: "DE" },
    {
      code: "AR",
      name: "Appenzell Ausserrhoden",
      slug: "appenzell-ausserrhoden",
      language: "DE",
    },
    {
      code: "AI",
      name: "Appenzell Innerrhoden",
      slug: "appenzell-innerrhoden",
      language: "DE",
    },
    {
      code: "BL",
      name: "Basel-Landschaft",
      slug: "basel-landschaft",
      language: "DE",
    },
    {
      code: "BS",
      name: "Basel-Stadt",
      slug: "basel-stadt",
      language: "DE",
    },
    { code: "BE", name: "Bern", slug: "bern", language: "DE" },
    { code: "FR", name: "Fribourg", slug: "fribourg", language: "FR" },
    { code: "GE", name: "Genève", slug: "geneve", language: "FR" },
    { code: "GL", name: "Glarus", slug: "glarus", language: "DE" },
    {
      code: "GR",
      name: "Graubünden",
      slug: "graubuenden",
      language: "DE",
    },
    { code: "JU", name: "Jura", slug: "jura", language: "FR" },
    { code: "LU", name: "Luzern", slug: "luzern", language: "DE" },
    {
      code: "NE",
      name: "Neuchâtel",
      slug: "neuchatel",
      language: "FR",
    },
    { code: "NW", name: "Nidwalden", slug: "nidwalden", language: "DE" },
    { code: "OW", name: "Obwalden", slug: "obwalden", language: "DE" },
    {
      code: "SH",
      name: "Schaffhausen",
      slug: "schaffhausen",
      language: "DE",
    },
    { code: "SZ", name: "Schwyz", slug: "schwyz", language: "DE" },
    {
      code: "SO",
      name: "Solothurn",
      slug: "solothurn",
      language: "DE",
    },
    {
      code: "SG",
      name: "St. Gallen",
      slug: "st-gallen",
      language: "DE",
    },
    { code: "TG", name: "Thurgau", slug: "thurgau", language: "DE" },
    { code: "TI", name: "Ticino", slug: "ticino", language: "IT" },
    { code: "UR", name: "Uri", slug: "uri", language: "DE" },
    { code: "VS", name: "Valais", slug: "valais", language: "FR" },
    { code: "VD", name: "Vaud", slug: "vaud", language: "FR" },
    { code: "ZG", name: "Zug", slug: "zug", language: "DE" },
    { code: "ZH", name: "Zürich", slug: "zuerich", language: "DE" },
  ] satisfies CantonFixture[]).map((fixture) => Object.freeze(fixture)),
);
