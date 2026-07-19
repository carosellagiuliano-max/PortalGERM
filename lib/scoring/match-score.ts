import type {
  JobType,
  RemoteType,
  SalaryPeriod,
} from "@/lib/scoring/fair-job-score";

export const MATCH_SCORE_VERSION = "v1" as const;

export const MATCH_FACTOR_ORDER_V1 = [
  "SKILLS",
  "LANGUAGES",
  "REGION",
  "WORKLOAD",
  "SALARY",
  "JOB_TYPE",
  "REMOTE",
  "AVAILABILITY",
] as const;

export type LanguageLevel =
  | "A1"
  | "A2"
  | "B1"
  | "B2"
  | "C1"
  | "C2"
  | "NATIVE";
export type RemotePreference = RemoteType | "ANY";
export type MatchFactorV1 = (typeof MATCH_FACTOR_ORDER_V1)[number];
export type MatchReasonState = "MATCH" | "PARTIAL" | "MISMATCH" | "MISSING";
export type MatchReasonCodeV1 = `${MatchFactorV1}_${MatchReasonState}`;

export type MatchInput = Readonly<{
  candidate: Readonly<{
    skills?: readonly string[];
    acceptableCantonIds?: readonly string[];
    workloadMin?: number;
    workloadMax?: number;
    desiredSalaryMin?: number;
    desiredSalaryMax?: number;
    desiredSalaryPeriod?: SalaryPeriod;
    remotePreference?: RemotePreference;
    languages?: readonly Readonly<{
      code: string;
      level: LanguageLevel;
    }>[];
    jobTypes?: readonly JobType[];
    availabilityDate?: Date;
  }>;
  job: Readonly<{
    requiredSkills?: readonly string[];
    cantonId?: string;
    workloadMin?: number;
    workloadMax?: number;
    salaryMin?: number;
    salaryMax?: number;
    salaryPeriod?: SalaryPeriod;
    remoteType?: RemoteType;
    requiredLanguages?: readonly Readonly<{
      code: string;
      minLevel: LanguageLevel;
    }>[];
    jobType?: JobType;
    startDate?: Date;
  }>;
}>;

export type MatchResult = Readonly<{
  score: number | null;
  confidence: number;
  version: typeof MATCH_SCORE_VERSION;
  factorScores: Readonly<Record<MatchFactorV1, number | null>>;
  matchReasons: readonly MatchReasonCodeV1[];
  missingFitReasons: readonly MatchReasonCodeV1[];
}>;

const MATCH_WEIGHTS_V1: Readonly<Record<MatchFactorV1, number>> = {
  SKILLS: 30,
  LANGUAGES: 15,
  REGION: 15,
  WORKLOAD: 15,
  SALARY: 10,
  JOB_TYPE: 5,
  REMOTE: 5,
  AVAILABILITY: 5,
};

const LANGUAGE_LEVEL_ORDER: Readonly<Record<LanguageLevel, number>> = {
  A1: 0,
  A2: 1,
  B1: 2,
  B2: 3,
  C1: 4,
  C2: 5,
  NATIVE: 6,
};

const LANGUAGE_LEVELS = new Set<LanguageLevel>([
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
  "NATIVE",
]);
const JOB_TYPES = new Set<JobType>([
  "PERMANENT",
  "TEMPORARY",
  "FREELANCE",
  "INTERNSHIP",
  "APPRENTICESHIP",
  "HOLIDAY_JOB",
]);
const SALARY_PERIODS = new Set<SalaryPeriod>([
  "YEARLY",
  "MONTHLY",
  "HOURLY",
]);
const REMOTE_TYPES = new Set<RemoteType>(["ONSITE", "HYBRID", "REMOTE"]);
const REMOTE_PREFERENCES = new Set<RemotePreference>([
  "ONSITE",
  "HYBRID",
  "REMOTE",
  "ANY",
]);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export function calculateCandidateMatchV1(input: MatchInput): MatchResult {
  const factorScores: Record<MatchFactorV1, number | null> = {
    SKILLS: calculateSkillsFactor(input),
    LANGUAGES: calculateLanguagesFactor(input),
    REGION: calculateRegionFactor(input),
    WORKLOAD: calculateWorkloadFactor(input),
    SALARY: calculateSalaryFactor(input),
    JOB_TYPE: calculateJobTypeFactor(input),
    REMOTE: calculateRemoteFactor(input),
    AVAILABILITY: calculateAvailabilityFactor(input),
  };

  let knownWeight = 0;
  let weightedScore = 0;
  const matchReasons: MatchReasonCodeV1[] = [];
  const missingFitReasons: MatchReasonCodeV1[] = [];

  for (const factor of MATCH_FACTOR_ORDER_V1) {
    const factorScore = factorScores[factor];
    if (factorScore === null) {
      missingFitReasons.push(`${factor}_MISSING`);
      continue;
    }

    const weight = MATCH_WEIGHTS_V1[factor];
    knownWeight += weight;
    weightedScore += weight * factorScore;

    if (factorScore === 1) {
      matchReasons.push(`${factor}_MATCH`);
    } else if (factorScore > 0) {
      matchReasons.push(`${factor}_PARTIAL`);
    } else {
      missingFitReasons.push(`${factor}_MISMATCH`);
    }
  }

  return {
    score:
      knownWeight === 0
        ? null
        : roundHalfUp((weightedScore / knownWeight) * 100),
    confidence: roundHalfUp(knownWeight),
    version: MATCH_SCORE_VERSION,
    factorScores,
    matchReasons,
    missingFitReasons,
  };
}

function calculateSkillsFactor(input: MatchInput): number | null {
  const requiredSkills = normalizeCodes(input.job.requiredSkills);
  if (requiredSkills.length === 0 || input.candidate.skills === undefined) {
    return null;
  }

  const candidateSkills = new Set(normalizeCodes(input.candidate.skills));
  const matches = requiredSkills.reduce(
    (count, skill) => count + Number(candidateSkills.has(skill)),
    0,
  );
  return matches / requiredSkills.length;
}

function calculateLanguagesFactor(input: MatchInput): number | null {
  const requiredLanguages = normalizeRequiredLanguages(
    input.job.requiredLanguages,
  );
  if (
    requiredLanguages === null ||
    requiredLanguages.size === 0 ||
    input.candidate.languages === undefined
  ) {
    return null;
  }

  const candidateLanguages = normalizeCandidateLanguages(
    input.candidate.languages,
  );
  if (candidateLanguages === null) {
    return null;
  }

  let total = 0;
  for (const [code, requiredLevel] of requiredLanguages) {
    const candidateLevel = candidateLanguages.get(code);
    if (candidateLevel === undefined) {
      continue;
    }

    const difference =
      LANGUAGE_LEVEL_ORDER[candidateLevel] -
      LANGUAGE_LEVEL_ORDER[requiredLevel];
    total += difference >= 0 ? 1 : difference === -1 ? 0.5 : 0;
  }

  return total / requiredLanguages.size;
}

function calculateRegionFactor(input: MatchInput): number | null {
  const jobCantonId = normalizeCode(input.job.cantonId);
  const acceptableCantonIds = normalizeCodes(
    input.candidate.acceptableCantonIds,
  );
  if (jobCantonId === null || acceptableCantonIds.length === 0) {
    return null;
  }

  return Number(acceptableCantonIds.includes(jobCantonId));
}

function calculateWorkloadFactor(input: MatchInput): number | null {
  const candidateRange = [
    input.candidate.workloadMin,
    input.candidate.workloadMax,
  ] as const;
  const jobRange = [input.job.workloadMin, input.job.workloadMax] as const;

  if (
    !isValidPercentageRange(candidateRange) ||
    !isValidPercentageRange(jobRange)
  ) {
    return null;
  }

  const [candidateMinimum, candidateMaximum] = candidateRange;
  const [jobMinimum, jobMaximum] = jobRange;

  const overlapLength = Math.max(
    0,
    Math.min(candidateMaximum, jobMaximum) -
      Math.max(candidateMinimum, jobMinimum) +
      1,
  );
  return overlapLength / (jobMaximum - jobMinimum + 1);
}

function calculateSalaryFactor(input: MatchInput): number | null {
  const desiredRange = [
    input.candidate.desiredSalaryMin,
    input.candidate.desiredSalaryMax,
  ] as const;
  const desiredPeriod = input.candidate.desiredSalaryPeriod;
  const jobRange = [input.job.salaryMin, input.job.salaryMax] as const;
  const jobPeriod = input.job.salaryPeriod;

  if (
    !isValidWholeChfRange(desiredRange) ||
    !isValidWholeChfRange(jobRange) ||
    desiredPeriod === undefined ||
    jobPeriod === undefined ||
    !SALARY_PERIODS.has(desiredPeriod) ||
    !SALARY_PERIODS.has(jobPeriod) ||
    desiredPeriod !== jobPeriod
  ) {
    return null;
  }

  const [desiredMinimum, desiredMaximum] = desiredRange;
  const [jobMinimum, jobMaximum] = jobRange;

  if (desiredMinimum <= jobMaximum && jobMinimum <= desiredMaximum) {
    return 1;
  }

  const nearestGap =
    desiredMaximum < jobMinimum
      ? jobMinimum - desiredMaximum
      : desiredMinimum - jobMaximum;
  return nearestGap <= 0.1 * Math.max(1, desiredMinimum) ? 0.5 : 0;
}

function calculateJobTypeFactor(input: MatchInput): number | null {
  const candidateJobTypes = input.candidate.jobTypes;
  const jobType = input.job.jobType;
  if (
    candidateJobTypes === undefined ||
    candidateJobTypes.length === 0 ||
    jobType === undefined ||
    !JOB_TYPES.has(jobType) ||
    candidateJobTypes.some((value) => !JOB_TYPES.has(value))
  ) {
    return null;
  }

  return Number(new Set(candidateJobTypes).has(jobType));
}

function calculateRemoteFactor(input: MatchInput): number | null {
  const preference = input.candidate.remotePreference;
  const remoteType = input.job.remoteType;
  if (
    preference === undefined ||
    remoteType === undefined ||
    !REMOTE_PREFERENCES.has(preference) ||
    !REMOTE_TYPES.has(remoteType)
  ) {
    return null;
  }

  if (preference === "ANY" || preference === remoteType) {
    return 1;
  }

  if (
    (preference === "HYBRID" &&
      (remoteType === "ONSITE" || remoteType === "REMOTE")) ||
    (remoteType === "HYBRID" &&
      (preference === "ONSITE" || preference === "REMOTE"))
  ) {
    return 0.5;
  }

  return 0;
}

function calculateAvailabilityFactor(input: MatchInput): number | null {
  const availabilityDate = input.candidate.availabilityDate;
  const startDate = input.job.startDate;
  if (!isValidDate(availabilityDate) || !isValidDate(startDate)) {
    return null;
  }

  const availabilityDay = toUtcCalendarDay(availabilityDate);
  const startDay = toUtcCalendarDay(startDate);
  if (availabilityDay <= startDay) {
    return 1;
  }

  const daysAfterStart =
    (availabilityDay - startDay) / MILLISECONDS_PER_DAY;
  return daysAfterStart <= 30 ? 0.5 : 0;
}

function normalizeRequiredLanguages(
  languages: MatchInput["job"]["requiredLanguages"],
): Map<string, LanguageLevel> | null {
  if (languages === undefined || languages.length === 0) {
    return new Map();
  }

  const normalized = new Map<string, LanguageLevel>();
  for (const language of languages) {
    const code = normalizeCode(language.code);
    if (code === null || !LANGUAGE_LEVELS.has(language.minLevel)) {
      return null;
    }

    const current = normalized.get(code);
    if (
      current === undefined ||
      LANGUAGE_LEVEL_ORDER[language.minLevel] > LANGUAGE_LEVEL_ORDER[current]
    ) {
      normalized.set(code, language.minLevel);
    }
  }
  return normalized;
}

function normalizeCandidateLanguages(
  languages: NonNullable<MatchInput["candidate"]["languages"]>,
): Map<string, LanguageLevel> | null {
  const normalized = new Map<string, LanguageLevel>();
  for (const language of languages) {
    const code = normalizeCode(language.code);
    if (code === null || !LANGUAGE_LEVELS.has(language.level)) {
      return null;
    }

    const current = normalized.get(code);
    if (
      current === undefined ||
      LANGUAGE_LEVEL_ORDER[language.level] > LANGUAGE_LEVEL_ORDER[current]
    ) {
      normalized.set(code, language.level);
    }
  }
  return normalized;
}

function normalizeCodes(values: readonly string[] | undefined): string[] {
  if (values === undefined) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => normalizeCode(value))
        .filter((value): value is string => value !== null),
    ),
  );
}

function normalizeCode(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isValidPercentageRange(
  range: readonly [number | undefined, number | undefined],
): range is readonly [number, number] {
  const [minimum, maximum] = range;
  return (
    Number.isInteger(minimum) &&
    Number.isInteger(maximum) &&
    minimum !== undefined &&
    maximum !== undefined &&
    minimum >= 0 &&
    maximum <= 100 &&
    minimum <= maximum
  );
}

function isValidWholeChfRange(
  range: readonly [number | undefined, number | undefined],
): range is readonly [number, number] {
  const [minimum, maximum] = range;
  return (
    Number.isInteger(minimum) &&
    Number.isInteger(maximum) &&
    minimum !== undefined &&
    maximum !== undefined &&
    minimum > 0 &&
    maximum > 0 &&
    minimum <= maximum
  );
}

function isValidDate(value: Date | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function toUtcCalendarDay(value: Date): number {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}
