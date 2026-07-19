import {
  FAIR_JOB_FACTOR_ORDER_V2,
  buildFairJobInputV2,
  calculateFairJobScoreV2,
  type FairJobInput,
  type FairJobRevisionInputV2,
} from "@/lib/scoring/fair-job-score";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1_000;
const JOB = { id: "job-1" } as const;

function structured(label: string) {
  return `${label} contains enough concrete detail.`;
}

function makeRevision(
  overrides: Partial<FairJobRevisionInputV2> = {},
): FairJobRevisionInputV2 {
  return {
    id: "revision-1",
    jobId: JOB.id,
    salaryPeriod: "YEARLY",
    salaryMin: 90_000,
    salaryMax: 110_000,
    tasks: [structured("Task one"), structured("Task two"), structured("Task three")],
    requirements: [
      structured("Requirement one"),
      structured("Requirement two"),
      structured("Requirement three"),
    ],
    workloadMin: 80,
    workloadMax: 100,
    jobType: "PERMANENT",
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    startByArrangement: false,
    remoteType: "HYBRID",
    cantonId: "canton-zh",
    cityId: "city-zurich",
    remoteCountryCode: null,
    applicationEffort: "SIMPLE",
    applicationProcessSteps: [structured("Submit the requested documents")],
    requiredDocumentKinds: ["CV", "COVER_LETTER"],
    responseTargetDays: 7,
    benefits: [
      {
        benefitCode: "HOME_OFFICE",
        description: structured("Two home-office days per week"),
      },
      {
        benefitCode: "PAID_TRAINING",
        description: structured("Annual paid training allowance"),
      },
    ],
    inclusionStatement:
      "We welcome qualified people from every background and provide support.",
    applicationContactKind: "EMAIL",
    applicationContactValue: "jobs@example.ch",
    validThrough: new Date(NOW.getTime() + 30 * DAY),
    ...overrides,
  };
}

function score(overrides: Partial<FairJobInput> = {}) {
  const input: FairJobInput = {
    salaryRange: null,
    tasksAndRequirementsClarity: "MISSING",
    workloadContractAndStartDefined: false,
    locationAndRemoteDefined: false,
    applicationProcessDefined: false,
    responseTargetDays: null,
    concreteBenefitsCount: 0,
    inclusionAndContactDefined: false,
    validThrough: null,
    ...overrides,
  };
  return calculateFairJobScoreV2(input, { now: NOW });
}

describe("buildFairJobInputV2", () => {
  it("builds the frozen all-evidence fixture and reaches exactly 100", () => {
    const input = buildFairJobInputV2({ revision: makeRevision(), job: JOB });
    const result = calculateFairJobScoreV2(input, { now: NOW });

    expect(input).toEqual({
      salaryRange: { minChf: 90_000, maxChf: 110_000, period: "YEARLY" },
      tasksAndRequirementsClarity: "CLEAR",
      workloadContractAndStartDefined: true,
      locationAndRemoteDefined: true,
      applicationProcessDefined: true,
      responseTargetDays: 7,
      concreteBenefitsCount: 2,
      inclusionAndContactDefined: true,
      validThrough: new Date(NOW.getTime() + 30 * DAY),
    });
    expect(result).toEqual({
      score: 100,
      version: "v2",
      evidence: {
        SALARY: "MET",
        TASKS_REQUIREMENTS: "MET",
        WORKLOAD_CONTRACT_START: "MET",
        LOCATION_REMOTE: "MET",
        APPLICATION_PROCESS: "MET",
        RESPONSE_TARGET: "MET",
        BENEFITS: "MET",
        INCLUSION_CONTACT: "MET",
        FRESHNESS: "MET",
      },
      positiveReasons: [
        "SALARY_MET",
        "TASKS_REQUIREMENTS_MET",
        "WORKLOAD_CONTRACT_START_MET",
        "LOCATION_REMOTE_MET",
        "APPLICATION_PROCESS_MET",
        "RESPONSE_TARGET_MET",
        "BENEFITS_MET",
        "INCLUSION_CONTACT_MET",
        "FRESHNESS_MET",
      ],
      missingImprovements: [],
      employerSuggestions: [],
    });
    expect(Object.keys(result.evidence)).toEqual(FAIR_JOB_FACTOR_ORDER_V2);
  });

  it("collapses whitespace and counts Unicode code points at the 20 boundary", () => {
    const twentyEmoji = `  ${"😀".repeat(20)}  `;
    const nineteenEmoji = "😀".repeat(19);
    const revision = makeRevision({
      tasks: [twentyEmoji, twentyEmoji, twentyEmoji],
      requirements: [twentyEmoji, twentyEmoji, nineteenEmoji],
    });

    expect(
      buildFairJobInputV2({ revision, job: JOB }).tasksAndRequirementsClarity,
    ).toBe("PARTIAL");
  });

  it("uses exact 20..500 code-point boundaries for structured items", () => {
    const valid20 = "a".repeat(20);
    const valid500 = "b".repeat(500);
    const invalid19 = "c".repeat(19);
    const invalid501 = "d".repeat(501);

    expect(
      buildFairJobInputV2({
        revision: makeRevision({
          tasks: [valid20, valid500, valid20],
          requirements: [valid500, valid20, valid500],
        }),
        job: JOB,
      }).tasksAndRequirementsClarity,
    ).toBe("CLEAR");
    expect(
      buildFairJobInputV2({
        revision: makeRevision({
          tasks: [invalid19],
          requirements: [invalid501],
        }),
        job: JOB,
      }).tasksAndRequirementsClarity,
    ).toBe("MISSING");
  });

  it.each([
    [{ workloadMin: 0, workloadMax: 100 }, true],
    [{ workloadMin: -1, workloadMax: 100 }, false],
    [{ workloadMin: 0, workloadMax: 101 }, false],
    [{ workloadMin: 80, workloadMax: 79 }, false],
    [{ workloadMin: 80.5, workloadMax: 100 }, false],
    [{ startDate: null, startByArrangement: true }, true],
    [{ startDate: null, startByArrangement: false }, false],
    [{ startDate: new Date("2026-09-01Z"), startByArrangement: true }, false],
  ] as const)(
    "derives workload/contract/start from the exact predicate (%o)",
    (overrides, expected) => {
      const input = buildFairJobInputV2({
        revision: makeRevision(overrides),
        job: JOB,
      });
      expect(input.workloadContractAndStartDefined).toBe(expected);
    },
  );

  it.each([
    [{ remoteType: "ONSITE", cantonId: "zh", cityId: "zurich" }, true],
    [{ remoteType: "HYBRID", cantonId: "zh", cityId: null }, false],
    [
      {
        remoteType: "REMOTE",
        cantonId: null,
        cityId: null,
        remoteCountryCode: "ch",
      },
      true,
    ],
    [
      {
        remoteType: "REMOTE",
        cantonId: "zh",
        cityId: "zurich",
        remoteCountryCode: "DE",
      },
      false,
    ],
  ] as const)(
    "derives location/remote from persisted evidence (%o)",
    (overrides, expected) => {
      const input = buildFairJobInputV2({
        revision: makeRevision(overrides),
        job: JOB,
      });
      expect(input.locationAndRemoteDefined).toBe(expected);
    },
  );

  it.each([
    [{ requiredDocumentKinds: ["NONE"] }, true],
    [{ requiredDocumentKinds: ["CV", "COVER_LETTER"] }, true],
    [{ requiredDocumentKinds: [] }, false],
    [{ requiredDocumentKinds: ["NONE", "CV"] }, false],
    [{ requiredDocumentKinds: ["CERTIFICATES"] }, false],
    [{ applicationProcessSteps: ["too short"] }, false],
  ] as const)(
    "enforces the P0 application-process storage gate (%o)",
    (overrides, expected) => {
      const input = buildFairJobInputV2({
        revision: makeRevision(overrides),
        job: JOB,
      });
      expect(input.applicationProcessDefined).toBe(expected);
    },
  );

  it("counts only unique allowlisted benefits with valid descriptions", () => {
    const input = buildFairJobInputV2({
      revision: makeRevision({
        benefits: [
          { benefitCode: "HOME_OFFICE", description: structured("Valid one") },
          { benefitCode: "HOME_OFFICE", description: structured("Valid duplicate") },
          { benefitCode: "PAID_TRAINING", description: "too short" },
          { benefitCode: "EXTRA_LEAVE", description: structured("Valid second") },
        ],
      }),
      job: JOB,
    });

    expect(input.concreteBenefitsCount).toBe(2);
  });

  it.each([
    ["EMAIL", "jobs@example.ch", true],
    ["EMAIL", "not-an-email", false],
    ["PHONE", "+41441234567", true],
    ["PHONE", "044 123 45 67", false],
    ["APPLY_URL", "https://jobs.example.ch/apply", true],
    ["APPLY_URL", "javascript:alert(1)", false],
    ["APPLY_URL", "https://user:secret@example.ch/apply", false],
  ] as const)("validates declared %s contacts", (kind, value, expected) => {
    const input = buildFairJobInputV2({
      revision: makeRevision({
        applicationContactKind: kind,
        applicationContactValue: value,
      }),
      job: JOB,
    });
    expect(input.inclusionAndContactDefined).toBe(expected);
  });

  it("rejects a revision belonging to another job", () => {
    expect(() =>
      buildFairJobInputV2({
        revision: makeRevision({ jobId: "another-job" }),
        job: JOB,
      }),
    ).toThrow("does not belong");
  });
});

describe("calculateFairJobScoreV2", () => {
  it("returns the fixed zero fixture and ordered missing reasons", () => {
    const result = score();
    const expectedReasons = FAIR_JOB_FACTOR_ORDER_V2.map(
      (factor) => `${factor}_MISSING`,
    );

    expect(result.score).toBe(0);
    expect(result.positiveReasons).toEqual([]);
    expect(result.missingImprovements).toEqual(expectedReasons);
    expect(result.employerSuggestions).toEqual(expectedReasons);
    expect(Object.values(result.evidence)).toEqual(
      Array.from({ length: 9 }, () => "MISSING"),
    );
  });

  it("awards exactly eight points for partial tasks and keeps the improvement", () => {
    const result = score({ tasksAndRequirementsClarity: "PARTIAL" });

    expect(result.score).toBe(8);
    expect(result.positiveReasons).toEqual(["TASKS_REQUIREMENTS_PARTIAL"]);
    expect(result.missingImprovements).toContain("TASKS_REQUIREMENTS_PARTIAL");
    expect(result.employerSuggestions).toContain("TASKS_REQUIREMENTS_PARTIAL");
  });

  it.each([
    [{ minChf: 1, maxChf: 1, period: "HOURLY" }, 25],
    [{ minChf: 0, maxChf: 1, period: "HOURLY" }, 0],
    [{ minChf: 2, maxChf: 1, period: "HOURLY" }, 0],
    [{ minChf: 1.5, maxChf: 2, period: "HOURLY" }, 0],
  ] as const)("scores salary range %o", (salaryRange, expected) => {
    expect(score({ salaryRange }).score).toBe(expected);
  });

  it.each([
    [1, 10],
    [30, 10],
    [0, 0],
    [31, 0],
    [1.5, 0],
    [null, 0],
  ] as const)("scores responseTargetDays=%s", (responseTargetDays, expected) => {
    expect(score({ responseTargetDays }).score).toBe(expected);
  });

  it.each([
    [2, 5],
    [1, 0],
    [2.5, 0],
    [-2, 0],
  ] as const)("scores concreteBenefitsCount=%s", (count, expected) => {
    expect(score({ concreteBenefitsCount: count }).score).toBe(expected);
  });

  it.each([
    [new Date(NOW.getTime()), 0],
    [new Date(NOW.getTime() + 1), 5],
    [new Date(NOW.getTime() + 120 * DAY), 5],
    [new Date(NOW.getTime() + 120 * DAY + 1), 0],
    [new Date("invalid"), 0],
    [null, 0],
  ] as const)("scores the injected freshness boundary %s", (validThrough, expected) => {
    expect(score({ validThrough }).score).toBe(expected);
  });

  it("requires a valid injected clock", () => {
    expect(() =>
      calculateFairJobScoreV2(
        scoreInput(),
        { now: new Date("invalid") },
      ),
    ).toThrow("clock.now");
  });

  it("has no paid or company-verification key and ignores runtime extras", () => {
    type ForbiddenKeys = Extract<
      keyof FairJobInput,
      "plan" | "product" | "boost" | "companyVerified"
    >;
    const forbiddenKeysAreAbsent: ForbiddenKeys extends never ? true : false = true;
    const baseline = score({ salaryRange: { minChf: 1, maxChf: 2, period: "YEARLY" } });
    const withUntrustedExtras = calculateFairJobScoreV2(
      {
        ...scoreInput(),
        salaryRange: { minChf: 1, maxChf: 2, period: "YEARLY" },
        boost: true,
        plan: "enterprise",
        companyVerified: true,
      } as FairJobInput,
      { now: NOW },
    );

    expect(forbiddenKeysAreAbsent).toBe(true);
    expect(withUntrustedExtras).toEqual(baseline);
  });
});

function scoreInput(): FairJobInput {
  return {
    salaryRange: null,
    tasksAndRequirementsClarity: "MISSING",
    workloadContractAndStartDefined: false,
    locationAndRemoteDefined: false,
    applicationProcessDefined: false,
    responseTargetDays: null,
    concreteBenefitsCount: 0,
    inclusionAndContactDefined: false,
    validThrough: null,
  };
}
