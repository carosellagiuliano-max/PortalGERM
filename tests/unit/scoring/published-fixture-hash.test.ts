import { createHash } from "node:crypto";

import {
  FAIR_JOB_FACTOR_ORDER_V2,
  calculateFairJobScoreV2,
  type FairJobInput,
} from "@/lib/scoring/fair-job-score";
import {
  MATCH_FACTOR_ORDER_V1,
  calculateCandidateMatchV1,
  type MatchInput,
} from "@/lib/scoring/match-score";
import { expect, it } from "vitest";

const FAIR_ZERO: FairJobInput = {
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

const FAIR_FULL: FairJobInput = {
  salaryRange: { minChf: 90_000, maxChf: 110_000, period: "YEARLY" },
  tasksAndRequirementsClarity: "CLEAR",
  workloadContractAndStartDefined: true,
  locationAndRemoteDefined: true,
  applicationProcessDefined: true,
  responseTargetDays: 30,
  concreteBenefitsCount: 2,
  inclusionAndContactDefined: true,
  validThrough: new Date("2026-11-16T12:00:00.000Z"),
};

const MATCH_NONE: MatchInput = { candidate: {}, job: {} };
const MATCH_HALF_UP: MatchInput = {
  candidate: { skills: ["one"] },
  job: {
    requiredSkills: [
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ],
  },
};

it("keeps the published scoring fixture hash stable", () => {
  const clock = { now: new Date("2026-07-19T12:00:00.000Z") };
  const fixture = {
    schema: "swisstalenthub-scoring-golden-v1",
    fairV2: {
      factorOrder: FAIR_JOB_FACTOR_ORDER_V2,
      zero: {
        input: FAIR_ZERO,
        output: calculateFairJobScoreV2(FAIR_ZERO, clock),
      },
      full: {
        input: FAIR_FULL,
        output: calculateFairJobScoreV2(FAIR_FULL, clock),
      },
    },
    matchV1: {
      factorOrder: MATCH_FACTOR_ORDER_V1,
      none: {
        input: MATCH_NONE,
        output: calculateCandidateMatchV1(MATCH_NONE),
      },
      halfUp: {
        input: MATCH_HALF_UP,
        output: calculateCandidateMatchV1(MATCH_HALF_UP),
      },
    },
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(fixture), "utf8")
    .digest("hex");

  expect(hash).toBe(
    "979ca264a9c5e124ae0a8ad650c0de84dccde674846fc295f66d8b4a0abb6d39",
  );
});
