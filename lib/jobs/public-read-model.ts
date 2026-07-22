import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/lib/generated/prisma/client";
import { ANALYTICS_MINIMUM_COHORT_SIZE_V1 } from "@/lib/analytics/metric-contracts";
import { EMPLOYER_RESPONSE_POLICY_V1 } from "@/lib/analytics/response-policy-v1";
import { jobHasActiveBoost } from "@/lib/billing/boosts";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  evaluatePublicJobEligibility,
  type PublicEligibilityEnvironment,
  type PublicEligibilitySnapshot,
} from "@/lib/jobs/public-eligibility";
import { getPublicDataContext } from "@/lib/public/environment";
import {
  DEFAULT_PUBLIC_JOB_PAGE_SIZE,
  hasBlockingPublicJobSearchIssue,
  type PublicJobSearchInput,
} from "@/lib/public/query-params";
import type {
  PublicCatalog,
  PublicClusterLink,
  PublicJobCardModel,
  PublicJobDetailModel,
  PublicJobSearchPage,
  PublicResponseEvidence,
} from "@/lib/public/types";
import { decodeSearchCursor, encodeSearchCursor } from "@/lib/search/cursor";
import {
  calculateRelevanceProxy,
  normalizedSearchTerms,
} from "@/lib/search/relevance";
import {
  paginateSearchJobs,
  rankSearchJobs,
} from "@/lib/search/ranking";
import { projectCanonicalResponseMedianMinutes } from "@/lib/search/response-evidence";
import type {
  JobSearchSort,
  OrganicCursorTuple,
  RankingCandidate,
} from "@/lib/search/types";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

/** Bound used only by non-paginated supporting surfaces such as Company cards. */
const MAXIMUM_BOUNDED_JOB_CANDIDATES = 2_000;
const EXACT_COUNT_SCAN_BATCH_SIZE = 500;
const EXACT_COUNT_TRANSACTION_TIMEOUT_MS = 30_000;
const RESPONSE_COMPANY_BATCH_SIZE = 100;
const MAXIMUM_SEARCH_PAGE_SIZE = 50;
const MAXIMUM_SPONSORED_SEARCH_RESULTS = 3;
const MAXIMUM_SEARCH_PAGE_HYDRATION =
  MAXIMUM_SEARCH_PAGE_SIZE + 1 + MAXIMUM_SPONSORED_SEARCH_RESULTS;
const DAY_MS = 86_400_000;
const SEARCH_COMBINING_MARK_PATTERN = "[\u0300-\u036f]";
const UUID_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type PublicSearchRankingFailureCode =
  | "COUNT_OVERFLOW"
  | "DATABASE_RESULT_BOUND_EXCEEDED"
  | "DUPLICATE_RANKED_JOB"
  | "HYDRATION_MISMATCH"
  | "RANKING_PROJECTION_DRIFT"
  | "RESPONSE_PROJECTION_CHANGED";

/**
 * Typed fail-closed boundary for the SQL ranking/card projection contract.
 * Callers must never silently serve a partial or differently ordered page.
 */
export class PublicSearchRankingContractError extends Error {
  readonly code: PublicSearchRankingFailureCode;

  constructor(code: PublicSearchRankingFailureCode, message: string) {
    super(message);
    this.name = "PublicSearchRankingContractError";
    this.code = code;
  }
}

export const PUBLIC_CLUSTER_DISCOVERY_POLICY_V1 = Object.freeze({
  version: "v1",
  minimumEligibleJobs: 3,
  indexable: false,
  promotedCantonCodes: Object.freeze(["ZH", "AG", "BE"] as const),
  promotedCategorySlugs: Object.freeze([
    "gesundheit-pflege",
    "engineering-technik",
  ] as const),
});

const PROMOTED_CANTON_CODES = new Set<string>(
  PUBLIC_CLUSTER_DISCOVERY_POLICY_V1.promotedCantonCodes,
);
const PROMOTED_CATEGORY_SLUGS = new Set<string>(
  PUBLIC_CLUSTER_DISCOVERY_POLICY_V1.promotedCategorySlugs,
);

const PUBLIC_JOB_ELIGIBILITY_SELECT = {
  id: true,
  slug: true,
  companyId: true,
  status: true,
  dataProvenance: true,
  currentRevisionId: true,
  publishedRevisionId: true,
  publishedAt: true,
  expiresAt: true,
  company: {
    select: {
      name: true,
      status: true,
      dataProvenance: true,
      verificationRequests: {
        where: { status: "VERIFIED", supersededBy: null },
        select: { id: true },
        take: 2,
      },
    },
  },
  publishedRevision: {
    select: {
      id: true,
      title: true,
      description: true,
      categoryId: true,
      category: { select: { isActive: true } },
      cantonId: true,
      cityId: true,
      salaryPeriod: true,
      salaryMin: true,
      salaryMax: true,
      responseTargetDays: true,
      remoteType: true,
      jobType: true,
      workloadMin: true,
      workloadMax: true,
      validThrough: true,
      approvedAt: true,
      rejectedAt: true,
      scoreSnapshots: {
        where: { scoreVersion: "v2" },
        select: { scorePoints: true },
        take: 2,
      },
    },
  },
} as const satisfies Prisma.JobSelect;

const PUBLIC_JOB_CARD_BASE_SELECT = {
  ...PUBLIC_JOB_ELIGIBILITY_SELECT,
  company: {
    select: {
      ...PUBLIC_JOB_ELIGIBILITY_SELECT.company.select,
      id: true,
      slug: true,
      responseTargetDays: true,
      responseSampleSize: true,
      responseWithinTargetBps: true,
    },
  },
  publishedRevision: {
    select: {
      ...PUBLIC_JOB_ELIGIBILITY_SELECT.publishedRevision.select,
      contentLanguage: true,
      category: { select: { id: true, name: true, slug: true, isActive: true } },
      canton: { select: { id: true, code: true, name: true, slug: true } },
      city: { select: { id: true, name: true, slug: true } },
      locationLabel: true,
      applicationEffort: true,
    },
  },
} as const satisfies Prisma.JobSelect;

function buildPublicJobCardSelect(now: Date) {
  return {
    ...PUBLIC_JOB_CARD_BASE_SELECT,
    boosts: {
      where: {
        status: { not: "CANCELLED" as const },
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: [{ startsAt: "desc" as const }, { id: "asc" as const }],
      take: 1,
      select: {
        companyId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        cancelledAt: true,
      },
    },
  } as const satisfies Prisma.JobSelect;
}

function buildPublicJobSearchSelect(now: Date) {
  const cardSelect = buildPublicJobCardSelect(now);
  return {
    ...cardSelect,
    publishedRevision: {
      select: {
        ...cardSelect.publishedRevision.select,
        tasks: true,
        requirements: true,
        offer: true,
      },
    },
  } as const satisfies Prisma.JobSelect;
}

const PUBLIC_JOB_CLUSTER_SELECT = {
  ...PUBLIC_JOB_ELIGIBILITY_SELECT,
  publishedRevision: {
    select: {
      ...PUBLIC_JOB_ELIGIBILITY_SELECT.publishedRevision.select,
      category: { select: { id: true, name: true, slug: true, isActive: true } },
      canton: { select: { id: true, code: true, name: true, slug: true } },
    },
  },
} as const satisfies Prisma.JobSelect;

const PUBLIC_JOB_DETAIL_EXTRAS_SELECT = {
  id: true,
  companyIntro: true,
  tasks: true,
  requirements: true,
  niceToHave: true,
  offer: true,
  applicationProcessSteps: true,
  requiredDocumentKinds: true,
  remoteCountryCode: true,
  startDate: true,
  startByArrangement: true,
  inclusionStatement: true,
  applicationContactKind: true,
  applicationContactValue: true,
  benefits: {
    orderBy: { sortOrder: "asc" },
    select: { benefitCode: true, description: true },
  },
  skills: {
    orderBy: { id: "asc" },
    select: {
      required: true,
      skill: { select: { id: true, name: true, slug: true } },
    },
  },
  languages: {
    orderBy: { code: "asc" },
    select: { code: true, minLevel: true },
  },
  scoreSnapshots: {
    where: { scoreVersion: "v2" },
    select: { factorBreakdown: true },
    take: 2,
  },
} as const satisfies Prisma.JobRevisionSelect;

function buildPublicJobDetailSelect(now: Date) {
  const cardSelect = buildPublicJobCardSelect(now);
  return {
    ...cardSelect,
    company: {
      select: {
        ...cardSelect.company.select,
        website: true,
      },
    },
    publishedRevision: {
      select: {
        ...cardSelect.publishedRevision.select,
        ...PUBLIC_JOB_DETAIL_EXTRAS_SELECT,
        scoreSnapshots: {
          where: { scoreVersion: "v2" },
          select: { scoreVersion: true, scorePoints: true, factorBreakdown: true },
          take: 2,
        },
      },
    },
  } as const satisfies Prisma.JobSelect;
}

type PublicJobEligibilityRow = Prisma.JobGetPayload<{
  select: typeof PUBLIC_JOB_ELIGIBILITY_SELECT;
}>;
type PublicJobRow = Prisma.JobGetPayload<{
  select: ReturnType<typeof buildPublicJobCardSelect>;
}>;
type PublicJobClusterRow = Prisma.JobGetPayload<{
  select: typeof PUBLIC_JOB_CLUSTER_SELECT;
}>;
type PublicJobDetailRow = Prisma.JobGetPayload<{
  select: ReturnType<typeof buildPublicJobDetailSelect>;
}>;
type EligibleRow<Row extends PublicJobEligibilityRow> = Row & Readonly<{
  publishedRevision: NonNullable<Row["publishedRevision"]>;
}>;
type EligiblePublicJobRow = EligibleRow<PublicJobRow>;
type EligiblePublicJobClusterRow = EligibleRow<PublicJobClusterRow>;
type EligiblePublicJobDetailRow = EligibleRow<PublicJobDetailRow>;
type PublicJobClusterCanton = NonNullable<
  EligiblePublicJobClusterRow["publishedRevision"]["canton"]
>;
type PublicJobClusterCategory =
  EligiblePublicJobClusterRow["publishedRevision"]["category"];
type ClusterCount<Value> = { value: Value; count: number };
type PublicReadTransaction = Parameters<
  Parameters<DatabaseClient["$transaction"]>[0]
>[0];

type PublicJobLoadScope = Readonly<{
  slug?: string;
  companyId?: string;
  companyIds?: readonly string[];
  publishedCategoryIds?: readonly string[];
  publishedCantonIds?: readonly string[];
  publishedCityIds?: readonly string[];
  take?: number;
  publishedAtUpperBound?: Date;
}>;

type LoadedJobs = Readonly<{
  rows: readonly EligiblePublicJobRow[];
  rowById: ReadonlyMap<string, EligiblePublicJobRow>;
  candidates: readonly RankingCandidate[];
  candidateSetTruncated: boolean;
}>;

type LoadedSearchPage = Readonly<{
  rows: readonly EligiblePublicJobRow[];
  rowById: ReadonlyMap<string, EligiblePublicJobRow>;
  page: ReturnType<typeof paginateSearchJobs> & Readonly<{ totalEligible: number }>;
}>;

type DatabaseRankingRow = Readonly<{
  id: string;
  relevanceTier: number;
  relevanceScore: number;
  fairScore: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  responseEvidenceKnown: boolean;
  onTimeRateBps: number | null;
  medianFirstResponseMinutes: number | null;
  publishedAt: Date;
  activeBoost: boolean;
}>;

type DatabaseSponsoredEnvelopeRow = Readonly<{
  id: string | null;
  relevanceTier: number | null;
  relevanceScore: number | null;
  fairScore: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  responseEvidenceKnown: boolean | null;
  onTimeRateBps: number | null;
  medianFirstResponseMinutes: number | null;
  publishedAt: Date | null;
  activeBoost: boolean | null;
  totalEligible: bigint | number | string;
  responseProjectionFingerprint: string;
}>;

type RadiusCenter = Readonly<{
  latitude: number;
  longitude: number;
  radiusKm: number;
}>;

type PublishedProjectionFilters = Readonly<{
  categoryIds: readonly string[];
  cantonIds: readonly string[];
  cityIds: readonly string[];
}>;

type DatabaseSearchQueryContext = Readonly<{
  input: PublicJobSearchInput;
  now: Date;
  rankingAsOf: Date;
  liveOnly: boolean;
  projectionFilters: PublishedProjectionFilters;
  radiusCenter: RadiusCenter | null | undefined;
}>;

type BoundedEligibleRows<Row extends PublicJobEligibilityRow> = Readonly<{
  rows: readonly EligibleRow<Row>[];
  candidateSetTruncated: boolean;
}>;

export function emptyPublicJobSearchInput(): PublicJobSearchInput {
  return Object.freeze({
    cantonSlugs: Object.freeze([]),
    citySlugs: Object.freeze([]),
    categorySlugs: Object.freeze([]),
    jobTypes: Object.freeze([]),
    remoteTypes: Object.freeze([]),
    languages: Object.freeze([]),
    efforts: Object.freeze([]),
    salaryDisclosedOnly: false,
    responseEvidenceOnly: false,
    companyVerifiedOnly: false,
    sort: "relevance",
    pageSize: DEFAULT_PUBLIC_JOB_PAGE_SIZE,
    validationIssues: Object.freeze([]),
  });
}

export async function listPublicJobs(
  input: PublicJobSearchInput,
  options: Readonly<{ pageSize?: number; now?: Date }> = {},
): Promise<PublicJobSearchPage> {
  const pageSize = options.pageSize ?? input.pageSize;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new RangeError("Public job page size must be between 1 and 50.");
  }
  if (hasBlockingPublicJobSearchIssue(input) ||
      ((input.salaryMin !== undefined || input.sort === "salary") &&
        input.salaryPeriod === undefined)) {
    return emptyPublicJobSearchPage();
  }
  const now = validNow(options.now);
  const queryHash = createPublicSearchQueryHash(input);
  const decoded = input.after
    ? withCursorSecret((secret) =>
        decodeSearchCursor(input.after as string, {
          queryHash,
          sort: input.sort,
          secret,
        }),
      )
    : undefined;
  let invalidCursor = input.after !== undefined && decoded === null;
  const rankingAsOf = decoded === undefined || decoded === null
    ? now
    : new Date(decoded.rankingAsOf);
  let loaded: LoadedSearchPage;
  try {
    loaded = await loadExactSearchPage(input, now, {
      pageSize,
      queryHash,
      rankingAsOf,
      ...(decoded === undefined || decoded === null ? {} : { cursor: decoded }),
    });
  } catch (error) {
    if (!(error instanceof PublicSearchRankingContractError) ||
        error.code !== "RESPONSE_PROJECTION_CHANGED" ||
        input.sort !== "response" || decoded === undefined || decoded === null) {
      throw error;
    }
    // Response projections are mutable unlike revision-owned ranking fields.
    // A signed fingerprint mismatch safely restarts instead of serving a page
    // with possible duplicates or gaps under a stale response tuple.
    invalidCursor = true;
    loaded = await loadExactSearchPage(input, now, {
      pageSize,
      queryHash,
      rankingAsOf: now,
    });
  }
  const page = loaded.page;
  const jobs = page.ranked.flatMap((entry) => {
    const row = loaded.rowById.get(entry.job.id);
    return row === undefined
      ? []
      : [toCardModel(row, now, entry.sponsored)];
  });
  return Object.freeze({
    jobs: Object.freeze(jobs),
    nextCursor:
      page.nextCursorPayload === null
        ? null
        : withCursorSecret((secret) =>
            encodeSearchCursor(page.nextCursorPayload!, secret),
          ),
    totalEligible: page.totalEligible,
    resultCountIsExact: true,
    candidateSetTruncated: false,
    invalidCursor,
  });
}

function emptyPublicJobSearchPage(): PublicJobSearchPage {
  return Object.freeze({
    jobs: Object.freeze([]),
    nextCursor: null,
    totalEligible: 0,
    resultCountIsExact: true,
    candidateSetTruncated: false,
    invalidCursor: false,
  });
}

export async function listHomepageJobs(
  options: Readonly<{ limit?: number; now?: Date }> = {},
): Promise<readonly PublicJobCardModel[]> {
  const now = validNow(options.now);
  const limit = Math.max(1, Math.min(12, options.limit ?? 6));
  const input = emptyPublicJobSearchInput();
  const loaded = await loadEligibleJobs(input, now);
  const ranked = rankSearchJobs({
    candidates: loaded.candidates,
    sort: "relevance",
    hasQuery: false,
    firstPage: true,
    sponsoredLimit: Math.min(2, limit),
  }).ranked.slice(0, limit);

  return Object.freeze(
    ranked.flatMap((entry) => {
      const row = loaded.rowById.get(entry.job.id);
      return row === undefined ? [] : [toCardModel(row, now, entry.sponsored)];
    }),
  );
}

export async function getPublicJobBySlug(
  slug: string,
  options: Readonly<{ now?: Date }> = {},
): Promise<PublicJobDetailModel | null> {
  if (!isSafeSlug(slug)) return null;
  const now = validNow(options.now);
  const row = await loadEligibleDetailJob(slug, now);
  return row === null ? null : toDetailModel(row, now);
}

export async function listRelatedPublicJobs(
  job: Pick<PublicJobDetailModel, "id" | "category" | "canton">,
  options: Readonly<{ limit?: number; now?: Date }> = {},
): Promise<readonly PublicJobCardModel[]> {
  const page = await listPublicJobs(
    Object.freeze({
      ...emptyPublicJobSearchInput(),
      categorySlugs: Object.freeze([job.category.slug]),
      cantonSlugs: job.canton === null
        ? Object.freeze([])
        : Object.freeze([job.canton.slug]),
      sort: "newest",
    }),
    { pageSize: Math.min(12, (options.limit ?? 4) + 1), now: options.now },
  );
  return Object.freeze(
    page.jobs.filter((candidate) => candidate.id !== job.id).slice(0, options.limit ?? 4),
  );
}

export async function listPublicJobsForCompany(
  companyId: string,
  options: Readonly<{ limit?: number; now?: Date }> = {},
): Promise<readonly PublicJobCardModel[]> {
  const now = validNow(options.now);
  const loaded = await loadEligibleJobs(emptyPublicJobSearchInput(), now, {
    companyId,
    take: Math.max(1, Math.min(100, options.limit ?? 100)),
  });
  return Object.freeze(loaded.rows.map((row) => toCardModel(row, now, false)));
}

/** Batch adapter for the Company directory; all counts reuse this module's one eligibility query. */
export async function loadPublicOpenJobCounts(
  companyIds: readonly string[],
  options: Readonly<{ now: Date }>,
): Promise<ReadonlyMap<string, number>> {
  const ids = [...new Set(companyIds)]
    .filter((id) => id.length <= 100 && /^[0-9a-f-]+$/iu.test(id))
    .slice(0, 100);
  const result = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return result;
  const now = validNow(options.now);
  const database = getDatabase();
  const dataContext = getPublicDataContext();
  const input = emptyPublicJobSearchInput();
  await scanEligibleRowsInSnapshot<PublicJobEligibilityRow>(
    database,
    now,
    dataContext.eligibilityEnvironment,
    (transaction, afterId) => transaction.job.findMany({
      where: {
        ...buildPublicJobWhere(input, now, dataContext.liveOnly, {
          companyIds: ids,
        }),
        ...(afterId === undefined ? {} : { id: { gt: afterId } }),
      },
      orderBy: { id: "asc" },
      take: EXACT_COUNT_SCAN_BATCH_SIZE,
      select: PUBLIC_JOB_ELIGIBILITY_SELECT,
    }),
    (rows) => {
      for (const row of rows) {
        result.set(row.companyId, (result.get(row.companyId) ?? 0) + 1);
      }
    },
  );
  return result;
}

export async function getPublicCatalog(): Promise<PublicCatalog> {
  const database = getDatabase();
  const [cantons, cities, categories] = await Promise.all([
    database.canton.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, slug: true },
    }),
    database.city.findMany({
      where: { isActive: true, canton: { isActive: true } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, slug: true, cantonId: true },
    }),
    database.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true },
    }),
  ]);
  return Object.freeze({
    cantons: Object.freeze(cantons),
    cities: Object.freeze(cities),
    categories: Object.freeze(categories),
  });
}

export async function listPublicClusterLinks(
  options: Readonly<{ limit?: number; now?: Date }> = {},
): Promise<readonly PublicClusterLink[]> {
  const now = validNow(options.now);
  const { cantonCounts, categoryCounts } = await loadExactPublicClusterCounts(now);
  const links: PublicClusterLink[] = [
    ...[...cantonCounts.values()].map(({ value, count }) => ({
      kind: "canton" as const,
      slug: value.slug,
      label: value.name,
      count,
      launchable: count >= PUBLIC_CLUSTER_DISCOVERY_POLICY_V1.minimumEligibleJobs,
    })),
    ...[...categoryCounts.values()].map(({ value, count }) => ({
      kind: "category" as const,
      slug: value.slug,
      label: value.name,
      count,
      launchable: count >= PUBLIC_CLUSTER_DISCOVERY_POLICY_V1.minimumEligibleJobs,
    })),
  ];
  return Object.freeze(
    links
      .filter((link) => link.launchable)
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "de-CH"))
      .slice(0, options.limit ?? 12),
  );
}

/**
 * ADR-003 global ranking path. PostgreSQL selects the complete ranking tuple
 * before LIMIT: one bounded sponsor query (also carrying the exact count and
 * response-projection fingerprint), then one organic keyset query with only
 * pageSize+1 IDs. At most 54 card rows cross the database boundary.
 */
async function loadExactSearchPage(
  input: PublicJobSearchInput,
  now: Date,
  pagination: Readonly<{
    pageSize: number;
    queryHash: string;
    rankingAsOf: Date;
    cursor?: NonNullable<ReturnType<typeof decodeSearchCursor>>;
  }>,
): Promise<LoadedSearchPage> {
  const database = getDatabase();
  const dataContext = getPublicDataContext();
  return database.$transaction(
    async (transaction) => {
      const projectionFilters = await resolvePublishedProjectionFilters(
        transaction,
        input,
      );
      if (projectionFilters === null) {
        return emptyLoadedSearchPage(input, pagination);
      }
      const radiusCenter = input.radiusKm === undefined
        ? undefined
        : await resolveRadiusCenter(
            transaction,
            input,
            projectionFilters.cityIds,
          );
      if (input.radiusKm !== undefined && radiusCenter === null) {
        return emptyLoadedSearchPage(input, pagination);
      }

      const queryContext = Object.freeze({
        input,
        now,
        rankingAsOf: pagination.rankingAsOf,
        liveOnly: dataContext.liveOnly,
        projectionFilters,
        radiusCenter,
      });
      const firstPage = pagination.cursor === undefined;
      const sponsorEnvelope = await loadDatabaseSponsoredRankingEnvelope(
        transaction,
        queryContext,
        firstPage
          ? Math.min(pagination.pageSize, MAXIMUM_SPONSORED_SEARCH_RESULTS)
          : 0,
      );
      const totalEligible = exactSearchCount(sponsorEnvelope);
      const responseProjectionFingerprint =
        sponsorEnvelope[0]?.responseProjectionFingerprint ?? "";
      if (input.sort === "response" && pagination.cursor !== undefined &&
          pagination.cursor.responseProjectionFingerprint !==
            responseProjectionFingerprint) {
        throw new PublicSearchRankingContractError(
          "RESPONSE_PROJECTION_CHANGED",
          "Employer response evidence changed during cursor pagination.",
        );
      }
      const sponsoredRows = firstPage
        ? sponsorEnvelope.flatMap(toSponsoredRankingRow)
        : [];
      if (sponsoredRows.length > Math.min(
        pagination.pageSize,
        MAXIMUM_SPONSORED_SEARCH_RESULTS,
      )) {
        throw new PublicSearchRankingContractError(
          "DATABASE_RESULT_BOUND_EXCEEDED",
          "The sponsored ranking query exceeded its formal result bound.",
        );
      }
      const selectedSponsoredIds = firstPage
        ? sponsoredRows.map(({ id }) => id)
        : [...new Set(pagination.cursor?.sponsoredIds ?? [])];
      const organicRows = await loadDatabaseOrganicRankingRows(
        transaction,
        queryContext,
        pagination.cursor?.organicTuple ?? null,
        selectedSponsoredIds,
        pagination.pageSize + 1,
      );
      if (organicRows.length > pagination.pageSize + 1) {
        throw new PublicSearchRankingContractError(
          "DATABASE_RESULT_BOUND_EXCEEDED",
          "The organic ranking query exceeded pageSize+1.",
        );
      }
      const rankingRows = [...sponsoredRows, ...organicRows];
      const rankedIds = rankingRows.map(({ id }) => id);
      const uniqueIds = [...new Set(rankedIds)];
      if (uniqueIds.length !== rankedIds.length) {
        throw new PublicSearchRankingContractError(
          "DUPLICATE_RANKED_JOB",
          "A database-ranked Job appeared in both ranking zones.",
        );
      }
      if (uniqueIds.length > MAXIMUM_SEARCH_PAGE_HYDRATION) {
        throw new PublicSearchRankingContractError(
          "DATABASE_RESULT_BOUND_EXCEEDED",
          "The search card hydration bound was exceeded.",
        );
      }

      const hydrated = uniqueIds.length === 0
        ? []
        : await transaction.job.findMany({
            where: {
              ...buildPublicJobWhere(input, now, dataContext.liveOnly, {
                publishedAtUpperBound: pagination.rankingAsOf,
                ...(projectionFilters.categoryIds.length === 0
                  ? {}
                  : { publishedCategoryIds: projectionFilters.categoryIds }),
                ...(projectionFilters.cantonIds.length === 0
                  ? {}
                  : { publishedCantonIds: projectionFilters.cantonIds }),
                ...(projectionFilters.cityIds.length === 0
                  ? {}
                  : { publishedCityIds: projectionFilters.cityIds }),
              }),
              id: { in: uniqueIds },
            },
            orderBy: { id: "asc" },
            take: uniqueIds.length,
            select: buildPublicJobCardSelect(now),
          });
      const eligibleRows = await filterEligibleRows(
        hydrated,
        now,
        dataContext.eligibilityEnvironment,
        transaction,
      );
      if (eligibleRows.length !== uniqueIds.length) {
        throw new PublicSearchRankingContractError(
          "HYDRATION_MISMATCH",
          "The SQL ranking eligibility contract disagreed with the canonical evaluator.",
        );
      }
      const rowById = new Map(eligibleRows.map((row) => [row.id, row]));
      const responseMedianByCompany = new Map<string, number | null>();
      if (input.sort === "response") {
        await loadCanonicalResponseMedians(
          transaction,
          eligibleRows,
          pagination.rankingAsOf,
          responseMedianByCompany,
        );
      }
      const candidates = rankingRows.map((rankingRow) => {
        const row = rowById.get(rankingRow.id);
        if (row === undefined) {
          throw new PublicSearchRankingContractError(
            "HYDRATION_MISMATCH",
            "A database-ranked Job was not hydrated.",
          );
        }
        return toDatabaseRankingCandidate(
          row,
          rankingRow,
          now,
          responseMedianByCompany,
        );
      });
      const paginated = paginateSearchJobs({
        candidates,
        sort: input.sort,
        hasQuery: Boolean(input.keyword),
        pageSize: pagination.pageSize,
        queryHash: pagination.queryHash,
        rankingAsOf: pagination.rankingAsOf,
        ...(pagination.cursor === undefined ? {} : { cursor: pagination.cursor }),
      });
      const expectedIds = (firstPage
        ? [...sponsoredRows, ...organicRows]
        : organicRows)
        .slice(0, pagination.pageSize)
        .map(({ id }) => id);
      const actualIds = paginated.ranked.map(({ job }) => job.id);
      if (!sameStringSequence(expectedIds, actualIds)) {
        throw new PublicSearchRankingContractError(
          "RANKING_PROJECTION_DRIFT",
          "The database and in-process ranking tuples disagree.",
        );
      }
      const nextCursorPayload = paginated.nextCursorPayload === null
        ? null
        : Object.freeze({
            ...paginated.nextCursorPayload,
            ...(input.sort === "response"
              ? { responseProjectionFingerprint }
              : {}),
          });
      const pageRows = actualIds.map((id) => rowById.get(id)!);
      return Object.freeze({
        rows: Object.freeze(pageRows),
        rowById: new Map(pageRows.map((row) => [row.id, row])),
        page: Object.freeze({
          ...paginated,
          nextCursorPayload,
          totalEligible,
        }),
      });
    },
    {
      isolationLevel: "RepeatableRead",
      timeout: EXACT_COUNT_TRANSACTION_TIMEOUT_MS,
    },
  );
}

async function resolvePublishedProjectionFilters(
  transaction: PublicReadTransaction,
  input: PublicJobSearchInput,
): Promise<PublishedProjectionFilters | null> {
  const categories = input.categorySlugs.length === 0
    ? []
    : await transaction.category.findMany({
        where: { isActive: true, ...catalogIdentityWhere(input.categorySlugs) },
        orderBy: { id: "asc" },
        select: { id: true },
      });
  const cantons = input.cantonSlugs.length === 0
    ? []
    : await transaction.canton.findMany({
        where: { isActive: true, ...catalogIdentityWhere(input.cantonSlugs) },
        orderBy: { id: "asc" },
        select: { id: true },
      });
  const cities = input.citySlugs.length === 0
    ? []
    : await transaction.city.findMany({
        where: {
          isActive: true,
          ...catalogIdentityWhere(input.citySlugs),
          ...(input.cantonSlugs.length === 0
            ? {}
            : { cantonId: { in: cantons.map(({ id }) => id) } }),
        },
        orderBy: { id: "asc" },
        select: { id: true },
      });
  if ((input.categorySlugs.length > 0 && categories.length === 0) ||
      (input.cantonSlugs.length > 0 && cantons.length === 0) ||
      (input.citySlugs.length > 0 && cities.length === 0)) {
    return null;
  }
  return Object.freeze({
    categoryIds: Object.freeze(categories.map(({ id }) => id)),
    cantonIds: Object.freeze(cantons.map(({ id }) => id)),
    cityIds: Object.freeze(cities.map(({ id }) => id)),
  });
}

async function resolveRadiusCenter(
  transaction: PublicReadTransaction,
  input: PublicJobSearchInput,
  cityIds: readonly string[],
): Promise<RadiusCenter | null> {
  if (input.radiusKm === undefined || input.citySlugs.length !== 1 || cityIds.length !== 1) {
    return null;
  }
  const rows = await transaction.city.findMany({
    where: { id: cityIds[0] },
    orderBy: { id: "asc" },
    take: 2,
    select: { latitude: true, longitude: true },
  });
  const center = rows[0];
  if (rows.length !== 1 || center === undefined ||
      center.latitude === null || center.longitude === null) {
    return null;
  }
  const latitude = Number(center.latitude);
  const longitude = Number(center.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }
  return Object.freeze({ latitude, longitude, radiusKm: input.radiusKm });
}

async function loadDatabaseSponsoredRankingEnvelope(
  transaction: PublicReadTransaction,
  context: DatabaseSearchQueryContext,
  limit: number,
): Promise<readonly DatabaseSponsoredEnvelopeRow[]> {
  const ctes = buildDatabaseRankingCtes(
    context,
    context.input.sort === "response",
  );
  const rows = await transaction.$queryRaw<readonly DatabaseSponsoredEnvelopeRow[]>(Prisma.sql`
    WITH ${ctes},
    counted AS MATERIALIZED (
      SELECT COUNT(*)::bigint AS "totalEligible" FROM ranked_candidates
    ),
    response_projection_version AS MATERIALIZED (
      SELECT md5(COALESCE(string_agg(
        concat_ws(':',
          projection."companyId"::text,
          projection."responseEvidenceKnown"::text,
          COALESCE(projection."onTimeRateBps"::text, 'null'),
          COALESCE(projection."medianFirstResponseMinutes"::text, 'null')
        ),
        '|' ORDER BY projection."companyId"
      ), '')) AS "responseProjectionFingerprint"
      FROM (
        SELECT DISTINCT candidate."companyId",
          candidate."responseEvidenceKnown",
          candidate."onTimeRateBps",
          candidate."medianFirstResponseMinutes"
        FROM ranked_candidates AS candidate
      ) AS projection
    ),
    sponsored AS MATERIALIZED (
      SELECT ranked.*,
        row_number() OVER (
          ORDER BY ranked."relevanceTier" DESC,
            ranked."relevanceScore" DESC,
            ranked."fairScore" DESC NULLS LAST,
            ranked."publishedAt" DESC,
            ranked."id" ASC
        ) AS "sponsorOrder"
      FROM ranked_candidates AS ranked
      WHERE ranked."activeBoost"
      ORDER BY ranked."relevanceTier" DESC,
        ranked."relevanceScore" DESC,
        ranked."fairScore" DESC NULLS LAST,
        ranked."publishedAt" DESC,
        ranked."id" ASC
      LIMIT ${limit}
    )
    SELECT sponsored."id",
      sponsored."relevanceTier",
      sponsored."relevanceScore",
      sponsored."fairScore",
      sponsored."salaryMin",
      sponsored."salaryMax",
      sponsored."responseEvidenceKnown",
      sponsored."onTimeRateBps",
      sponsored."medianFirstResponseMinutes",
      sponsored."publishedAt",
      sponsored."activeBoost",
      counted."totalEligible",
      response_projection_version."responseProjectionFingerprint"
    FROM counted
    CROSS JOIN response_projection_version
    LEFT JOIN sponsored ON TRUE
    ORDER BY sponsored."sponsorOrder" ASC NULLS LAST
  `);
  const maximumRows = Math.max(1, limit);
  if (rows.length === 0 || rows.length > maximumRows) {
    throw new PublicSearchRankingContractError(
      "DATABASE_RESULT_BOUND_EXCEEDED",
      "The sponsor/count envelope violated its formal row bound.",
    );
  }
  return Object.freeze([...rows]);
}

async function loadDatabaseOrganicRankingRows(
  transaction: PublicReadTransaction,
  context: DatabaseSearchQueryContext,
  after: OrganicCursorTuple | null,
  sponsoredIds: readonly string[],
  limit: number,
): Promise<readonly DatabaseRankingRow[]> {
  const ctes = buildDatabaseRankingCtes(
    context,
    context.input.sort === "response",
  );
  const cursorPredicate = databaseOrganicCursorPredicate(context.input.sort, after);
  const sponsorPredicate = databaseSponsoredExclusionPredicate(sponsoredIds);
  const orderBy = databaseOrganicOrderBy(context.input.sort);
  const rows = await transaction.$queryRaw<readonly DatabaseRankingRow[]>(Prisma.sql`
    WITH ${ctes}
    SELECT ranked."id",
      ranked."relevanceTier",
      ranked."relevanceScore",
      ranked."fairScore",
      ranked."salaryMin",
      ranked."salaryMax",
      ranked."responseEvidenceKnown",
      ranked."onTimeRateBps",
      ranked."medianFirstResponseMinutes",
      ranked."publishedAt",
      ranked."activeBoost"
    FROM ranked_candidates AS ranked
    WHERE ${sponsorPredicate}
      AND ${cursorPredicate}
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `);
  if (rows.length > limit) {
    throw new PublicSearchRankingContractError(
      "DATABASE_RESULT_BOUND_EXCEEDED",
      "The organic ranking result exceeded its formal row bound.",
    );
  }
  return Object.freeze([...rows]);
}

function buildDatabaseRankingCtes(
  context: DatabaseSearchQueryContext,
  includeCanonicalResponse: boolean,
): Prisma.Sql {
  const terms = context.input.keyword === undefined
    ? []
    : normalizedSearchTerms(context.input.keyword);
  const titleText = normalizedDatabaseSearchText(Prisma.raw('revision."title"'));
  const companyText = normalizedDatabaseSearchText(Prisma.raw('company."name"'));
  const bodyText = normalizedDatabaseSearchText(Prisma.sql`
    concat_ws(E'\\n',
      revision."description",
      array_to_string(revision."tasks", E'\\n'),
      array_to_string(revision."requirements", E'\\n'),
      revision."offer"
    )
  `);
  const relevanceScore = Prisma.sql`(
    ${databaseWeightedMatchScore(titleText, terms, 3)}
    + ${databaseWeightedMatchScore(companyText, terms, 2)}
    + ${databaseWeightedMatchScore(bodyText, terms, 1)}
  )`;
  const relevanceTier = Prisma.sql`(
    ${databaseFieldMatchTier(titleText, terms)}
    + ${databaseFieldMatchTier(companyText, terms)}
    + ${databaseFieldMatchTier(bodyText, terms)}
  )`;
  const predicates = databaseSearchPredicates(context);
  const keywordGate = context.input.keyword === undefined
    ? Prisma.sql`TRUE`
    : Prisma.sql`source."relevanceScore" > 0`;
  const source = Prisma.sql`
    candidate_source AS MATERIALIZED (
      SELECT job."id",
        job."companyId",
        job."publishedAt",
        revision."salaryMin" AS "salaryMin",
        revision."salaryMax" AS "salaryMax",
        score."scorePoints" AS "fairScore",
        ${relevanceTier}::integer AS "relevanceTier",
        ${relevanceScore}::integer AS "relevanceScore",
        EXISTS (
          SELECT 1
          FROM "JobBoost" AS boost
          WHERE boost."jobId" = job."id"
            AND boost."companyId" = job."companyId"
            AND boost."status" <> 'CANCELLED'::"BoostStatus"
            AND boost."cancelledAt" IS NULL
            AND boost."startsAt" <= ${context.now}
            AND boost."endsAt" > ${context.now}
        ) AS "activeBoost",
        company."responseTargetDays" AS "responseTargetDays",
        company."responseSampleSize" AS "responseSampleSize",
        company."responseWithinTargetBps" AS "responseWithinTargetBps",
        (
          company."responseSampleSize" >= ${ANALYTICS_MINIMUM_COHORT_SIZE_V1}
          AND company."responseTargetDays" BETWEEN
            ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min}
            AND ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max}
          AND company."responseWithinTargetBps" BETWEEN 0 AND 10000
        ) AS "responseProjectionKnown"
      FROM "Job" AS job
      JOIN "JobRevision" AS revision
        ON revision."id" = job."publishedRevisionId"
        AND revision."jobId" = job."id"
      JOIN "Company" AS company ON company."id" = job."companyId"
      JOIN "Category" AS category ON category."id" = revision."categoryId"
      LEFT JOIN "City" AS city ON city."id" = job."publishedCityId"
      LEFT JOIN "JobScoreSnapshot" AS score
        ON score."jobRevisionId" = revision."id"
        AND score."scoreVersion" = 'v2'
      WHERE ${Prisma.join(predicates, " AND ")}
    ),
    search_candidates AS MATERIALIZED (
      SELECT source.* FROM candidate_source AS source WHERE ${keywordGate}
    )
  `;
  if (!includeCanonicalResponse) {
    return Prisma.sql`${source},
      ranked_candidates AS MATERIALIZED (
        SELECT candidate.*,
          candidate."responseProjectionKnown" AS "responseEvidenceKnown",
          CASE WHEN candidate."responseProjectionKnown"
            THEN candidate."responseWithinTargetBps" ELSE NULL
          END AS "onTimeRateBps",
          NULL::integer AS "medianFirstResponseMinutes"
        FROM search_candidates AS candidate
      )`;
  }

  const responseWindowStart = new Date(
    context.rankingAsOf.getTime() - EMPLOYER_RESPONSE_POLICY_V1.rollingWindowDays * DAY_MS,
  );
  return Prisma.sql`${source},
    response_cases AS MATERIALIZED (
      SELECT response_job."companyId" AS "companyId",
        application."id" AS "applicationId",
        application."submittedAt" AS "submittedAt",
        snapshot."responseTargetDays" AS "caseTargetDays",
        first_response."createdAt" AS "firstResponseAt"
      FROM (
        SELECT DISTINCT candidate."companyId" FROM search_candidates AS candidate
      ) AS candidate_company
      JOIN "Job" AS response_job
        ON response_job."companyId" = candidate_company."companyId"
      JOIN "Application" AS application
        ON application."jobId" = response_job."id"
      JOIN "CandidateProfile" AS candidate_profile
        ON candidate_profile."id" = application."candidateProfileId"
      JOIN "User" AS candidate_user
        ON candidate_user."id" = candidate_profile."userId"
      LEFT JOIN "ApplicationSubmissionSnapshot" AS snapshot
        ON snapshot."applicationId" = application."id"
      LEFT JOIN LATERAL (
        SELECT event."createdAt"
        FROM "ApplicationEvent" AS event
        WHERE event."applicationId" = application."id"
          AND event."kind" IN (
            'STATUS_CHANGE'::"ApplicationEventKind",
            'MESSAGE_SENT'::"ApplicationEventKind"
          )
          AND event."actorUserId" IS NOT NULL
          AND event."actorUserId" <> candidate_profile."userId"
          AND event."createdAt" >= application."submittedAt"
          AND event."createdAt" >= ${responseWindowStart}
          AND event."createdAt" < ${context.rankingAsOf}
        ORDER BY event."createdAt" ASC, event."id" ASC
        LIMIT 1
      ) AS first_response ON TRUE
      WHERE application."submittedAt" >= ${responseWindowStart}
        AND application."submittedAt" < ${context.rankingAsOf}
        AND candidate_user."dataProvenance" = 'LIVE'::"DataProvenance"
    ),
    response_aggregates AS MATERIALIZED (
      SELECT response_case."companyId",
        (COUNT(*) FILTER (WHERE
          response_case."caseTargetDays" BETWEEN
            ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min}
            AND ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max}
          AND response_case."submittedAt"
            + response_case."caseTargetDays" * INTERVAL '1 day'
            <= ${context.rankingAsOf}
        ))::integer AS "dueCases",
        (COUNT(*) FILTER (WHERE
          response_case."caseTargetDays" BETWEEN
            ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min}
            AND ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max}
          AND response_case."submittedAt"
            + response_case."caseTargetDays" * INTERVAL '1 day'
            <= ${context.rankingAsOf}
          AND response_case."firstResponseAt" IS NOT NULL
        ))::integer AS "respondedCases",
        (COUNT(*) FILTER (WHERE
          response_case."caseTargetDays" BETWEEN
            ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min}
            AND ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max}
          AND response_case."submittedAt"
            + response_case."caseTargetDays" * INTERVAL '1 day'
            <= ${context.rankingAsOf}
          AND response_case."firstResponseAt" IS NOT NULL
          AND response_case."firstResponseAt" <= response_case."submittedAt"
            + response_case."caseTargetDays" * INTERVAL '1 day'
        ))::integer AS "onTimeCases",
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY floor(extract(epoch FROM (
            response_case."firstResponseAt" - response_case."submittedAt"
          )) / 60.0)
        ) FILTER (WHERE
          response_case."caseTargetDays" BETWEEN
            ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min}
            AND ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max}
          AND response_case."submittedAt"
            + response_case."caseTargetDays" * INTERVAL '1 day'
            <= ${context.rankingAsOf}
          AND response_case."firstResponseAt" IS NOT NULL
        ) AS "medianResponseMinutes"
      FROM response_cases AS response_case
      GROUP BY response_case."companyId"
    ),
    ranked_candidates AS MATERIALIZED (
      SELECT candidate.*,
        candidate."responseProjectionKnown" AS "responseEvidenceKnown",
        CASE WHEN candidate."responseProjectionKnown"
          THEN candidate."responseWithinTargetBps" ELSE NULL
        END AS "onTimeRateBps",
        CASE WHEN candidate."responseProjectionKnown"
          AND response."dueCases" = candidate."responseSampleSize"
          AND response."dueCases" >= ${EMPLOYER_RESPONSE_POLICY_V1.minimumDueCases}
          AND response."respondedCases" >=
            ${EMPLOYER_RESPONSE_POLICY_V1.minimumMedianResponses}
          AND floor(
            response."onTimeCases"::numeric * 10000
              / response."dueCases"::numeric + 0.5
          )::integer = candidate."responseWithinTargetBps"
          AND response."medianResponseMinutes" IS NOT NULL
        THEN floor(response."medianResponseMinutes" + 0.5)::integer
        ELSE NULL END AS "medianFirstResponseMinutes"
      FROM search_candidates AS candidate
      LEFT JOIN response_aggregates AS response
        ON response."companyId" = candidate."companyId"
    )`;
}

function databaseSearchPredicates(
  context: DatabaseSearchQueryContext,
): Prisma.Sql[] {
  const { input, now, projectionFilters, radiusCenter } = context;
  const publishedAtUpperBound = context.rankingAsOf.getTime() < now.getTime()
    ? context.rankingAsOf
    : now;
  const predicates: Prisma.Sql[] = [
    Prisma.sql`job."status" = 'PUBLISHED'::"JobStatus"`,
    Prisma.sql`job."currentRevisionId" = job."publishedRevisionId"`,
    Prisma.sql`job."publishedAt" <= ${publishedAtUpperBound}`,
    Prisma.sql`job."expiresAt" > ${now}`,
    Prisma.sql`revision."approvedAt" IS NOT NULL`,
    Prisma.sql`revision."rejectedAt" IS NULL`,
    Prisma.sql`revision."validThrough" > ${now}`,
    Prisma.sql`job."expiresAt" = revision."validThrough"`,
    Prisma.sql`company."status" = 'ACTIVE'::"CompanyStatus"`,
    Prisma.sql`category."isActive"`,
    Prisma.sql`(
      SELECT COUNT(*)
      FROM "CompanyVerificationRequest" AS verification
      WHERE verification."companyId" = company."id"
        AND verification."status" = 'VERIFIED'::"CompanyVerificationStatus"
        AND NOT EXISTS (
          SELECT 1 FROM "CompanyVerificationRequest" AS superseding
          WHERE superseding."supersedesRequestId" = verification."id"
        )
    ) = 1`,
    Prisma.sql`NOT EXISTS (
      SELECT 1
      FROM "ModerationRestriction" AS restriction
      WHERE restriction."status" = 'ACTIVE'::"ModerationRestrictionStatus"
        AND restriction."startsAt" <= ${now}
        AND restriction."liftedAt" IS NULL
        AND (restriction."endsAt" IS NULL OR restriction."endsAt" > ${now})
        AND (
          (restriction."targetType" = 'HIDE_JOB'::"ModerationRestrictionType"
            AND restriction."targetId" = job."id")
          OR
          (restriction."targetType" = 'PAUSE_COMPANY'::"ModerationRestrictionType"
            AND restriction."targetId" = company."id")
        )
    )`,
  ];
  if (context.liveOnly) {
    predicates.push(
      Prisma.sql`job."dataProvenance" = 'LIVE'::"DataProvenance"`,
      Prisma.sql`company."dataProvenance" = 'LIVE'::"DataProvenance"`,
    );
  }
  pushUuidListPredicate(
    predicates,
    Prisma.raw('job."publishedCategoryId"'),
    projectionFilters.categoryIds,
  );
  pushUuidListPredicate(
    predicates,
    Prisma.raw('job."publishedCantonId"'),
    projectionFilters.cantonIds,
  );
  if (input.radiusKm === undefined) {
    pushUuidListPredicate(
      predicates,
      Prisma.raw('job."publishedCityId"'),
      projectionFilters.cityIds,
    );
  }
  if (input.salaryDisclosedOnly) {
    predicates.push(
      Prisma.sql`job."publishedSalaryMin" IS NOT NULL`,
      Prisma.sql`job."publishedSalaryMax" IS NOT NULL`,
      Prisma.sql`job."publishedSalaryPeriod" IS NOT NULL`,
    );
  }
  if (input.salaryMin !== undefined) {
    predicates.push(Prisma.sql`job."publishedSalaryMax" >= ${input.salaryMin}`);
  }
  if (input.salaryPeriod !== undefined) {
    predicates.push(
      Prisma.sql`job."publishedSalaryPeriod"::text = ${input.salaryPeriod}`,
    );
  }
  pushTextListPredicate(
    predicates,
    Prisma.raw('revision."jobType"'),
    input.jobTypes,
  );
  pushTextListPredicate(
    predicates,
    Prisma.raw('revision."remoteType"'),
    input.remoteTypes,
  );
  pushTextListPredicate(
    predicates,
    Prisma.raw('revision."applicationEffort"'),
    input.efforts,
  );
  if (input.workloadMin !== undefined) {
    predicates.push(Prisma.sql`revision."workloadMax" >= ${input.workloadMin}`);
  }
  if (input.workloadMax !== undefined) {
    predicates.push(Prisma.sql`revision."workloadMin" <= ${input.workloadMax}`);
  }
  if (input.languages.length > 0) {
    const contentLanguages = input.languages.map((value) => value.toUpperCase());
    const languageCodes = input.languages.map((value) => value.toLowerCase());
    predicates.push(Prisma.sql`(
      revision."contentLanguage"::text IN (
        ${Prisma.join(contentLanguages.map((value) => Prisma.sql`${value}`))}
      )
      OR EXISTS (
        SELECT 1 FROM "JobRevisionLanguage" AS language
        WHERE language."jobRevisionId" = revision."id"
          AND lower(language."code") IN (
            ${Prisma.join(languageCodes.map((value) => Prisma.sql`${value}`))}
          )
      )
    )`);
  }
  if (input.responseEvidenceOnly) {
    predicates.push(Prisma.sql`
      company."responseSampleSize" >= ${ANALYTICS_MINIMUM_COHORT_SIZE_V1}
      AND company."responseTargetDays" BETWEEN
        ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min}
        AND ${EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max}
      AND company."responseWithinTargetBps" BETWEEN 0 AND 10000
    `);
  }
  if (radiusCenter !== undefined && radiusCenter !== null) {
    predicates.push(Prisma.sql`
      city."latitude" IS NOT NULL
      AND city."longitude" IS NOT NULL
      AND 6371.0 * 2.0 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
        power(sin(radians((city."latitude"::double precision
          - ${radiusCenter.latitude}) / 2.0)), 2)
        + cos(radians(${radiusCenter.latitude}))
          * cos(radians(city."latitude"::double precision))
          * power(sin(radians((city."longitude"::double precision
            - ${radiusCenter.longitude}) / 2.0)), 2)
      )))) <= ${radiusCenter.radiusKm}
    `);
  }
  return predicates;
}

function normalizedDatabaseSearchText(field: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`regexp_replace(
    normalize(lower(COALESCE(${field}, '')), NFKD),
    ${SEARCH_COMBINING_MARK_PATTERN},
    '',
    'g'
  )`;
}

function databaseWeightedMatchScore(
  field: Prisma.Sql,
  terms: readonly string[],
  weight: number,
): Prisma.Sql {
  if (terms.length === 0) return Prisma.sql`0`;
  return Prisma.sql`(${Prisma.join(terms.map((term) => Prisma.sql`
    CASE WHEN ${field} LIKE ${`%${term}%`} THEN ${weight} ELSE 0 END
  `), " + ")})`;
}

function databaseFieldMatchTier(
  field: Prisma.Sql,
  terms: readonly string[],
): Prisma.Sql {
  if (terms.length === 0) return Prisma.sql`0`;
  return Prisma.sql`CASE WHEN ${Prisma.join(terms.map((term) => Prisma.sql`
    ${field} LIKE ${`%${term}%`}
  `), " OR ")} THEN 1 ELSE 0 END`;
}

function pushUuidListPredicate(
  predicates: Prisma.Sql[],
  field: Prisma.Sql,
  values: readonly string[],
): void {
  if (values.length === 0) return;
  predicates.push(Prisma.sql`${field} IN (
    ${Prisma.join(values.map((value) => Prisma.sql`${value}::uuid`))}
  )`);
}

function pushTextListPredicate(
  predicates: Prisma.Sql[],
  field: Prisma.Sql,
  values: readonly string[],
): void {
  if (values.length === 0) return;
  predicates.push(Prisma.sql`${field}::text IN (
    ${Prisma.join(values.map((value) => Prisma.sql`${value}`))}
  )`);
}

function databaseOrganicOrderBy(sort: JobSearchSort): Prisma.Sql {
  switch (sort) {
    case "relevance":
      return Prisma.sql`ranked."relevanceTier" DESC,
        ranked."relevanceScore" DESC,
        ranked."fairScore" DESC NULLS LAST,
        ranked."publishedAt" DESC,
        ranked."id" ASC`;
    case "newest":
      return Prisma.sql`ranked."publishedAt" DESC, ranked."id" ASC`;
    case "fair-score":
      return Prisma.sql`ranked."fairScore" DESC NULLS LAST,
        ranked."publishedAt" DESC,
        ranked."id" ASC`;
    case "salary":
      return Prisma.sql`ranked."salaryMin" DESC NULLS LAST,
        ranked."salaryMax" DESC NULLS LAST,
        ranked."publishedAt" DESC,
        ranked."id" ASC`;
    case "response":
      return Prisma.sql`ranked."responseEvidenceKnown" DESC,
        ranked."onTimeRateBps" DESC NULLS LAST,
        ranked."medianFirstResponseMinutes" ASC NULLS LAST,
        ranked."publishedAt" DESC,
        ranked."id" ASC`;
  }
}

function databaseOrganicCursorPredicate(
  sort: JobSearchSort,
  after: OrganicCursorTuple | null,
): Prisma.Sql {
  if (after === null) return Prisma.sql`TRUE`;
  if (after.sort !== sort || !UUID_REFERENCE.test(after.id)) {
    throw new PublicSearchRankingContractError(
      "RANKING_PROJECTION_DRIFT",
      "The organic cursor tuple is not valid for the database ranking query.",
    );
  }
  const tail = (prefix: Prisma.Sql) => Prisma.sql`(
    ${prefix}
    OR (
      ranked."publishedAt" = ${new Date(after.publishedAt)}
      AND ranked."id" > ${after.id}::uuid
    )
  )`;
  switch (after.sort) {
    case "newest":
      return tail(Prisma.sql`ranked."publishedAt" < ${new Date(after.publishedAt)}`);
    case "relevance": {
      const fairScore = after.fairScore ?? -1;
      return Prisma.sql`(
        ranked."relevanceTier" < ${after.relevanceTier}
        OR (ranked."relevanceTier" = ${after.relevanceTier}
          AND ranked."relevanceScore" < ${after.relevanceScore})
        OR (ranked."relevanceTier" = ${after.relevanceTier}
          AND ranked."relevanceScore" = ${after.relevanceScore}
          AND COALESCE(ranked."fairScore", -1) < ${fairScore})
        OR (ranked."relevanceTier" = ${after.relevanceTier}
          AND ranked."relevanceScore" = ${after.relevanceScore}
          AND COALESCE(ranked."fairScore", -1) = ${fairScore}
          AND ranked."publishedAt" < ${new Date(after.publishedAt)})
        OR (ranked."relevanceTier" = ${after.relevanceTier}
          AND ranked."relevanceScore" = ${after.relevanceScore}
          AND COALESCE(ranked."fairScore", -1) = ${fairScore}
          AND ranked."publishedAt" = ${new Date(after.publishedAt)}
          AND ranked."id" > ${after.id}::uuid)
      )`;
    }
    case "fair-score": {
      const fairScore = after.fairScore ?? -1;
      return Prisma.sql`(
        COALESCE(ranked."fairScore", -1) < ${fairScore}
        OR (COALESCE(ranked."fairScore", -1) = ${fairScore}
          AND ranked."publishedAt" < ${new Date(after.publishedAt)})
        OR (COALESCE(ranked."fairScore", -1) = ${fairScore}
          AND ranked."publishedAt" = ${new Date(after.publishedAt)}
          AND ranked."id" > ${after.id}::uuid)
      )`;
    }
    case "salary": {
      const salaryMin = after.salaryMinChf ?? -1;
      const salaryMax = after.salaryMaxChf ?? -1;
      return Prisma.sql`(
        COALESCE(ranked."salaryMin", -1) < ${salaryMin}
        OR (COALESCE(ranked."salaryMin", -1) = ${salaryMin}
          AND COALESCE(ranked."salaryMax", -1) < ${salaryMax})
        OR (COALESCE(ranked."salaryMin", -1) = ${salaryMin}
          AND COALESCE(ranked."salaryMax", -1) = ${salaryMax}
          AND ranked."publishedAt" < ${new Date(after.publishedAt)})
        OR (COALESCE(ranked."salaryMin", -1) = ${salaryMin}
          AND COALESCE(ranked."salaryMax", -1) = ${salaryMax}
          AND ranked."publishedAt" = ${new Date(after.publishedAt)}
          AND ranked."id" > ${after.id}::uuid)
      )`;
    }
    case "response": {
      const known = Number(after.responseEvidenceKnown);
      const onTimeRateBps = after.onTimeRateBps ?? -1;
      const median = after.medianFirstResponseMinutes ?? 2_147_483_647;
      return Prisma.sql`(
        CASE WHEN ranked."responseEvidenceKnown" THEN 1 ELSE 0 END < ${known}
        OR (CASE WHEN ranked."responseEvidenceKnown" THEN 1 ELSE 0 END = ${known}
          AND COALESCE(ranked."onTimeRateBps", -1) < ${onTimeRateBps})
        OR (CASE WHEN ranked."responseEvidenceKnown" THEN 1 ELSE 0 END = ${known}
          AND COALESCE(ranked."onTimeRateBps", -1) = ${onTimeRateBps}
          AND COALESCE(ranked."medianFirstResponseMinutes", 2147483647) > ${median})
        OR (CASE WHEN ranked."responseEvidenceKnown" THEN 1 ELSE 0 END = ${known}
          AND COALESCE(ranked."onTimeRateBps", -1) = ${onTimeRateBps}
          AND COALESCE(ranked."medianFirstResponseMinutes", 2147483647) = ${median}
          AND ranked."publishedAt" < ${new Date(after.publishedAt)})
        OR (CASE WHEN ranked."responseEvidenceKnown" THEN 1 ELSE 0 END = ${known}
          AND COALESCE(ranked."onTimeRateBps", -1) = ${onTimeRateBps}
          AND COALESCE(ranked."medianFirstResponseMinutes", 2147483647) = ${median}
          AND ranked."publishedAt" = ${new Date(after.publishedAt)}
          AND ranked."id" > ${after.id}::uuid)
      )`;
    }
  }
}

function databaseSponsoredExclusionPredicate(
  sponsoredIds: readonly string[],
): Prisma.Sql {
  if (sponsoredIds.length === 0) return Prisma.sql`TRUE`;
  if (sponsoredIds.some((id) => !UUID_REFERENCE.test(id))) {
    throw new PublicSearchRankingContractError(
      "RANKING_PROJECTION_DRIFT",
      "A sponsored cursor ID is not a UUID.",
    );
  }
  return Prisma.sql`ranked."id" NOT IN (
    ${Prisma.join(sponsoredIds.map((id) => Prisma.sql`${id}::uuid`))}
  )`;
}

function exactSearchCount(
  envelope: readonly DatabaseSponsoredEnvelopeRow[],
): number {
  const raw = envelope[0]?.totalEligible;
  const count = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new PublicSearchRankingContractError(
      "COUNT_OVERFLOW",
      "The exact public search count is outside the safe integer range.",
    );
  }
  return count;
}

function toSponsoredRankingRow(
  row: DatabaseSponsoredEnvelopeRow,
): readonly DatabaseRankingRow[] {
  if (row.id === null) return Object.freeze([]);
  if (row.relevanceTier === null || row.relevanceScore === null ||
      row.responseEvidenceKnown === null || row.publishedAt === null ||
      row.activeBoost === null) {
    throw new PublicSearchRankingContractError(
      "RANKING_PROJECTION_DRIFT",
      "The sponsored ranking tuple is incomplete.",
    );
  }
  return Object.freeze([Object.freeze({
    id: row.id,
    relevanceTier: row.relevanceTier,
    relevanceScore: row.relevanceScore,
    fairScore: row.fairScore,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    responseEvidenceKnown: row.responseEvidenceKnown,
    onTimeRateBps: row.onTimeRateBps,
    medianFirstResponseMinutes: row.medianFirstResponseMinutes,
    publishedAt: row.publishedAt,
    activeBoost: row.activeBoost,
  })]);
}

function emptyLoadedSearchPage(
  input: PublicJobSearchInput,
  pagination: Readonly<{
    pageSize: number;
    queryHash: string;
    rankingAsOf: Date;
    cursor?: NonNullable<ReturnType<typeof decodeSearchCursor>>;
  }>,
): LoadedSearchPage {
  const page = paginateSearchJobs({
    candidates: Object.freeze([]),
    sort: input.sort,
    hasQuery: Boolean(input.keyword),
    pageSize: pagination.pageSize,
    queryHash: pagination.queryHash,
    rankingAsOf: pagination.rankingAsOf,
    ...(pagination.cursor === undefined ? {} : { cursor: pagination.cursor }),
  });
  return Object.freeze({
    rows: Object.freeze([]),
    rowById: new Map(),
    page: Object.freeze({ ...page, totalEligible: 0 }),
  });
}

function sameStringSequence(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function loadEligibleJobs(
  input: PublicJobSearchInput,
  now: Date,
  scope: PublicJobLoadScope = {},
): Promise<LoadedJobs> {
  const database = getDatabase();
  const dataContext = getPublicDataContext();
  const candidateLimit = Math.min(
    scope.take ?? MAXIMUM_BOUNDED_JOB_CANDIDATES,
    MAXIMUM_BOUNDED_JOB_CANDIDATES,
  );
  const detectTruncation = scope.take === undefined;
  const loaded = await loadBoundedEligibleRowsInSnapshot<PublicJobRow>(
    database,
    now,
    dataContext.eligibilityEnvironment,
    candidateLimit,
    detectTruncation,
    (transaction) => transaction.job.findMany({
      where: buildPublicJobWhere(input, now, dataContext.liveOnly, scope),
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      // The extra row is a sentinel. It is never ranked, but proves that a
      // global result count would be incomplete without an unbounded query.
      take: candidateLimit + (detectTruncation ? 1 : 0),
      select: input.keyword
        ? buildPublicJobSearchSelect(now)
        : buildPublicJobCardSelect(now),
    }),
  );
  const eligibleRows = loaded.rows;

  if (eligibleRows.length === 0) {
    return Object.freeze({
      rows: Object.freeze([]),
      rowById: new Map(),
      candidates: Object.freeze([]),
      candidateSetTruncated: loaded.candidateSetTruncated,
    });
  }
  const candidates = eligibleRows.map((row) => toRankingCandidate(row, input.keyword, now));
  const rowById = new Map(eligibleRows.map((row) => [row.id, row]));

  return Object.freeze({
    rows: Object.freeze(eligibleRows),
    rowById,
    candidates: Object.freeze(candidates),
    candidateSetTruncated: loaded.candidateSetTruncated,
  });
}

async function loadEligibleDetailJob(
  slug: string,
  now: Date,
): Promise<EligiblePublicJobDetailRow | null> {
  const database = getDatabase();
  const dataContext = getPublicDataContext();
  const input = emptyPublicJobSearchInput();
  const eligibleRows = await loadEligibleRowsInSnapshot<PublicJobDetailRow>(
    database,
    now,
    dataContext.eligibilityEnvironment,
    (transaction) => transaction.job.findMany({
      where: buildPublicJobWhere(input, now, dataContext.liveOnly, { slug }),
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 1,
      select: buildPublicJobDetailSelect(now),
    }),
  );
  return eligibleRows[0] ?? null;
}

async function loadExactPublicClusterCounts(now: Date): Promise<Readonly<{
  cantonCounts: ReadonlyMap<string, ClusterCount<PublicJobClusterCanton>>;
  categoryCounts: ReadonlyMap<string, ClusterCount<PublicJobClusterCategory>>;
}>> {
  const database = getDatabase();
  const input = emptyPublicJobSearchInput();
  const cantonCounts = new Map<string, ClusterCount<PublicJobClusterCanton>>();
  const categoryCounts = new Map<string, ClusterCount<PublicJobClusterCategory>>();
  await scanEligibleRowsInSnapshot<PublicJobClusterRow>(
    database,
    now,
    "production",
    (transaction, afterId) => transaction.job.findMany({
      where: {
        ...buildPublicJobWhere(input, now, true, {}),
        ...(afterId === undefined ? {} : { id: { gt: afterId } }),
        AND: [{
          OR: [
            {
              publishedRevision: {
                is: {
                  canton: {
                    is: {
                      code: {
                        in: [...PUBLIC_CLUSTER_DISCOVERY_POLICY_V1.promotedCantonCodes],
                      },
                    },
                  },
                },
              },
            },
            {
              publishedRevision: {
                is: {
                  category: {
                    is: {
                      slug: {
                        in: [...PUBLIC_CLUSTER_DISCOVERY_POLICY_V1.promotedCategorySlugs],
                      },
                    },
                  },
                },
              },
            },
          ],
        }],
      },
      orderBy: { id: "asc" },
      take: EXACT_COUNT_SCAN_BATCH_SIZE,
      select: PUBLIC_JOB_CLUSTER_SELECT,
    }),
    (rows) => {
      for (const row of rows) {
        const canton = row.publishedRevision.canton;
        if (canton !== null && PROMOTED_CANTON_CODES.has(canton.code)) {
          incrementClusterCount(cantonCounts, canton);
        }
        const category = row.publishedRevision.category;
        if (PROMOTED_CATEGORY_SLUGS.has(category.slug)) {
          incrementClusterCount(categoryCounts, category);
        }
      }
    },
  );
  return Object.freeze({ cantonCounts, categoryCounts });
}

function buildPublicJobWhere(
  input: PublicJobSearchInput,
  now: Date,
  liveOnly: boolean,
  scope: PublicJobLoadScope,
): Prisma.JobWhereInput {
  // This bounds the candidate set for performance. The canonical evaluator
  // below remains the final authority for lifecycle and restriction eligibility.
  const publishedAtUpperBound = scope.publishedAtUpperBound !== undefined &&
      scope.publishedAtUpperBound.getTime() < now.getTime()
    ? scope.publishedAtUpperBound
    : now;
  const publishedSalaryMin = input.salaryDisclosedOnly
    ? { not: null }
    : undefined;
  const publishedSalaryMax = input.salaryMin !== undefined
    ? {
        gte: input.salaryMin,
        ...(input.salaryDisclosedOnly ? { not: null } : {}),
      }
    : input.salaryDisclosedOnly ? { not: null } : undefined;
  const publishedSalaryPeriod = input.salaryPeriod ??
    (input.salaryDisclosedOnly ? { not: null } : undefined);
  return {
    ...(scope.slug === undefined ? {} : { slug: scope.slug }),
    ...(scope.companyId === undefined ? {} : { companyId: scope.companyId }),
    ...(scope.companyIds === undefined ? {} : { companyId: { in: [...scope.companyIds] } }),
    ...(scope.publishedCategoryIds === undefined
      ? {}
      : { publishedCategoryId: { in: [...scope.publishedCategoryIds] } }),
    ...(scope.publishedCantonIds === undefined
      ? {}
      : { publishedCantonId: { in: [...scope.publishedCantonIds] } }),
    ...(scope.publishedCityIds === undefined || input.radiusKm !== undefined
      ? {}
      : { publishedCityId: { in: [...scope.publishedCityIds] } }),
    ...(publishedSalaryMin === undefined ? {} : { publishedSalaryMin }),
    ...(publishedSalaryMax === undefined ? {} : { publishedSalaryMax }),
    ...(publishedSalaryPeriod === undefined ? {} : { publishedSalaryPeriod }),
    status: "PUBLISHED",
    publishedAt: { lte: publishedAtUpperBound },
    expiresAt: { gt: now },
    ...(liveOnly ? { dataProvenance: "LIVE" as const } : {}),
    company: {
      is: {
        status: "ACTIVE",
        ...(liveOnly ? { dataProvenance: "LIVE" as const } : {}),
        verificationRequests: {
          some: { status: "VERIFIED", supersededBy: null },
        },
        ...(input.responseEvidenceOnly
          ? {
              responseSampleSize: { gte: ANALYTICS_MINIMUM_COHORT_SIZE_V1 },
              responseTargetDays: {
                gte: EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min,
                lte: EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max,
              },
              responseWithinTargetBps: { gte: 0, lte: 10_000 },
            }
          : {}),
      },
    },
    publishedRevision: {
      is: {
        approvedAt: { not: null },
        rejectedAt: null,
        validThrough: { gt: now },
        ...buildRevisionWhere(input),
      },
    },
  };
}

async function loadEligibleRowsInSnapshot<Row extends PublicJobEligibilityRow>(
  database: DatabaseClient,
  now: Date,
  environment: PublicEligibilityEnvironment,
  loadRows: (transaction: PublicReadTransaction) => Promise<readonly Row[]>,
): Promise<EligibleRow<Row>[]> {
  return database.$transaction(
    async (transaction) => {
      const rows = await loadRows(transaction);
      return filterEligibleRows(rows, now, environment, transaction);
    },
    { isolationLevel: "RepeatableRead" },
  );
}

async function loadBoundedEligibleRowsInSnapshot<
  Row extends PublicJobEligibilityRow,
>(
  database: DatabaseClient,
  now: Date,
  environment: PublicEligibilityEnvironment,
  candidateLimit: number,
  detectTruncation: boolean,
  loadRows: (transaction: PublicReadTransaction) => Promise<readonly Row[]>,
): Promise<BoundedEligibleRows<Row>> {
  return database.$transaction(
    async (transaction) => {
      const candidateRows = await loadRows(transaction);
      const maximumLoadedRows = candidateLimit + (detectTruncation ? 1 : 0);
      if (candidateRows.length > maximumLoadedRows) {
        throw new RangeError("A public search query exceeded its safety bound.");
      }
      const candidateSetTruncated = detectTruncation &&
        candidateRows.length > candidateLimit;
      const eligibleRows = await filterEligibleRows(
        candidateRows,
        now,
        environment,
        transaction,
      );
      return Object.freeze({
        rows: Object.freeze(eligibleRows.slice(0, candidateLimit)),
        // The sentinel is deliberately evaluated too. Even when moderation
        // excludes it, more unseen rows may follow, so only `false` proves an
        // exact result count.
        candidateSetTruncated,
      });
    },
    { isolationLevel: "RepeatableRead" },
  );
}

async function scanEligibleRowsInSnapshot<Row extends PublicJobEligibilityRow>(
  database: DatabaseClient,
  now: Date,
  environment: PublicEligibilityEnvironment,
  loadBatch: (
    transaction: PublicReadTransaction,
    afterId: string | undefined,
  ) => Promise<readonly Row[]>,
  consume: (rows: readonly EligibleRow<Row>[]) => void,
): Promise<void> {
  await database.$transaction(
    async (transaction) => {
      let afterId: string | undefined;
      while (true) {
        const rows = await loadBatch(transaction, afterId);
        if (rows.length === 0) return;
        if (rows.length > EXACT_COUNT_SCAN_BATCH_SIZE) {
          throw new RangeError("A public count scan batch exceeded its safety bound.");
        }
        consume(await filterEligibleRows(rows, now, environment, transaction));
        if (rows.length < EXACT_COUNT_SCAN_BATCH_SIZE) return;
        const nextAfterId = rows.at(-1)?.id;
        if (nextAfterId === undefined ||
            (afterId !== undefined && nextAfterId <= afterId)) {
          throw new Error("Public count keyset scan did not advance.");
        }
        afterId = nextAfterId;
      }
    },
    {
      isolationLevel: "RepeatableRead",
      timeout: EXACT_COUNT_TRANSACTION_TIMEOUT_MS,
    },
  );
}

async function filterEligibleRows<Row extends PublicJobEligibilityRow>(
  rows: readonly Row[],
  now: Date,
  environment: PublicEligibilityEnvironment,
  database: PublicReadTransaction,
): Promise<EligibleRow<Row>[]> {
  if (rows.length === 0) return [];
  const restrictions = await database.moderationRestriction.findMany({
    where: {
      status: "ACTIVE",
      startsAt: { lte: now },
      liftedAt: null,
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      AND: [{
        OR: [
          { targetType: "HIDE_JOB", targetId: { in: rows.map((row) => row.id) } },
          { targetType: "PAUSE_COMPANY", targetId: { in: rows.map((row) => row.companyId) } },
        ],
      }],
    },
    select: { targetType: true, targetId: true },
  });
  const hiddenJobs = new Set(
    restrictions.filter((row) => row.targetType === "HIDE_JOB").map((row) => row.targetId),
  );
  const pausedCompanies = new Set(
    restrictions.filter((row) => row.targetType === "PAUSE_COMPANY").map((row) => row.targetId),
  );
  const eligibleRows: EligibleRow<Row>[] = [];
  for (const row of rows) {
    const result = evaluatePublicJobEligibility(
      toPublicEligibilitySnapshot(row, hiddenJobs, pausedCompanies),
      now,
      environment,
    );
    if (result.eligible && row.publishedRevision !== null) {
      eligibleRows.push(row as EligibleRow<Row>);
    }
  }
  return eligibleRows;
}

function buildRevisionWhere(input: PublicJobSearchInput): Prisma.JobRevisionWhereInput {
  const where: Prisma.JobRevisionWhereInput = {
    category: { is: { isActive: true } },
  };
  if (input.jobTypes.length > 0) where.jobType = { in: [...input.jobTypes] };
  if (input.remoteTypes.length > 0) where.remoteType = { in: [...input.remoteTypes] };
  if (input.workloadMin !== undefined) where.workloadMax = { gte: input.workloadMin };
  if (input.workloadMax !== undefined) where.workloadMin = { lte: input.workloadMax };
  if (input.efforts.length > 0) where.applicationEffort = { in: [...input.efforts] };
  if (input.languages.length > 0) {
    const contentLanguages = [...input.languages];
    const languageCodes = contentLanguages.map((language) => language.toLowerCase());
    where.AND = [
      {
        OR: [
          { contentLanguage: { in: contentLanguages } },
          { languages: { some: { code: { in: languageCodes } } } },
        ],
      },
    ];
  }
  return where;
}

function toPublicEligibilitySnapshot<Row extends PublicJobEligibilityRow>(
  row: Row,
  hiddenJobs: ReadonlySet<string>,
  pausedCompanies: ReadonlySet<string>,
): PublicEligibilitySnapshot {
  const revision = row.publishedRevision;
  return Object.freeze({
    id: row.id,
    slug: row.slug,
    companyId: row.companyId,
    status: row.status,
    dataProvenance: row.dataProvenance,
    currentRevisionId: row.currentRevisionId,
    publishedRevisionId: row.publishedRevisionId,
    publishedAt: row.publishedAt,
    expiresAt: row.expiresAt,
    company: Object.freeze({
      name: row.company.name,
      status: row.company.status,
      dataProvenance: row.company.dataProvenance,
      hasCurrentVerifiedCycle: row.company.verificationRequests.length === 1,
    }),
    revision: revision === null
      ? null
      : Object.freeze({
          id: revision.id,
          title: revision.title,
          description: revision.description,
          categoryIsActive: revision.category.isActive,
          approvedAt: revision.approvedAt,
          rejectedAt: revision.rejectedAt,
          validThrough: revision.validThrough,
          categoryId: revision.categoryId,
          cantonId: revision.cantonId,
          cityId: revision.cityId,
          salaryMin: revision.salaryMin,
          salaryMax: revision.salaryMax,
          salaryPeriod: revision.salaryPeriod,
          responseTargetDays: revision.responseTargetDays,
          remoteType: revision.remoteType,
          jobType: revision.jobType,
          workloadMin: revision.workloadMin,
          workloadMax: revision.workloadMax,
          fairScore: revision.scoreSnapshots.length === 1
            ? (revision.scoreSnapshots[0]?.scorePoints ?? null)
            : null,
        }),
    hasEffectivePublicHideRestriction:
      hiddenJobs.has(row.id) || pausedCompanies.has(row.companyId),
  });
}

async function loadCanonicalResponseMedians(
  transaction: PublicReadTransaction,
  rows: readonly EligiblePublicJobRow[],
  now: Date,
  cache: Map<string, number | null>,
): Promise<void> {
  const projections = new Map<string, EligiblePublicJobRow["company"]>();
  for (const row of rows) {
    if (!cache.has(row.companyId) && responseEvidence(row.company).known) {
      projections.set(row.companyId, row.company);
    }
  }
  if (projections.size === 0) return;

  const windowStart = new Date(
    now.getTime() - EMPLOYER_RESPONSE_POLICY_V1.rollingWindowDays * DAY_MS,
  );
  for (const companyIds of chunks([...projections.keys()], RESPONSE_COMPANY_BATCH_SIZE)) {
    const applications = await transaction.application.findMany({
      where: {
        job: { companyId: { in: companyIds } },
        submittedAt: { gte: windowStart, lt: now },
        candidateProfile: {
          is: { user: { is: { dataProvenance: "LIVE" } } },
        },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        submittedAt: true,
        job: { select: { companyId: true } },
        candidateProfile: { select: { userId: true } },
        submissionSnapshot: { select: { responseTargetDays: true } },
        events: {
          where: {
            kind: { in: ["STATUS_CHANGE", "MESSAGE_SENT"] },
            actorUserId: { not: null },
            createdAt: { gte: windowStart, lt: now },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { actorUserId: true, createdAt: true },
        },
      },
    });
    const casesByCompany = new Map<string, Array<{
      applicationId: string;
      submittedAt: Date;
      responseTargetDays: number | null;
      firstResponseAt: Date | null;
    }>>();
    for (const application of applications) {
      const cases = casesByCompany.get(application.job.companyId) ?? [];
      const firstEmployerResponse = application.events.find(
        (event) => event.actorUserId !== application.candidateProfile.userId &&
          event.createdAt >= application.submittedAt,
      );
      cases.push({
        applicationId: application.id,
        submittedAt: application.submittedAt,
        responseTargetDays:
          application.submissionSnapshot?.responseTargetDays ?? null,
        firstResponseAt: firstEmployerResponse?.createdAt ?? null,
      });
      casesByCompany.set(application.job.companyId, cases);
    }
    for (const companyId of companyIds) {
      const projection = projections.get(companyId);
      if (projection === undefined) continue;
      cache.set(companyId, projectCanonicalResponseMedianMinutes(
        projection,
        casesByCompany.get(companyId) ?? [],
        now,
      ));
    }
  }
}

function toDatabaseRankingCandidate(
  row: EligiblePublicJobRow,
  ranking: DatabaseRankingRow,
  now: Date,
  responseMedianByCompany: ReadonlyMap<string, number | null>,
): RankingCandidate {
  const projected = toRankingCandidate(
    row,
    undefined,
    now,
    responseMedianByCompany,
  );
  if (projected.id !== ranking.id ||
      projected.publishedAt.getTime() !== ranking.publishedAt.getTime() ||
      projected.fairScore !== ranking.fairScore ||
      projected.salaryMin !== ranking.salaryMin ||
      projected.salaryMax !== ranking.salaryMax ||
      projected.activeBoost !== ranking.activeBoost ||
      projected.responseEvidenceKnown !== ranking.responseEvidenceKnown ||
      projected.onTimeRateBps !== ranking.onTimeRateBps ||
      projected.medianFirstResponseMinutes !== ranking.medianFirstResponseMinutes) {
    throw new PublicSearchRankingContractError(
      "RANKING_PROJECTION_DRIFT",
      "A hydrated card disagreed with its database ranking tuple.",
    );
  }
  return Object.freeze({
    ...projected,
    relevanceTier: ranking.relevanceTier,
    relevanceScore: ranking.relevanceScore,
  });
}

function toRankingCandidate(
  row: EligiblePublicJobRow,
  keyword: string | undefined,
  now: Date,
  responseMedianByCompany: ReadonlyMap<string, number | null> = new Map(),
): RankingCandidate {
  const revision = row.publishedRevision;
  const relevance = keyword
    ? calculateRelevanceProxy(keyword, {
        title: revision.title,
        companyName: row.company.name,
        body: searchableRevisionBody(revision),
      })
    : { score: 0, tier: 0 };
  const score = revision.scoreSnapshots.length === 1
    ? (revision.scoreSnapshots[0]?.scorePoints ?? null)
    : null;
  const response = responseEvidence(row.company);
  return Object.freeze({
    id: row.id,
    slug: row.slug,
    companyId: row.companyId,
    companyName: stripUnsafeHtml(row.company.name),
    title: stripUnsafeHtml(revision.title),
    description: stripUnsafeHtml(revision.description),
    publishedAt: new Date(row.publishedAt!),
    expiresAt: new Date(row.expiresAt!),
    fairScore: score,
    responseTargetDays: revision.responseTargetDays,
    salaryMin: revision.salaryMin,
    salaryMax: revision.salaryMax,
    salaryPeriod: revision.salaryPeriod,
    categoryId: revision.categoryId,
    cantonId: revision.cantonId,
    cityId: revision.cityId,
    remoteType: revision.remoteType,
    jobType: revision.jobType,
    workloadMin: revision.workloadMin,
    workloadMax: revision.workloadMax,
    relevanceScore: relevance.score,
    relevanceTier: relevance.tier,
    activeBoost: hasActiveBoost(row, now),
    responseEvidenceKnown: response.known,
    onTimeRateBps: response.onTimeRateBps,
    medianFirstResponseMinutes: response.known
      ? (responseMedianByCompany.get(row.companyId) ?? null)
      : null,
  });
}

function searchableRevisionBody(
  revision: EligiblePublicJobRow["publishedRevision"],
): string {
  const searchText = revision as typeof revision & Readonly<{
    tasks?: readonly string[];
    requirements?: readonly string[];
    offer?: string | null;
  }>;
  return [
    revision.description,
    ...(searchText.tasks ?? []),
    ...(searchText.requirements ?? []),
    searchText.offer ?? "",
  ].join("\n");
}

function toCardModel(
  row: EligiblePublicJobRow,
  now: Date,
  sponsored: boolean,
): PublicJobCardModel {
  const revision = row.publishedRevision;
  const score = revision.scoreSnapshots.length === 1
    ? (revision.scoreSnapshots[0]?.scorePoints ?? null)
    : null;
  return Object.freeze({
    id: row.id,
    slug: row.slug,
    title: stripUnsafeHtml(revision.title),
    description: stripUnsafeHtml(revision.description),
    company: Object.freeze({
      id: row.company.id,
      slug: row.company.slug,
      name: stripUnsafeHtml(row.company.name),
      verified: true as const,
    }),
    category: Object.freeze({
      id: revision.category.id,
      name: revision.category.name,
      slug: revision.category.slug,
    }),
    canton: revision.canton === null ? null : Object.freeze({ ...revision.canton }),
    city: revision.city === null ? null : Object.freeze({ ...revision.city }),
    locationLabel: cleanOptional(revision.locationLabel),
    remoteType: revision.remoteType,
    jobType: revision.jobType,
    workloadMin: revision.workloadMin,
    workloadMax: revision.workloadMax,
    salaryMin: revision.salaryMin,
    salaryMax: revision.salaryMax,
    salaryPeriod: revision.salaryPeriod,
    applicationEffort: revision.applicationEffort,
    contentLanguage: revision.contentLanguage,
    fairScore: score,
    response: responseEvidence(row.company),
    publishedAt: new Date(row.publishedAt!),
    expiresAt: new Date(row.expiresAt!),
    dataProvenance: row.dataProvenance,
    activeBoost: hasActiveBoost(row, now),
    sponsored,
  });
}

function toDetailModel(
  row: EligiblePublicJobDetailRow,
  now: Date,
): PublicJobDetailModel {
  const revision = row.publishedRevision;
  const card = toCardModel(row, now, false);
  return Object.freeze({
    ...card,
    company: Object.freeze({
      ...card.company,
      website: safePublicCompanyWebsite(row.company.website),
      // Fail closed until an operations-reviewed public asset publication and
      // serving contract exists. Employer-editable storage keys are not review
      // evidence and must never be projected as trusted structured-data URLs.
      logoUrl: null,
    }),
    companyIntro: cleanOptional(revision.companyIntro),
    tasks: cleanList(revision.tasks),
    requirements: cleanList(revision.requirements),
    niceToHave: cleanList(revision.niceToHave),
    offer: cleanOptional(revision.offer),
    benefits: Object.freeze(revision.benefits.map((benefit) => Object.freeze({
      code: benefit.benefitCode,
      description: stripUnsafeHtml(benefit.description),
    }))),
    skills: Object.freeze(revision.skills.map((entry) => Object.freeze({
      ...entry.skill,
      name: stripUnsafeHtml(entry.skill.name),
      required: entry.required,
    }))),
    languages: Object.freeze(revision.languages.map((language) => Object.freeze({
      code: language.code.toLowerCase(),
      minLevel: language.minLevel,
    }))),
    applicationProcessSteps: cleanList(revision.applicationProcessSteps),
    requiredDocumentKinds: Object.freeze([...revision.requiredDocumentKinds]),
    inclusionStatement: cleanOptional(revision.inclusionStatement),
    startDate: revision.startDate === null ? null : new Date(revision.startDate),
    startByArrangement: revision.startByArrangement,
    remoteCountryCode: revision.remoteCountryCode,
    applicationContactKind: revision.applicationContactKind,
    applicationContactValue: revision.applicationContactValue.trim(),
    fairScoreVersion: safeScoreVersion(revision.scoreSnapshots[0]?.scoreVersion),
    fairBreakdown: fairBreakdown(revision.scoreSnapshots[0]?.factorBreakdown),
  });
}

function safePublicCompanyWebsite(value: string | null): string | null {
  if (value === null || value.length > 512) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === ""
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeScoreVersion(value: string | undefined): string | null {
  return value !== undefined && value.length <= 32 && /^[a-z0-9._-]+$/iu.test(value)
    ? value
    : null;
}

function responseEvidence(company: Readonly<{
  responseTargetDays: number | null;
  responseSampleSize: number;
  responseWithinTargetBps: number | null;
}>): PublicResponseEvidence {
  const known = Number.isSafeInteger(company.responseSampleSize) &&
    company.responseSampleSize >= ANALYTICS_MINIMUM_COHORT_SIZE_V1 &&
    Number.isInteger(company.responseTargetDays) &&
    company.responseTargetDays !== null &&
    company.responseTargetDays >= EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min &&
    company.responseTargetDays <= EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max &&
    Number.isInteger(company.responseWithinTargetBps) &&
    company.responseWithinTargetBps !== null &&
    company.responseWithinTargetBps >= 0 &&
    company.responseWithinTargetBps <= 10_000;
  return Object.freeze({
    known,
    targetDays: known ? company.responseTargetDays : null,
    onTimeRateBps: known ? company.responseWithinTargetBps : null,
    sampleSizeBucket: known
      ? company.responseSampleSize >= 50 ? "50+" : "20–49"
      : null,
  });
}

function hasActiveBoost(row: PublicJobRow, now: Date): boolean {
  return jobHasActiveBoost(
    row.boosts.filter((boost) => boost.companyId === row.companyId),
    now,
  );
}

const FACTOR_LABELS: Readonly<Record<string, string>> = {
  SALARY: "Lohntransparenz",
  TASKS_REQUIREMENTS: "Aufgaben & Anforderungen",
  WORKLOAD_CONTRACT_START: "Pensum, Vertrag & Start",
  LOCATION_REMOTE: "Arbeitsort & Remote",
  APPLICATION_PROCESS: "Bewerbungsprozess",
  RESPONSE_TARGET: "Antwortversprechen",
  BENEFITS: "Konkrete Benefits",
  INCLUSION_CONTACT: "Inklusion & Kontakt",
  FRESHNESS: "Aktualität",
};

function fairBreakdown(value: unknown): PublicJobDetailModel["fairBreakdown"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze([]);
  }
  const result = Object.entries(value as Record<string, unknown>).flatMap(([key, raw]) => {
    if (!Object.hasOwn(FACTOR_LABELS, key)) return [];
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    return typeof item.pointsAwarded === "number" && typeof item.maxPoints === "number" &&
      Number.isFinite(item.pointsAwarded) && Number.isFinite(item.maxPoints)
      ? [Object.freeze({
          key,
          label: FACTOR_LABELS[key] as string,
          points: item.pointsAwarded,
          maxPoints: item.maxPoints,
        })]
      : [];
  });
  return Object.freeze(result);
}

function createPublicSearchQueryHash(input: PublicJobSearchInput): string {
  const canonical = {
    version: "public-search-v2",
    keyword: input.keyword?.trim().normalize("NFKC").toLowerCase() ?? null,
    cantonSlugs: canonicalSet(input.cantonSlugs),
    citySlugs: canonicalSet(input.citySlugs),
    radiusKm: input.radiusKm ?? null,
    categorySlugs: canonicalSet(input.categorySlugs),
    workloadMin: input.workloadMin ?? null,
    workloadMax: input.workloadMax ?? null,
    jobTypes: canonicalSet(input.jobTypes),
    remoteTypes: canonicalSet(input.remoteTypes),
    languages: canonicalSet(input.languages),
    efforts: canonicalSet(input.efforts),
    salaryMin: input.salaryMin ?? null,
    salaryPeriod: input.salaryPeriod ?? null,
    salaryDisclosedOnly: input.salaryDisclosedOnly,
    responseEvidenceOnly: input.responseEvidenceOnly,
    companyVerifiedOnly: input.companyVerifiedOnly,
    sort: input.sort,
    pageSize: input.pageSize,
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function canonicalSet(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function catalogIdentityWhere(values: readonly string[]): {
  OR: ({ id: { in: string[] } } | { slug: { in: string[] } })[];
} {
  const ids = values.filter((value) => UUID_REFERENCE.test(value));
  const slugs = values.filter((value) => !UUID_REFERENCE.test(value));
  return {
    OR: [
      ...(ids.length === 0 ? [] : [{ id: { in: ids } }]),
      ...(slugs.length === 0 ? [] : [{ slug: { in: slugs } }]),
    ],
  };
}

function withCursorSecret<T>(consumer: (secret: string) => T): T {
  return getServerEnvironment().secrets.session.withValue(consumer);
}

function cleanList(values: readonly string[]): readonly string[] {
  return Object.freeze(values.map(stripUnsafeHtml).filter(Boolean));
}

function cleanOptional(value: string | null): string | null {
  if (value === null) return null;
  const clean = stripUnsafeHtml(value);
  return clean.length === 0 ? null : clean;
}

function chunks<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function validNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("A valid public read-model clock is required.");
  }
  return new Date(now);
}

function isSafeSlug(value: string): boolean {
  return value.length <= 220 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function incrementClusterCount<Value extends Readonly<{ id: string }>>(
  counts: Map<string, ClusterCount<Value>>,
  value: Value,
): void {
  const current = counts.get(value.id);
  counts.set(value.id, { value, count: (current?.count ?? 0) + 1 });
}
