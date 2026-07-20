import {
  JOBROOM_LEGAL_DISCLAIMER,
  JOBROOM_MOCK_SOURCE,
  JOBROOM_OFFICIAL_SOURCE_URL,
  OCCUPATION_CODES_2026_FIXTURE as PROVIDER_OCCUPATION_FIXTURE,
} from "@/lib/providers/jobroom/fixtures/occupation-codes-2026";
import { CANTON_FIXTURES } from "@/prisma/seed/fixtures/cantons";
import { CATEGORY_FIXTURES } from "@/prisma/seed/fixtures/categories";
import { OCCUPATION_CODES_2026_FIXTURE } from "@/prisma/seed/fixtures/occupation-codes";
import {
  SALARY_BAND_FIXTURES,
  SALARY_DATASET_FIXTURE,
} from "@/prisma/seed/fixtures/salary";
import { describe, expect, it } from "vitest";

describe("occupation-code seed fixture", () => {
  it("is the identical canonical 40-code source used by the provider", () => {
    expect(PROVIDER_OCCUPATION_FIXTURE).toBe(OCCUPATION_CODES_2026_FIXTURE);
    expect(OCCUPATION_CODES_2026_FIXTURE.occupationCodes).toHaveLength(40);
    expect(
      new Set(OCCUPATION_CODES_2026_FIXTURE.occupationCodes.map(({ id }) => id))
        .size,
    ).toBe(40);
    expect(
      new Set(OCCUPATION_CODES_2026_FIXTURE.occupationCodes.map(({ code }) => code))
        .size,
    ).toBe(40);
    expect(Object.isFrozen(OCCUPATION_CODES_2026_FIXTURE)).toBe(true);
    expect(Object.isFrozen(OCCUPATION_CODES_2026_FIXTURE.occupationCodes)).toBe(
      true,
    );
    expect(
      OCCUPATION_CODES_2026_FIXTURE.occupationCodes.every(Object.isFrozen),
    ).toBe(true);
  });

  it("keeps the reviewed fictional metadata and mixed fail-closed tri-state", () => {
    expect(OCCUPATION_CODES_2026_FIXTURE).toMatchObject({
      datasetKey: "JOBROOM_REPORTING_MOCK",
      datasetVersion: "mock-ch-isco-2026-v1",
      dataYear: 2026,
      source: JOBROOM_MOCK_SOURCE,
      sourceUrl: JOBROOM_OFFICIAL_SOURCE_URL,
      disclaimer: JOBROOM_LEGAL_DISCLAIMER,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2027-01-01T00:00:00.000Z",
    });
    expect(new Set(OCCUPATION_CODES_2026_FIXTURE.occupationCodes.map(({ result }) => result))).toEqual(
      new Set(["REQUIRES_REPORTING", "NOT_REQUIRED", "UNKNOWN"]),
    );
    expect(
      OCCUPATION_CODES_2026_FIXTURE.occupationCodes.filter(
        ({ classificationStatus }) => classificationStatus === "AMBIGUOUS",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      OCCUPATION_CODES_2026_FIXTURE.occupationCodes.every(
        ({ classificationStatus, result }) =>
          classificationStatus !== "AMBIGUOUS" || result === "UNKNOWN",
      ),
    ).toBe(true);
    expect(
      OCCUPATION_CODES_2026_FIXTURE.occupationCodes.some(
        ({ effectiveTo }) => effectiveTo === "2026-01-01T00:00:00.000Z",
      ),
    ).toBe(true);
  });
});

describe("salary seed fixture", () => {
  it("has one immutable approved, half-open fictional dataset version", () => {
    expect(SALARY_DATASET_FIXTURE).toMatchObject({
      reviewStatus: "APPROVED",
      source: "SwissTalentHub fiktive Lohnband-Modellierung 2026",
      referenceUrl: null,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2027-01-01T00:00:00.000Z",
    });
    expect(Date.parse(SALARY_DATASET_FIXTURE.validFrom)).toBeLessThan(
      Date.parse(SALARY_DATASET_FIXTURE.validTo),
    );
    expect(Object.isFrozen(SALARY_DATASET_FIXTURE)).toBe(true);
  });

  it("has exactly 12 valid FTE bands covering every fallback and sample boundary", () => {
    const categorySlugs = new Set(CATEGORY_FIXTURES.map(({ slug }) => slug));
    const cantonCodes = new Set(CANTON_FIXTURES.map(({ code }) => code));
    const scopes = new Set<string>();

    expect(SALARY_BAND_FIXTURES).toHaveLength(12);
    expect(
      new Set(SALARY_BAND_FIXTURES.map(({ naturalKey }) => naturalKey)).size,
    ).toBe(12);
    expect(
      new Set(SALARY_BAND_FIXTURES.map(({ sampleSize }) => sampleSize)),
    ).toEqual(new Set([29, 30, 49, 50, 99, 100]));

    for (const band of SALARY_BAND_FIXTURES) {
      expect(band.salaryDatasetNaturalKey).toBe(
        SALARY_DATASET_FIXTURE.naturalKey,
      );
      expect(categorySlugs.has(band.categorySlug)).toBe(true);
      expect(band.cantonCode === null || cantonCodes.has(band.cantonCode)).toBe(
        true,
      );
      expect(band.period).toBe("YEARLY");
      expect([band.workloadMin, band.workloadMax]).toEqual([100, 100]);
      expect(band.p25Chf).toBeLessThanOrEqual(band.medianChf);
      expect(band.medianChf).toBeLessThanOrEqual(band.p75Chf);
      expect(band.sampleSize).toBeGreaterThanOrEqual(0);
      expect(Object.isFrozen(band)).toBe(true);

      scopes.add(
        band.cantonCode !== null && band.seniority !== null
          ? "EXACT"
          : band.cantonCode !== null
            ? "CANTON_ALL_SENIORITIES"
            : band.seniority !== null
              ? "NATIONAL_SENIORITY"
              : "NATIONAL_ALL",
      );
    }
    expect(scopes).toEqual(
      new Set([
        "EXACT",
        "CANTON_ALL_SENIORITIES",
        "NATIONAL_SENIORITY",
        "NATIONAL_ALL",
      ]),
    );
    expect(Object.isFrozen(SALARY_BAND_FIXTURES)).toBe(true);
  });
});
