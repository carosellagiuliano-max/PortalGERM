import {
  publicJobSearchQuery,
  type PublicJobSearchInput,
  type RawPublicSearchParams,
} from "@/lib/public/query-params";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ALLOWED_RAW_KEYS = new Set([
  "keyword", "canton", "city", "radius", "category", "workloadMin", "workloadMax",
  "workload", "jobType", "remoteType", "remote", "language",
  "applicationEffort", "effort", "salaryMin", "salary", "salaryPeriod",
  "salaryDisclosed", "evidence", "companyVerified", "sort", "pageSize",
  "after", "cursor",
]);

export type ExactClusterFilter =
  | Readonly<{ kind: "canton"; cantonSlug: string }>
  | Readonly<{ kind: "category"; categorySlug: string }>
  | Readonly<{
      kind: "pair";
      cantonSlug: string;
      categorySlug: string;
    }>;

/**
 * Only a clean, canonical Canton/Category filter may become a landing-page
 * redirect. Allowlisted empty/default/duplicate controls are normalized away;
 * unknown keys and every substantive extra search state deliberately remain
 * on `/jobs` and are noindexed there.
 */
export function exactClusterFilterFromSearch(
  raw: RawPublicSearchParams,
  input: PublicJobSearchInput,
): ExactClusterFilter | null {
  const presentEntries = Object.entries(raw).filter(([, value]) => value !== undefined);
  if (
    presentEntries.some(([key]) => !ALLOWED_RAW_KEYS.has(key)) ||
    input.validationIssues.length > 0
  ) {
    return null;
  }

  const normalized = new URLSearchParams(
    publicJobSearchQuery(input, { after: null }).replace(/^\?/u, ""),
  );
  if ([...normalized.keys()].some((key) => key !== "canton" && key !== "category")) {
    return null;
  }
  const cantonValues = normalized.getAll("canton");
  const categoryValues = normalized.getAll("category");
  if (cantonValues.length > 1 || categoryValues.length > 1) return null;
  const canton = cleanSingleSlug(cantonValues[0]);
  const category = cleanSingleSlug(categoryValues[0]);

  if (canton !== undefined && category !== undefined) {
    return Object.freeze({ kind: "pair", cantonSlug: canton, categorySlug: category });
  }
  if (canton !== undefined) return Object.freeze({ kind: "canton", cantonSlug: canton });
  if (category !== undefined) {
    return Object.freeze({ kind: "category", categorySlug: category });
  }
  return null;
}

export function hasRawPublicJobQueryState(raw: RawPublicSearchParams): boolean {
  return Object.values(raw).some((value) => value !== undefined);
}

function cleanSingleSlug(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return SLUG_PATTERN.test(normalized) ? normalized : undefined;
}
