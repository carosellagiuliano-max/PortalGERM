export type SalarySeniority = "JUNIOR" | "MID" | "SENIOR" | "LEAD";

export interface SalaryDatasetFixture {
  readonly naturalKey: string;
  readonly datasetKey: string;
  readonly version: string;
  readonly source: string;
  readonly referenceUrl: null;
  readonly methodology: string;
  readonly locale: "de-CH";
  readonly dataAsOf: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly publishedAt: string;
  readonly reviewStatus: "APPROVED";
}

export interface SalaryBandFixture {
  readonly naturalKey: string;
  readonly salaryDatasetNaturalKey: string;
  readonly categorySlug: string;
  readonly cantonCode: string | null;
  readonly seniority: SalarySeniority | null;
  readonly workloadMin: 100;
  readonly workloadMax: 100;
  readonly period: "YEARLY";
  readonly p25Chf: number;
  readonly medianChf: number;
  readonly p75Chf: number;
  readonly sampleSize: number;
  readonly notes: string;
}

export const SALARY_DATASET_FIXTURE: Readonly<SalaryDatasetFixture> =
  Object.freeze({
    naturalKey: "SWISSTALENTHUB_SALARY_MOCK:2026-v1",
    datasetKey: "SWISSTALENTHUB_SALARY_MOCK",
    version: "2026-v1",
    source: "SwissTalentHub fiktive Lohnband-Modellierung 2026",
    referenceUrl: null,
    methodology:
      "Originale, deterministische Mock-Lohnbänder für Produkt- und Fallbacktests. Alle Werte sind fiktiv, auf ein Vollzeitäquivalent normiert und keine Marktstatistik oder Lohnempfehlung.",
    locale: "de-CH",
    dataAsOf: "2025-12-31",
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: "2027-01-01T00:00:00.000Z",
    publishedAt: "2026-01-05T09:00:00.000Z",
    reviewStatus: "APPROVED",
  });

const BAND_NOTES =
  "Fiktive FTE-Jahreswerte für deterministische Demo- und Policy-Tests; keine Marktstatistik.";

type SalaryBandDefinition = Omit<
  SalaryBandFixture,
  "naturalKey" | "salaryDatasetNaturalKey" | "workloadMin" | "workloadMax" | "period" | "notes"
>;

const BAND_DEFINITIONS = [
  { categorySlug: "informatik", cantonCode: "ZH", seniority: "SENIOR", p25Chf: 105_000, medianChf: 120_000, p75Chf: 138_000, sampleSize: 29 },
  { categorySlug: "informatik", cantonCode: "ZH", seniority: null, p25Chf: 90_000, medianChf: 108_000, p75Chf: 126_000, sampleSize: 30 },
  { categorySlug: "informatik", cantonCode: null, seniority: "SENIOR", p25Chf: 100_000, medianChf: 116_000, p75Chf: 132_000, sampleSize: 49 },
  { categorySlug: "informatik", cantonCode: null, seniority: null, p25Chf: 84_000, medianChf: 102_000, p75Chf: 120_000, sampleSize: 50 },
  { categorySlug: "gesundheit-pflege", cantonCode: "BE", seniority: "MID", p25Chf: 78_000, medianChf: 86_000, p75Chf: 96_000, sampleSize: 99 },
  { categorySlug: "gesundheit-pflege", cantonCode: "BE", seniority: null, p25Chf: 72_000, medianChf: 82_000, p75Chf: 92_000, sampleSize: 100 },
  { categorySlug: "gesundheit-pflege", cantonCode: null, seniority: "MID", p25Chf: 75_000, medianChf: 84_000, p75Chf: 94_000, sampleSize: 30 },
  { categorySlug: "gesundheit-pflege", cantonCode: null, seniority: null, p25Chf: 69_000, medianChf: 79_000, p75Chf: 89_000, sampleSize: 50 },
  { categorySlug: "engineering-technik", cantonCode: "VD", seniority: "JUNIOR", p25Chf: 73_000, medianChf: 82_000, p75Chf: 91_000, sampleSize: 99 },
  { categorySlug: "engineering-technik", cantonCode: "VD", seniority: null, p25Chf: 82_000, medianChf: 96_000, p75Chf: 112_000, sampleSize: 100 },
  { categorySlug: "engineering-technik", cantonCode: null, seniority: "JUNIOR", p25Chf: 70_000, medianChf: 79_000, p75Chf: 88_000, sampleSize: 29 },
  { categorySlug: "engineering-technik", cantonCode: null, seniority: null, p25Chf: 79_000, medianChf: 93_000, p75Chf: 108_000, sampleSize: 49 },
] satisfies SalaryBandDefinition[];

function salaryBandNaturalKey(definition: SalaryBandDefinition) {
  return [
    SALARY_DATASET_FIXTURE.naturalKey,
    definition.categorySlug,
    definition.cantonCode ?? "CH",
    definition.seniority ?? "ALL",
    "100-100",
    "YEARLY",
  ].join(":");
}

export const SALARY_BAND_FIXTURES: readonly Readonly<SalaryBandFixture>[] =
  Object.freeze(
    BAND_DEFINITIONS.map((definition) =>
      Object.freeze({
        naturalKey: salaryBandNaturalKey(definition),
        salaryDatasetNaturalKey: SALARY_DATASET_FIXTURE.naturalKey,
        ...definition,
        workloadMin: 100 as const,
        workloadMax: 100 as const,
        period: "YEARLY" as const,
        notes: BAND_NOTES,
      }),
    ),
  );
