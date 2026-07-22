import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const RADAR_CANTON_CODES_V1 = Object.freeze([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU",
  "LU", "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR",
  "VD", "VS", "ZG", "ZH",
] as const);

export const RADAR_REMOTE_PREFERENCES_V1 = Object.freeze([
  "ONSITE",
  "HYBRID",
  "REMOTE",
  "ANY",
] as const);

export const RADAR_WORKLOAD_MINIMUMS_V1 = Object.freeze([
  20,
  40,
  60,
  80,
  100,
] as const);

export const RADAR_LANGUAGE_BUCKETS_V1 = Object.freeze([
  "BASIC",
  "WORKING",
  "ADVANCED",
] as const);

export const RADAR_LANGUAGE_LEVELS_V1 = Object.freeze([
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
  "NATIVE",
] as const);

/** Canonical ISO-639-1 codes. Deprecated aliases such as `iw` and `in` are absent. */
export const RADAR_ISO_639_1_CODES_V1 = Object.freeze([
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
  "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs",
  "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy",
  "da", "de", "dv", "dz",
  "ee", "el", "en", "eo", "es", "et", "eu",
  "fa", "ff", "fi", "fj", "fo", "fr", "fy",
  "ga", "gd", "gl", "gn", "gu", "gv",
  "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
  "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu",
  "ja", "jv",
  "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky",
  "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv",
  "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
  "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
  "oc", "oj", "om", "or", "os",
  "pa", "pi", "pl", "ps", "pt",
  "qu",
  "rm", "rn", "ro", "ru", "rw",
  "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw",
  "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty",
  "ug", "uk", "ur", "uz",
  "ve", "vi", "vo",
  "wa", "wo",
  "xh",
  "yi", "yo",
  "za", "zh", "zu",
] as const);

export const RADAR_SALARY_CEILINGS_CHF_V1 = Object.freeze(
  Array.from({ length: 22 }, (_, index) => 40_000 + index * 10_000),
) as readonly number[];

export const RADAR_PRIVACY_POLICY_V1 = Object.freeze({
  version: "v1" as const,
  calendarTimeZone: "Europe/Zurich" as const,
  salary: Object.freeze({
    minimumCeilingChf: 40_000,
    maximumCeilingChf: 250_000,
    stepChf: 10_000,
    period: "YEARLY_FTE" as const,
  }),
  cohort: Object.freeze({
    minimumSize: 10,
    countLabels: Object.freeze(["10+", "25+", "50+", "100+"] as const),
  }),
  discovery: Object.freeze({
    maximumSampleSize: 20,
    pageSize: 10,
    maximumPages: 2,
  }),
  enumeration: Object.freeze({
    listRequestsPerMembershipPerRollingMinute: 10,
    distinctFilterHashesPerCompanyPerZurichDay: 30,
  }),
  cursor: Object.freeze({
    context: "swisstalenthub:talent-radar:cursor:v1" as const,
    ttlMilliseconds: 15 * 60 * 1_000,
    maximumLength: 2_048,
    allowedClockSkewMilliseconds: 30 * 1_000,
  }),
  sampling: Object.freeze({
    context: "swisstalenthub:talent-radar:daily-sample:v1" as const,
    sampleIdBytes: 16,
  }),
  opaqueId: Object.freeze({
    epochLengthZurichCalendarDays: 30,
    epochAnchorZurichDate: "2026-01-01" as const,
  }),
});

export type RadarRemotePreferenceV1 =
  (typeof RADAR_REMOTE_PREFERENCES_V1)[number];
export type RadarWorkloadMinimumV1 =
  (typeof RADAR_WORKLOAD_MINIMUMS_V1)[number];
export type RadarLanguageBucketV1 =
  (typeof RADAR_LANGUAGE_BUCKETS_V1)[number];
export type RadarLanguageLevelV1 =
  (typeof RADAR_LANGUAGE_LEVELS_V1)[number];
export type RadarCohortCountLabelV1 =
  (typeof RADAR_PRIVACY_POLICY_V1.cohort.countLabels)[number];

export type NormalizedRadarFiltersV1 = Readonly<{
  skillId: string | null;
  cantonCode: string | null;
  salaryBudgetCeilingChf: number | null;
  workloadMinimumPercent: RadarWorkloadMinimumV1 | null;
  languageCode: string | null;
  languageMinimumLevel: RadarLanguageBucketV1 | null;
  remotePreference: RadarRemotePreferenceV1 | null;
}>;

export type NormalizedRadarFilterResultV1 = Readonly<{
  filters: NormalizedRadarFiltersV1;
  canonical: string;
  filterHash: string;
}>;

export type RadarPrivacyHmacKeyV1 = Readonly<{
  version: string;
  /** Canonical base64 encoding of exactly 32 bytes. */
  secret: string;
}>;

export type RadarDailySampleV1 = Readonly<{
  sampleId: string;
  candidateProfileIds: readonly string[];
}>;

export type RadarCursorPayloadV1 = Readonly<{
  policyVersion: "v1";
  keyVersion: string;
  companyId: string;
  filterHash: string;
  dailySampleId: string;
  position: 10;
  issuedAt: number;
  expiresAt: number;
}>;

const CANTON_CODES = new Set<string>(RADAR_CANTON_CODES_V1);
const ISO_639_1_CODES = new Set<string>(RADAR_ISO_639_1_CODES_V1);
const KEY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;
const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

function normalizedString(value: unknown, casing: "lower" | "upper"): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return casing === "lower" ? trimmed.toLowerCase() : trimmed.toUpperCase();
}

function wholeNumberInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return /^\d+$/u.test(trimmed) ? Number(trimmed) : value;
}

const optionalSkillId = z.preprocess(
  (value) => normalizedString(value, "lower"),
  z.uuid().optional(),
);
const optionalCantonCode = z.preprocess(
  (value) => normalizedString(value, "upper"),
  z.string().refine((value) => CANTON_CODES.has(value), "Unknown canton code.").optional(),
);
const optionalSalaryCeiling = z.preprocess(
  wholeNumberInput,
  z.number().int()
    .min(RADAR_PRIVACY_POLICY_V1.salary.minimumCeilingChf)
    .max(RADAR_PRIVACY_POLICY_V1.salary.maximumCeilingChf)
    .transform((value) =>
      Math.floor(value / RADAR_PRIVACY_POLICY_V1.salary.stepChf) *
      RADAR_PRIVACY_POLICY_V1.salary.stepChf)
    .optional(),
);
const optionalWorkloadMinimum = z.preprocess(
  wholeNumberInput,
  z.union(RADAR_WORKLOAD_MINIMUMS_V1.map((value) => z.literal(value)) as [
    z.ZodLiteral<20>,
    z.ZodLiteral<40>,
    z.ZodLiteral<60>,
    z.ZodLiteral<80>,
    z.ZodLiteral<100>,
  ]).optional(),
);
const optionalLanguageCode = z.preprocess(
  (value) => normalizedString(value, "lower"),
  z.string().refine(
    (value) => ISO_639_1_CODES.has(value),
    "Language must be a canonical ISO-639-1 code.",
  ).optional(),
);
const optionalLanguageBucket = z.preprocess(
  (value) => normalizedString(value, "upper"),
  z.enum(RADAR_LANGUAGE_BUCKETS_V1).optional(),
);
const optionalRemotePreference = z.preprocess(
  (value) => normalizedString(value, "upper"),
  z.enum(RADAR_REMOTE_PREFERENCES_V1).optional(),
);

const radarFilterInputSchema = z.strictObject({
  skillId: optionalSkillId,
  cantonCode: optionalCantonCode,
  salaryBudgetCeilingChf: optionalSalaryCeiling,
  workloadMinimumPercent: optionalWorkloadMinimum,
  languageCode: optionalLanguageCode,
  languageMinimumLevel: optionalLanguageBucket,
  remotePreference: optionalRemotePreference,
}).superRefine((filters, context) => {
  if ((filters.languageCode === undefined) !==
      (filters.languageMinimumLevel === undefined)) {
    context.addIssue({
      code: "custom",
      path: filters.languageCode === undefined
        ? ["languageCode"]
        : ["languageMinimumLevel"],
      message: "Language code and minimum level must be supplied together.",
    });
  }
});

const persistedRadarFiltersSchema = z.strictObject({
  skillId: z.uuid().nullable(),
  cantonCode: z.enum(RADAR_CANTON_CODES_V1).nullable(),
  salaryBudgetCeilingChf: z.number().int()
    .min(RADAR_PRIVACY_POLICY_V1.salary.minimumCeilingChf)
    .max(RADAR_PRIVACY_POLICY_V1.salary.maximumCeilingChf)
    .refine(
      (value) => value % RADAR_PRIVACY_POLICY_V1.salary.stepChf === 0,
      "Salary ceiling must use the frozen Radar step.",
    )
    .nullable(),
  workloadMinimumPercent: z.union(
    RADAR_WORKLOAD_MINIMUMS_V1.map((value) => z.literal(value)) as [
      z.ZodLiteral<20>,
      z.ZodLiteral<40>,
      z.ZodLiteral<60>,
      z.ZodLiteral<80>,
      z.ZodLiteral<100>,
    ],
  ).nullable(),
  languageCode: z.enum(RADAR_ISO_639_1_CODES_V1).nullable(),
  languageMinimumLevel: z.enum(RADAR_LANGUAGE_BUCKETS_V1).nullable(),
  remotePreference: z.enum(RADAR_REMOTE_PREFERENCES_V1).nullable(),
}).superRefine((filters, context) => {
  if ((filters.languageCode === null) !==
      (filters.languageMinimumLevel === null)) {
    context.addIssue({
      code: "custom",
      path: filters.languageCode === null
        ? ["languageCode"]
        : ["languageMinimumLevel"],
      message: "Language code and minimum level must be supplied together.",
    });
  }
});

const sampleScopeSchema = z.strictObject({
  companyId: z.uuid().transform((value) => value.toLowerCase()),
  filterHash: z.string().regex(SHA_256_HEX_PATTERN),
  calendarDate: z.string().refine(isCanonicalCalendarDate, "Invalid calendar date."),
  candidateProfileIds: z.array(
    z.uuid().transform((value) => value.toLowerCase()),
  ),
});

const cursorScopeSchema = z.strictObject({
  companyId: z.uuid().transform((value) => value.toLowerCase()),
  filterHash: z.string().regex(SHA_256_HEX_PATTERN),
  dailySampleId: z.string().refine(isCanonicalSampleId, "Invalid daily sample id."),
});

const cursorPayloadSchema = z.strictObject({
  policyVersion: z.literal(RADAR_PRIVACY_POLICY_V1.version),
  keyVersion: z.string().regex(KEY_VERSION_PATTERN),
  companyId: z.uuid().transform((value) => value.toLowerCase()),
  filterHash: z.string().regex(SHA_256_HEX_PATTERN),
  dailySampleId: z.string().refine(isCanonicalSampleId, "Invalid daily sample id."),
  position: z.literal(RADAR_PRIVACY_POLICY_V1.discovery.pageSize),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

const INSUFFICIENT_COHORT = Object.freeze({
  status: "INSUFFICIENT_COHORT" as const,
});

/**
 * Parses the closed P0 filter grammar and returns one canonical representation.
 * Unknown fields and multi-value arrays fail instead of being ignored.
 */
export function normalizeRadarFiltersV1(input: unknown): NormalizedRadarFilterResultV1 {
  const parsed = radarFilterInputSchema.parse(input);
  return toNormalizedRadarFilterResult(Object.freeze({
    skillId: parsed.skillId ?? null,
    cantonCode: parsed.cantonCode ?? null,
    salaryBudgetCeilingChf: parsed.salaryBudgetCeilingChf ?? null,
    workloadMinimumPercent: parsed.workloadMinimumPercent ?? null,
    languageCode: parsed.languageCode ?? null,
    languageMinimumLevel: parsed.languageMinimumLevel ?? null,
    remotePreference: parsed.remotePreference ?? null,
  }) satisfies NormalizedRadarFiltersV1);
}

/**
 * Revalidates the exact closed filter snapshot stored with a Radar session.
 * This is intentionally separate from request normalization because persisted
 * snapshots contain every allowlisted key and represent omissions as null.
 */
export function parsePersistedRadarFiltersV1(
  input: unknown,
): NormalizedRadarFilterResultV1 {
  return toNormalizedRadarFilterResult(
    Object.freeze(persistedRadarFiltersSchema.parse(input)),
  );
}

function toNormalizedRadarFilterResult(
  filters: NormalizedRadarFiltersV1,
): NormalizedRadarFilterResultV1 {
  const canonical = JSON.stringify({
    policyVersion: RADAR_PRIVACY_POLICY_V1.version,
    filters,
  });
  return Object.freeze({
    filters,
    canonical,
    filterHash: createHash("sha256").update(canonical, "utf8").digest("hex"),
  });
}

export function toRadarLanguageBucketV1(level: string): RadarLanguageBucketV1 {
  const normalized = level.trim().toUpperCase();
  if (normalized === "A1" || normalized === "A2") return "BASIC";
  if (normalized === "B1" || normalized === "B2") return "WORKING";
  if (normalized === "C1" || normalized === "C2" || normalized === "NATIVE") {
    return "ADVANCED";
  }
  throw new TypeError("Radar language level is outside the frozen taxonomy.");
}

export function radarLanguageMeetsMinimumV1(
  level: string,
  minimum: RadarLanguageBucketV1,
): boolean {
  const ranks: Readonly<Record<RadarLanguageBucketV1, number>> = Object.freeze({
    BASIC: 0,
    WORKING: 1,
    ADVANCED: 2,
  });
  if (!RADAR_LANGUAGE_BUCKETS_V1.includes(minimum)) {
    throw new TypeError("Radar language minimum is outside the frozen taxonomy.");
  }
  return ranks[toRadarLanguageBucketV1(level)] >= ranks[minimum];
}

/** Returns no exact count, and deliberately reuses one result for 0 through 9. */
export function gateRadarCohortV1(exactEligibleCount: number):
  | typeof INSUFFICIENT_COHORT
  | Readonly<{ status: "AVAILABLE"; countLabel: RadarCohortCountLabelV1 }> {
  if (!Number.isSafeInteger(exactEligibleCount) || exactEligibleCount < 0) {
    throw new TypeError("Radar cohort size must be a non-negative safe integer.");
  }
  if (exactEligibleCount < RADAR_PRIVACY_POLICY_V1.cohort.minimumSize) {
    return INSUFFICIENT_COHORT;
  }
  const countLabel: RadarCohortCountLabelV1 = exactEligibleCount >= 100
    ? "100+"
    : exactEligibleCount >= 50
      ? "50+"
      : exactEligibleCount >= 25
        ? "25+"
        : "10+";
  return Object.freeze({ status: "AVAILABLE", countLabel });
}

/**
 * Produces the same bounded, pseudorandom order for a Company/filter/Zurich day.
 * Input ordering and duplicate query rows cannot influence or enlarge the sample.
 */
export function selectRadarDailySampleV1(
  input: Readonly<{
    companyId: string;
    filterHash: string;
    calendarDate: string;
    candidateProfileIds: readonly string[];
  }>,
  key: RadarPrivacyHmacKeyV1,
): RadarDailySampleV1 {
  const parsed = sampleScopeSchema.parse({
    ...input,
    candidateProfileIds: [...input.candidateProfileIds],
  });
  const keyBytes = decodeHmacKey(key);
  const scopeSeed = createHmac("sha256", keyBytes)
    .update([
      RADAR_PRIVACY_POLICY_V1.sampling.context,
      key.version,
      parsed.companyId,
      parsed.filterHash,
      parsed.calendarDate,
    ].join("\0"), "utf8")
    .digest();
  const sampleId = createHmac("sha256", scopeSeed)
    .update("sample-id", "utf8")
    .digest()
    .subarray(0, RADAR_PRIVACY_POLICY_V1.sampling.sampleIdBytes)
    .toString("base64url");
  const distinctIds = [...new Set(parsed.candidateProfileIds)].sort();
  const ranked = distinctIds.map((candidateProfileId) => ({
    candidateProfileId,
    score: createHmac("sha256", scopeSeed)
      .update(`candidate\0${candidateProfileId}`, "utf8")
      .digest(),
  }));
  ranked.sort((left, right) =>
    Buffer.compare(left.score, right.score) ||
    left.candidateProfileId.localeCompare(right.candidateProfileId));
  return Object.freeze({
    sampleId,
    candidateProfileIds: Object.freeze(
      ranked
        .slice(0, RADAR_PRIVACY_POLICY_V1.discovery.maximumSampleSize)
        .map(({ candidateProfileId }) => candidateProfileId),
    ),
  });
}

export function pageRadarDailySampleV1(
  sample: readonly string[],
  position: 0 | 10,
): Readonly<{
  candidateProfileIds: readonly string[];
  nextPosition: 10 | null;
}> {
  if (
    !Array.isArray(sample) ||
    sample.length > RADAR_PRIVACY_POLICY_V1.discovery.maximumSampleSize ||
    new Set(sample).size !== sample.length ||
    sample.some((value) => !z.uuid().safeParse(value).success)
  ) {
    throw new TypeError("Radar page requires a distinct bounded Candidate sample.");
  }
  if (position !== 0 && position !== RADAR_PRIVACY_POLICY_V1.discovery.pageSize) {
    throw new TypeError("Radar page position is outside the frozen two-page window.");
  }
  const end = position + RADAR_PRIVACY_POLICY_V1.discovery.pageSize;
  return Object.freeze({
    candidateProfileIds: Object.freeze(sample.slice(position, end)),
    nextPosition: position === 0 && sample.length > end ? 10 : null,
  });
}

export function signRadarCursorV1(
  input: Readonly<{
    companyId: string;
    filterHash: string;
    dailySampleId: string;
    now: Date;
  }>,
  key: RadarPrivacyHmacKeyV1,
): string {
  assertValidInstant(input.now, "Radar cursor clock");
  const scope = cursorScopeSchema.parse({
    companyId: input.companyId,
    filterHash: input.filterHash,
    dailySampleId: input.dailySampleId,
  });
  decodeHmacKey(key);
  const issuedAt = input.now.getTime();
  const payload = cursorPayloadSchema.parse({
    policyVersion: RADAR_PRIVACY_POLICY_V1.version,
    keyVersion: key.version,
    ...scope,
    position: RADAR_PRIVACY_POLICY_V1.discovery.pageSize,
    issuedAt,
    expiresAt: issuedAt + RADAR_PRIVACY_POLICY_V1.cursor.ttlMilliseconds,
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = cursorSignature(encoded, key).toString("base64url");
  return `${encoded}.${signature}`;
}

export function verifyRadarCursorV1(
  cursor: string | null | undefined,
  expected: Readonly<{
    companyId: string;
    filterHash: string;
    dailySampleId: string;
    now: Date;
  }>,
  keyring: readonly RadarPrivacyHmacKeyV1[],
): RadarCursorPayloadV1 | null {
  if (
    cursor == null ||
    cursor.length === 0 ||
    cursor.length > RADAR_PRIVACY_POLICY_V1.cursor.maximumLength ||
    !isValidInstant(expected.now)
  ) return null;
  const scope = cursorScopeSchema.safeParse({
    companyId: expected.companyId,
    filterHash: expected.filterHash,
    dailySampleId: expected.dailySampleId,
  });
  if (!scope.success) return null;
  const validKeys = keyring.map((key) => {
    decodeHmacKey(key);
    return key;
  });
  if (validKeys.length === 0) {
    throw new TypeError("Radar cursor verification requires a keyring.");
  }
  const [encoded, encodedSignature, extra] = cursor.split(".");
  if (
    !encoded ||
    !encodedSignature ||
    extra !== undefined ||
    !isCanonicalBase64Url(encoded) ||
    !isCanonicalBase64Url(encodedSignature)
  ) return null;

  try {
    const supplied = Buffer.from(encodedSignature, "base64url");
    const verifiedKey = validKeys.find((key) => {
      const correct = cursorSignature(encoded, key);
      return supplied.length === correct.length && timingSafeEqual(supplied, correct);
    });
    if (verifiedKey === undefined) return null;
    const parsed = cursorPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    const payload = parsed.data;
    const now = expected.now.getTime();
    if (
      payload.keyVersion !== verifiedKey.version ||
      payload.companyId !== scope.data.companyId ||
      payload.filterHash !== scope.data.filterHash ||
      payload.dailySampleId !== scope.data.dailySampleId ||
      payload.expiresAt !==
        payload.issuedAt + RADAR_PRIVACY_POLICY_V1.cursor.ttlMilliseconds ||
      payload.issuedAt >
        now + RADAR_PRIVACY_POLICY_V1.cursor.allowedClockSkewMilliseconds ||
      now >= payload.expiresAt
    ) return null;
    return Object.freeze(payload);
  } catch {
    return null;
  }
}

export function getRadarZurichCalendarDateV1(instant: Date): string {
  assertValidInstant(instant, "Radar calendar clock");
  const parts = getZurichParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getRadarZurichCalendarDayWindowV1(instant: Date): Readonly<{
  calendarDate: string;
  start: Date;
  end: Date;
}> {
  const calendarDate = getRadarZurichCalendarDateV1(instant);
  const start = projectZurichMidnight(calendarDate);
  const nominalNext = new Date(`${calendarDate}T00:00:00.000Z`);
  nominalNext.setUTCDate(nominalNext.getUTCDate() + 1);
  const nextDate = [
    nominalNext.getUTCFullYear(),
    String(nominalNext.getUTCMonth() + 1).padStart(2, "0"),
    String(nominalNext.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return Object.freeze({
    calendarDate,
    start,
    end: projectZurichMidnight(nextDate),
  });
}

function cursorSignature(encoded: string, key: RadarPrivacyHmacKeyV1): Buffer {
  return createHmac("sha256", decodeHmacKey(key))
    .update([
      RADAR_PRIVACY_POLICY_V1.cursor.context,
      key.version,
      encoded,
    ].join("\0"), "utf8")
    .digest();
}

function decodeHmacKey(key: RadarPrivacyHmacKeyV1): Buffer {
  if (!KEY_VERSION_PATTERN.test(key.version)) {
    throw new TypeError("Radar HMAC key version is invalid.");
  }
  const decoded = Buffer.from(key.secret, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== key.secret) {
    throw new TypeError("Radar HMAC key must be canonical base64 for exactly 32 bytes.");
  }
  return decoded;
}

function isCanonicalSampleId(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === RADAR_PRIVACY_POLICY_V1.sampling.sampleIdBytes &&
    decoded.toString("base64url") === value;
}

function isCanonicalBase64Url(value: string): boolean {
  if (!BASE64URL_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value;
}

function isCanonicalCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type ZurichParts = Readonly<{
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}>;

function getZurichParts(instant: Date): ZurichParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RADAR_PRIVACY_POLICY_V1.calendarTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  if (["year", "month", "day", "hour", "minute", "second"]
      .some((part) => typeof values[part] !== "string")) {
    throw new RangeError("Europe/Zurich calendar parts could not be resolved.");
  }
  return Object.freeze({
    year: values.year as string,
    month: values.month as string,
    day: values.day as string,
    hour: values.hour as string,
    minute: values.minute as string,
    second: values.second as string,
  });
}

function projectZurichMidnight(calendarDate: string): Date {
  if (!isCanonicalCalendarDate(calendarDate)) {
    throw new TypeError("A canonical Radar calendar date is required.");
  }
  const [year, month, day] = calendarDate.split("-").map(Number) as [number, number, number];
  const nominalUtc = Date.UTC(year, month - 1, day);
  let projected = nominalUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = getZurichParts(new Date(projected));
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const next = nominalUtc - (representedAsUtc - projected);
    if (next === projected) break;
    projected = next;
  }
  const result = new Date(projected);
  const represented = getZurichParts(result);
  if (
    `${represented.year}-${represented.month}-${represented.day}` !== calendarDate ||
    represented.hour !== "00" ||
    represented.minute !== "00" ||
    represented.second !== "00"
  ) {
    throw new RangeError("Europe/Zurich midnight could not be resolved.");
  }
  return result;
}

function assertValidInstant(value: Date, label: string): void {
  if (!isValidInstant(value)) throw new TypeError(`${label} requires a valid instant.`);
}

function isValidInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
