export const SALARY_RADAR_POLICY_V1 = Object.freeze({
  version: "v1",
  minimumSampleSize: 30,
  period: "YEARLY",
  workloadBasis: 100,
  fallbackOrder: Object.freeze([
    "CATEGORY_CANTON_SENIORITY",
    "CATEGORY_CANTON_ALL_SENIORITIES",
    "CATEGORY_SWITZERLAND_SENIORITY",
    "CATEGORY_SWITZERLAND_ALL",
  ] as const),
});

export type SalaryDatasetVersionV1 = Readonly<{
  id: string;
  datasetKey: string;
  version: string;
  source: string;
  methodology: string;
  dataAsOf: Date;
  validFrom: Date;
  validTo: Date | null;
  reviewStatus: "DRAFT" | "APPROVED" | "RETIRED";
  bands: readonly SalaryBandV1[];
}>;

export type SalaryBandV1 = Readonly<{
  id: string;
  categoryId: string;
  cantonId: string | null;
  seniority: "JUNIOR" | "MID" | "SENIOR" | "LEAD" | null;
  workloadMin: number;
  workloadMax: number;
  period: "YEARLY" | "MONTHLY" | "HOURLY";
  p25Chf: number;
  medianChf: number;
  p75Chf: number;
  sampleSize: number;
}>;

export type SalaryRadarResultV1 =
  | Readonly<{
      status: "FOUND";
      policyVersion: "v1";
      datasetId: string;
      datasetKey: string;
      datasetVersion: string;
      source: string;
      methodology: string;
      dataAsOf: Date;
      scope: (typeof SALARY_RADAR_POLICY_V1.fallbackOrder)[number];
      sampleSizeBucket: "30–49" | "50–99" | "100+";
      fteBand: Readonly<{ p25Chf: number; medianChf: number; p75Chf: number }>;
      workloadAdjustedBand: Readonly<{
        workloadMin: number;
        workloadMax: number;
        atMinimum: Readonly<{ p25Chf: number; medianChf: number; p75Chf: number }>;
        atMaximum: Readonly<{ p25Chf: number; medianChf: number; p75Chf: number }>;
      }>;
    }>
  | Readonly<{
      status: "NO_RESULT";
      reason:
        | "NO_EFFECTIVE_DATASET"
        | "AMBIGUOUS_DATASET"
        | "NO_QUALIFYING_BAND"
        | "AMBIGUOUS_BAND"
        | "INVALID_QUERY";
      adjacentCategoryGuidance: boolean;
    }>;

export function selectSalaryRadarBandV1(
  datasets: readonly SalaryDatasetVersionV1[],
  query: Readonly<{
    datasetKey: string;
    categoryId: string;
    cantonId: string;
    seniority: "JUNIOR" | "MID" | "SENIOR" | "LEAD";
    workloadMin: number;
    workloadMax: number;
    at: Date;
  }>,
): SalaryRadarResultV1 {
  if (!isValidWorkload(query.workloadMin, query.workloadMax)) {
    return noResult("INVALID_QUERY", false);
  }

  const effective = datasets.filter(
    (dataset) =>
      dataset.datasetKey === query.datasetKey &&
      dataset.reviewStatus === "APPROVED" &&
      dataset.validFrom.getTime() <= query.at.getTime() &&
      (dataset.validTo === null || query.at.getTime() < dataset.validTo.getTime()),
  );
  if (effective.length === 0) {
    return noResult("NO_EFFECTIVE_DATASET", true);
  }
  if (effective.length !== 1) {
    return noResult("AMBIGUOUS_DATASET", false);
  }
  const dataset = effective[0];
  if (!dataset) {
    throw new Error("An effective salary dataset unexpectedly disappeared.");
  }

  for (const scope of SALARY_RADAR_POLICY_V1.fallbackOrder) {
    const candidates = dataset.bands.filter(
      (band) =>
        band.categoryId === query.categoryId &&
        band.period === SALARY_RADAR_POLICY_V1.period &&
        band.workloadMin === SALARY_RADAR_POLICY_V1.workloadBasis &&
        band.workloadMax === SALARY_RADAR_POLICY_V1.workloadBasis &&
        band.sampleSize >= SALARY_RADAR_POLICY_V1.minimumSampleSize &&
        isValidBand(band) &&
        matchesScope(band, query, scope),
    );
    if (candidates.length > 1) {
      return noResult("AMBIGUOUS_BAND", false);
    }
    const band = candidates[0];
    if (band) {
      return Object.freeze({
        status: "FOUND",
        policyVersion: "v1",
        datasetId: dataset.id,
        datasetKey: dataset.datasetKey,
        datasetVersion: dataset.version,
        source: dataset.source,
        methodology: dataset.methodology,
        dataAsOf: dataset.dataAsOf,
        scope,
        sampleSizeBucket: sampleSizeBucket(band.sampleSize),
        fteBand: Object.freeze({
          p25Chf: band.p25Chf,
          medianChf: band.medianChf,
          p75Chf: band.p75Chf,
        }),
        workloadAdjustedBand: Object.freeze({
          workloadMin: query.workloadMin,
          workloadMax: query.workloadMax,
          atMinimum: adjustBand(band, query.workloadMin),
          atMaximum: adjustBand(band, query.workloadMax),
        }),
      });
    }
  }

  return noResult("NO_QUALIFYING_BAND", true);
}

function matchesScope(
  band: SalaryBandV1,
  query: Readonly<{
    cantonId: string;
    seniority: "JUNIOR" | "MID" | "SENIOR" | "LEAD";
  }>,
  scope: (typeof SALARY_RADAR_POLICY_V1.fallbackOrder)[number],
) {
  switch (scope) {
    case "CATEGORY_CANTON_SENIORITY":
      return band.cantonId === query.cantonId && band.seniority === query.seniority;
    case "CATEGORY_CANTON_ALL_SENIORITIES":
      return band.cantonId === query.cantonId && band.seniority === null;
    case "CATEGORY_SWITZERLAND_SENIORITY":
      return band.cantonId === null && band.seniority === query.seniority;
    case "CATEGORY_SWITZERLAND_ALL":
      return band.cantonId === null && band.seniority === null;
  }
}

function adjustBand(band: SalaryBandV1, workload: number) {
  return Object.freeze({
    p25Chf: multiplyAndRoundHalfUp(band.p25Chf, workload, 100),
    medianChf: multiplyAndRoundHalfUp(band.medianChf, workload, 100),
    p75Chf: multiplyAndRoundHalfUp(band.p75Chf, workload, 100),
  });
}

function multiplyAndRoundHalfUp(value: number, multiplier: number, divisor: number) {
  const numerator = BigInt(value) * BigInt(multiplier);
  const denominator = BigInt(divisor);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("The workload-adjusted salary exceeds safe integer precision.");
  }
  return result;
}

function isValidWorkload(minimum: number, maximum: number) {
  return Number.isSafeInteger(minimum) &&
    Number.isSafeInteger(maximum) &&
    minimum >= 0 &&
    minimum <= maximum &&
    maximum <= 100;
}

function isValidBand(band: SalaryBandV1) {
  return [band.p25Chf, band.medianChf, band.p75Chf, band.sampleSize].every(
    (value) => Number.isSafeInteger(value) && value > 0,
  ) && band.p25Chf <= band.medianChf && band.medianChf <= band.p75Chf;
}

function sampleSizeBucket(sampleSize: number) {
  if (sampleSize >= 100) {
    return "100+" as const;
  }
  if (sampleSize >= 50) {
    return "50–99" as const;
  }
  return "30–49" as const;
}

function noResult(
  reason: Extract<SalaryRadarResultV1, { status: "NO_RESULT" }>["reason"],
  adjacentCategoryGuidance: boolean,
): SalaryRadarResultV1 {
  return Object.freeze({ status: "NO_RESULT", reason, adjacentCategoryGuidance });
}
