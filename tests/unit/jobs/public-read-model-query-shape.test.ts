// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databaseMocks = vi.hoisted(() => ({
  jobFindMany: vi.fn(),
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
      moderationRestriction: { findMany: databaseMocks.restrictionFindMany },
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

const NOW = new Date("2026-07-20T12:00:00.000Z");
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";

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
    databaseMocks.jobRevisionFindFirst.mockResolvedValue(null);
    databaseMocks.restrictionFindMany.mockResolvedValue([]);
  });

  it("keeps list queries on the card projection without detail-only fields", async () => {
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
        status: "ACTIVE",
        cancelledAt: null,
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
    expect(query?.take).toBe(2_001);
    expect(result).toMatchObject({
      totalEligible: 0,
      resultCountIsExact: true,
      candidateSetTruncated: false,
    });
    expect(databaseMocks.transactionOptions).toHaveBeenCalledWith({
      isolationLevel: "RepeatableRead",
    });
  });

  it("uses a sentinel row and never presents the capped workset as an exact total", async () => {
    const rows = Array.from({ length: 2_001 }, (_, index) => {
      const suffix = String(index).padStart(4, "0");
      return searchCardRow(
        `cap-job-${suffix}`,
        `cap-job-${suffix}`,
        new Date(NOW.getTime() - index * 1_000),
      );
    });
    databaseMocks.jobFindMany.mockResolvedValue(rows);

    const result = await listPublicJobs(emptyPublicJobSearchInput(), {
      now: NOW,
      pageSize: 1,
    });

    expect(databaseMocks.jobFindMany.mock.calls[0]?.[0]?.take).toBe(2_001);
    expect(result).toMatchObject({
      totalEligible: 2_000,
      resultCountIsExact: false,
      candidateSetTruncated: true,
    });
    expect(result.jobs).toHaveLength(1);
  });

  it("keeps minimum-salary and salary-sort queries on comparable yearly values", async () => {
    await listPublicJobs(
      {
        ...emptyPublicJobSearchInput(),
        salaryMin: 120_000,
        salaryDisclosedOnly: true,
      },
      { now: NOW },
    );
    const minimumSalaryRevisionWhere = databaseMocks.jobFindMany.mock.calls[0]
      ?.[0]?.where?.publishedRevision?.is;
    expect(minimumSalaryRevisionWhere).toMatchObject({
      salaryPeriod: "YEARLY",
      salaryMin: { not: null },
      salaryMax: { gte: 120_000 },
    });

    databaseMocks.jobFindMany.mockClear();
    await listPublicJobs(
      {
        ...emptyPublicJobSearchInput(),
        sort: "salary",
        salaryDisclosedOnly: true,
      },
      { now: NOW },
    );
    const salarySortRevisionWhere = databaseMocks.jobFindMany.mock.calls[0]
      ?.[0]?.where?.publishedRevision?.is;
    expect(salarySortRevisionWhere).toMatchObject({
      salaryPeriod: "YEARLY",
      salaryMin: { not: null },
      salaryMax: { not: null },
    });
  });

  it("keeps the count exact at the 2,000-candidate boundary", async () => {
    const rows = Array.from({ length: 2_000 }, (_, index) => {
      const suffix = String(index).padStart(4, "0");
      return searchCardRow(
        `boundary-job-${suffix}`,
        `boundary-job-${suffix}`,
        new Date(NOW.getTime() - index * 1_000),
      );
    });
    databaseMocks.jobFindMany.mockResolvedValue(rows);

    const result = await listPublicJobs(emptyPublicJobSearchInput(), {
      now: NOW,
      pageSize: 1,
    });

    expect(result).toMatchObject({
      totalEligible: 2_000,
      resultCountIsExact: true,
      candidateSetTruncated: false,
    });
  });

  it("uses the minimal eligibility projection for batched company counts", async () => {
    await loadPublicOpenJobCounts([COMPANY_ID], { now: NOW });

    const query = databaseMocks.jobFindMany.mock.calls[0]?.[0];
    expect(Object.keys(query?.select ?? {}).sort()).toEqual([
      "company",
      "companyId",
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
      "cursor-job-older",
      "cursor-job-older",
      new Date("2026-07-01T12:00:00.000Z"),
    );
    const newer = searchCardRow(
      "cursor-job-newer",
      "cursor-job-newer",
      new Date("2026-07-10T12:00:00.000Z"),
    );
    const insertedAfterSnapshot = searchCardRow(
      "cursor-job-inserted",
      "cursor-job-inserted",
      new Date("2026-07-20T18:00:00.000Z"),
    );
    const allRows = [insertedAfterSnapshot, newer, older];
    databaseMocks.jobFindMany.mockImplementation(async (query) => {
      const upperBound = query.where?.publishedAt?.lte as Date;
      return allRows.filter((row) =>
        row.publishedAt.getTime() <= upperBound.getTime());
    });
    const input = { ...emptyPublicJobSearchInput(), sort: "newest" as const };
    const first = await listPublicJobs(input, { now: NOW, pageSize: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));

    databaseMocks.jobFindMany.mockClear();
    const second = await listPublicJobs(
      { ...input, cursor: first.nextCursor as string },
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
    expect(databaseMocks.jobRevisionFindFirst).not.toHaveBeenCalled();
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
