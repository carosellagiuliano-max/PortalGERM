import type { SearchCursorPayload } from "@/lib/search/cursor";
import { SPONSORED_PLACEMENT_CONFIG_V1 } from "@/lib/search/placement-config";
import type {
  JobSearchSort,
  OrganicCursorTuple,
  RankedJob,
  RankingCandidate,
} from "@/lib/search/types";

function compareAscendingString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function descending(left: number, right: number): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function ascending(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function descendingNullable(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return descending(left, right);
}

function ascendingNullable(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return ascending(left, right);
}

function stableTail(left: RankingCandidate, right: RankingCandidate): number {
  return descending(left.publishedAt.getTime(), right.publishedAt.getTime()) ||
    compareAscendingString(left.id, right.id);
}

export function compareOrganicJobs(
  sort: JobSearchSort,
  left: RankingCandidate,
  right: RankingCandidate,
): number {
  let primary = 0;
  switch (sort) {
    case "relevance":
      primary = descending(left.relevanceTier, right.relevanceTier) ||
        descending(left.relevanceScore, right.relevanceScore) ||
        descendingNullable(left.fairScore, right.fairScore);
      break;
    case "newest":
      break;
    case "fair-score":
      primary = descendingNullable(left.fairScore, right.fairScore);
      break;
    case "salary":
      primary = descendingNullable(left.salaryMin, right.salaryMin) ||
        descendingNullable(left.salaryMax, right.salaryMax);
      break;
    case "response":
      primary = descending(
        Number(left.responseEvidenceKnown),
        Number(right.responseEvidenceKnown),
      ) || descendingNullable(left.onTimeRateBps, right.onTimeRateBps) ||
        ascendingNullable(
          left.medianFirstResponseMinutes,
          right.medianFirstResponseMinutes,
        );
      break;
  }
  return primary || stableTail(left, right);
}

function compareSponsored(left: RankingCandidate, right: RankingCandidate): number {
  return (
    descending(left.relevanceTier, right.relevanceTier) ||
    descending(left.relevanceScore, right.relevanceScore) ||
    descendingNullable(left.fairScore, right.fairScore) ||
    stableTail(left, right)
  );
}

export function createOrganicCursorTuple(
  sort: JobSearchSort,
  job: RankingCandidate,
): OrganicCursorTuple {
  const tail = { publishedAt: job.publishedAt.toISOString(), id: job.id };
  switch (sort) {
    case "relevance":
      return Object.freeze({
        sort,
        relevanceTier: job.relevanceTier,
        relevanceScore: job.relevanceScore,
        fairScore: job.fairScore,
        ...tail,
      });
    case "newest":
      return Object.freeze({ sort, ...tail });
    case "fair-score":
      return Object.freeze({ sort, fairScore: job.fairScore, ...tail });
    case "salary":
      return Object.freeze({
        sort,
        salaryMinChf: job.salaryMin,
        salaryMaxChf: job.salaryMax,
        ...tail,
      });
    case "response":
      return Object.freeze({
        sort,
        responseEvidenceKnown: job.responseEvidenceKnown,
        onTimeRateBps: job.onTimeRateBps,
        medianFirstResponseMinutes: job.medianFirstResponseMinutes,
        ...tail,
      });
  }
}

type RelevanceTuple = Extract<OrganicCursorTuple, { sort: "relevance" }>;
type NewestTuple = Extract<OrganicCursorTuple, { sort: "newest" }>;
type FairScoreTuple = Extract<OrganicCursorTuple, { sort: "fair-score" }>;
type SalaryTuple = Extract<OrganicCursorTuple, { sort: "salary" }>;
type ResponseTuple = Extract<OrganicCursorTuple, { sort: "response" }>;

function compareTupleTail(
  left: Readonly<{ publishedAt: string; id: string }>,
  right: Readonly<{ publishedAt: string; id: string }>,
): number {
  return descending(Date.parse(left.publishedAt), Date.parse(right.publishedAt)) ||
    compareAscendingString(left.id, right.id);
}

export function compareOrganicCursorTuples(
  left: OrganicCursorTuple,
  right: OrganicCursorTuple,
): number {
  if (left.sort !== right.sort) {
    throw new TypeError("Organic cursor tuples must use the same search sort.");
  }
  switch (left.sort) {
    case "relevance": {
      const matching = right as RelevanceTuple;
      return descending(left.relevanceTier, matching.relevanceTier) ||
        descending(left.relevanceScore, matching.relevanceScore) ||
        descendingNullable(left.fairScore, matching.fairScore) ||
        compareTupleTail(left, matching);
    }
    case "newest":
      return compareTupleTail(left, right as NewestTuple);
    case "fair-score": {
      const matching = right as FairScoreTuple;
      return descendingNullable(left.fairScore, matching.fairScore) ||
        compareTupleTail(left, matching);
    }
    case "salary": {
      const matching = right as SalaryTuple;
      return descendingNullable(left.salaryMinChf, matching.salaryMinChf) ||
        descendingNullable(left.salaryMaxChf, matching.salaryMaxChf) ||
        compareTupleTail(left, matching);
    }
    case "response": {
      const matching = right as ResponseTuple;
      return descending(
        Number(left.responseEvidenceKnown),
        Number(matching.responseEvidenceKnown),
      ) || descendingNullable(left.onTimeRateBps, matching.onTimeRateBps) ||
        ascendingNullable(
          left.medianFirstResponseMinutes,
          matching.medianFirstResponseMinutes,
        ) || compareTupleTail(left, matching);
    }
  }
}

export function rankSearchJobs(input: Readonly<{
  candidates: readonly RankingCandidate[];
  sort: JobSearchSort;
  hasQuery: boolean;
  firstPage: boolean;
  selectedSponsoredIds?: readonly string[];
  sponsoredLimit?: number;
}>): Readonly<{ ranked: readonly RankedJob[]; selectedSponsoredIds: readonly string[] }> {
  const relevant = input.hasQuery
    ? input.candidates.filter((job) => job.relevanceScore > 0)
    : [...input.candidates];
  const requestedSponsoredLimit = input.sponsoredLimit ??
    SPONSORED_PLACEMENT_CONFIG_V1.SEARCH_FIRST_PAGE;
  const sponsoredLimit = Number.isFinite(requestedSponsoredLimit)
    ? Math.max(
        0,
        Math.min(
          SPONSORED_PLACEMENT_CONFIG_V1.SEARCH_FIRST_PAGE,
          Math.floor(requestedSponsoredLimit),
        ),
      )
    : 0;
  let sponsoredIds: readonly string[];
  if (input.selectedSponsoredIds !== undefined) {
    sponsoredIds = [...new Set(input.selectedSponsoredIds)].slice(
      0,
      SPONSORED_PLACEMENT_CONFIG_V1.SEARCH_FIRST_PAGE,
    );
  } else if (input.firstPage) {
    sponsoredIds = relevant
      .filter((job) => job.activeBoost)
      .sort(compareSponsored)
      .slice(0, sponsoredLimit)
      .map((job) => job.id);
  } else {
    sponsoredIds = [];
  }
  const sponsoredSet = new Set(sponsoredIds);
  const byId = new Map(relevant.map((job) => [job.id, job]));
  const sponsored = input.firstPage
    ? sponsoredIds.flatMap((id) => {
        const job = byId.get(id);
        return job
          ? [Object.freeze({ job, sponsored: true, label: "Gesponsert" as const })]
          : [];
      })
    : [];
  const organic = relevant
    .filter((job) => !sponsoredSet.has(job.id))
    .sort((left, right) => compareOrganicJobs(input.sort, left, right))
    .map((job) => Object.freeze({ job, sponsored: false, label: null }));
  return Object.freeze({
    ranked: Object.freeze([...sponsored, ...organic]),
    selectedSponsoredIds: Object.freeze([...sponsoredIds]),
  });
}

export type SearchPage = Readonly<{
  ranked: readonly RankedJob[];
  selectedSponsoredIds: readonly string[];
  rankingAsOf: string;
  nextCursorPayload: SearchCursorPayload | null;
}>;

/**
 * Ranks the complete bounded candidate set before slicing a page. Callers pass
 * only currently public-eligible candidates; `rankingAsOf` additionally keeps
 * newly published jobs out of a cursor replay while removed jobs simply vanish.
 */
export function paginateSearchJobs(input: Readonly<{
  candidates: readonly RankingCandidate[];
  sort: JobSearchSort;
  hasQuery: boolean;
  pageSize: number;
  queryHash: string;
  rankingAsOf: Date;
  cursor?: SearchCursorPayload;
}>): SearchPage {
  if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 50) {
    throw new RangeError("Search page size must be an integer between 1 and 50.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.queryHash)) {
    throw new TypeError("Search query hash must be a lowercase SHA-256 hex value.");
  }
  if (input.cursor?.queryHash !== undefined && input.cursor.queryHash !== input.queryHash) {
    throw new TypeError("Search cursor does not belong to this query.");
  }
  if (input.cursor?.organicTuple !== null &&
      input.cursor?.organicTuple !== undefined &&
      input.cursor.organicTuple.sort !== input.sort) {
    throw new TypeError("Search cursor does not belong to this sort.");
  }

  const rankingAsOf = input.cursor?.rankingAsOf ?? input.rankingAsOf.toISOString();
  const rankingAsOfMs = Date.parse(rankingAsOf);
  if (!Number.isFinite(rankingAsOfMs)) {
    throw new TypeError("Search rankingAsOf must be a valid timestamp.");
  }
  const snapshotCandidates = input.candidates.filter(
    (job) => job.publishedAt.getTime() <= rankingAsOfMs,
  );
  const ranking = rankSearchJobs({
    candidates: snapshotCandidates,
    sort: input.sort,
    hasQuery: input.hasQuery,
    firstPage: input.cursor === undefined,
    selectedSponsoredIds: input.cursor?.sponsoredIds,
    sponsoredLimit: Math.min(input.pageSize, SPONSORED_PLACEMENT_CONFIG_V1.SEARCH_FIRST_PAGE),
  });
  const after = input.cursor?.organicTuple;
  const remaining = after === undefined || after === null
    ? ranking.ranked
    : ranking.ranked.filter(({ job }) => compareOrganicCursorTuples(
        createOrganicCursorTuple(input.sort, job),
        after,
      ) > 0);
  const ranked = Object.freeze(remaining.slice(0, input.pageSize));
  const hasMore = remaining.length > ranked.length;
  const lastOrganic = [...ranked].reverse().find((entry) => !entry.sponsored);
  const organicTuple = lastOrganic === undefined
    ? null
    : createOrganicCursorTuple(input.sort, lastOrganic.job);
  const selectedSponsoredIds = Object.freeze([...ranking.selectedSponsoredIds]);
  const nextCursorPayload = hasMore
    ? Object.freeze({
        policyVersion: "v1" as const,
        configVersion: "v1" as const,
        queryHash: input.queryHash,
        rankingAsOf,
        sponsoredIds: selectedSponsoredIds,
        organicTuple,
      })
    : null;

  return Object.freeze({
    ranked,
    selectedSponsoredIds,
    rankingAsOf,
    nextCursorPayload,
  });
}

export function rankHomepageSponsoredJobs(
  candidates: readonly RankingCandidate[],
): readonly RankedJob[] {
  return Object.freeze(
    candidates
      .filter((job) => job.activeBoost)
      .sort(compareSponsored)
      .slice(0, SPONSORED_PLACEMENT_CONFIG_V1.HOMEPAGE)
      .map((job) => Object.freeze({
        job,
        sponsored: true,
        label: "Gesponsert" as const,
      })),
  );
}
