import { isSafeAbsoluteHttpUrl } from "@/lib/validation/common";

export const FAIR_JOB_SCORE_VERSION = "v2" as const;

export const FAIR_JOB_FACTOR_ORDER_V2 = [
  "SALARY",
  "TASKS_REQUIREMENTS",
  "WORKLOAD_CONTRACT_START",
  "LOCATION_REMOTE",
  "APPLICATION_PROCESS",
  "RESPONSE_TARGET",
  "BENEFITS",
  "INCLUSION_CONTACT",
  "FRESHNESS",
] as const;

export type SalaryPeriod = "YEARLY" | "MONTHLY" | "HOURLY";
export type JobType =
  | "PERMANENT"
  | "TEMPORARY"
  | "FREELANCE"
  | "INTERNSHIP"
  | "APPRENTICESHIP"
  | "HOLIDAY_JOB";
export type RemoteType = "ONSITE" | "HYBRID" | "REMOTE";
export type ApplicationEffort = "SIMPLE" | "MEDIUM" | "LONG";
export type RequiredDocumentKind =
  | "NONE"
  | "CV"
  | "COVER_LETTER"
  | "CERTIFICATES"
  | "REFERENCES"
  | "PORTFOLIO"
  | "OTHER";
export type ApplicationContactKind = "EMAIL" | "PHONE" | "APPLY_URL";
export type JobBenefitCode =
  | "FLEXIBLE_WORK"
  | "HOME_OFFICE"
  | "PAID_TRAINING"
  | "PENSION_TOP_UP"
  | "PARENTAL_LEAVE"
  | "CHILDCARE_SUPPORT"
  | "PUBLIC_TRANSPORT_SUPPORT"
  | "MEAL_SUPPORT"
  | "HEALTH_WELLBEING"
  | "EXTRA_LEAVE"
  | "PERFORMANCE_BONUS";

export type FairJobClarity = "MISSING" | "PARTIAL" | "CLEAR";
export type FairJobEvidenceState = "MISSING" | "PARTIAL" | "MET";
export type FairJobFactorV2 = (typeof FAIR_JOB_FACTOR_ORDER_V2)[number];
export type FairJobReasonCodeV2 = `${FairJobFactorV2}_${FairJobEvidenceState}`;

export type FairJobInput = Readonly<{
  salaryRange: Readonly<{
    minChf: number;
    maxChf: number;
    period: SalaryPeriod;
  }> | null;
  tasksAndRequirementsClarity: FairJobClarity;
  workloadContractAndStartDefined: boolean;
  locationAndRemoteDefined: boolean;
  applicationProcessDefined: boolean;
  responseTargetDays: number | null;
  concreteBenefitsCount: number;
  inclusionAndContactDefined: boolean;
  validThrough: Date | null;
}>;

export type FairJobResult = Readonly<{
  score: number;
  version: typeof FAIR_JOB_SCORE_VERSION;
  evidence: Readonly<Record<FairJobFactorV2, FairJobEvidenceState>>;
  positiveReasons: readonly FairJobReasonCodeV2[];
  missingImprovements: readonly FairJobReasonCodeV2[];
  employerSuggestions: readonly FairJobReasonCodeV2[];
}>;

export type FairJobRevisionInputV2 = Readonly<{
  id: string;
  jobId: string;
  salaryPeriod: SalaryPeriod | null;
  salaryMin: number | null;
  salaryMax: number | null;
  tasks: readonly string[];
  requirements: readonly string[];
  workloadMin: number;
  workloadMax: number;
  jobType: JobType;
  startDate: Date | null;
  startByArrangement: boolean;
  remoteType: RemoteType;
  cantonId: string | null;
  cityId: string | null;
  remoteCountryCode: string | null;
  applicationEffort: ApplicationEffort;
  applicationProcessSteps: readonly string[];
  requiredDocumentKinds: readonly RequiredDocumentKind[];
  responseTargetDays: number | null;
  benefits: readonly Readonly<{
    benefitCode: JobBenefitCode;
    description: string;
  }>[];
  inclusionStatement: string | null;
  applicationContactKind: ApplicationContactKind;
  applicationContactValue: string;
  validThrough: Date | null;
}>;

export type FairJobIdentityInputV2 = Readonly<{
  id: string;
}>;

export type BuildFairJobInputV2Args = Readonly<{
  revision: FairJobRevisionInputV2;
  job: FairJobIdentityInputV2;
}>;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const FRESHNESS_WINDOW_DAYS = 120;

const SALARY_PERIODS = new Set<SalaryPeriod>(["YEARLY", "MONTHLY", "HOURLY"]);
const JOB_TYPES = new Set<JobType>([
  "PERMANENT",
  "TEMPORARY",
  "FREELANCE",
  "INTERNSHIP",
  "APPRENTICESHIP",
  "HOLIDAY_JOB",
]);
const REMOTE_TYPES = new Set<RemoteType>(["ONSITE", "HYBRID", "REMOTE"]);
const APPLICATION_EFFORTS = new Set<ApplicationEffort>([
  "SIMPLE",
  "MEDIUM",
  "LONG",
]);
const P0_REQUIRED_DOCUMENT_KINDS = new Set<RequiredDocumentKind>([
  "NONE",
  "CV",
  "COVER_LETTER",
]);
const JOB_BENEFIT_CODES = new Set<JobBenefitCode>([
  "FLEXIBLE_WORK",
  "HOME_OFFICE",
  "PAID_TRAINING",
  "PENSION_TOP_UP",
  "PARENTAL_LEAVE",
  "CHILDCARE_SUPPORT",
  "PUBLIC_TRANSPORT_SUPPORT",
  "MEAL_SUPPORT",
  "HEALTH_WELLBEING",
  "EXTRA_LEAVE",
  "PERFORMANCE_BONUS",
]);

export const FAIR_JOB_FACTOR_POINTS_V2: Readonly<
  Record<FairJobFactorV2, number>
> = {
  SALARY: 25,
  TASKS_REQUIREMENTS: 15,
  WORKLOAD_CONTRACT_START: 15,
  LOCATION_REMOTE: 10,
  APPLICATION_PROCESS: 10,
  RESPONSE_TARGET: 10,
  BENEFITS: 5,
  INCLUSION_CONTACT: 5,
  FRESHNESS: 5,
};

export function buildFairJobInputV2({
  revision,
  job,
}: BuildFairJobInputV2Args): FairJobInput {
  if (revision.jobId !== job.id) {
    throw new TypeError("The revision does not belong to the supplied job.");
  }

  const validTasks = countValidStructuredItems(revision.tasks);
  const validRequirements = countValidStructuredItems(revision.requirements);
  const tasksAndRequirementsClarity: FairJobClarity =
    validTasks >= 3 && validRequirements >= 3
      ? "CLEAR"
      : validTasks >= 1 && validRequirements >= 1
        ? "PARTIAL"
        : "MISSING";

  const hasValidStartDate = isValidDate(revision.startDate);
  const workloadContractAndStartDefined =
    isValidPercentageRange(revision.workloadMin, revision.workloadMax) &&
    JOB_TYPES.has(revision.jobType) &&
    hasValidStartDate !== (revision.startByArrangement === true);

  const hasCantonAndCity =
    isNonEmptyIdentifier(revision.cantonId) &&
    isNonEmptyIdentifier(revision.cityId);
  const locationAndRemoteDefined =
    REMOTE_TYPES.has(revision.remoteType) &&
    ((revision.remoteType === "REMOTE" &&
      revision.remoteCountryCode?.trim().toUpperCase() === "CH") ||
      ((revision.remoteType === "ONSITE" || revision.remoteType === "HYBRID") &&
        hasCantonAndCity));

  const requiredDocumentKinds = new Set(revision.requiredDocumentKinds);
  const hasOnlyP0DocumentKinds =
    revision.requiredDocumentKinds.length > 0 &&
    revision.requiredDocumentKinds.every((kind) =>
      P0_REQUIRED_DOCUMENT_KINDS.has(kind),
    );
  const hasValidNoneSelection =
    !requiredDocumentKinds.has("NONE") || requiredDocumentKinds.size === 1;
  const applicationProcessDefined =
    APPLICATION_EFFORTS.has(revision.applicationEffort) &&
    countValidStructuredItems(revision.applicationProcessSteps) >= 1 &&
    hasOnlyP0DocumentKinds &&
    hasValidNoneSelection;

  const validBenefitCodes = new Set<JobBenefitCode>();
  for (const benefit of revision.benefits) {
    if (
      JOB_BENEFIT_CODES.has(benefit.benefitCode) &&
      isValidStructuredText(benefit.description)
    ) {
      validBenefitCodes.add(benefit.benefitCode);
    }
  }

  const inclusionAndContactDefined =
    isValidBoundedText(revision.inclusionStatement, 30, 500) &&
    isValidApplicationContact(
      revision.applicationContactKind,
      revision.applicationContactValue,
    );

  return {
    salaryRange: buildSalaryRange(revision),
    tasksAndRequirementsClarity,
    workloadContractAndStartDefined,
    locationAndRemoteDefined,
    applicationProcessDefined,
    responseTargetDays: revision.responseTargetDays,
    concreteBenefitsCount: validBenefitCodes.size,
    inclusionAndContactDefined,
    validThrough: cloneValidDateOrNull(revision.validThrough),
  };
}

export function calculateFairJobScoreV2(
  input: FairJobInput,
  clock: Readonly<{ now: Date }>,
): FairJobResult {
  if (!isValidDate(clock?.now)) {
    throw new TypeError("A valid injected clock.now is required.");
  }

  const evidence = buildEvidence(input, clock.now);
  let score = 0;
  const positiveReasons: FairJobReasonCodeV2[] = [];
  const missingImprovements: FairJobReasonCodeV2[] = [];
  const employerSuggestions: FairJobReasonCodeV2[] = [];

  for (const factor of FAIR_JOB_FACTOR_ORDER_V2) {
    const state = evidence[factor];
    const reason = `${factor}_${state}` as FairJobReasonCodeV2;

    if (state === "MET") {
      score += FAIR_JOB_FACTOR_POINTS_V2[factor];
      positiveReasons.push(reason);
      continue;
    }

    if (factor === "TASKS_REQUIREMENTS" && state === "PARTIAL") {
      score += 8;
      positiveReasons.push(reason);
    }

    missingImprovements.push(reason);
    employerSuggestions.push(reason);
  }

  return {
    score,
    version: FAIR_JOB_SCORE_VERSION,
    evidence,
    positiveReasons,
    missingImprovements,
    employerSuggestions,
  };
}

function buildEvidence(
  input: FairJobInput,
  now: Date,
): Record<FairJobFactorV2, FairJobEvidenceState> {
  return {
    SALARY: isValidSalaryRange(input.salaryRange) ? "MET" : "MISSING",
    TASKS_REQUIREMENTS:
      input.tasksAndRequirementsClarity === "CLEAR"
        ? "MET"
        : input.tasksAndRequirementsClarity === "PARTIAL"
          ? "PARTIAL"
          : "MISSING",
    WORKLOAD_CONTRACT_START:
      input.workloadContractAndStartDefined === true ? "MET" : "MISSING",
    LOCATION_REMOTE:
      input.locationAndRemoteDefined === true ? "MET" : "MISSING",
    APPLICATION_PROCESS:
      input.applicationProcessDefined === true ? "MET" : "MISSING",
    RESPONSE_TARGET: isIntegerInRange(input.responseTargetDays, 1, 30)
      ? "MET"
      : "MISSING",
    BENEFITS: isIntegerAtLeast(input.concreteBenefitsCount, 2)
      ? "MET"
      : "MISSING",
    INCLUSION_CONTACT:
      input.inclusionAndContactDefined === true ? "MET" : "MISSING",
    FRESHNESS: isFresh(input.validThrough, now) ? "MET" : "MISSING",
  };
}

function buildSalaryRange(
  revision: FairJobRevisionInputV2,
): FairJobInput["salaryRange"] {
  if (
    revision.salaryPeriod === null ||
    revision.salaryMin === null ||
    revision.salaryMax === null
  ) {
    return null;
  }

  return {
    minChf: revision.salaryMin,
    maxChf: revision.salaryMax,
    period: revision.salaryPeriod,
  };
}

function isValidSalaryRange(value: FairJobInput["salaryRange"]): boolean {
  return (
    value !== null &&
    SALARY_PERIODS.has(value.period) &&
    Number.isInteger(value.minChf) &&
    Number.isInteger(value.maxChf) &&
    value.minChf > 0 &&
    value.maxChf > 0 &&
    value.minChf <= value.maxChf
  );
}

function isFresh(validThrough: Date | null, now: Date): boolean {
  if (!isValidDate(validThrough)) {
    return false;
  }

  const timestamp = validThrough.getTime();
  return (
    timestamp > now.getTime() &&
    timestamp <= now.getTime() + FRESHNESS_WINDOW_DAYS * MILLISECONDS_PER_DAY
  );
}

function countValidStructuredItems(items: readonly string[]): number {
  return items.reduce(
    (count, item) => count + Number(isValidStructuredText(item)),
    0,
  );
}

function isValidStructuredText(value: string): boolean {
  return isValidBoundedText(value, 20, 500);
}

function isValidBoundedText(
  value: string | null,
  minimumCodePoints: number,
  maximumCodePoints: number,
): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = normalizeStructuredText(value);
  const codePointLength = Array.from(normalized).length;
  return (
    codePointLength >= minimumCodePoints && codePointLength <= maximumCodePoints
  );
}

function normalizeStructuredText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function isValidPercentageRange(minimum: number, maximum: number): boolean {
  return (
    Number.isInteger(minimum) &&
    Number.isInteger(maximum) &&
    minimum >= 0 &&
    maximum <= 100 &&
    minimum <= maximum
  );
}

function isIntegerInRange(
  value: number | null,
  minimum: number,
  maximum: number,
): boolean {
  return (
    value !== null &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isIntegerAtLeast(value: number, minimum: number): boolean {
  return Number.isInteger(value) && value >= minimum;
}

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function cloneValidDateOrNull(value: Date | null): Date | null {
  return isValidDate(value) ? new Date(value.getTime()) : null;
}

function isNonEmptyIdentifier(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidApplicationContact(
  kind: ApplicationContactKind,
  rawValue: string,
): boolean {
  const value = rawValue.trim();
  if (kind === "EMAIL") {
    return (
      value.length >= 3 &&
      value.length <= 320 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
    );
  }

  if (kind === "PHONE") {
    return /^\+[1-9][0-9]{7,14}$/u.test(value);
  }

  if (kind === "APPLY_URL") {
    return isSafeAbsoluteHttpUrl(value);
  }

  return false;
}
