export interface CityFixture {
  readonly cantonCode: string;
  readonly name: string;
  readonly slug: string;
  readonly latitude: number;
  readonly longitude: number;
}

export const CITY_FIXTURES: readonly Readonly<CityFixture>[] = Object.freeze(
  ([
    { cantonCode: "ZH", name: "Zürich", slug: "zuerich", latitude: 47.376887, longitude: 8.541694 },
    { cantonCode: "ZH", name: "Winterthur", slug: "winterthur", latitude: 47.49882, longitude: 8.723688 },
    { cantonCode: "BS", name: "Basel", slug: "basel", latitude: 47.559599, longitude: 7.588576 },
    { cantonCode: "BE", name: "Bern", slug: "bern", latitude: 46.947974, longitude: 7.447447 },
    { cantonCode: "LU", name: "Luzern", slug: "luzern", latitude: 47.050168, longitude: 8.309307 },
    { cantonCode: "SG", name: "St. Gallen", slug: "st-gallen", latitude: 47.424482, longitude: 9.376717 },
    { cantonCode: "GR", name: "Chur", slug: "chur", latitude: 46.850783, longitude: 9.531985 },
    { cantonCode: "AG", name: "Aarau", slug: "aarau", latitude: 47.390434, longitude: 8.045701 },
    { cantonCode: "ZG", name: "Zug", slug: "zug", latitude: 47.166167, longitude: 8.515495 },
    { cantonCode: "SH", name: "Schaffhausen", slug: "schaffhausen", latitude: 47.69647, longitude: 8.634929 },
    { cantonCode: "VD", name: "Lausanne", slug: "lausanne", latitude: 46.519653, longitude: 6.632273 },
    { cantonCode: "GE", name: "Genève", slug: "geneve", latitude: 46.204391, longitude: 6.143158 },
    { cantonCode: "FR", name: "Fribourg", slug: "fribourg", latitude: 46.806477, longitude: 7.161972 },
    { cantonCode: "NE", name: "Neuchâtel", slug: "neuchatel", latitude: 46.989987, longitude: 6.929273 },
    { cantonCode: "VS", name: "Sion", slug: "sion", latitude: 46.233122, longitude: 7.360626 },
    { cantonCode: "TI", name: "Lugano", slug: "lugano", latitude: 46.003678, longitude: 8.951052 },
    { cantonCode: "TI", name: "Bellinzona", slug: "bellinzona", latitude: 46.195015, longitude: 9.022108 },
    { cantonCode: "BE", name: "Biel/Bienne", slug: "biel-bienne", latitude: 47.136778, longitude: 7.24679 },
    { cantonCode: "BE", name: "Thun", slug: "thun", latitude: 46.757986, longitude: 7.627988 },
    { cantonCode: "BE", name: "Köniz", slug: "koeniz", latitude: 46.92436, longitude: 7.41457 },
    { cantonCode: "SG", name: "Rapperswil-Jona", slug: "rapperswil-jona", latitude: 47.2265, longitude: 8.8186 },
    { cantonCode: "SG", name: "Wil", slug: "wil", latitude: 47.461521, longitude: 9.045524 },
    { cantonCode: "TG", name: "Frauenfeld", slug: "frauenfeld", latitude: 47.5584, longitude: 8.8985 },
    { cantonCode: "AG", name: "Baden", slug: "baden", latitude: 47.47333, longitude: 8.30592 },
    { cantonCode: "SO", name: "Olten", slug: "olten", latitude: 47.34999, longitude: 7.90329 },
    { cantonCode: "SO", name: "Solothurn", slug: "solothurn", latitude: 47.208835, longitude: 7.532291 },
    { cantonCode: "ZH", name: "Uster", slug: "uster", latitude: 47.34713, longitude: 8.72091 },
    { cantonCode: "ZH", name: "Wetzikon", slug: "wetzikon", latitude: 47.3264, longitude: 8.79779 },
    { cantonCode: "ZH", name: "Dietikon", slug: "dietikon", latitude: 47.40556, longitude: 8.40339 },
  ] satisfies CityFixture[]).map((fixture) => Object.freeze(fixture)),
);
