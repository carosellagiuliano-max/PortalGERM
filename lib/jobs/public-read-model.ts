import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma/client";
import { ANALYTICS_MINIMUM_COHORT_SIZE_V1 } from "@/lib/analytics/metric-contracts";
import { EMPLOYER_RESPONSE_POLICY_V1 } from "@/lib/analytics/response-policy-v1";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  evaluatePublicJobEligibility,
  type PublicEligibilityEnvironment,
  type PublicEligibilitySnapshot,
} from "@/lib/jobs/public-eligibility";
import { getPublicDataContext } from "@/lib/public/environment";
import type { PublicJobSearchInput } from "@/lib/public/query-params";
import type {
  PublicCatalog,
  PublicClusterLink,
  PublicJobCardModel,
  PublicJobDetailModel,
  PublicJobSearchPage,
  PublicResponseEvidence,
} from "@/lib/public/types";
import { decodeSearchCursor, encodeSearchCursor } from "@/lib/search/cursor";
import { calculateRelevanceProxy } from "@/lib/search/relevance";
import {
  paginateSearchJobs,
  rankSearchJobs,
} from "@/lib/search/ranking";
import type { RankingCandidate } from "@/lib/search/types";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

/** Deliberate ranking-workset safety cap for public discovery. */
const MAXIMUM_SEARCH_CANDIDATES = 2_000;
const DEFAULT_PAGE_SIZE = 20;
const EXACT_COUNT_SCAN_BATCH_SIZE = 500;
const EXACT_COUNT_TRANSACTION_TIMEOUT_MS = 30_000;

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
      category: { select: { id: true, name: true, slug: true } },
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
        status: "ACTIVE" as const,
        cancelledAt: null,
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

const PUBLIC_JOB_CLUSTER_SELECT = {
  ...PUBLIC_JOB_ELIGIBILITY_SELECT,
  publishedRevision: {
    select: {
      ...PUBLIC_JOB_ELIGIBILITY_SELECT.publishedRevision.select,
      category: { select: { id: true, name: true, slug: true } },
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
  take?: number;
  publishedAtUpperBound?: Date;
}>;

type LoadedJobs = Readonly<{
  rows: readonly EligiblePublicJobRow[];
  rowById: ReadonlyMap<string, EligiblePublicJobRow>;
  candidates: readonly RankingCandidate[];
  candidateSetTruncated: boolean;
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
  });
}

export async function listPublicJobs(
  input: PublicJobSearchInput,
  options: Readonly<{ pageSize?: number; now?: Date }> = {},
): Promise<PublicJobSearchPage> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new RangeError("Public job page size must be between 1 and 50.");
  }
  const now = validNow(options.now);
  const queryHash = createPublicSearchQueryHash(input);
  const decoded = input.cursor
    ? withCursorSecret((secret) =>
        decodeSearchCursor(input.cursor as string, {
          queryHash,
          sort: input.sort,
          secret,
        }),
      )
    : undefined;
  const invalidCursor = input.cursor !== undefined && decoded === null;
  const rankingAsOf = decoded === undefined || decoded === null
    ? now
    : new Date(decoded.rankingAsOf);
  const loaded = await loadEligibleJobs(input, now, {
    publishedAtUpperBound: rankingAsOf,
  });
  const page = paginateSearchJobs({
    candidates: loaded.candidates,
    sort: input.sort,
    hasQuery: Boolean(input.keyword),
    pageSize,
    queryHash,
    rankingAsOf,
    ...(decoded === undefined || decoded === null ? {} : { cursor: decoded }),
  });
  const jobs = page.ranked.flatMap((entry) => {
    const row = loaded.rowById.get(entry.job.id);
    return row === undefined
      ? []
      : [toCardModel(row, now, entry.sponsored)];
  });
  const totalEligible = input.keyword
    ? loaded.candidates.filter((candidate) => candidate.relevanceScore > 0).length
    : loaded.candidates.length;

  return Object.freeze({
    jobs: Object.freeze(jobs),
    nextCursor:
      page.nextCursorPayload === null
        ? null
        : withCursorSecret((secret) =>
            encodeSearchCursor(page.nextCursorPayload!, secret),
          ),
    totalEligible,
    resultCountIsExact: !loaded.candidateSetTruncated,
    candidateSetTruncated: loaded.candidateSetTruncated,
    invalidCursor,
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
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, slug: true },
    }),
    database.city.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
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

async function loadEligibleJobs(
  input: PublicJobSearchInput,
  now: Date,
  scope: PublicJobLoadScope = {},
): Promise<LoadedJobs> {
  const database = getDatabase();
  const dataContext = getPublicDataContext();
  const candidateLimit = Math.min(
    scope.take ?? MAXIMUM_SEARCH_CANDIDATES,
    MAXIMUM_SEARCH_CANDIDATES,
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
      select: buildPublicJobCardSelect(now),
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
  return {
    ...(scope.slug === undefined ? {} : { slug: scope.slug }),
    ...(scope.companyId === undefined ? {} : { companyId: scope.companyId }),
    ...(scope.companyIds === undefined ? {} : { companyId: { in: [...scope.companyIds] } }),
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
  if (input.keyword) {
    where.OR = [
      { title: { contains: input.keyword, mode: "insensitive" } },
      { description: { contains: input.keyword, mode: "insensitive" } },
      { job: { company: { name: { contains: input.keyword, mode: "insensitive" } } } },
    ];
  }
  if (input.categorySlugs.length > 0) {
    where.category = {
      is: { isActive: true, slug: { in: [...input.categorySlugs] } },
    };
  }
  if (input.cantonSlugs.length > 0) {
    where.canton = { is: { slug: { in: [...input.cantonSlugs] } } };
  }
  if (input.citySlugs.length > 0) {
    where.city = { is: { slug: { in: [...input.citySlugs] } } };
  }
  if (input.jobTypes.length > 0) where.jobType = { in: [...input.jobTypes] };
  if (input.remoteTypes.length > 0) where.remoteType = { in: [...input.remoteTypes] };
  if (input.workloadMin !== undefined) where.workloadMax = { gte: input.workloadMin };
  if (input.workloadMax !== undefined) where.workloadMin = { lte: input.workloadMax };
  if (input.efforts.length > 0) where.applicationEffort = { in: [...input.efforts] };
  const requiresYearlySalary =
    input.salaryMin !== undefined || input.sort === "salary";
  if (requiresYearlySalary) {
    where.salaryPeriod = "YEARLY";
  }
  if (input.salaryMin !== undefined) {
    where.salaryMax = { gte: input.salaryMin };
  }
  if (input.salaryDisclosedOnly) {
    where.salaryMin = { not: null };
    if (input.salaryMin === undefined) where.salaryMax = { not: null };
    if (!requiresYearlySalary) where.salaryPeriod = { not: null };
  }
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

function toRankingCandidate(
  row: EligiblePublicJobRow,
  keyword: string | undefined,
  now: Date,
): RankingCandidate {
  const revision = row.publishedRevision;
  const relevance = keyword
    ? calculateRelevanceProxy(keyword, {
        title: revision.title,
        companyName: row.company.name,
        body: revision.description,
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
    medianFirstResponseMinutes: null,
  });
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
    category: Object.freeze({ ...revision.category }),
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
  return row.boosts.some((boost) =>
    boost.companyId === row.companyId &&
    boost.status === "ACTIVE" &&
    boost.cancelledAt === null &&
    boost.startsAt.getTime() <= now.getTime() &&
    now.getTime() < boost.endsAt.getTime(),
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
    version: "public-search-v1",
    keyword: input.keyword?.trim().normalize("NFKC").toLowerCase() ?? null,
    cantonSlugs: canonicalSet(input.cantonSlugs),
    citySlugs: canonicalSet(input.citySlugs),
    categorySlugs: canonicalSet(input.categorySlugs),
    workloadMin: input.workloadMin ?? null,
    workloadMax: input.workloadMax ?? null,
    jobTypes: canonicalSet(input.jobTypes),
    remoteTypes: canonicalSet(input.remoteTypes),
    languages: canonicalSet(input.languages),
    efforts: canonicalSet(input.efforts),
    salaryMin: input.salaryMin ?? null,
    salaryDisclosedOnly: input.salaryDisclosedOnly,
    responseEvidenceOnly: input.responseEvidenceOnly,
    companyVerifiedOnly: input.companyVerifiedOnly,
    sort: input.sort,
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function canonicalSet(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
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
