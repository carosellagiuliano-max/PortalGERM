import { ApplicationEffort, JobType, Language, RemoteType } from "@/lib/generated/prisma/enums";
import type { JobSearchSort } from "@/lib/search/types";

export type RawPublicSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export type PublicJobSearchInput = Readonly<{
  keyword?: string;
  cantonSlugs: readonly string[];
  citySlugs: readonly string[];
  categorySlugs: readonly string[];
  workloadMin?: number;
  workloadMax?: number;
  jobTypes: readonly JobType[];
  remoteTypes: readonly RemoteType[];
  languages: readonly Language[];
  efforts: readonly ApplicationEffort[];
  salaryMin?: number;
  salaryDisclosedOnly: boolean;
  responseEvidenceOnly: boolean;
  companyVerifiedOnly: boolean;
  sort: JobSearchSort;
  cursor?: string;
}>;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const JOB_TYPES = new Set<string>(Object.values(JobType));
const REMOTE_TYPES = new Set<string>(Object.values(RemoteType));
const LANGUAGES = new Set<string>(Object.values(Language));
const EFFORTS = new Set<string>(Object.values(ApplicationEffort));

export function parsePublicJobSearchParams(
  params: RawPublicSearchParams,
): PublicJobSearchInput {
  const workload = parseWorkload(first(params.workload));
  const salary = parsePositiveInteger(first(params.salary), 10_000_000);
  const cursor = bounded(first(params.cursor), 4_096);

  return Object.freeze({
    ...(bounded(first(params.keyword), 120) === undefined
      ? {}
      : { keyword: bounded(first(params.keyword), 120) }),
    cantonSlugs: slugList(params.canton, 26),
    citySlugs: slugList(params.city, 20),
    categorySlugs: slugList(params.category, 20),
    ...(workload === undefined
      ? {}
      : { workloadMin: workload[0], workloadMax: workload[1] }),
    jobTypes: enumList(params.jobType, JOB_TYPES, 6) as readonly JobType[],
    remoteTypes: enumList(params.remote, REMOTE_TYPES, 3) as readonly RemoteType[],
    languages: enumList(params.language, LANGUAGES, 4) as readonly Language[],
    efforts: enumList(params.effort, EFFORTS, 3) as readonly ApplicationEffort[],
    ...(salary === undefined ? {} : { salaryMin: salary }),
    salaryDisclosedOnly: first(params.salaryDisclosed) === "true",
    responseEvidenceOnly: first(params.evidence) === "response",
    companyVerifiedOnly: first(params.companyVerified) === "true",
    sort: parseSort(first(params.sort)),
    ...(cursor === undefined ? {} : { cursor }),
  });
}

export function publicJobSearchQuery(
  input: PublicJobSearchInput,
  overrides: Readonly<{ cursor?: string | null }> = {},
): string {
  const query = new URLSearchParams();
  if (input.keyword) query.set("keyword", input.keyword);
  appendAll(query, "canton", input.cantonSlugs);
  appendAll(query, "city", input.citySlugs);
  appendAll(query, "category", input.categorySlugs);
  if (input.workloadMin !== undefined && input.workloadMax !== undefined) {
    query.set("workload", `${input.workloadMin}-${input.workloadMax}`);
  }
  appendAll(query, "jobType", input.jobTypes);
  appendAll(query, "remote", input.remoteTypes);
  appendAll(query, "language", input.languages);
  appendAll(query, "effort", input.efforts);
  if (input.salaryMin !== undefined) query.set("salary", String(input.salaryMin));
  if (input.salaryDisclosedOnly) query.set("salaryDisclosed", "true");
  if (input.responseEvidenceOnly) query.set("evidence", "response");
  if (input.companyVerifiedOnly) query.set("companyVerified", "true");
  if (input.sort !== "relevance") query.set("sort", publicSortValue(input.sort));
  const cursor = overrides.cursor === undefined ? input.cursor : overrides.cursor;
  if (cursor) query.set("cursor", cursor);
  const serialized = query.toString();
  return serialized.length === 0 ? "" : `?${serialized}`;
}

function publicSortValue(sort: JobSearchSort): string {
  if (sort === "fair-score") return "fair";
  if (sort === "salary") return "salary-desc";
  return sort;
}

function parseSort(value: string | undefined): JobSearchSort {
  switch (value) {
    case "newest":
      return "newest";
    case "fair":
    case "fair-score":
      return "fair-score";
    case "salary":
    case "salary-desc":
      return "salary";
    case "response":
      return "response";
    default:
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

function bounded(value: string | undefined, maximum: number): string | undefined {
  const normalized = value?.trim().normalize("NFKC");
  return normalized && normalized.length <= maximum ? normalized : undefined;
}

function slugList(
  value: string | readonly string[] | undefined,
  maximum: number,
): readonly string[] {
  return Object.freeze(
    [...new Set(all(value).map((entry) => entry.trim().toLowerCase()))]
      .filter((entry) => entry.length <= 160 && SLUG_PATTERN.test(entry))
      .slice(0, maximum),
  );
}

function enumList(
  value: string | readonly string[] | undefined,
  allowed: ReadonlySet<string>,
  maximum: number,
): readonly string[] {
  return Object.freeze(
    [...new Set(all(value).map((entry) => entry.trim().toUpperCase()))]
      .filter((entry) => allowed.has(entry))
      .slice(0, maximum),
  );
}

function parsePositiveInteger(value: string | undefined, maximum: number) {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : undefined;
}

function parseWorkload(value: string | undefined): readonly [number, number] | undefined {
  if (!value) return undefined;
  const match = /^(\d{1,3})(?:-(\d{1,3}))?$/u.exec(value);
  if (!match) return undefined;
  const minimum = Number(match[1]);
  const maximum = Number(match[2] ?? match[1]);
  return Number.isInteger(minimum) && Number.isInteger(maximum) &&
      minimum >= 0 && minimum <= maximum && maximum <= 100
    ? Object.freeze([minimum, maximum] as const)
    : undefined;
}

function appendAll(query: URLSearchParams, key: string, values: readonly string[]) {
  for (const value of values) query.append(key, value);
}
