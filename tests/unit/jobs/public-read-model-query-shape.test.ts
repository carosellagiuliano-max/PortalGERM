// @vitest-environment node

import { Buffer } from "node:buffer";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databaseMocks = vi.hoisted(() => ({
  jobFindMany: vi.fn(),
  applicationFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
  cantonFindMany: vi.fn(),
  cityFindMany: vi.fn(),
  queryRaw: vi.fn(),
  jobRevisionFindFirst: vi.fn(),
  restrictionFindMany: vi.fn(),
  transactionOptions: vi.fn(),
}));

const publicRuntime = vi.hoisted(() => ({
  dataContext: {
    eligibilityEnvironment: "production" as "production" | "non-production",
    liveOnly: true,
    publicIndexingAllowed: true,
    showDemoBanner: false,
  },
}));

vi.mock("@/lib/db/client", () => ({
  getDatabase: () => {
    const transaction = {
      job: { findMany: databaseMocks.jobFindMany },
      application: { findMany: databaseMocks.applicationFindMany },
      category: { findMany: databaseMocks.categoryFindMany },
      canton: { findMany: databaseMocks.cantonFindMany },
      city: { findMany: databaseMocks.cityFindMany },
      moderationRestriction: { findMany: databaseMocks.restrictionFindMany },
      $queryRaw: databaseMocks.queryRaw,
    };
    return {
      ...transaction,
      jobRevision: { findFirst: databaseMocks.jobRevisionFindFirst },
      $transaction: async (
        operation: (client: typeof transaction) => Promise<unknown>,
        options: unknown,
      ) => {
        databaseMocks.transactionOptions(options);
        return operation(transaction);
      },
    };
  },
}));

vi.mock("@/lib/public/environment", () => ({
  getPublicDataContext: () => publicRuntime.dataContext,
}));

vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: () => ({
    APP_URL: "https://swisstalenthub.test",
    secrets: {
      session: {
        withValue: (consumer: (secret: string) => unknown) =>
          consumer("phase-07-query-shape-secret-000000000000"),
      },
    },
  }),
}));

import {
  PUBLIC_CLUSTER_DISCOVERY_POLICY_V1,
  emptyPublicJobSearchInput,
  getPublicJobBySlug,
  listPublicClusterLinks,
  listPublicJobs,
  loadPublicOpenJobCounts,
} from "@/lib/jobs/public-read-model";
import { parsePublicJobSearchParams } from "@/lib/public/query-params";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID_2 = "11111111-1111-4111-8111-111111111112";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID_3 = "11111111-1111-4111-8111-111111111113";
const EMPTY_RESPONSE_FINGERPRINT = "d41d8cd98f00b204e9800998ecf8427e";

type MockDatabaseRankingRow = Readonly<{
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

let rankingScenario: Readonly<{
  sponsored: readonly MockDatabaseRankingRow[];
  organic: readonly MockDatabaseRankingRow[];
  totalEligible: number;
  responseProjectionFingerprint: string;
}>;

const DETAIL_ONLY_REVISION_FIELDS = [
  "companyIntro",
  "tasks",
  "requirements",
  "niceToHave",
  "offer",
  "applicationProcessSteps",
  "requiredDocumentKinds",
  "remoteCountryCode",
  "startDate",
  "startByArrangement",
  "inclusionStatement",
  "applicationContactKind",
  "applicationContactValue",
  "benefits",
  "skills",
  "languages",
] as const;

describe("public Job query data minimization", () => {
  beforeEach(() => {
    publicRuntime.dataContext = {
      eligibilityEnvironment: "production",
      liveOnly: true,
      publicIndexingAllowed: true,
      showDemoBanner: false,
    };
    databaseMocks.jobFindMany.mockResolvedValue([]);
    databaseMocks.applicationFindMany.mockResolvedValue([]);
    databaseMocks.categoryFindMany.mockResolvedValue([]);
    databaseMocks.cantonFindMany.mockResolvedValue([]);
    databaseMocks.cityFindMany.mockResolvedValue([]);
    installDatabaseRanking({ organic: [], totalEligible: 0 });
    databaseMocks.jobRevisionFindFirst.mockResolvedValue(null);
    databaseMocks.restrictionFindMany.mockResolvedValue([]);
  });

  it("keeps list queries on the card projection without detail-only fields", async () => {
    const row = eligibleCardRow();
    installDatabaseRanking({
      organic: [databaseRankingRow(row)],
      totalEligible: 1,
    });
    installSearchHydrationRows([row]);
    const result = await listPublicJobs(emptyPublicJobSearchInput(), { now: NOW });

    const query = databaseMocks.jobFindMany.mock.calls[0]?.[0];
    const revisionSelect = query?.select?.publishedRevision?.select;
    expect(revisionSelect).toBeDefined();
    for (const field of DETAIL_ONLY_REVISION_FIELDS) {
      expect(revisionSelect).not.toHaveProperty(field);
    }
    expect(revisionSelect?.scoreSnapshots?.select).toEqual({ scorePoints: true });
    expect(query?.select?.boosts).toEqual({
      where: {
        status: { not: "CANCELLED" },
        startsAt: { lte: NOW },
        endsAt: { gt: NOW },
      },
      orderBy: [{ startsAt: "desc" }, { id: "asc" }],
      take: 1,
      select: {
        companyId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        cancelledAt: true,
      },
    });
    expect(query).toMatchObject({
      orderBy: { id: "asc" },
      take: 1,
    });
    expect(query?.where?.id).toEqual({ in: [JOB_ID] });
    expect(query).not.toHaveProperty("skip");
    expect(result).toMatchObject({
      totalEligible: 1,
      resultCountIsExact: true,
      candidateSetTruncated: false,
    });
    expect(databaseMocks.transactionOptions).toHaveBeenCalledWith({
      isolationLevel: "RepeatableRead",
      timeout: 30_000,
    });
  });

  it("ranks keyword fields in PostgreSQL and hydrates only the card projection", async () => {
    const row = eligibleCardRow();
    const keywordRow = {
      ...row,
      publishedRevision: {
        ...row.publishedRevision,
        tasks: ["Kubernetes-Plattform betreiben"],
        requirements: ["TypeScript"],
        offer: "Lernbudget",
      },
    };
    installDatabaseRanking({
      organic: [databaseRankingRow(keywordRow, {
        relevanceTier: 1,
        relevanceScore: 1,
      })],
      totalEligible: 1,
    });
    installSearchHydrationRows([keywordRow]);

    const result = await listPublicJobs(
      { ...emptyPublicJobSearchInput(), keyword: "Kubernetes" },
      { now: NOW },
    );

    const query = databaseMocks.jobFindMany.mock.calls[0]?.[0];
    expect(query?.select?.publishedRevision?.select).not.toHaveProperty("tasks");
    expect(query?.select?.publishedRevision?.select).not.toHaveProperty("requirements");
    expect(query?.select?.publishedRevision?.select).not.toHaveProperty("offer");
    expect(query?.where?.publishedRevision?.is).not.toHaveProperty("OR");
    expect(databaseMocks.queryRaw).toHaveBeenCalledTimes(2);
    const rawSql = databaseMocks.queryRaw.mock.calls
      .map(([statement]) => statement.strings.join(" "))
      .join("\n");
    expect(rawSql).toContain('array_to_string(revision."tasks"');
    expect(rawSql).toContain('array_to_string(revision."requirements"');
    expect(result.jobs.map((job) => job.id)).toEqual([JOB_ID]);
    expect(result.totalEligible).toBe(1);
    expect(JSON.stringify(result.jobs)).not.toContain("Kubernetes-Plattform betreiben");
  });

  it("scans beyond the former 2,000-row cap without truncating the exact total", async () => {
    const rows = [
      searchCardRow(JOB_ID, "cap-job-newest", NOW),
      searchCardRow(JOB_ID_2, "cap-job-sentinel", new Date(NOW.getTime() - 1_000)),
    ];
    installDatabaseRanking({
      organic: rows.map((row) => databaseRankingRow(row)),
      totalEligible: 2_101,
    });
    installSearchHydrationRows(rows);

    const result = await listPublicJobs(emptyPublicJobSearchInput(), {
      now: NOW,
      pageSize: 1,
    });

    expect(databaseMocks.jobFindMany.mock.calls[0]?.[0]?.take).toBe(2);
    expect(result).toMatchObject({
      totalEligible: 2_101,
      resultCountIsExact: true,
      candidateSetTruncated: false,
    });
    expect(result.jobs).toHaveLength(1);
    expect(databaseMocks.jobFindMany).toHaveBeenCalledOnce();
    expect(databaseMocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(databaseMocks.jobFindMany.mock.calls[0]?.[0]?.skip).toBeUndefined();
  });

  it("keeps minimum-salary and salary-sort queries on the requested comparable period", async () => {
    const row = eligibleCardRow();
    installDatabaseRanking({ organic: [databaseRankingRow(row)], totalEligible: 1 });
    installSearchHydrationRows([row]);
    await listPublicJobs(
      {
        ...emptyPublicJobSearchInput(),
        salaryMin: 120_000,
        salaryPeriod: "MONTHLY",
        salaryDisclosedOnly: true,
      },
      { now: NOW },
    );
    const minimumSalaryWhere = databaseMocks.jobFindMany.mock.calls[0]?.[0]?.where;
    expect(minimumSalaryWhere).toMatchObject({
      publishedSalaryPeriod: "MONTHLY",
      publishedSalaryMin: { not: null },
      publishedSalaryMax: { gte: 120_000, not: null },
    });
    expect(minimumSalaryWhere?.publishedRevision?.is).not.toHaveProperty("salaryPeriod");

    databaseMocks.jobFindMany.mockClear();
    installDatabaseRanking({ organic: [databaseRankingRow(row)], totalEligible: 1 });
    installSearchHydrationRows([row]);
    await listPublicJobs(
      {
        ...emptyPublicJobSearchInput(),
        sort: "salary",
        salaryPeriod: "HOURLY",
        salaryDisclosedOnly: true,
      },
      { now: NOW },
    );
    const salarySortWhere = databaseMocks.jobFindMany.mock.calls[0]?.[0]?.where;
    expect(salarySortWhere).toMatchObject({
      publishedSalaryPeriod: "HOURLY",
      publishedSalaryMin: { not: null },
      publishedSalaryMax: { not: null },
    });
  });

  it("resolves catalog filters by validated UUID or slug without casting slugs to UUID", async () => {
    const row = eligibleCardRow();
    installDatabaseRanking({ organic: [databaseRankingRow(row)], totalEligible: 1 });
    installSearchHydrationRows([row]);
    databaseMocks.categoryFindMany.mockResolvedValue([{
      id: "44444444-4444-4444-8444-444444444444",
    }]);
    databaseMocks.cantonFindMany.mockResolvedValue([{
      id: "55555555-5555-4555-8555-555555555555",
    }]);
    databaseMocks.cityFindMany.mockResolvedValue([{
      id: "66666666-6666-4666-8666-666666666666",
    }]);
    await listPublicJobs({
      ...emptyPublicJobSearchInput(),
      cantonSlugs: ["bern", "55555555-5555-4555-8555-555555555555"],
      citySlugs: ["bern-stadt", "66666666-6666-4666-8666-666666666666"],
      categorySlugs: ["engineering-technik", "44444444-4444-4444-8444-444444444444"],
    }, { now: NOW });

    const queryWhere = databaseMocks.jobFindMany.mock.calls[0]?.[0]?.where;
    expect(queryWhere?.publishedCategoryId).toEqual({
      in: ["44444444-4444-4444-8444-444444444444"],
    });
    expect(queryWhere?.publishedCantonId).toEqual({
      in: ["55555555-5555-4555-8555-555555555555"],
    });
    expect(queryWhere?.publishedCityId).toEqual({
      in: ["66666666-6666-4666-8666-666666666666"],
    });
    expect(databaseMocks.categoryFindMany.mock.calls[0]?.[0]?.where?.OR).toEqual([
      { id: { in: ["44444444-4444-4444-8444-444444444444"] } },
      { slug: { in: ["engineering-technik"] } },
    ]);
    expect(databaseMocks.cantonFindMany.mock.calls[0]?.[0]?.where?.OR).toEqual([
      { id: { in: ["55555555-5555-4555-8555-555555555555"] } },
      { slug: { in: ["bern"] } },
    ]);
    expect(databaseMocks.cityFindMany.mock.calls[0]?.[0]?.where?.OR).toEqual([
      { id: { in: ["66666666-6666-4666-8666-666666666666"] } },
      { slug: { in: ["bern-stadt"] } },
    ]);
    expect(queryWhere?.publishedRevision?.is).toMatchObject({
      category: { is: { isActive: true } },
    });
  });

  it("does not query when a salary comparison has no explicit period", async () => {
    const result = await listPublicJobs({
      ...emptyPublicJobSearchInput(),
      salaryMin: 120_000,
    }, { now: NOW });

    expect(result).toMatchObject({
      jobs: [],
      nextCursor: null,
      totalEligible: 0,
      resultCountIsExact: true,
    });
    expect(databaseMocks.jobFindMany).not.toHaveBeenCalled();
  });

  it("fails a radius search closed when its unique City has no coordinates", async () => {
    databaseMocks.cityFindMany
      .mockResolvedValueOnce([{ id: "66666666-6666-4666-8666-666666666666" }])
      .mockResolvedValueOnce([{ latitude: null, longitude: null }]);

    const result = await listPublicJobs(
      parsePublicJobSearchParams({ city: "bern", radius: "25" }),
      { now: NOW },
    );

    expect(result).toMatchObject({
      jobs: [],
      totalEligible: 0,
      resultCountIsExact: true,
    });
    expect(databaseMocks.cityFindMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: {
        isActive: true,
        OR: [{ slug: { in: ["bern"] } }],
      },
    }));
    expect(databaseMocks.cityFindMany.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      where: { id: "66666666-6666-4666-8666-666666666666" },
      take: 2,
    }));
    expect(databaseMocks.queryRaw).not.toHaveBeenCalled();
    expect(databaseMocks.jobFindMany).not.toHaveBeenCalled();
  });

  it("applies a coordinate-backed radius in PostgreSQL without retaining an exact-City filter", async () => {
    const row = eligibleCardRow();
    databaseMocks.cityFindMany
      .mockResolvedValueOnce([{ id: "66666666-6666-4666-8666-666666666666" }])
      .mockResolvedValueOnce([{
        latitude: "46.948090",
        longitude: "7.447440",
      }]);
    installDatabaseRanking({ organic: [databaseRankingRow(row)], totalEligible: 1 });
    installSearchHydrationRows([row]);

    const result = await listPublicJobs(
      parsePublicJobSearchParams({ city: "bern", radius: "25" }),
      { now: NOW },
    );

    const query = databaseMocks.jobFindMany.mock.calls[0]?.[0];
    expect(query?.where?.id).toEqual({ in: [JOB_ID] });
    expect(query?.where?.publishedRevision?.is).not.toHaveProperty("city");
    expect(databaseMocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(result.jobs.map((job) => job.id)).toEqual([JOB_ID]);
  });

  it("binds radius changes into the signed cursor fingerprint", async () => {
    const rows = [
      searchCardRow(JOB_ID, "radius-newer", new Date("2026-07-10T00:00:00Z")),
      searchCardRow(JOB_ID_2, "radius-older", new Date("2026-07-09T00:00:00Z")),
    ];
    databaseMocks.cityFindMany.mockImplementation(async (query) =>
      query.select?.id
        ? [{ id: "66666666-6666-4666-8666-666666666666" }]
        : [{ latitude: "46.948090", longitude: "7.447440" }]);
    installDatabaseRanking({
      organic: rows.map((row) => databaseRankingRow(row)),
      totalEligible: 2,
    });
    installSearchHydrationRows(rows);
    const firstInput = parsePublicJobSearchParams({
      city: "bern",
      radius: "25",
      sort: "newest",
      pageSize: "1",
    });
    const first = await listPublicJobs(firstInput, { now: NOW });
    expect(first.nextCursor).toEqual(expect.any(String));

    installDatabaseRanking({
      organic: rows.map((row) => databaseRankingRow(row)),
      totalEligible: 2,
    });
    installSearchHydrationRows(rows);
    const changedRadius = await listPublicJobs({
      ...parsePublicJobSearchParams({
        city: "bern",
        radius: "30",
        sort: "newest",
        pageSize: "1",
      }),
      after: first.nextCursor as string,
    }, { now: NOW });

    expect(changedRadius.invalidCursor).toBe(true);
    expect(changedRadius.jobs[0]?.id).toBe(JOB_ID);
  });

  it("loads canonical response cases once per Company batch and encodes the real median", async () => {
    const rows = [
      searchCardRow(JOB_ID, "response-newer", new Date("2026-07-10T00:00:00Z")),
      searchCardRow(JOB_ID_2, "response-older", new Date("2026-07-09T00:00:00Z")),
    ].map((row) => ({
      ...row,
      company: { ...row.company, responseWithinTargetBps: 10_000 },
    }));
    installDatabaseRanking({
      organic: rows.map((row) => databaseRankingRow(row, {
        medianFirstResponseMinutes: 60,
        onTimeRateBps: 10_000,
      })),
      totalEligible: 2,
      responseProjectionFingerprint: "11111111111111111111111111111111",
    });
    installSearchHydrationRows(rows);
    databaseMocks.applicationFindMany.mockResolvedValue(Array.from(
      { length: 20 },
      (_, index) => {
        const submittedAt = new Date(NOW.getTime() - 10 * 86_400_000);
        return {
          id: `application-${index}`,
          submittedAt,
          job: { companyId: COMPANY_ID },
          candidateProfile: { userId: `candidate-${index}` },
          submissionSnapshot: { responseTargetDays: 5 },
          events: [{
            actorUserId: "employer-user",
            createdAt: new Date(submittedAt.getTime() + 60 * 60_000),
          }],
        };
      },
    ));

    const result = await listPublicJobs({
      ...emptyPublicJobSearchInput(),
      sort: "response",
      pageSize: 1,
    }, { now: NOW });

    expect(databaseMocks.applicationFindMany).toHaveBeenCalledOnce();
    const responseQuery = databaseMocks.applicationFindMany.mock.calls[0]?.[0];
    expect(responseQuery?.select).toEqual(expect.objectContaining({
      id: true,
      candidateProfile: { select: { userId: true } },
      events: expect.any(Object),
    }));
    expect(responseQuery?.select).not.toHaveProperty("candidateEmail");
    const responseEnvelopeSql = databaseMocks.queryRaw.mock.calls[0]?.[0]?.strings.join(" ");
    expect(responseEnvelopeSql).toContain('projection."responseEvidenceKnown"');
    expect(responseEnvelopeSql).toContain('projection."onTimeRateBps"');
    expect(responseEnvelopeSql).toContain('projection."medianFirstResponseMinutes"');
    expect(responseEnvelopeSql).toContain("FROM ranked_candidates AS candidate");
    const encoded = result.nextCursor?.split(".")[0];
    expect(encoded).toBeDefined();
    const payload = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"));
    expect(payload.organicTuple).toMatchObject({
      sort: "response",
      responseEvidenceKnown: true,
      onTimeRateBps: 10_000,
      medianFirstResponseMinutes: 60,
    });
    expect(payload.responseProjectionFingerprint).toBe(
      "11111111111111111111111111111111",
    );
    expect(JSON.stringify(result.jobs)).not.toContain("candidate-");

    installDatabaseRanking({
      organic: rows.map((row) => databaseRankingRow(row, {
        medianFirstResponseMinutes: 60,
        onTimeRateBps: 10_000,
      })),
      totalEligible: 2,
      responseProjectionFingerprint: "22222222222222222222222222222222",
    });
    installSearchHydrationRows(rows);
    const restarted = await listPublicJobs({
      ...emptyPublicJobSearchInput(),
      sort: "response",
      pageSize: 1,
      after: result.nextCursor as string,
    }, { now: new Date(NOW.getTime() + 60_000) });
    expect(restarted.invalidCursor).toBe(true);
    expect(restarted.jobs.map((job) => job.id)).toEqual([JOB_ID]);
  });

  it("keeps the count exact at the 2,000-candidate boundary", async () => {
    const rows = [
      searchCardRow(JOB_ID, "boundary-newest", NOW),
      searchCardRow(JOB_ID_2, "boundary-sentinel", new Date(NOW.getTime() - 1_000)),
    ];
    installDatabaseRanking({
      organic: rows.map((row) => databaseRankingRow(row)),
      totalEligible: 2_000,
    });
    installSearchHydrationRows(rows);

    const result = await listPublicJobs(emptyPublicJobSearchInput(), {
      now: NOW,
      pageSize: 1,
    });

    expect(result).toMatchObject({
      totalEligible: 2_000,
      resultCountIsExact: true,
      candidateSetTruncated: false,
    });
    expect(databaseMocks.jobFindMany).toHaveBeenCalledOnce();
    expect(databaseMocks.jobFindMany.mock.calls[0]?.[0]?.take).toBe(2);
  });

  it("uses the minimal eligibility projection for batched company counts", async () => {
    await loadPublicOpenJobCounts([COMPANY_ID], { now: NOW });

    const query = databaseMocks.jobFindMany.mock.calls[0]?.[0];
    expect(Object.keys(query?.select ?? {}).sort()).toEqual([
      "company",
      "companyId",
      "currentRevisionId",
      "dataProvenance",
      "expiresAt",
      "id",
      "publishedAt",
      "publishedRevision",
      "publishedRevisionId",
      "slug",
      "status",
    ]);
    expect(query?.select).not.toHaveProperty("boosts");
    expect(query?.select?.publishedRevision?.select).not.toHaveProperty("tasks");
    expect(query?.select?.publishedRevision?.select).not.toHaveProperty("benefits");
    expect(query?.select?.company?.select).not.toHaveProperty("slug");
    expect(query?.select?.company?.select).not.toHaveProperty("responseTargetDays");
    expect(query).toMatchObject({
      orderBy: { id: "asc" },
      take: 500,
    });
    expect(query).not.toHaveProperty("skip");
    expect(databaseMocks.transactionOptions).toHaveBeenCalledWith({
      isolationLevel: "RepeatableRead",
      timeout: 30_000,
    });
  });

  it("loads only taxonomy data in the cluster count query", async () => {
    await listPublicClusterLinks({ now: NOW });

    const query = databaseMocks.jobFindMany.mock.calls[0]?.[0];
    expect(query?.select).not.toHaveProperty("boosts");
    expect(query?.select?.publishedRevision?.select).toHaveProperty("category");
    expect(query?.select?.publishedRevision?.select).toHaveProperty("canton");
    expect(query?.select?.publishedRevision?.select).not.toHaveProperty("tasks");
    expect(query?.select?.publishedRevision?.select).not.toHaveProperty("benefits");
  });

  it("promotes only the seeded launch-wedge cantons and categories", async () => {
    databaseMocks.jobFindMany.mockResolvedValue([
      ...Array.from({ length: 3 }, (_, index) => launchClusterRow(index)),
      ...Array.from({ length: 4 }, (_, index) => outsideClusterRow(index)),
    ]);

    const result = await listPublicClusterLinks({ now: NOW });

    expect(PUBLIC_CLUSTER_DISCOVERY_POLICY_V1).toMatchObject({
      promotedCantonCodes: ["ZH", "AG", "BE"],
      promotedCategorySlugs: ["gesundheit-pflege", "engineering-technik"],
    });
    expect(result.map((link) => [link.kind, link.slug, link.count])).toEqual([
      ["category", "engineering-technik", 3],
      ["canton", "zuerich", 3],
    ]);
  });

  it("uses LIVE-only launch evidence even in a non-production environment", async () => {
    publicRuntime.dataContext = {
      eligibilityEnvironment: "non-production",
      liveOnly: false,
      publicIndexingAllowed: false,
      showDemoBanner: true,
    };
    const liveRows = Array.from({ length: 3 }, (_, index) =>
      launchClusterRow(index));
    const demoJob = {
      ...launchClusterRow(10),
      dataProvenance: "DEMO",
    };
    const testJob = {
      ...launchClusterRow(11),
      dataProvenance: "TEST",
    };
    const demoCompany = launchClusterRow(12);
    const testCompany = launchClusterRow(13);
    databaseMocks.jobFindMany.mockResolvedValue([
      ...liveRows,
      demoJob,
      testJob,
      {
        ...demoCompany,
        company: { ...demoCompany.company, dataProvenance: "DEMO" },
      },
      {
        ...testCompany,
        company: { ...testCompany.company, dataProvenance: "TEST" },
      },
    ]);

    const result = await listPublicClusterLinks({ now: NOW });

    expect(result.map((link) => [link.kind, link.count])).toEqual([
      ["category", 3],
      ["canton", 3],
    ]);
    const query = databaseMocks.jobFindMany.mock.calls[0]?.[0];
    expect(query?.where).toMatchObject({
      dataProvenance: "LIVE",
      company: { is: { dataProvenance: "LIVE" } },
    });
  });

  it("counts more than 2,000 company Jobs exactly with an ID keyset scan", async () => {
    const rows = Array.from({ length: 2_001 }, (_, index) =>
      countRow(index));
    installKeysetRows(rows);

    const result = await loadPublicOpenJobCounts([COMPANY_ID], { now: NOW });

    expect(result.get(COMPANY_ID)).toBe(2_001);
    expect(databaseMocks.jobFindMany).toHaveBeenCalledTimes(5);
    expect(databaseMocks.jobFindMany.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: rows[499]?.id } }),
      }),
    );
    expect(databaseMocks.jobFindMany.mock.calls.every(
      ([query]) => query.skip === undefined && query.orderBy?.id === "asc",
    )).toBe(true);
  });

  it("counts more than 2,000 LIVE launch-evidence rows exactly", async () => {
    const rows = Array.from({ length: 2_001 }, (_, index) =>
      launchClusterRow(index));
    installKeysetRows(rows);

    const result = await listPublicClusterLinks({ now: NOW });

    expect(result.map((link) => [link.kind, link.count])).toEqual([
      ["category", 2_001],
      ["canton", 2_001],
    ]);
    expect(databaseMocks.jobFindMany).toHaveBeenCalledTimes(5);
  });

  it("decodes the cursor before loading and bounds candidates by rankingAsOf", async () => {
    const older = searchCardRow(
      JOB_ID_2,
      "cursor-job-older",
      new Date("2026-07-01T12:00:00.000Z"),
    );
    const newer = searchCardRow(
      JOB_ID,
      "cursor-job-newer",
      new Date("2026-07-10T12:00:00.000Z"),
    );
    const insertedAfterSnapshot = searchCardRow(
      JOB_ID_3,
      "cursor-job-inserted",
      new Date("2026-07-20T18:00:00.000Z"),
    );
    const allRows = [insertedAfterSnapshot, newer, older];
    installDatabaseRanking({
      organic: [newer, older].map((row) => databaseRankingRow(row)),
      totalEligible: 2,
    });
    installSearchHydrationRows(allRows);
    const input = { ...emptyPublicJobSearchInput(), sort: "newest" as const };
    const first = await listPublicJobs(input, { now: NOW, pageSize: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));

    databaseMocks.jobFindMany.mockClear();
    installDatabaseRanking({
      organic: [databaseRankingRow(older)],
      totalEligible: 2,
    });
    installSearchHydrationRows(allRows);
    const second = await listPublicJobs(
      { ...input, after: first.nextCursor as string },
      { now: new Date("2026-07-21T12:00:00.000Z"), pageSize: 1 },
    );

    expect(second.jobs.map((job) => job.id)).toEqual([older.id]);
    expect(databaseMocks.jobFindMany.mock.calls[0]?.[0]?.where?.publishedAt).toEqual({
      lte: NOW,
    });
  });

  it("loads detail extras atomically with the exact eligible published Job", async () => {
    databaseMocks.jobFindMany.mockResolvedValue([eligibleDetailRow()]);

    const result = await getPublicJobBySlug("software-engineer", { now: NOW });

    expect(result).toMatchObject({
      id: JOB_ID,
      companyIntro: "Wir bauen sichere Plattformen",
      tasks: ["Sichere Systeme bauen"],
      niceToHave: ["PostgreSQL"],
      offer: "Lernbudget & Weiterbildung",
      applicationContactValue: "jobs@example.test",
      fairScoreVersion: "v2",
      company: {
        website: "https://example.test/careers",
        logoUrl: null,
      },
    });
    const query = databaseMocks.jobFindMany.mock.calls[0]?.[0];
    expect(query).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        slug: "software-engineer",
        status: "PUBLISHED",
        publishedRevision: expect.any(Object),
      }),
      take: 1,
      select: expect.objectContaining({
        company: {
          select: expect.objectContaining({
            website: true,
          }),
        },
        publishedRevision: {
          select: expect.objectContaining({
            companyIntro: true,
            tasks: true,
            requirements: true,
            niceToHave: true,
            offer: true,
            applicationContactValue: true,
            benefits: expect.any(Object),
            skills: expect.any(Object),
            languages: expect.any(Object),
            scoreSnapshots: expect.objectContaining({
              select: {
                scoreVersion: true,
                scorePoints: true,
                factorBreakdown: true,
              },
            }),
          }),
        },
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("public/company-logos/");
    expect(databaseMocks.jobRevisionFindFirst).not.toHaveBeenCalled();
  });

  it("excludes a PUBLISHED row when current and published revisions diverge", async () => {
    const mismatchedCard = {
      ...eligibleCardRow(),
      currentRevisionId: "99999999-9999-4999-8999-999999999999",
    };
    databaseMocks.jobFindMany.mockResolvedValue([mismatchedCard]);

    const search = await listPublicJobs(emptyPublicJobSearchInput(), { now: NOW });
    expect(search.jobs).toEqual([]);
    expect(search.totalEligible).toBe(0);

    databaseMocks.jobFindMany.mockResolvedValue([{
      ...eligibleDetailRow(),
      currentRevisionId: "99999999-9999-4999-8999-999999999999",
    }]);
    await expect(
      getPublicJobBySlug("software-engineer", { now: NOW }),
    ).resolves.toBeNull();
  });

  it("never projects employer-editable logo storage keys as reviewed public assets", async () => {
    const row = eligibleDetailRow();
    databaseMocks.jobFindMany.mockResolvedValue([{
      ...row,
      company: {
        ...row.company,
        logoStorageKey: "public/company-logos/other-company/logo.svg",
      },
    }]);

    const result = await getPublicJobBySlug("software-engineer", { now: NOW });

    expect(result?.company.logoUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain("logoStorageKey");
    expect(JSON.stringify(result)).not.toContain("other-company");
    expect(databaseMocks.jobFindMany.mock.calls[0]?.[0]?.select?.company?.select)
      .not.toHaveProperty("logoStorageKey");
  });

  it("exposes only allowlisted Fair-Job-Score factor keys", async () => {
    const row = eligibleDetailRow();
    databaseMocks.jobFindMany.mockResolvedValue([{
      ...row,
      publishedRevision: {
        ...row.publishedRevision,
        scoreSnapshots: [{
          ...row.publishedRevision.scoreSnapshots[0],
          factorBreakdown: {
            SALARY: { pointsAwarded: 20, maxPoints: 20 },
            INTERNAL_NOTE: { pointsAwarded: 99, maxPoints: 99 },
          },
        }],
      },
    }]);

    const result = await getPublicJobBySlug("software-engineer", { now: NOW });

    expect(result?.fairBreakdown).toEqual([{
      key: "SALARY",
      label: "Lohntransparenz",
      points: 20,
      maxPoints: 20,
    }]);
    expect(JSON.stringify(result)).not.toContain("INTERNAL_NOTE");
  });
});

function eligibleCardRow() {
  const expiresAt = new Date("2026-08-20T12:00:00.000Z");
  return {
    id: JOB_ID,
    slug: "software-engineer",
    companyId: COMPANY_ID,
    status: "PUBLISHED",
    dataProvenance: "LIVE",
    currentRevisionId: REVISION_ID,
    publishedRevisionId: REVISION_ID,
    publishedAt: new Date("2026-07-01T12:00:00.000Z"),
    expiresAt,
    publishedCategoryId: "44444444-4444-4444-8444-444444444444",
    publishedCantonId: "55555555-5555-4555-8555-555555555555",
    publishedCityId: null,
    publishedSalaryPeriod: "YEARLY",
    publishedSalaryMin: 100_000,
    publishedSalaryMax: 130_000,
    company: {
      id: COMPANY_ID,
      slug: "example-ag",
      name: "Example AG",
      status: "ACTIVE",
      dataProvenance: "LIVE",
      responseTargetDays: 5,
      responseSampleSize: 20,
      responseWithinTargetBps: 9_000,
      website: "https://example.test/careers",
      logoStorageKey: "public/company-logos/example-ag/logo.svg",
      verificationRequests: [{ id: "verification-1" }],
    },
    publishedRevision: {
      id: REVISION_ID,
      title: "Software Engineer",
      description: "Wir bauen sichere Plattformen.",
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      contentLanguage: "DE",
      categoryId: "44444444-4444-4444-8444-444444444444",
      category: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "IT",
        slug: "it",
        isActive: true,
      },
      cantonId: "55555555-5555-4555-8555-555555555555",
      canton: {
        id: "55555555-5555-4555-8555-555555555555",
        code: "BE",
        name: "Bern",
        slug: "bern",
      },
      cityId: null,
      city: null,
      locationLabel: "Bern",
      workloadMin: 80,
      workloadMax: 100,
      salaryPeriod: "YEARLY",
      salaryMin: 100_000,
      salaryMax: 130_000,
      validThrough: expiresAt,
      responseTargetDays: 5,
      applicationEffort: "SIMPLE",
      approvedAt: new Date("2026-06-30T12:00:00.000Z"),
      rejectedAt: null,
      scoreSnapshots: [{ scorePoints: 88 }],
    },
    boosts: [],
  };
}

function eligibleDetailRow() {
  const card = eligibleCardRow();
  const details = detailExtras();
  return {
    ...card,
    publishedRevision: {
      ...card.publishedRevision,
      ...details,
      scoreSnapshots: [{
        scoreVersion: "v2",
        scorePoints: 88,
        factorBreakdown: {},
      }],
    },
  };
}

function launchClusterRow(index: number) {
  const row = eligibleCardRow();
  return {
    ...row,
    id: `launch-job-${index}`,
    publishedRevision: {
      ...row.publishedRevision,
      category: {
        id: row.publishedRevision.categoryId,
        name: "Engineering/Technik",
        slug: "engineering-technik",
        isActive: true,
      },
      canton: {
        id: row.publishedRevision.cantonId,
        code: "ZH",
        name: "Zürich",
        slug: "zuerich",
      },
    },
  };
}

function outsideClusterRow(index: number) {
  const row = eligibleCardRow();
  const categoryId = "77777777-7777-4777-8777-777777777777";
  const cantonId = "88888888-8888-4888-8888-888888888888";
  return {
    ...row,
    id: `outside-job-${index}`,
    publishedCategoryId: categoryId,
    publishedCantonId: cantonId,
    publishedRevision: {
      ...row.publishedRevision,
      categoryId,
      category: {
        id: categoryId,
        name: "Administration",
        slug: "administration-dienste",
        isActive: true,
      },
      cantonId,
      canton: {
        id: cantonId,
        code: "VD",
        name: "Waadt",
        slug: "waadt",
      },
    },
  };
}

function countRow(index: number) {
  const row = eligibleCardRow();
  const suffix = String(index).padStart(6, "0");
  return {
    ...row,
    id: `count-job-${suffix}`,
    slug: `count-job-${suffix}`,
  };
}

function searchCardRow(id: string, slug: string, publishedAt: Date) {
  return {
    ...eligibleCardRow(),
    id,
    slug,
    publishedAt,
  };
}

function installDatabaseRanking(input: Readonly<{
  sponsored?: readonly MockDatabaseRankingRow[];
  organic: readonly MockDatabaseRankingRow[];
  totalEligible: number;
  responseProjectionFingerprint?: string;
}>): void {
  rankingScenario = Object.freeze({
    sponsored: Object.freeze([...(input.sponsored ?? [])]),
    organic: Object.freeze([...input.organic]),
    totalEligible: input.totalEligible,
    responseProjectionFingerprint:
      input.responseProjectionFingerprint ?? EMPTY_RESPONSE_FINGERPRINT,
  });
  databaseMocks.queryRaw.mockImplementation(async (query) => {
    const text = Array.isArray(query?.strings) ? query.strings.join(" ") : "";
    if (text.includes("response_projection_version")) {
      const common = {
        totalEligible: BigInt(rankingScenario.totalEligible),
        responseProjectionFingerprint: rankingScenario.responseProjectionFingerprint,
      };
      return rankingScenario.sponsored.length === 0
        ? [{
            id: null,
            relevanceTier: null,
            relevanceScore: null,
            fairScore: null,
            salaryMin: null,
            salaryMax: null,
            responseEvidenceKnown: null,
            onTimeRateBps: null,
            medianFirstResponseMinutes: null,
            publishedAt: null,
            activeBoost: null,
            ...common,
          }]
        : rankingScenario.sponsored.map((row) => ({ ...row, ...common }));
    }
    return [...rankingScenario.organic];
  });
}

function databaseRankingRow(
  row: ReturnType<typeof eligibleCardRow>,
  overrides: Partial<MockDatabaseRankingRow> = {},
): MockDatabaseRankingRow {
  return Object.freeze({
    id: row.id,
    relevanceTier: 0,
    relevanceScore: 0,
    fairScore: row.publishedRevision.scoreSnapshots[0]?.scorePoints ?? null,
    salaryMin: row.publishedRevision.salaryMin,
    salaryMax: row.publishedRevision.salaryMax,
    responseEvidenceKnown: true,
    onTimeRateBps: row.company.responseWithinTargetBps,
    medianFirstResponseMinutes: null,
    publishedAt: row.publishedAt,
    activeBoost: row.boosts.length > 0,
    ...overrides,
  });
}

function installSearchHydrationRows(
  rows: readonly ReturnType<typeof eligibleCardRow>[],
): void {
  databaseMocks.jobFindMany.mockImplementation(async (query) => {
    const ids = query.where?.id?.in as readonly string[] | undefined;
    return ids === undefined ? [...rows] : rows.filter((row) => ids.includes(row.id));
  });
}

function installKeysetRows(
  rows: readonly ReturnType<typeof eligibleCardRow>[],
): void {
  const sorted = [...rows].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  databaseMocks.jobFindMany.mockImplementation(async (query) => {
    const afterId = query.where?.id?.gt as string | undefined;
    return sorted
      .filter((row) => afterId === undefined || row.id > afterId)
      .slice(0, query.take);
  });
}

function detailExtras() {
  return {
    id: REVISION_ID,
    companyIntro: "<p>Wir bauen sichere Plattformen</p>",
    tasks: ["Sichere Systeme bauen"],
    requirements: ["TypeScript"],
    niceToHave: ["<strong>PostgreSQL</strong>"],
    offer: "<p>Lernbudget &amp; Weiterbildung</p><script>private()</script>",
    applicationProcessSteps: ["Gespräch"],
    requiredDocumentKinds: ["CV"],
    remoteCountryCode: "CH",
    startDate: null,
    startByArrangement: true,
    inclusionStatement: "Alle sind willkommen.",
    applicationContactKind: "EMAIL",
    applicationContactValue: "jobs@example.test",
    benefits: [{ benefitCode: "TRAINING", description: "Weiterbildung" }],
    skills: [{
      required: true,
      skill: {
        id: "66666666-6666-4666-8666-666666666666",
        name: "TypeScript",
        slug: "typescript",
      },
    }],
    languages: [{ code: "de", minLevel: "C1" }],
    scoreSnapshots: [{ factorBreakdown: {} }],
  };
}
