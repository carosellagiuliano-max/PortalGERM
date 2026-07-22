// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  decodeSearchCursor,
  encodeSearchCursor,
  type SearchCursorPayload,
} from "@/lib/search/cursor";
import { SPONSORED_PLACEMENT_CONFIG_V1 } from "@/lib/search/placement-config";
import { calculateRelevanceProxy } from "@/lib/search/relevance";
import {
  compareOrganicCursorTuples,
  createOrganicCursorTuple,
  paginateSearchJobs,
  rankHomepageSponsoredJobs,
  rankSearchJobs,
} from "@/lib/search/ranking";
import type { JobSearchSort, RankingCandidate } from "@/lib/search/types";

const SECRET = "a-dedicated-context-bound-cursor-secret-v1";
const RANKING_AS_OF = new Date("2026-07-19T12:00:00.000Z");

function job(
  id: string,
  overrides: Partial<RankingCandidate> = {},
): RankingCandidate {
  return {
    id,
    slug: id,
    companyId: "company-1",
    companyName: "Talent AG",
    title: id,
    description: "engineering",
    publishedAt: new Date("2026-07-19T00:00:00Z"),
    expiresAt: new Date("2026-08-19T00:00:00Z"),
    fairScore: 80,
    responseTargetDays: 14,
    salaryMin: 90_000,
    salaryMax: 110_000,
    salaryPeriod: "YEARLY",
    categoryId: "category-1",
    cantonId: "canton-1",
    cityId: "city-1",
    remoteType: "HYBRID",
    jobType: "PERMANENT",
    workloadMin: 80,
    workloadMax: 100,
    relevanceScore: 1,
    relevanceTier: 1,
    activeBoost: false,
    responseEvidenceKnown: true,
    onTimeRateBps: 8_000,
    medianFirstResponseMinutes: 720,
    ...overrides,
  };
}

function rankedIds(sort: JobSearchSort, candidates: readonly RankingCandidate[]): string[] {
  return rankSearchJobs({
    candidates,
    sort,
    hasQuery: false,
    firstPage: false,
  }).ranked.map(({ job: ranked }) => ranked.id);
}

describe("search relevance contract", () => {
  it("weights keyword hits title=3, company=2 and body=1", () => {
    expect(calculateRelevanceProxy("engineer", {
      title: "Engineer",
      companyName: "Engineer AG",
      body: "Engineer role",
    })).toEqual({ score: 6, tier: 3 });
    expect(calculateRelevanceProxy("missing", {
      title: "Engineer",
      companyName: "Talent AG",
      body: "Role",
    })).toEqual({ score: 0, tier: 0 });
  });

});

describe("canonical organic ordering", () => {
  it("uses tier, score and nullable Fair score for relevance", () => {
    expect(rankedIds("relevance", [
      job("tier-low", { relevanceTier: 1, relevanceScore: 100, fairScore: 100 }),
      job("fair-null", { relevanceTier: 2, relevanceScore: 5, fairScore: null }),
      job("fair-high", { relevanceTier: 2, relevanceScore: 5, fairScore: 90 }),
      job("score-high", { relevanceTier: 2, relevanceScore: 6, fairScore: 1 }),
    ])).toEqual(["score-high", "fair-high", "fair-null", "tier-low"]);
  });

  it("uses the frozen newest, Fair-score and salary tuples with nulls last", () => {
    const older = new Date("2026-07-17T00:00:00Z");
    const newer = new Date("2026-07-18T00:00:00Z");
    expect(rankedIds("newest", [
      job("b", { publishedAt: newer }),
      job("a", { publishedAt: newer }),
      job("older", { publishedAt: older }),
    ])).toEqual(["a", "b", "older"]);
    expect(rankedIds("fair-score", [
      job("null", { fairScore: null, publishedAt: newer }),
      job("low", { fairScore: 70 }),
      job("high", { fairScore: 90 }),
    ])).toEqual(["high", "low", "null"]);
    expect(rankedIds("salary", [
      job("unknown", { salaryMin: null, salaryMax: null }),
      job("same-min-low-max", { salaryMin: 100_000, salaryMax: 110_000 }),
      job("same-min-high-max", { salaryMin: 100_000, salaryMax: 120_000 }),
      job("highest-min", { salaryMin: 110_000, salaryMax: 110_000 }),
    ])).toEqual(["highest-min", "same-min-high-max", "same-min-low-max", "unknown"]);
  });

  it("sorts response history by known, rate, median, publishedAt and id", () => {
    const samePublishedAt = new Date("2026-07-18T00:00:00Z");
    expect(rankedIds("response", [
      job("unknown-null", {
        responseEvidenceKnown: false,
        onTimeRateBps: null,
        medianFirstResponseMinutes: null,
      }),
      job("known-low-rate", {
        responseEvidenceKnown: true,
        onTimeRateBps: 7_000,
        medianFirstResponseMinutes: 10,
        responseTargetDays: 1,
      }),
      job("known-slow", {
        responseEvidenceKnown: true,
        onTimeRateBps: 9_000,
        medianFirstResponseMinutes: 600,
      }),
      job("known-fast-b", {
        responseEvidenceKnown: true,
        onTimeRateBps: 9_000,
        medianFirstResponseMinutes: 120,
        publishedAt: samePublishedAt,
      }),
      job("known-fast-a", {
        responseEvidenceKnown: true,
        onTimeRateBps: 9_000,
        medianFirstResponseMinutes: 120,
        responseTargetDays: 30,
        publishedAt: samePublishedAt,
      }),
      job("unknown-measured", {
        responseEvidenceKnown: false,
        onTimeRateBps: null,
        medianFirstResponseMinutes: 60,
        responseTargetDays: 1,
      }),
    ])).toEqual([
      "known-fast-a",
      "known-fast-b",
      "known-slow",
      "known-low-rate",
      "unknown-measured",
      "unknown-null",
    ]);
  });
});

describe("sponsored ranking and cursor snapshot", () => {
  it("uses exactly three first-page labelled slots inside the relevant set", () => {
    expect(SPONSORED_PLACEMENT_CONFIG_V1).toEqual({ SEARCH_FIRST_PAGE: 3, HOMEPAGE: 2 });
    const candidates = [
      job("organic", { relevanceScore: 100 }),
      job("boost-low", { activeBoost: true, relevanceScore: 2, relevanceTier: 1 }),
      job("boost-top", { activeBoost: true, relevanceScore: 5, relevanceTier: 2 }),
      job("boost-mid", { activeBoost: true, relevanceScore: 4, relevanceTier: 2 }),
      job("boost-fourth", { activeBoost: true, relevanceScore: 1 }),
      job("irrelevant-boost", { activeBoost: true, relevanceScore: 0, relevanceTier: 0 }),
    ];
    const result = rankSearchJobs({ candidates, sort: "newest", hasQuery: true, firstPage: true });
    expect(result.selectedSponsoredIds).toEqual(["boost-top", "boost-mid", "boost-low"]);
    expect(result.ranked.slice(0, 3).map(({ label }) => label)).toEqual([
      "Gesponsert",
      "Gesponsert",
      "Gesponsert",
    ]);
    expect(result.ranked.map(({ job: ranked }) => ranked.id)).not.toContain("irrelevant-boost");
  });

  it("never replenishes later pages and keeps snapshot IDs excluded after boost expiry", () => {
    const result = rankSearchJobs({
      candidates: [job("boost", { activeBoost: false }), job("organic")],
      sort: "newest",
      hasQuery: false,
      firstPage: false,
      selectedSponsoredIds: ["boost"],
    });
    expect(result.ranked.map(({ job: ranked }) => ranked.id)).toEqual(["organic"]);
    expect(result.ranked.every(({ sponsored }) => !sponsored)).toBe(true);
  });

  it("keeps the homepage on its own immutable two-slot policy", () => {
    expect(rankHomepageSponsoredJobs([
      job("one", { activeBoost: true, relevanceScore: 3 }),
      job("two", { activeBoost: true, relevanceScore: 2 }),
      job("three", { activeBoost: true, relevanceScore: 1 }),
    ]).map(({ job: ranked }) => ranked.id)).toEqual(["one", "two"]);
  });

  it("signs the complete tuple and rejects tampering, sort or query replay", () => {
    const payload = {
      policyVersion: "v1" as const,
      configVersion: "v1" as const,
      queryHash: "a".repeat(64),
      rankingAsOf: "2026-07-19T00:00:00.000Z",
      sponsoredIds: ["job-1"],
      organicTuple: {
        sort: "response" as const,
        responseEvidenceKnown: true,
        onTimeRateBps: 9_500,
        medianFirstResponseMinutes: 90,
        publishedAt: "2026-07-18T00:00:00.000Z",
        id: "job-2",
      },
    } satisfies SearchCursorPayload;
    const cursor = encodeSearchCursor(payload, SECRET);
    expect(decodeSearchCursor(cursor, {
      queryHash: payload.queryHash,
      sort: "response",
      secret: SECRET,
    })).toEqual(payload);
    expect(decodeSearchCursor(`${cursor.slice(0, -1)}x`, {
      queryHash: payload.queryHash,
      sort: "response",
      secret: SECRET,
    })).toBeNull();
    expect(decodeSearchCursor(cursor, {
      queryHash: "b".repeat(64),
      sort: "response",
      secret: SECRET,
    })).toBeNull();
    expect(decodeSearchCursor(cursor, {
      queryHash: payload.queryHash,
      sort: "newest",
      secret: SECRET,
    })).toBeNull();
    expect(() => encodeSearchCursor({
      ...payload,
      sponsoredIds: ["duplicate", "duplicate"],
    }, SECRET)).toThrow();
    expect(() => encodeSearchCursor({
      ...payload,
      organicTuple: { ...payload.organicTuple, onTimeRateBps: null },
    }, SECRET)).toThrow();
  });

  it("round-trips the complete cursor tuple for every organic sort", () => {
    for (const sort of [
      "relevance",
      "newest",
      "fair-score",
      "salary",
      "response",
    ] as const) {
      const payload = {
        policyVersion: "v1" as const,
        configVersion: "v1" as const,
        queryHash: "e".repeat(64),
        rankingAsOf: RANKING_AS_OF.toISOString(),
        sponsoredIds: ["sponsored"],
        organicTuple: createOrganicCursorTuple(sort, job("boundary")),
      } satisfies SearchCursorPayload;
      const cursor = encodeSearchCursor(payload, SECRET);
      expect(decodeSearchCursor(cursor, {
        queryHash: payload.queryHash,
        sort,
        secret: SECRET,
      })).toEqual(payload);
    }
  });

  it("paginates the global order and survives expiry, removal and concurrent publish", () => {
    const queryHash = "c".repeat(64);
    const firstCandidates = [
      job("boost-a", {
        activeBoost: true,
        relevanceTier: 3,
        publishedAt: new Date("2026-07-17T00:00:00Z"),
      }),
      job("boost-b", {
        activeBoost: true,
        relevanceTier: 2,
        publishedAt: new Date("2026-07-16T00:00:00Z"),
      }),
      job("organic-1", { publishedAt: new Date("2026-07-19T00:00:00Z") }),
      job("organic-2", { publishedAt: new Date("2026-07-18T00:00:00Z") }),
      job("organic-3", { publishedAt: new Date("2026-07-17T00:00:00Z") }),
    ];
    const first = paginateSearchJobs({
      candidates: firstCandidates,
      sort: "newest",
      hasQuery: false,
      pageSize: 3,
      queryHash,
      rankingAsOf: RANKING_AS_OF,
    });
    expect(first.ranked.map(({ job: ranked }) => ranked.id)).toEqual([
      "boost-a",
      "boost-b",
      "organic-1",
    ]);
    expect(first.selectedSponsoredIds).toEqual(["boost-a", "boost-b"]);
    expect(first.nextCursorPayload?.organicTuple).toEqual(
      createOrganicCursorTuple("newest", firstCandidates[2]!),
    );

    const encoded = encodeSearchCursor(first.nextCursorPayload!, SECRET);
    const decoded = decodeSearchCursor(encoded, { queryHash, sort: "newest", secret: SECRET });
    expect(decoded).not.toBeNull();
    const second = paginateSearchJobs({
      candidates: [
        job("boost-a", {
          activeBoost: false,
          relevanceTier: 3,
          publishedAt: new Date("2026-07-17T00:00:00Z"),
        }),
        // boost-b and the page-boundary organic-1 were removed after page one.
        job("organic-2", { publishedAt: new Date("2026-07-18T00:00:00Z") }),
        job("organic-3", { publishedAt: new Date("2026-07-17T00:00:00Z") }),
        job("concurrent-new", { publishedAt: new Date("2026-07-19T13:00:00Z") }),
      ],
      sort: "newest",
      hasQuery: false,
      pageSize: 3,
      queryHash,
      rankingAsOf: new Date("2030-01-01T00:00:00Z"),
      cursor: decoded!,
    });
    expect(second.ranked.map(({ job: ranked }) => ranked.id)).toEqual([
      "organic-2",
      "organic-3",
    ]);
    expect(second.ranked.every(({ sponsored }) => !sponsored)).toBe(true);
    expect(second.nextCursorPayload).toBeNull();
    expect(paginateSearchJobs({
      candidates: [
        job("boost-a", {
          activeBoost: false,
          relevanceTier: 3,
          publishedAt: new Date("2026-07-17T00:00:00Z"),
        }),
        job("organic-2", { publishedAt: new Date("2026-07-18T00:00:00Z") }),
        job("organic-3", { publishedAt: new Date("2026-07-17T00:00:00Z") }),
      ],
      sort: "newest",
      hasQuery: false,
      pageSize: 3,
      queryHash,
      rankingAsOf: new Date("2030-01-01T00:00:00Z"),
      cursor: decoded!,
    }).ranked.map(({ job: ranked }) => ranked.id)).toEqual(["organic-2", "organic-3"]);
  });

  it("uses a null organic position when sponsored jobs fill a small first page", () => {
    const queryHash = "d".repeat(64);
    const candidates = [
      job("boost-top", { activeBoost: true, relevanceScore: 3 }),
      job("boost-second", { activeBoost: true, relevanceScore: 2 }),
      job("organic", { relevanceScore: 1 }),
    ];
    const first = paginateSearchJobs({
      candidates,
      sort: "relevance",
      hasQuery: true,
      pageSize: 1,
      queryHash,
      rankingAsOf: RANKING_AS_OF,
    });
    expect(first.ranked.map(({ job: ranked }) => ranked.id)).toEqual(["boost-top"]);
    expect(first.selectedSponsoredIds).toEqual(["boost-top"]);
    expect(first.nextCursorPayload?.organicTuple).toBeNull();
    const second = paginateSearchJobs({
      candidates,
      sort: "relevance",
      hasQuery: true,
      pageSize: 2,
      queryHash,
      rankingAsOf: RANKING_AS_OF,
      cursor: first.nextCursorPayload!,
    });
    expect(second.ranked.map(({ job: ranked }) => ranked.id)).toEqual([
      "boost-second",
      "organic",
    ]);
    expect(second.ranked.every(({ sponsored }) => !sponsored)).toBe(true);
  });

  it("replays nullable cursor tuples without skipping equal-score jobs", () => {
    const older = job("null-b", {
      fairScore: null,
      publishedAt: new Date("2026-07-17T00:00:00Z"),
    });
    const newer = job("null-a", {
      fairScore: null,
      publishedAt: new Date("2026-07-18T00:00:00Z"),
    });
    const newerTuple = createOrganicCursorTuple("fair-score", newer);
    const olderTuple = createOrganicCursorTuple("fair-score", older);
    expect(compareOrganicCursorTuples(olderTuple, newerTuple)).toBeGreaterThan(0);
    expect(compareOrganicCursorTuples(newerTuple, newerTuple)).toBe(0);
  });
});
