import {
  MATCH_FACTOR_ORDER_V1,
  calculateCandidateMatchV1,
  type MatchInput,
  type RemotePreference,
} from "@/lib/scoring/match-score";
import type { RemoteType } from "@/lib/scoring/fair-job-score";
import { describe, expect, it } from "vitest";

function match(input: MatchInput) {
  return calculateCandidateMatchV1(input);
}

describe("calculateCandidateMatchV1 golden fixtures", () => {
  it("returns the exact all-factor match fixture", () => {
    const result = match({
      candidate: {
        skills: [" React ", "typescript", "react"],
        acceptableCantonIds: [" ZH "],
        workloadMin: 80,
        workloadMax: 100,
        desiredSalaryMin: 90_000,
        desiredSalaryMax: 110_000,
        desiredSalaryPeriod: "YEARLY",
        remotePreference: "HYBRID",
        languages: [{ code: " DE ", level: "B2" }],
        jobTypes: ["PERMANENT"],
        availabilityDate: new Date("2026-08-01T00:00:00.000Z"),
      },
      job: {
        requiredSkills: ["react", "TypeScript"],
        cantonId: "zh",
        workloadMin: 80,
        workloadMax: 100,
        salaryMin: 100_000,
        salaryMax: 120_000,
        salaryPeriod: "YEARLY",
        remoteType: "HYBRID",
        requiredLanguages: [{ code: "de", minLevel: "B2" }],
        jobType: "PERMANENT",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    expect(result).toEqual({
      score: 100,
      confidence: 100,
      version: "v1",
      factorScores: {
        SKILLS: 1,
        LANGUAGES: 1,
        REGION: 1,
        WORKLOAD: 1,
        SALARY: 1,
        JOB_TYPE: 1,
        REMOTE: 1,
        AVAILABILITY: 1,
      },
      matchReasons: [
        "SKILLS_MATCH",
        "LANGUAGES_MATCH",
        "REGION_MATCH",
        "WORKLOAD_MATCH",
        "SALARY_MATCH",
        "JOB_TYPE_MATCH",
        "REMOTE_MATCH",
        "AVAILABILITY_MATCH",
      ],
      missingFitReasons: [],
    });
    expect(Object.keys(result.factorScores)).toEqual(MATCH_FACTOR_ORDER_V1);
  });

  it("returns the exact mixed partial fixture", () => {
    const result = match({
      candidate: {
        skills: ["react"],
        acceptableCantonIds: ["zh"],
        workloadMin: 0,
        workloadMax: 49,
        desiredSalaryMin: 100,
        desiredSalaryMax: 120,
        desiredSalaryPeriod: "HOURLY",
        remotePreference: "HYBRID",
        languages: [{ code: "de", level: "B1" }],
        jobTypes: ["TEMPORARY"],
        availabilityDate: new Date("2026-10-01T00:00:00.000Z"),
      },
      job: {
        requiredSkills: ["react", "typescript"],
        cantonId: "zh",
        workloadMin: 0,
        workloadMax: 99,
        salaryMin: 130,
        salaryMax: 150,
        salaryPeriod: "HOURLY",
        remoteType: "ONSITE",
        requiredLanguages: [{ code: "de", minLevel: "B2" }],
        jobType: "PERMANENT",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    expect(result).toEqual({
      score: 55,
      confidence: 100,
      version: "v1",
      factorScores: {
        SKILLS: 0.5,
        LANGUAGES: 0.5,
        REGION: 1,
        WORKLOAD: 0.5,
        SALARY: 0.5,
        JOB_TYPE: 0,
        REMOTE: 0.5,
        AVAILABILITY: 0.5,
      },
      matchReasons: [
        "SKILLS_PARTIAL",
        "LANGUAGES_PARTIAL",
        "REGION_MATCH",
        "WORKLOAD_PARTIAL",
        "SALARY_PARTIAL",
        "REMOTE_PARTIAL",
        "AVAILABILITY_PARTIAL",
      ],
      missingFitReasons: ["JOB_TYPE_MISMATCH"],
    });
  });

  it("returns null/zero and all ordered MISSING reasons with no known factor", () => {
    const result = match({ candidate: {}, job: {} });

    expect(result.score).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.matchReasons).toEqual([]);
    expect(result.missingFitReasons).toEqual(
      MATCH_FACTOR_ORDER_V1.map((factor) => `${factor}_MISSING`),
    );
  });
});

describe("skills and missing-data denominator", () => {
  it("treats an explicit empty candidate list as known zero", () => {
    const result = match({
      candidate: { skills: [] },
      job: { requiredSkills: ["react"] },
    });

    expect(result).toMatchObject({ score: 0, confidence: 30 });
    expect(result.factorScores.SKILLS).toBe(0);
    expect(result.missingFitReasons[0]).toBe("SKILLS_MISMATCH");
  });

  it("treats an absent candidate list and empty job requirements as unknown", () => {
    expect(
      match({ candidate: {}, job: { requiredSkills: ["react"] } }).factorScores
        .SKILLS,
    ).toBeNull();
    expect(
      match({ candidate: { skills: [] }, job: { requiredSkills: [] } })
        .factorScores.SKILLS,
    ).toBeNull();
  });

  it("normalizes and de-duplicates required skills", () => {
    const result = match({
      candidate: { skills: [" REACT "] },
      job: { requiredSkills: ["react", "REACT", "typescript"] },
    });
    expect(result.factorScores.SKILLS).toBe(0.5);
    expect(result).toMatchObject({ score: 50, confidence: 30 });
  });

  it("uses exact half-up rounding for a 12.5 percent fit", () => {
    const result = match({
      candidate: { skills: ["one"] },
      job: {
        requiredSkills: ["one", "two", "three", "four", "five", "six", "seven", "eight"],
      },
    });
    expect(result.factorScores.SKILLS).toBe(0.125);
    expect(result).toMatchObject({ score: 13, confidence: 30 });
  });
});

describe("language matrix", () => {
  it.each([
    ["B2", "B2", 1],
    ["C1", "B2", 1],
    ["B1", "B2", 0.5],
    ["A2", "B2", 0],
    ["NATIVE", "C2", 1],
  ] as const)("scores candidate %s against required %s", (level, minLevel, expected) => {
    const result = match({
      candidate: { languages: [{ code: "de", level }] },
      job: { requiredLanguages: [{ code: "DE", minLevel }] },
    });
    expect(result.factorScores.LANGUAGES).toBe(expected);
  });

  it("treats a missing required language in an explicit profile as zero", () => {
    const result = match({
      candidate: { languages: [] },
      job: { requiredLanguages: [{ code: "de", minLevel: "B2" }] },
    });
    expect(result).toMatchObject({ score: 0, confidence: 15 });
    expect(result.factorScores.LANGUAGES).toBe(0);
  });

  it("keeps an absent candidate language profile unknown", () => {
    const result = match({
      candidate: {},
      job: { requiredLanguages: [{ code: "de", minLevel: "B2" }] },
    });
    expect(result.factorScores.LANGUAGES).toBeNull();
  });

  it("deduplicates languages and applies the highest repeated requirement", () => {
    const result = match({
      candidate: {
        languages: [
          { code: "DE", level: "B1" },
          { code: "de", level: "B2" },
        ],
      },
      job: {
        requiredLanguages: [
          { code: "de", minLevel: "B1" },
          { code: " DE ", minLevel: "C1" },
        ],
      },
    });
    expect(result.factorScores.LANGUAGES).toBe(0.5);
  });
});

describe("region and workload boundaries", () => {
  it("requires an explicit non-empty acceptable-canton list", () => {
    expect(
      match({ candidate: {}, job: { cantonId: "zh" } }).factorScores.REGION,
    ).toBeNull();
    expect(
      match({ candidate: { acceptableCantonIds: [] }, job: { cantonId: "zh" } })
        .factorScores.REGION,
    ).toBeNull();
    expect(
      match({
        candidate: { acceptableCantonIds: ["BE"] },
        job: { cantonId: "zh" },
      }).factorScores.REGION,
    ).toBe(0);
  });

  it("uses inclusive integer percentage points", () => {
    const result = match({
      candidate: { workloadMin: 100, workloadMax: 100 },
      job: { workloadMin: 0, workloadMax: 100 },
    });
    expect(result.factorScores.WORKLOAD).toBe(1 / 101);
  });

  it.each([
    [{ workloadMin: -1, workloadMax: 50 }, { workloadMin: 0, workloadMax: 50 }],
    [{ workloadMin: 0.5, workloadMax: 50 }, { workloadMin: 0, workloadMax: 50 }],
    [{ workloadMin: 50, workloadMax: 49 }, { workloadMin: 0, workloadMax: 50 }],
    [{ workloadMin: 0, workloadMax: 50 }, { workloadMin: 0, workloadMax: 101 }],
  ] as const)("marks invalid ranges unknown", (candidate, job) => {
    expect(match({ candidate, job }).factorScores.WORKLOAD).toBeNull();
  });
});

describe("salary boundaries", () => {
  it.each([
    [
      { desiredSalaryMin: 100, desiredSalaryMax: 120, desiredSalaryPeriod: "HOURLY" },
      { salaryMin: 120, salaryMax: 130, salaryPeriod: "HOURLY" },
      1,
    ],
    [
      { desiredSalaryMin: 100, desiredSalaryMax: 120, desiredSalaryPeriod: "HOURLY" },
      { salaryMin: 130, salaryMax: 140, salaryPeriod: "HOURLY" },
      0.5,
    ],
    [
      { desiredSalaryMin: 100, desiredSalaryMax: 120, desiredSalaryPeriod: "HOURLY" },
      { salaryMin: 131, salaryMax: 140, salaryPeriod: "HOURLY" },
      0,
    ],
    [
      { desiredSalaryMin: 100, desiredSalaryMax: 120, desiredSalaryPeriod: "YEARLY" },
      { salaryMin: 100, salaryMax: 120, salaryPeriod: "MONTHLY" },
      null,
    ],
    [
      { desiredSalaryMin: 0, desiredSalaryMax: 120, desiredSalaryPeriod: "YEARLY" },
      { salaryMin: 100, salaryMax: 120, salaryPeriod: "YEARLY" },
      null,
    ],
  ] as const)("scores same-period whole-CHF intervals", (candidate, job, expected) => {
    expect(match({ candidate, job }).factorScores.SALARY).toBe(expected);
  });
});

describe("job type, remote, and availability", () => {
  it("keeps an empty job-type preference unknown and mismatches an explicit list", () => {
    expect(
      match({ candidate: { jobTypes: [] }, job: { jobType: "PERMANENT" } })
        .factorScores.JOB_TYPE,
    ).toBeNull();
    expect(
      match({
        candidate: { jobTypes: ["TEMPORARY"] },
        job: { jobType: "PERMANENT" },
      }).factorScores.JOB_TYPE,
    ).toBe(0);
  });

  it.each([
    ["ANY", "ONSITE", 1],
    ["REMOTE", "REMOTE", 1],
    ["HYBRID", "ONSITE", 0.5],
    ["HYBRID", "REMOTE", 0.5],
    ["ONSITE", "HYBRID", 0.5],
    ["REMOTE", "HYBRID", 0.5],
    ["ONSITE", "REMOTE", 0],
    ["REMOTE", "ONSITE", 0],
  ] as const)("scores remote %s against %s", (preference, remoteType, expected) => {
    const result = match({
      candidate: { remotePreference: preference as RemotePreference },
      job: { remoteType: remoteType as RemoteType },
    });
    expect(result.factorScores.REMOTE).toBe(expected);
  });

  it.each([
    ["2026-08-31", 1],
    ["2026-09-01", 1],
    ["2026-09-02", 0.5],
    ["2026-10-01", 0.5],
    ["2026-10-02", 0],
  ] as const)("scores availability on %s", (candidateDate, expected) => {
    const result = match({
      candidate: { availabilityDate: new Date(`${candidateDate}T00:00:00.000Z`) },
      job: { startDate: new Date("2026-09-01T00:00:00.000Z") },
    });
    expect(result.factorScores.AVAILABILITY).toBe(expected);
  });
});

describe("fairness exclusions", () => {
  it("has no protected-field key and ignores untrusted runtime extras", () => {
    type ProtectedKeys = Extract<
      keyof MatchInput["candidate"],
      | "age"
      | "gender"
      | "origin"
      | "health"
      | "family"
      | "photo"
      | "name"
    >;
    const protectedKeysAreAbsent: ProtectedKeys extends never ? true : false = true;
    const baseline: MatchInput = {
      candidate: { skills: ["react"] },
      job: { requiredSkills: ["react"] },
    };
    const withProtectedExtras = {
      candidate: {
        ...baseline.candidate,
        age: 30,
        gender: "x",
        name: "Canary Person",
      },
      job: baseline.job,
    } as MatchInput;

    expect(protectedKeysAreAbsent).toBe(true);
    expect(match(withProtectedExtras)).toEqual(match(baseline));
  });
});
