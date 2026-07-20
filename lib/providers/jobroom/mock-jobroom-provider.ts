import {
  JOBROOM_LEGAL_DISCLAIMER,
  OCCUPATION_CODES_2026_FIXTURE,
  type OccupationCodeDatasetFixture,
  type OccupationCodeFixtureEntry,
} from "./fixtures/occupation-codes-2026";
import type {
  JobroomProvider,
  JobroomReportingResult,
  ReportingObligationCheckResult,
} from "./jobroom-provider";

const SUPPORTED_CANTON_CODES = new Set([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE",
  "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
]);
const MAX_OCCUPATION_CODES = 10_000;
const DATASET_KEYS = Object.freeze([
  "datasetKey",
  "datasetVersion",
  "dataYear",
  "sourceUrl",
  "validFrom",
  "validTo",
  "occupationCodes",
] as const);
const OCCUPATION_CODE_KEYS = Object.freeze([
  "id",
  "code",
  "label",
  "result",
  "classificationStatus",
  "effectiveFrom",
  "effectiveTo",
] as const);
const DEFAULT_RESPONSE_METADATA = Object.freeze({
  datasetVersion: OCCUPATION_CODES_2026_FIXTURE.datasetVersion,
  dataYear: OCCUPATION_CODES_2026_FIXTURE.dataYear,
  sourceUrl: OCCUPATION_CODES_2026_FIXTURE.sourceUrl,
});

export type JobroomReasonCode =
  | "REPORTING_REQUIRED"
  | "REPORTING_NOT_REQUIRED"
  | "SOURCE_RESULT_UNKNOWN"
  | "MISSING_OCCUPATION_CODE"
  | "OCCUPATION_CODE_NOT_FOUND"
  | "AMBIGUOUS_OCCUPATION_CODE"
  | "STALE_DATASET"
  | "STALE_OCCUPATION_CODE"
  | "UNSUPPORTED_CANTON"
  | "INVALID_INPUT"
  | "INVALID_FIXTURE_DATA"
  | "UNSUPPORTED_SOURCE_RESULT";

export interface MockJobroomProviderOptions {
  readonly fixture?: OccupationCodeDatasetFixture;
  readonly now?: () => Date;
}

export class MockJobroomProvider implements JobroomProvider {
  readonly #fixture: unknown;
  readonly #now: unknown;

  constructor(options: MockJobroomProviderOptions = {}) {
    let fixture: unknown = OCCUPATION_CODES_2026_FIXTURE;
    let now: unknown = () => new Date();
    try {
      if (Object.prototype.hasOwnProperty.call(options, "fixture")) {
        fixture = options.fixture;
      }
      if (Object.prototype.hasOwnProperty.call(options, "now")) {
        now = options.now;
      }
    } catch {
      fixture = null;
      now = null;
    }
    this.#fixture = fixture;
    this.#now = now;
  }

  async checkReportingObligation(input: {
    occupationCodeId?: string;
    cantonCode?: string;
  }): Promise<ReportingObligationCheckResult> {
    const fixture = validateFixture(this.#fixture);
    if (fixture === null) {
      return this.#result(
        DEFAULT_RESPONSE_METADATA,
        "UNKNOWN",
        "INVALID_FIXTURE_DATA",
      );
    }

    const now = readClock(this.#now);
    if (now === null) {
      return this.#result(
        fixture,
        "UNKNOWN",
        "INVALID_FIXTURE_DATA",
      );
    }

    const validatedInput = validateCheckInput(input);
    if (validatedInput === null) {
      return this.#result(fixture, "UNKNOWN", "INVALID_INPUT");
    }

    const { occupationCodeId, cantonCode } = validatedInput;
    if (!occupationCodeId) {
      return this.#result(fixture, "UNKNOWN", "MISSING_OCCUPATION_CODE");
    }

    if (cantonCode !== undefined && !isSupportedCanton(cantonCode)) {
      return this.#result(fixture, "UNKNOWN", "UNSUPPORTED_CANTON");
    }

    const datasetWindow = parseWindow(fixture.validFrom, fixture.validTo);
    if (datasetWindow === null) {
      return this.#result(fixture, "UNKNOWN", "INVALID_FIXTURE_DATA");
    }
    if (!isWithinWindow(now, datasetWindow)) {
      return this.#result(fixture, "UNKNOWN", "STALE_DATASET");
    }

    const matches = fixture.occupationCodes.filter(
      (occupationCode) => occupationCode.id === occupationCodeId,
    );
    if (matches.length === 0) {
      return this.#result(fixture, "UNKNOWN", "OCCUPATION_CODE_NOT_FOUND");
    }
    if (matches.length !== 1) {
      return this.#result(fixture, "UNKNOWN", "AMBIGUOUS_OCCUPATION_CODE");
    }

    const occupationCode = matches[0];
    if (!occupationCode) {
      return this.#result(fixture, "UNKNOWN", "INVALID_FIXTURE_DATA");
    }
    if (occupationCode.classificationStatus === "AMBIGUOUS") {
      return this.#result(fixture, "UNKNOWN", "AMBIGUOUS_OCCUPATION_CODE");
    }
    const occupationWindow = parseOptionalWindow(occupationCode);
    if (occupationWindow === null) {
      return this.#result(fixture, "UNKNOWN", "INVALID_FIXTURE_DATA");
    }
    if (!isWithinWindow(now, occupationWindow)) {
      return this.#result(fixture, "UNKNOWN", "STALE_OCCUPATION_CODE");
    }

    switch (occupationCode.result) {
      case "REQUIRES_REPORTING":
        return this.#result(
          fixture,
          "REQUIRES_REPORTING",
          "REPORTING_REQUIRED",
        );
      case "NOT_REQUIRED":
        return this.#result(fixture, "NOT_REQUIRED", "REPORTING_NOT_REQUIRED");
      case "UNKNOWN":
        return this.#result(fixture, "UNKNOWN", "SOURCE_RESULT_UNKNOWN");
    }
  }

  async submitJob(_input: unknown): Promise<{
    accepted: false;
    reason: "not_implemented_in_mvp";
  }> {
    return Object.freeze({
      accepted: false,
      reason: "not_implemented_in_mvp",
    });
  }

  #result(
    metadata: ResponseMetadata,
    result: JobroomReportingResult,
    reasonCode: JobroomReasonCode,
  ): ReportingObligationCheckResult {
    return Object.freeze({
      result,
      reasonCode,
      disclaimer: JOBROOM_LEGAL_DISCLAIMER,
      datasetVersion: metadata.datasetVersion,
      dataYear: metadata.dataYear,
      sourceUrl: metadata.sourceUrl,
    });
  }
}

interface EffectiveWindow {
  readonly from: number;
  readonly to: number;
}

interface ResponseMetadata {
  readonly datasetVersion: string;
  readonly dataYear: number;
  readonly sourceUrl: string;
}

interface ValidatedFixture extends OccupationCodeDatasetFixture, ResponseMetadata {
  readonly occupationCodes: readonly OccupationCodeFixtureEntry[];
}

function validateFixture(value: unknown): ValidatedFixture | null {
  try {
    const record = readStrictRecord(value, DATASET_KEYS);
    if (record === null) {
      return null;
    }

    const datasetKey = boundedString(
      record.datasetKey,
      1,
      64,
      /^[A-Z0-9][A-Z0-9_]*$/u,
    );
    const datasetVersion = boundedString(
      record.datasetVersion,
      1,
      32,
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
    );
    const dataYear = record.dataYear;
    const sourceUrl = parseOfficialSourceUrl(record.sourceUrl, dataYear);
    const validFrom = parseCanonicalTimestamp(record.validFrom);
    const validTo = parseCanonicalTimestamp(record.validTo);
    if (
      datasetKey === null ||
      datasetVersion === null ||
      !Number.isSafeInteger(dataYear) ||
      (dataYear as number) < 2_000 ||
      (dataYear as number) > 2_100 ||
      sourceUrl === null ||
      validFrom === null ||
      validTo === null ||
      validFrom.time !== Date.UTC(dataYear as number, 0, 1) ||
      validTo.time !== Date.UTC((dataYear as number) + 1, 0, 1)
    ) {
      return null;
    }

    if (
      !Array.isArray(record.occupationCodes) ||
      record.occupationCodes.length === 0 ||
      record.occupationCodes.length > MAX_OCCUPATION_CODES
    ) {
      return null;
    }

    const occupationCodes: OccupationCodeFixtureEntry[] = [];
    const ids = new Set<string>();
    const codes = new Set<string>();
    for (const candidate of record.occupationCodes) {
      const occupationCode = validateOccupationCode(candidate);
      if (
        occupationCode === null ||
        ids.has(occupationCode.id) ||
        codes.has(occupationCode.code)
      ) {
        return null;
      }
      ids.add(occupationCode.id);
      codes.add(occupationCode.code);
      occupationCodes.push(occupationCode);
    }

    return Object.freeze({
      datasetKey,
      datasetVersion,
      dataYear: dataYear as number,
      sourceUrl,
      validFrom: validFrom.value,
      validTo: validTo.value,
      occupationCodes: Object.freeze(occupationCodes),
    });
  } catch {
    return null;
  }
}

function validateOccupationCode(value: unknown): OccupationCodeFixtureEntry | null {
  const record = readStrictRecord(value, OCCUPATION_CODE_KEYS);
  if (record === null) {
    return null;
  }

  const id = parseUuid(record.id);
  const code = boundedString(
    record.code,
    1,
    32,
    /^[A-Z0-9][A-Z0-9._-]*$/u,
  );
  const label = boundedString(record.label, 1, 255);
  const result = parseReportingResult(record.result);
  const classificationStatus = parseClassificationStatus(
    record.classificationStatus,
  );
  const effectiveFrom = parseOptionalTimestamp(record.effectiveFrom, "from");
  const effectiveTo = parseOptionalTimestamp(record.effectiveTo, "to");
  if (
    id === null ||
    code === null ||
    label === null ||
    result === null ||
    classificationStatus === null ||
    effectiveFrom === null ||
    effectiveTo === null ||
    effectiveFrom.time >= effectiveTo.time ||
    (classificationStatus === "AMBIGUOUS" && result !== "UNKNOWN")
  ) {
    return null;
  }

  return Object.freeze({
    id,
    code,
    label,
    result,
    classificationStatus,
    effectiveFrom: effectiveFrom.value,
    effectiveTo: effectiveTo.value,
  });
}

function readStrictRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== allowedKeys.length ||
      keys.some(
        (key) => typeof key !== "string" || !allowedKeys.includes(key),
      )
    ) {
      return null;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of allowedKeys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        "get" in descriptor ||
        "set" in descriptor
      ) {
        return null;
      }
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    return null;
  }
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
  pattern?: RegExp,
) {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    return null;
  }
  return value;
}

function parseUuid(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    return null;
  }
  return value.toLocaleLowerCase("de-CH");
}

function parseReportingResult(value: unknown): JobroomReportingResult | null {
  return value === "REQUIRES_REPORTING" ||
    value === "NOT_REQUIRED" ||
    value === "UNKNOWN"
    ? value
    : null;
}

function parseClassificationStatus(value: unknown) {
  return value === "RESOLVED" || value === "AMBIGUOUS" ? value : null;
}

type ParsedTimestamp = Readonly<{ value: string; time: number }>;
type ParsedOptionalTimestamp = Readonly<{
  value: string | null;
  time: number;
}>;

function parseCanonicalTimestamp(value: unknown): ParsedTimestamp | null {
  if (typeof value !== "string" || value.length > 35) {
    return null;
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    return null;
  }
  return Object.freeze({ value, time });
}

function parseOptionalTimestamp(
  value: unknown,
  boundary: "from" | "to",
): ParsedOptionalTimestamp | null {
  if (value === null) {
    return Object.freeze({
      value: null,
      time: boundary === "from"
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY,
    });
  }
  return parseCanonicalTimestamp(value);
}

function parseOfficialSourceUrl(value: unknown, dataYear: unknown) {
  if (typeof value !== "string" || value.length > 1_000) {
    return null;
  }
  try {
    const url = new URL(value);
    const expectedYearPath = Number.isSafeInteger(dataYear)
      ? `/de/arbeitgebende/stellenmeldepflicht-${String(dataYear)}`
      : "";
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.arbeit.swiss" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== expectedYearPath ||
      url.toString() !== value
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function readClock(clock: unknown) {
  if (typeof clock !== "function") {
    return null;
  }
  try {
    const value: unknown = Reflect.apply(clock, undefined, []);
    if (!(value instanceof Date)) {
      return null;
    }
    const time = Date.prototype.getTime.call(value);
    return Number.isFinite(time) ? new Date(time) : null;
  } catch {
    return null;
  }
}

function isSupportedCanton(value: string) {
  return SUPPORTED_CANTON_CODES.has(value);
}

interface ValidatedCheckInput {
  readonly occupationCodeId: string | undefined;
  readonly cantonCode: string | undefined;
}

function validateCheckInput(input: unknown): ValidatedCheckInput | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return null;
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return null;
    }

    const keys = Reflect.ownKeys(input);
    if (
      keys.length > 2 ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "occupationCodeId" && key !== "cantonCode"),
      )
    ) {
      return null;
    }

    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Object.values(descriptors).some((descriptor) => "get" in descriptor || "set" in descriptor)) {
      return null;
    }

    const occupationCodeIdValue = descriptors.occupationCodeId?.value;
    const cantonCodeValue = descriptors.cantonCode?.value;
    if (
      occupationCodeIdValue !== undefined && typeof occupationCodeIdValue !== "string" ||
      cantonCodeValue !== undefined && typeof cantonCodeValue !== "string"
    ) {
      return null;
    }

    const rawOccupationCodeId = (occupationCodeIdValue as string | undefined)?.trim();
    if (
      rawOccupationCodeId &&
      (rawOccupationCodeId.length !== 36 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
          rawOccupationCodeId,
        ))
    ) {
      return null;
    }

    const rawCantonCode = (cantonCodeValue as string | undefined)?.trim();
    if (
      rawCantonCode !== undefined &&
      (!/^[a-z]{2}$/iu.test(rawCantonCode) || rawCantonCode.length > 2)
    ) {
      return null;
    }

    return Object.freeze({
      occupationCodeId: rawOccupationCodeId?.toLocaleLowerCase("de-CH"),
      cantonCode: rawCantonCode?.toLocaleUpperCase("de-CH"),
    });
  } catch {
    return null;
  }
}

function parseWindow(from: string, to: string): EffectiveWindow | null {
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime >= toTime) {
    return null;
  }
  return Object.freeze({ from: fromTime, to: toTime });
}

function parseOptionalWindow(
  occupationCode: OccupationCodeFixtureEntry,
): EffectiveWindow | null {
  const fromTime = occupationCode.effectiveFrom === null
    ? Number.NEGATIVE_INFINITY
    : Date.parse(occupationCode.effectiveFrom);
  const toTime = occupationCode.effectiveTo === null
    ? Number.POSITIVE_INFINITY
    : Date.parse(occupationCode.effectiveTo);
  if (!Number.isFinite(fromTime) && fromTime !== Number.NEGATIVE_INFINITY) {
    return null;
  }
  if (!Number.isFinite(toTime) && toTime !== Number.POSITIVE_INFINITY) {
    return null;
  }
  if (fromTime >= toTime) {
    return null;
  }
  return Object.freeze({ from: fromTime, to: toTime });
}

function isWithinWindow(at: Date, window: EffectiveWindow) {
  const instant = at.getTime();
  return instant >= window.from && instant < window.to;
}
