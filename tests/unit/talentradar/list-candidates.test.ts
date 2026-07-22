// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  RadarDistinctFilterBudget,
  RadarDistinctFilterBudgetDecision,
} from "@/lib/auth/rate-limit";
import { RADAR_CONSENT_NOTICE_V1 } from "@/lib/privacy/radar-consent";
import {
  buildPrismaRadarCandidateSelect,
  listRadarCandidates,
  type RadarCandidateListRepository,
  type RadarEmployerAccessSnapshot,
  type RadarListCandidateRecord,
  type RadarListCandidatesDependencies,
  type RadarMembershipListRateLimit,
  type RadarSearchSessionSnapshot,
} from "@/lib/talentradar/list-candidates";
import type { RadarPrivacyHmacKeyV1 } from "@/lib/talentradar/privacy-policy-v1";

const NOW = new Date("2026-07-22T10:00:00.000Z");
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const SKILL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HMAC_KEY: RadarPrivacyHmacKeyV1 = {
  version: "radar-v1",
  secret: Buffer.alloc(32, 41).toString("base64"),
};
const LOOKUP_KEY = {
  version: "lookup-v1",
  secret: Buffer.alloc(32, 42).toString("base64"),
};
const ENCRYPTION_KEY = {
  version: "encryption-v1",
  secret: Buffer.alloc(32, 43).toString("base64"),
};

function candidateId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function candidate(
  index: number,
  override: Partial<RadarListCandidateRecord> = {},
): RadarListCandidateRecord {
  const base: RadarListCandidateRecord = {
    candidateProfileId: candidateId(index),
    salaryPeriod: "YEARLY",
    eligibility: {
      userStatus: "ACTIVE",
      onboardingStatus: "COMPLETE",
      candidateProvenance: "LIVE",
      latestVisibilityConsent: {
        kind: "TALENT_RADAR_VISIBILITY",
        granted: true,
        noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
        noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
        effectiveAt: new Date("2026-07-20T10:00:00.000Z"),
      },
      radarProfile: {
        publishedAt: new Date("2026-07-20T10:00:00.000Z"),
        withdrawnAt: null,
      },
    },
    radar: {
      cantonBucket: "ZH",
      categoryBucket: "software-development",
      workloadMin: 60,
      workloadMax: 100,
      salaryYearlyMinChf: 115_000,
      salaryYearlyMaxChf: 135_000,
      languageCodes: ["de", "en"],
      skillSlugs: ["typescript", "react"],
      remotePreference: "HYBRID",
      availabilityBucket: "WITHIN_30_DAYS",
    },
    activeCategorySlugs: ["software-development"],
    skills: [
      { skillId: SKILL_ID, slug: "typescript", active: true },
      {
        skillId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        slug: "react",
        active: true,
      },
    ],
    languages: [
      { code: "de", level: "B2" },
      { code: "en", level: "C1" },
    ],
  };
  return { ...base, ...override };
}

function access(
  override: Partial<RadarEmployerAccessSnapshot> = {},
): RadarEmployerAccessSnapshot {
  return {
    membershipId: MEMBERSHIP_ID,
    membershipUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    membershipStatus: "ACTIVE",
    membershipRole: "RECRUITER",
    userStatus: "ACTIVE",
    companyStatus: "ACTIVE",
    currentVerifiedEvidenceCount: 1,
    talentRadarAccess: true,
    ...override,
  };
}

type Harness = Readonly<{
  dependencies: RadarListCandidatesDependencies;
  repository: RadarCandidateListRepository;
  candidateQuery: ReturnType<typeof vi.fn>;
  membershipLimit: ReturnType<typeof vi.fn>;
  distinctBudget: ReturnType<typeof vi.fn>;
  currentSession(): RadarSearchSessionSnapshot | null;
}>;

function harness(input: Readonly<{
  access?: RadarEmployerAccessSnapshot | null;
  rows?: readonly RadarListCandidateRecord[];
  membershipAllowed?: boolean;
  distinctAllowed?: boolean;
}> = {}): Harness {
  let session: RadarSearchSessionSnapshot | null = null;
  const candidateQuery = vi.fn(async (
    query: Parameters<RadarCandidateListRepository["listCandidates"]>[0],
  ) => [...(input.rows ?? [])]
    .sort((left, right) =>
      left.candidateProfileId.localeCompare(right.candidateProfileId))
    .filter(({ candidateProfileId }) =>
      query.afterCandidateProfileId === null ||
      candidateProfileId.localeCompare(query.afterCandidateProfileId) > 0)
    .slice(0, query.limit));
  const membershipLimit = vi.fn(async () => input.membershipAllowed === false
    ? { allowed: false as const, retryAfterSeconds: 17 }
    : { allowed: true as const });
  const distinctBudget = vi.fn(async () => input.distinctAllowed === false
    ? deniedDistinctBudget()
    : allowedDistinctBudget());
  const repository: RadarCandidateListRepository = {
    getEmployerAccess: vi.fn(async () =>
      input.access === undefined ? access() : input.access),
    findSearchSession: vi.fn(async (scope) =>
      session !== null &&
      session.companyId === scope.companyId &&
      session.membershipId === scope.membershipId &&
      session.requestingUserId === scope.requestingUserId &&
      session.filterHash === scope.filterHash &&
      session.calendarDate === scope.calendarDate
        ? session
        : null),
    listCandidates: candidateQuery,
    persistSearchSession: vi.fn(async (request) => {
      session = session === null
        ? {
            id: SESSION_ID,
            companyId: request.companyId,
            membershipId: request.membershipId,
            requestingUserId: request.requestingUserId,
            filterHash: request.filterHash,
            calendarDate: request.calendarDate,
            policyVersion: request.policyVersion,
            expiresAt: request.expiresAt,
            candidateProfileIds: [...request.candidateProfileIds],
          }
        : { ...session, expiresAt: request.expiresAt };
      return session;
    }),
    getOrCreateOpaqueId: vi.fn(async ({ candidateProfileId }) =>
      opaqueToken(Number(candidateProfileId.slice(-12)))),
  };
  const rateLimit: RadarMembershipListRateLimit = { consume: membershipLimit };
  const budget: RadarDistinctFilterBudget = { consume: distinctBudget };
  return {
    repository,
    candidateQuery,
    membershipLimit,
    distinctBudget,
    currentSession: () => session,
    dependencies: {
      repository,
      membershipRateLimit: rateLimit,
      distinctFilterBudget: budget,
      samplingKey: HMAC_KEY,
      cursorKeyring: [HMAC_KEY],
      opaqueLookupKeyring: [LOOKUP_KEY],
      opaqueEncryptionKeyring: [ENCRYPTION_KEY],
    },
  };
}

function request(
  override: Partial<Parameters<typeof listRadarCandidates>[0]> = {},
) {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    filters: {},
    now: NOW,
    environment: "development" as const,
    ...override,
  };
}

function opaqueToken(index: number): string {
  const bytes = Buffer.alloc(16, 0);
  bytes.writeUInt32BE(index, 12);
  return bytes.toString("base64url");
}

function allowedDistinctBudget(): RadarDistinctFilterBudgetDecision {
  return {
    allowed: true,
    status: 200,
    calendarDate: "2026-07-22",
    isNewFilter: true,
    distinctFiltersUsed: 1,
    remaining: 29,
  };
}

function deniedDistinctBudget(): RadarDistinctFilterBudgetDecision {
  return {
    allowed: false,
    status: 429,
    code: "RADAR_DISTINCT_FILTER_BUDGET_EXHAUSTED",
    calendarDate: "2026-07-22",
    distinctFiltersUsed: 30,
    retryAfterSeconds: 123,
    audit: { action: "RATE_LIMITED", preset: "RADAR_LIST", scope: "COMPANY" },
  };
}

describe("Talent Radar employer authorization before Candidate access", () => {
  it.each([
    ["missing Membership", null, "NO_ACTIVE_MEMBERSHIP"],
    ["VIEWER", access({ membershipRole: "VIEWER" }), "NO_ACTIVE_MEMBERSHIP"],
    ["suspended Membership", access({ membershipStatus: "SUSPENDED" }), "NO_ACTIVE_MEMBERSHIP"],
    ["inactive User", access({ userStatus: "SUSPENDED" }), "USER_INACTIVE"],
    ["draft Company", access({ companyStatus: "DRAFT" }), "COMPANY_INACTIVE"],
    ["suspended Company", access({ companyStatus: "SUSPENDED" }), "COMPANY_INACTIVE"],
    ["no current verification", access({ currentVerifiedEvidenceCount: 0 }), "COMPANY_UNVERIFIED"],
    ["ambiguous verification", access({ currentVerifiedEvidenceCount: 2 }), "COMPANY_UNVERIFIED"],
    ["no effective entitlement", access({ talentRadarAccess: false }), "TALENT_RADAR_NOT_INCLUDED"],
  ] as const)("locks %s without issuing a Candidate query", async (_label, actorAccess, reason) => {
    const test = harness({ access: actorAccess, rows: Array.from({ length: 20 }, (_, i) => candidate(i + 1)) });
    await expect(listRadarCandidates(request(), test.dependencies)).resolves.toMatchObject({
      status: "LOCKED",
      reason,
    });
    expect(test.candidateQuery).not.toHaveBeenCalled();
    expect(test.membershipLimit).not.toHaveBeenCalled();
    expect(test.distinctBudget).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "ADMIN", "RECRUITER"] as const)(
    "accepts an active %s with exactly one current verification",
    async (membershipRole) => {
      const test = harness({
        access: access({ membershipRole }),
        rows: Array.from({ length: 10 }, (_, i) => candidate(i + 1)),
      });
      await expect(listRadarCandidates(request(), test.dependencies)).resolves.toMatchObject({
        status: "AVAILABLE",
      });
      expect(test.candidateQuery).toHaveBeenCalledOnce();
    },
  );
});

describe("closed filters and enumeration limits", () => {
  it("returns INVALID_FILTER before repositories for unknown, array and free-text predicates", async () => {
    for (const filters of [
      { query: "typescript" },
      { skillId: [SKILL_ID] },
      { sort: "salary" },
    ]) {
      const test = harness();
      await expect(listRadarCandidates(request({ filters }), test.dependencies))
        .resolves.toEqual({ status: "INVALID_FILTER" });
      expect(test.repository.getEmployerAccess).not.toHaveBeenCalled();
      expect(test.candidateQuery).not.toHaveBeenCalled();
    }
  });

  it("enforces membership rolling-rate and Company daily-hash budgets before Candidate access", async () => {
    const rateLimited = harness({ membershipAllowed: false });
    await expect(listRadarCandidates(request(), rateLimited.dependencies)).resolves.toEqual({
      status: "LIMIT",
      limit: "MEMBERSHIP_RATE",
      retryAfterSeconds: 17,
    });
    expect(rateLimited.candidateQuery).not.toHaveBeenCalled();
    expect(rateLimited.distinctBudget).not.toHaveBeenCalled();

    const budgetLimited = harness({ distinctAllowed: false });
    await expect(listRadarCandidates(request(), budgetLimited.dependencies)).resolves.toEqual({
      status: "LIMIT",
      limit: "DISTINCT_FILTERS",
      retryAfterSeconds: 123,
    });
    expect(budgetLimited.membershipLimit).toHaveBeenCalledWith({
      membershipId: MEMBERSHIP_ID,
      now: NOW,
    });
    expect(budgetLimited.candidateQuery).not.toHaveBeenCalled();
  });
});

describe("canonical final conjunction, cohort floor and Safe DTO", () => {
  const filters = {
    skillId: SKILL_ID,
    cantonCode: "ZH",
    salaryBudgetCeilingChf: 120_000,
    workloadMinimumPercent: 80,
    languageCode: "de",
    languageMinimumLevel: "WORKING",
    remotePreference: "HYBRID",
  };

  it("applies every filter and canonical eligibility check before calculating the cohort", async () => {
    const matching = Array.from({ length: 10 }, (_, i) => candidate(i + 1));
    const excluded = [
      candidate(101, {
        eligibility: { ...candidate(101).eligibility, userStatus: "SUSPENDED" },
      }),
      candidate(102, {
        eligibility: {
          ...candidate(102).eligibility,
          latestVisibilityConsent: {
            ...candidate(102).eligibility.latestVisibilityConsent!,
            granted: false,
          },
        },
      }),
      candidate(103, { radar: { ...candidate(103).radar!, cantonBucket: "BE" } }),
      candidate(104, { radar: { ...candidate(104).radar!, salaryYearlyMinChf: null } }),
      candidate(110, { salaryPeriod: "MONTHLY" }),
      candidate(105, { radar: { ...candidate(105).radar!, workloadMax: 60 } }),
      candidate(106, { languages: [{ code: "de", level: "A2" }] }),
      candidate(107, { radar: { ...candidate(107).radar!, remotePreference: "REMOTE" } }),
      candidate(108, { skills: [{ skillId: SKILL_ID, slug: "typescript", active: false }] }),
      candidate(109, { activeCategorySlugs: ["healthcare"] }),
    ];
    const test = harness({ rows: [...matching, ...excluded] });
    const result = await listRadarCandidates(request({ filters }), test.dependencies);
    expect(result).toMatchObject({ status: "AVAILABLE", countLabel: "10+" });
    if (result.status !== "AVAILABLE") throw new Error("Expected AVAILABLE.");
    expect(result.candidates).toHaveLength(10);
    expect(result.nextCursor).toBeNull();
  });

  it("returns one indistinguishable suppression shape for zero through nine and persists no session", async () => {
    for (const count of [0, 1, 9]) {
      const test = harness({ rows: Array.from({ length: count }, (_, i) => candidate(i + 1)) });
      const result = await listRadarCandidates(request(), test.dependencies);
      expect(result).toEqual({ status: "INSUFFICIENT_COHORT" });
      expect(JSON.stringify(result)).not.toMatch(/count|total|size|candidate/i);
      expect(test.repository.persistSearchSession).not.toHaveBeenCalled();
    }
  });

  it("emits only selected coarse fields and never Candidate PK or identity canaries", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ...candidate(i + 1),
      firstName: `CANARY_FIRST_${i}`,
      email: `canary-${i}@example.invalid`,
      phone: `+4100000${i}`,
      cvStorageKey: `private/cv/${i}`,
    }));
    const test = harness({ rows });
    const result = await listRadarCandidates(request({ filters }), test.dependencies);
    expect(result).toMatchObject({ status: "AVAILABLE", countLabel: "10+" });
    if (result.status !== "AVAILABLE") throw new Error("Expected AVAILABLE.");
    expect(result.candidates).toHaveLength(10);
    expect(result.nextCursor).toEqual(expect.any(String));
    for (const card of result.candidates) {
      expect(card).toMatchObject({
        displayLabel: "software-development · ZH",
        cantonBucket: "ZH",
        categoryBucket: "software-development",
        skillSlugs: ["typescript"],
        workloadBucket: "80",
        salaryBucket: "CHF_110000",
        salaryPeriod: "YEARLY_FTE",
        languageCodes: ["de"],
        remotePreference: "HYBRID",
      });
      expect(Object.keys(card).sort()).toEqual([
        "cantonBucket",
        "categoryBucket",
        "displayLabel",
        "languageCodes",
        "opaqueId",
        "remotePreference",
        "salaryBucket",
        "salaryPeriod",
        "skillSlugs",
        "workloadBucket",
      ]);
    }
    const serialized = JSON.stringify(result);
    for (const row of rows) {
      expect(serialized).not.toContain(row.candidateProfileId);
      expect(serialized).not.toContain(row.firstName);
      expect(serialized).not.toContain(row.email);
      expect(serialized).not.toContain(row.phone);
      expect(serialized).not.toContain(row.cvStorageKey);
    }
    expect(result).not.toHaveProperty("total");
    expect(result).not.toHaveProperty("exactCount");
  });

  it("never treats absent/non-yearly salary projection as salary-matchable", async () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => candidate(i + 1)),
      candidate(20, { radar: { ...candidate(20).radar!, salaryYearlyMinChf: null, salaryYearlyMaxChf: null } }),
      candidate(21, { salaryPeriod: "MONTHLY" }),
    ];
    const test = harness({ rows });
    await expect(listRadarCandidates(
      request({ filters: { salaryBudgetCeilingChf: 120_000 } }),
      test.dependencies,
    )).resolves.toEqual({ status: "INSUFFICIENT_COHORT" });
  });
});

describe("bounded daily sample, member session and signed cursor", () => {
  it("scans large cohorts through bounded pages while retaining only the 20-card sample", async () => {
    const test = harness({
      rows: Array.from({ length: 450 }, (_, i) => candidate(i + 1)).reverse(),
    });
    const result = await listRadarCandidates(request(), test.dependencies);
    expect(result).toMatchObject({ status: "AVAILABLE", countLabel: "100+" });
    if (result.status !== "AVAILABLE") throw new Error("Expected AVAILABLE.");
    expect(result.candidates).toHaveLength(10);
    expect(test.currentSession()?.candidateProfileIds).toHaveLength(20);
    expect(test.candidateQuery).toHaveBeenCalledTimes(3);
    for (const [query] of test.candidateQuery.mock.calls) {
      expect(query.limit).toBe(200);
    }
  });

  it("serves exactly two stable ten-card pages from a max-20 daily sample", async () => {
    const test = harness({
      rows: Array.from({ length: 30 }, (_, i) => candidate(i + 1)),
    });
    const first = await listRadarCandidates(request(), test.dependencies);
    expect(first).toMatchObject({ status: "AVAILABLE", countLabel: "25+" });
    if (first.status !== "AVAILABLE" || first.nextCursor === null) {
      throw new Error("Expected first Radar page and cursor.");
    }
    expect(first.candidates).toHaveLength(10);
    expect(test.currentSession()?.candidateProfileIds).toHaveLength(20);

    const second = await listRadarCandidates(request({
      cursor: first.nextCursor,
      now: new Date(NOW.getTime() + 1),
    }), test.dependencies);
    expect(second).toMatchObject({ status: "AVAILABLE", nextCursor: null });
    if (second.status !== "AVAILABLE") throw new Error("Expected second Radar page.");
    expect(second.candidates).toHaveLength(10);
    expect(new Set([
      ...first.candidates.map(({ opaqueId }) => opaqueId),
      ...second.candidates.map(({ opaqueId }) => opaqueId),
    ])).toHaveLength(20);
    expect(test.candidateQuery).toHaveBeenCalledTimes(2);
  });

  it("rejects expired, filter-replayed and non-member-session cursors before Candidate access", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => candidate(i + 1));
    const test = harness({ rows });
    const first = await listRadarCandidates(request(), test.dependencies);
    if (first.status !== "AVAILABLE" || first.nextCursor === null) {
      throw new Error("Expected first Radar page and cursor.");
    }
    expect(test.candidateQuery).toHaveBeenCalledTimes(1);

    await expect(listRadarCandidates(request({
      cursor: first.nextCursor,
      filters: { cantonCode: "ZH" },
    }), test.dependencies)).resolves.toEqual({ status: "INVALID_CURSOR" });
    expect(test.candidateQuery).toHaveBeenCalledTimes(1);

    await expect(listRadarCandidates(request({
      cursor: first.nextCursor,
      now: new Date(NOW.getTime() + 15 * 60 * 1_000),
    }), test.dependencies)).resolves.toEqual({ status: "INVALID_CURSOR" });
    expect(test.candidateQuery).toHaveBeenCalledTimes(1);

    (test.repository.getEmployerAccess as ReturnType<typeof vi.fn>).mockResolvedValue(
      access({ membershipId: "55555555-5555-4555-8555-555555555555" }),
    );
    await expect(listRadarCandidates(request({ cursor: first.nextCursor }), test.dependencies))
      .resolves.toEqual({ status: "INVALID_CURSOR" });
    expect(test.candidateQuery).toHaveBeenCalledTimes(1);
  });

  it("keeps same-day order independent of repository row order", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => candidate(i + 1));
    const firstHarness = harness({ rows });
    const secondHarness = harness({ rows: [...rows].reverse() });
    const [first, second] = await Promise.all([
      listRadarCandidates(request(), firstHarness.dependencies),
      listRadarCandidates(request(), secondHarness.dependencies),
    ]);
    expect(first.status).toBe("AVAILABLE");
    expect(second.status).toBe("AVAILABLE");
    if (first.status !== "AVAILABLE" || second.status !== "AVAILABLE") {
      throw new Error("Expected deterministic Radar pages.");
    }
    expect(first.candidates.map(({ opaqueId }) => opaqueId)).toEqual(
      second.candidates.map(({ opaqueId }) => opaqueId),
    );
  });
});

describe("identity-safe Prisma projection", () => {
  it("selects eligibility and coarse Radar fields without identity-bearing columns", () => {
    const select = buildPrismaRadarCandidateSelect(NOW);
    const serialized = JSON.stringify(select);
    for (const forbidden of [
      "firstName",
      "lastName",
      "publicDisplayName",
      "email",
      "phone",
      "postalCode",
      "cityLabel",
      "documents",
      "cvFileName",
      "cvStorageKey",
      "summary",
    ]) expect(serialized).not.toContain(forbidden);
    expect(serialized).toContain('"radarConsents"');
    expect(serialized).toContain('"radarProfile"');
    expect(serialized).toContain('"skillId"');
    expect(serialized).toContain('"level"');
  });
});
