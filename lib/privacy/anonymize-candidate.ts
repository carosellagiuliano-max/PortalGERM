const CANTON_CODES = new Set([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU",
  "LU", "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR",
  "VD", "VS", "ZG", "ZH",
]);
const WORKLOAD_BUCKETS = new Set(["20", "40", "60", "80", "100"]);
const SALARY_BUCKETS = new Set(
  Array.from({ length: 22 }, (_, index) => `CHF_${40_000 + index * 10_000}`),
);
const REMOTE_PREFERENCES = new Set(["ONSITE", "HYBRID", "REMOTE", "ANY"]);
const AVAILABILITY_BUCKETS = new Set([
  "NOW", "WITHIN_30_DAYS", "WITHIN_90_DAYS", "LATER", "UNKNOWN",
]);
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_LANGUAGE = /^[a-z]{2}$/;

export const ANONYMOUS_CANDIDATE_POLICY_V1 = Object.freeze({
  version: "v1",
  opaqueTokenBytes: 16,
  allowedFields: Object.freeze([
    "opaqueId",
    "displayLabel",
    "cantonBucket",
    "categoryBucket",
    "skillSlugs",
    "workloadBucket",
    "salaryBucket",
    "salaryPeriod",
    "languageCodes",
    "remotePreference",
    "availabilityBucket",
  ] as const),
});

export type RadarCohortPolicy = Readonly<{
  exposeSkills: boolean;
  exposeWorkload: boolean;
  exposeSalary: boolean;
  exposeLanguages: boolean;
  exposeRemotePreference: boolean;
  exposeAvailability: boolean;
  allowedCategoryBuckets: readonly string[];
  allowedSkillSlugs: readonly string[];
  allowedLanguageCodes: readonly string[];
}>;

export type AnonymousCandidateDto = Readonly<{
  opaqueId: string;
  displayLabel: string;
  cantonBucket: string;
  categoryBucket: string;
  skillSlugs?: readonly string[];
  workloadBucket?: string;
  salaryBucket?: string;
  salaryPeriod?: "YEARLY_FTE";
  languageCodes?: readonly string[];
  remotePreference?: "ONSITE" | "HYBRID" | "REMOTE" | "ANY";
  availabilityBucket?: string;
}>;

export function toAnonymousCandidate(input: Readonly<{
  opaqueId: string;
  cantonBucket: string;
  categoryBucket: string;
  skillSlugs: readonly string[];
  workloadBucket: string | null;
  salaryBucket: string | null;
  salaryPeriod: "YEARLY" | "MONTHLY" | "HOURLY" | null;
  languageCodes: readonly string[];
  remotePreference: "ONSITE" | "HYBRID" | "REMOTE" | "ANY" | null;
  availabilityBucket: string | null;
  radarConsentGranted: boolean;
  policy: RadarCohortPolicy;
}>): AnonymousCandidateDto | null {
  if (!input.radarConsentGranted) {
    return null;
  }
  assertOpaqueToken(input.opaqueId);
  if (!CANTON_CODES.has(input.cantonBucket)) {
    throw new TypeError("Radar canton bucket is invalid.");
  }
  if (
    !SAFE_SLUG.test(input.categoryBucket) ||
    !input.policy.allowedCategoryBuckets.includes(input.categoryBucket)
  ) {
    throw new TypeError("Radar category bucket is not allowlisted.");
  }

  const dto: {
    opaqueId: string;
    displayLabel: string;
    cantonBucket: string;
    categoryBucket: string;
    skillSlugs?: readonly string[];
    workloadBucket?: string;
    salaryBucket?: string;
    salaryPeriod?: "YEARLY_FTE";
    languageCodes?: readonly string[];
    remotePreference?: "ONSITE" | "HYBRID" | "REMOTE" | "ANY";
    availabilityBucket?: string;
  } = {
    opaqueId: input.opaqueId,
    displayLabel: `${input.categoryBucket} · ${input.cantonBucket}`,
    cantonBucket: input.cantonBucket,
    categoryBucket: input.categoryBucket,
  };

  if (input.policy.exposeSkills) {
    dto.skillSlugs = Object.freeze(
      normalizeAllowedValues(
        input.skillSlugs,
        input.policy.allowedSkillSlugs,
        SAFE_SLUG,
        20,
      ),
    );
  }
  if (input.policy.exposeWorkload && input.workloadBucket !== null) {
    assertBucket(WORKLOAD_BUCKETS, input.workloadBucket, "workload");
    dto.workloadBucket = input.workloadBucket;
  }
  if (input.policy.exposeSalary && input.salaryBucket !== null) {
    if (input.salaryPeriod === "YEARLY") {
      assertBucket(SALARY_BUCKETS, input.salaryBucket, "salary");
      dto.salaryBucket = input.salaryBucket;
      dto.salaryPeriod = "YEARLY_FTE";
    }
  }
  if (input.policy.exposeLanguages) {
    dto.languageCodes = Object.freeze(
      normalizeAllowedValues(
        input.languageCodes.map((value) => value.trim().toLowerCase()),
        input.policy.allowedLanguageCodes.map((value) => value.trim().toLowerCase()),
        ISO_LANGUAGE,
        8,
      ),
    );
  }
  if (input.policy.exposeRemotePreference && input.remotePreference !== null) {
    assertBucket(REMOTE_PREFERENCES, input.remotePreference, "remote preference");
    dto.remotePreference = input.remotePreference;
  }
  if (input.policy.exposeAvailability && input.availabilityBucket !== null) {
    assertBucket(AVAILABILITY_BUCKETS, input.availabilityBucket, "availability");
    dto.availabilityBucket = input.availabilityBucket;
  }

  return Object.freeze(dto);
}

function assertOpaqueToken(token: string) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) {
    throw new TypeError("Radar opaque id must be an unpadded 128-bit base64url token.");
  }
  const decoded = Buffer.from(token, "base64url");
  if (
    decoded.length !== ANONYMOUS_CANDIDATE_POLICY_V1.opaqueTokenBytes ||
    decoded.toString("base64url") !== token
  ) {
    throw new TypeError("Radar opaque id must be canonical base64url.");
  }
}

function normalizeAllowedValues(
  values: readonly string[],
  allowlist: readonly string[],
  pattern: RegExp,
  maximum: number,
) {
  const allowed = new Set(allowlist);
  return [...new Set(values)]
    .filter((value) => pattern.test(value) && allowed.has(value))
    .sort()
    .slice(0, maximum);
}

function assertBucket(allowed: ReadonlySet<string>, value: string, label: string) {
  if (!allowed.has(value)) {
    throw new TypeError(`Radar ${label} bucket is invalid.`);
  }
}
