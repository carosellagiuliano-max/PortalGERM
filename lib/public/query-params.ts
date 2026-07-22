import {
  ApplicationEffort,
  JobType,
  Language,
  RemoteType,
  SalaryPeriod,
} from "@/lib/generated/prisma/enums";
import type { JobSearchSort } from "@/lib/search/types";

export const DEFAULT_PUBLIC_JOB_PAGE_SIZE = 20;
export const MAXIMUM_PUBLIC_JOB_PAGE_SIZE = 50;

export type RawPublicSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export type PublicJobSearchValidationField =
  | "keyword"
  | "canton"
  | "city"
  | "radius"
  | "category"
  | "workloadMin"
  | "workloadMax"
  | "jobType"
  | "remoteType"
  | "language"
  | "applicationEffort"
  | "salaryMin"
  | "salaryPeriod"
  | "salaryDisclosed"
  | "evidence"
  | "companyVerified"
  | "sort"
  | "pageSize"
  | "after";

export type PublicJobSearchValidationIssue = Readonly<{
  field: PublicJobSearchValidationField;
  code: "INVALID_VALUE" | "OUT_OF_RANGE" | "REQUIRED" | "CONFLICT";
}>;

export type PublicJobSearchInput = Readonly<{
  keyword?: string;
  cantonSlugs: readonly string[];
  citySlugs: readonly string[];
  radiusKm?: number;
  categorySlugs: readonly string[];
  workloadMin?: number;
  workloadMax?: number;
  jobTypes: readonly JobType[];
  remoteTypes: readonly RemoteType[];
  languages: readonly Language[];
  efforts: readonly ApplicationEffort[];
  salaryMin?: number;
  salaryPeriod?: SalaryPeriod;
  salaryDisclosedOnly: boolean;
  responseEvidenceOnly: boolean;
  companyVerifiedOnly: boolean;
  sort: JobSearchSort;
  pageSize: number;
  after?: string;
  validationIssues: readonly PublicJobSearchValidationIssue[];
}>;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const JOB_TYPES = new Set<string>(Object.values(JobType));
const REMOTE_TYPES = new Set<string>(Object.values(RemoteType));
const LANGUAGES = new Set<string>(Object.values(Language));
const EFFORTS = new Set<string>(Object.values(ApplicationEffort));
const SALARY_PERIODS = new Set<string>(Object.values(SalaryPeriod));

export function parsePublicJobSearchParams(
  params: RawPublicSearchParams,
): PublicJobSearchInput {
  const issues: PublicJobSearchValidationIssue[] = [];
  const keyword = parseBoundedText(first(params.keyword), 120, "keyword", issues);
  const cantonSlugs = parseSlugList(params.canton, 26, "canton", issues);
  const citySlugs = parseSlugList(params.city, 20, "city", issues);
  const radiusKm = parseOptionalInteger(
    first(preferred(params.radius, params.radiusKm)),
    1,
    200,
    "radius",
    issues,
  );
  const categorySlugs = parseSlugList(params.category, 20, "category", issues);
  const jobTypes = parseEnumList(params.jobType, JOB_TYPES, 6, "jobType", issues) as readonly JobType[];
  const remoteTypes = parseEnumList(
    preferred(params.remoteType, params.remote),
    REMOTE_TYPES,
    3,
    "remoteType",
    issues,
  ) as readonly RemoteType[];
  const languages = parseEnumList(params.language, LANGUAGES, 4, "language", issues) as readonly Language[];
  const efforts = parseEnumList(
    preferred(params.applicationEffort, params.effort),
    EFFORTS,
    3,
    "applicationEffort",
    issues,
  ) as readonly ApplicationEffort[];
  const workload = parseWorkloadRange(params, issues);
  const salaryMin = parseOptionalInteger(
    first(preferred(params.salaryMin, params.salary)),
    1,
    10_000_000,
    "salaryMin",
    issues,
  );
  const salaryPeriod = parseEnumValue(
    first(params.salaryPeriod),
    SALARY_PERIODS,
    "salaryPeriod",
    issues,
  ) as SalaryPeriod | undefined;
  const sort = parseSort(first(params.sort), issues);
  const pageSize = parsePageSize(first(params.pageSize), issues);
  const after = parseBoundedText(
    first(preferred(params.after, params.cursor)),
    4_096,
    "after",
    issues,
  );

  if ((salaryMin !== undefined || sort === "salary") && salaryPeriod === undefined &&
      !issues.some((issue) => issue.field === "salaryPeriod")) {
    issues.push(Object.freeze({ field: "salaryPeriod", code: "REQUIRED" }));
  }
  if (radiusKm !== undefined && citySlugs.length !== 1) {
    issues.push(Object.freeze({
      field: "city",
      code: citySlugs.length === 0 ? "REQUIRED" : "CONFLICT",
    }));
  }

  return Object.freeze({
    ...(keyword === undefined ? {} : { keyword }),
    cantonSlugs,
    citySlugs,
    ...(radiusKm === undefined ? {} : { radiusKm }),
    categorySlugs,
    ...workload,
    jobTypes,
    remoteTypes,
    languages,
    efforts,
    ...(salaryMin === undefined ? {} : { salaryMin }),
    ...(salaryPeriod === undefined ? {} : { salaryPeriod }),
    salaryDisclosedOnly: parseBooleanFlag(
      first(params.salaryDisclosed),
      "salaryDisclosed",
      issues,
    ),
    responseEvidenceOnly: parseEvidence(first(params.evidence), issues),
    companyVerifiedOnly: parseBooleanFlag(
      first(params.companyVerified),
      "companyVerified",
      issues,
    ),
    sort,
    pageSize,
    ...(after === undefined ? {} : { after }),
    validationIssues: Object.freeze(issues),
  });
}

export function hasBlockingPublicJobSearchIssue(input: PublicJobSearchInput): boolean {
  return input.validationIssues.some(
    (issue) => (issue.field === "salaryPeriod" &&
      (issue.code === "REQUIRED" || issue.code === "INVALID_VALUE")) ||
      issue.field === "radius" ||
      (input.radiusKm !== undefined && issue.field === "city"),
  );
}

export function publicJobSearchQuery(
  input: PublicJobSearchInput,
  overrides: Readonly<{ after?: string | null }> = {},
): string {
  const query = new URLSearchParams();
  if (input.keyword) query.set("keyword", input.keyword);
  appendAll(query, "canton", canonicalSet(input.cantonSlugs));
  appendAll(query, "city", canonicalSet(input.citySlugs));
  if (input.radiusKm !== undefined) query.set("radius", String(input.radiusKm));
  appendAll(query, "category", canonicalSet(input.categorySlugs));
  if (input.workloadMin !== undefined) query.set("workloadMin", String(input.workloadMin));
  if (input.workloadMax !== undefined) query.set("workloadMax", String(input.workloadMax));
  appendAll(query, "jobType", canonicalSet(input.jobTypes));
  appendAll(query, "remoteType", canonicalSet(input.remoteTypes));
  appendAll(query, "language", canonicalSet(input.languages));
  appendAll(query, "applicationEffort", canonicalSet(input.efforts));
  if (input.salaryMin !== undefined) query.set("salaryMin", String(input.salaryMin));
  if (input.salaryPeriod !== undefined) query.set("salaryPeriod", input.salaryPeriod);
  if (input.salaryDisclosedOnly) query.set("salaryDisclosed", "true");
  if (input.responseEvidenceOnly) query.set("evidence", "response");
  if (input.companyVerifiedOnly) query.set("companyVerified", "true");
  if (input.sort !== "relevance") query.set("sort", publicSortValue(input.sort));
  if (input.pageSize !== DEFAULT_PUBLIC_JOB_PAGE_SIZE) {
    query.set("pageSize", String(input.pageSize));
  }
  const after = overrides.after === undefined ? input.after : overrides.after;
  if (after) query.set("after", after);
  const serialized = query.toString();
  return serialized.length === 0 ? "" : `?${serialized}`;
}

function publicSortValue(sort: JobSearchSort): string {
  if (sort === "fair-score") return "fairjobscore";
  return sort;
}

function parseSort(
  value: string | undefined,
  issues: PublicJobSearchValidationIssue[],
): JobSearchSort {
  switch (value?.trim().toLowerCase()) {
    case undefined:
    case "":
    case "relevance":
      return "relevance";
    case "newest":
      return "newest";
    case "fairjobscore":
    case "fair":
    case "fair-score":
      return "fair-score";
    case "salary":
    case "salary-desc":
      return "salary";
    case "response":
      return "response";
    default:
      issues.push(Object.freeze({ field: "sort", code: "INVALID_VALUE" }));
      return "relevance";
  }
}

function first(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function all(value: string | readonly string[] | undefined): readonly string[] {
  const values = typeof value === "string" ? [value] : value ?? [];
  return values.flatMap((entry) => entry.split(","));
}

function preferred(
  canonical: string | readonly string[] | undefined,
  alias: string | readonly string[] | undefined,
): string | readonly string[] | undefined {
  return canonical === undefined ? alias : canonical;
}

function parseBoundedText(
  value: string | undefined,
  maximum: number,
  field: PublicJobSearchValidationField,
  issues: PublicJobSearchValidationIssue[],
): string | undefined {
  const normalized = value?.trim().normalize("NFKC");
  if (!normalized) return undefined;
  if (normalized.length <= maximum) return normalized;
  issues.push(Object.freeze({ field, code: "OUT_OF_RANGE" }));
  return undefined;
}

function parseSlugList(
  value: string | readonly string[] | undefined,
  maximum: number,
  field: PublicJobSearchValidationField,
  issues: PublicJobSearchValidationIssue[],
): readonly string[] {
  const raw = all(value).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const valid = [...new Set(raw.filter(
    (entry) => entry.length <= 160 && SLUG_PATTERN.test(entry),
  ))];
  if (valid.length !== new Set(raw).size) {
    issues.push(Object.freeze({ field, code: "INVALID_VALUE" }));
  }
  if (valid.length > maximum) {
    issues.push(Object.freeze({ field, code: "OUT_OF_RANGE" }));
  }
  return Object.freeze(valid.slice(0, maximum));
}

function parseEnumList(
  value: string | readonly string[] | undefined,
  allowed: ReadonlySet<string>,
  maximum: number,
  field: PublicJobSearchValidationField,
  issues: PublicJobSearchValidationIssue[],
): readonly string[] {
  const raw = all(value).map((entry) => entry.trim().toUpperCase()).filter(Boolean);
  const valid = [...new Set(raw.filter((entry) => allowed.has(entry)))];
  if (valid.length !== new Set(raw).size) {
    issues.push(Object.freeze({ field, code: "INVALID_VALUE" }));
  }
  if (valid.length > maximum) {
    issues.push(Object.freeze({ field, code: "OUT_OF_RANGE" }));
  }
  return Object.freeze(valid.slice(0, maximum));
}

function parseEnumValue(
  value: string | undefined,
  allowed: ReadonlySet<string>,
  field: PublicJobSearchValidationField,
  issues: PublicJobSearchValidationIssue[],
): string | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  if (allowed.has(normalized)) return normalized;
  issues.push(Object.freeze({ field, code: "INVALID_VALUE" }));
  return undefined;
}

function parseOptionalInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  field: PublicJobSearchValidationField,
  issues: PublicJobSearchValidationIssue[],
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (!/^\d+$/u.test(value.trim())) {
    issues.push(Object.freeze({ field, code: "INVALID_VALUE" }));
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    issues.push(Object.freeze({ field, code: "OUT_OF_RANGE" }));
    return undefined;
  }
  return parsed;
}

function parseWorkloadRange(
  params: RawPublicSearchParams,
  issues: PublicJobSearchValidationIssue[],
): Readonly<{ workloadMin?: number; workloadMax?: number }> {
  const hasCanonical = params.workloadMin !== undefined || params.workloadMax !== undefined;
  if (!hasCanonical) {
    const legacy = first(params.workload)?.trim();
    if (!legacy) return {};
    const match = /^(\d{1,3})(?:-(\d{1,3}))?$/u.exec(legacy);
    if (!match) {
      issues.push(Object.freeze({ field: "workloadMin", code: "INVALID_VALUE" }));
      return {};
    }
    const minimum = Number(match[1]);
    const maximum = Number(match[2] ?? match[1]);
    if (minimum > maximum) {
      issues.push(Object.freeze({ field: "workloadMin", code: "CONFLICT" }));
      return {};
    }
    if (minimum < 0 || maximum > 100) {
      issues.push(Object.freeze({ field: "workloadMin", code: "OUT_OF_RANGE" }));
      return {};
    }
    return { workloadMin: minimum, workloadMax: maximum };
  }

  const minimum = parseOptionalInteger(
    first(params.workloadMin),
    0,
    100,
    "workloadMin",
    issues,
  );
  const maximum = parseOptionalInteger(
    first(params.workloadMax),
    0,
    100,
    "workloadMax",
    issues,
  );
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    issues.push(Object.freeze({ field: "workloadMin", code: "CONFLICT" }));
    return {};
  }
  return {
    ...(minimum === undefined ? {} : { workloadMin: minimum }),
    ...(maximum === undefined ? {} : { workloadMax: maximum }),
  };
}

function parsePageSize(
  value: string | undefined,
  issues: PublicJobSearchValidationIssue[],
): number {
  return parseOptionalInteger(
    value,
    1,
    MAXIMUM_PUBLIC_JOB_PAGE_SIZE,
    "pageSize",
    issues,
  ) ?? DEFAULT_PUBLIC_JOB_PAGE_SIZE;
}

function parseBooleanFlag(
  value: string | undefined,
  field: PublicJobSearchValidationField,
  issues: PublicJobSearchValidationIssue[],
): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  issues.push(Object.freeze({ field, code: "INVALID_VALUE" }));
  return false;
}

function parseEvidence(
  value: string | undefined,
  issues: PublicJobSearchValidationIssue[],
): boolean {
  if (value === undefined || value === "") return false;
  if (value === "response") return true;
  issues.push(Object.freeze({ field: "evidence", code: "INVALID_VALUE" }));
  return false;
}

function appendAll(query: URLSearchParams, key: string, values: readonly string[]) {
  for (const value of values) query.append(key, value);
}

function canonicalSet(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}
