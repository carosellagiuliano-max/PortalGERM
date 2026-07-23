import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";

import type { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ServerEnvironment } from "@/lib/config/env-schema";

const runtime = vi.hoisted(() => ({
  environment: undefined as ServerEnvironment | undefined,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: () => {
    if (runtime.environment === undefined) {
      throw new Error("The Phase-07 integration runtime is not initialized.");
    }
    return runtime.environment;
  },
}));

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  emptyPublicJobSearchInput,
  getPublicJobBySlug,
  listPublicJobs,
} from "@/lib/jobs/public-read-model";
import { parsePublicJobSearchParams } from "@/lib/public/query-params";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-20T12:00:00.000Z");
const DAY = 86_400_000;
const IDS = {
  user: "07000000-0000-4000-8000-000000000001",
  cantonZh: "07000000-0000-4000-8000-000000000002",
  cityZurich: "07000000-0000-4000-8000-000000000003",
  cantonBe: "07000000-0000-4000-8000-000000000004",
  cityBern: "07000000-0000-4000-8000-000000000005",
  categoryEngineering: "07000000-0000-4000-8000-000000000006",
  categoryHealth: "07000000-0000-4000-8000-000000000007",
  verifiedCompany: "07000000-0000-4000-8000-000000000008",
  secondVerifiedCompany: "07000000-0000-4000-8000-000000000009",
  unverifiedCompany: "07000000-0000-4000-8000-000000000010",
  demoCompany: "07000000-0000-4000-8000-000000000011",
  verifiedRequest: "07000000-0000-4000-8000-000000000012",
  secondVerifiedRequest: "07000000-0000-4000-8000-000000000013",
  demoVerifiedRequest: "07000000-0000-4000-8000-000000000014",
  platformJob: "07000000-0000-4000-8000-000000000015",
  platformRevision: "07000000-0000-4000-8000-000000000016",
  platformScore: "07000000-0000-4000-8000-000000000017",
  careJob: "07000000-0000-4000-8000-000000000018",
  careRevision: "07000000-0000-4000-8000-000000000019",
  careScore: "07000000-0000-4000-8000-000000000020",
  draftJob: "07000000-0000-4000-8000-000000000021",
  draftRevision: "07000000-0000-4000-8000-000000000022",
  draftScore: "07000000-0000-4000-8000-000000000023",
  expiredJob: "07000000-0000-4000-8000-000000000024",
  expiredRevision: "07000000-0000-4000-8000-000000000025",
  expiredScore: "07000000-0000-4000-8000-000000000026",
  restrictedJob: "07000000-0000-4000-8000-000000000027",
  restrictedRevision: "07000000-0000-4000-8000-000000000028",
  restrictedScore: "07000000-0000-4000-8000-000000000029",
  unverifiedJob: "07000000-0000-4000-8000-000000000030",
  unverifiedRevision: "07000000-0000-4000-8000-000000000031",
  unverifiedScore: "07000000-0000-4000-8000-000000000032",
  demoJob: "07000000-0000-4000-8000-000000000033",
  demoRevision: "07000000-0000-4000-8000-000000000034",
  demoScore: "07000000-0000-4000-8000-000000000035",
  demoCompanyJob: "07000000-0000-4000-8000-000000000036",
  demoCompanyRevision: "07000000-0000-4000-8000-000000000037",
  demoCompanyScore: "07000000-0000-4000-8000-000000000038",
  restrictionReport: "07000000-0000-4000-8000-000000000039",
  restriction: "07000000-0000-4000-8000-000000000040",
  verifiedCompanyLocation: "07000000-0000-4000-8000-000000000042",
  secondVerifiedCompanyLocation: "07000000-0000-4000-8000-000000000043",
  unverifiedCompanyLocation: "07000000-0000-4000-8000-000000000044",
  demoCompanyLocation: "07000000-0000-4000-8000-000000000045",
  cursorInsertedJob: "07000000-0000-4000-8000-000000000046",
  cursorInsertedRevision: "07000000-0000-4000-8000-000000000047",
  cursorInsertedScore: "07000000-0000-4000-8000-000000000048",
  responseBoost: "07000000-0000-4000-8000-000000000049",
  responseBoostAccount: "07000000-0000-4000-8000-000000000050",
  responseBoostGrant: "07000000-0000-4000-8000-000000000051",
  responseBoostConsume: "07000000-0000-4000-8000-000000000052",
} as const;

const SLUGS = {
  platform: "senior-platform-engineer-zuerich",
  care: "pflegefachperson-bern",
  draft: "draft-platform-role",
  expired: "expired-platform-role",
  restricted: "restricted-platform-role",
  unverified: "unverified-platform-role",
  demo: "demo-platform-role",
  demoCompany: "demo-company-live-role",
} as const;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function pool(): Pool {
  if (migrated === undefined) {
    throw new Error("The Phase-07 public read-model database is unavailable.");
  }
  return migrated.pool;
}

function atDay(offset: number): Date {
  return new Date(NOW.getTime() + offset * DAY);
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase07_public_read_model");
  database = createDatabaseClient(migrated.connectionString);
  globalThis.swissTalentHubDatabase = database;
  setRuntimeEnvironment("local");
  await insertFixtures(pool());
});

afterEach(async () => {
  setRuntimeEnvironment("local");
  await restoreRestriction(pool());
});

afterAll(async () => {
  if (globalThis.swissTalentHubDatabase === database) {
    globalThis.swissTalentHubDatabase = undefined;
  }
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  runtime.environment = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-07 PostgreSQL public Job read model", () => {
  it("returns only approved, current, unexpired Jobs of active verified companies", async () => {
    const page = await listPublicJobs(
      { ...emptyPublicJobSearchInput(), sort: "newest" },
      { now: NOW },
    );
    const slugs = page.jobs.map((job) => job.slug);

    expect(slugs).toEqual([
      SLUGS.platform,
      SLUGS.care,
      SLUGS.demo,
      SLUGS.demoCompany,
    ]);
    expect(slugs).not.toContain(SLUGS.draft);
    expect(slugs).not.toContain(SLUGS.expired);
    expect(slugs).not.toContain(SLUGS.restricted);
    expect(slugs).not.toContain(SLUGS.unverified);
    expect(page.totalEligible).toBe(4);

    await expect(getPublicJobBySlug(SLUGS.draft, { now: NOW })).resolves.toBeNull();
    await expect(getPublicJobBySlug(SLUGS.expired, { now: NOW })).resolves.toBeNull();
    await expect(
      getPublicJobBySlug(SLUGS.unverified, { now: NOW }),
    ).resolves.toBeNull();
  });

  it("applies keyword, taxonomy, workload, contract, remote, language, effort and salary filters together", async () => {
    setRuntimeEnvironment("production");
    const input = parsePublicJobSearchParams({
      keyword: "Platform",
      canton: "zuerich",
      city: "zuerich-stadt",
      category: "engineering-technik",
      workloadMin: "80",
      workloadMax: "90",
      jobType: "permanent",
      remoteType: "hybrid",
      language: "de",
      applicationEffort: "simple",
      salaryMin: "125000",
      salaryPeriod: "YEARLY",
      salaryDisclosed: "true",
      companyVerified: "true",
      sort: "salary",
    });

    const page = await listPublicJobs(input, { now: NOW });

    expect(page.jobs).toHaveLength(1);
    expect(page.jobs[0]).toMatchObject({
      slug: SLUGS.platform,
      title: "Senior Platform Engineer",
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      workloadMin: 80,
      workloadMax: 100,
      salaryMin: 120_000,
      salaryMax: 145_000,
      salaryPeriod: "YEARLY",
      applicationEffort: "SIMPLE",
      contentLanguage: "DE",
    });
    expect(page.totalEligible).toBe(1);
  });

  it("finds a production Job when the keyword exists only in tasks", async () => {
    setRuntimeEnvironment("production");

    const page = await listPublicJobs(
      parsePublicJobSearchParams({ keyword: "Kubernetes" }),
      { now: NOW },
    );

    expect(page.jobs.map((job) => job.slug)).toEqual([SLUGS.platform]);
    expect(page.totalEligible).toBe(1);
    expect(JSON.stringify(page.jobs)).not.toContain("Kubernetes-Plattform");
  });

  it("paginates a stable production result with a signed cursor and rejects tampering", async () => {
    setRuntimeEnvironment("production");
    const input = { ...emptyPublicJobSearchInput(), sort: "newest" as const };

    const first = await listPublicJobs(input, { now: NOW, pageSize: 1 });
    expect(first.jobs.map((job) => job.slug)).toEqual([SLUGS.platform]);
    expect(first.totalEligible).toBe(2);
    expect(first.invalidCursor).toBe(false);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await listPublicJobs(
      { ...input, after: first.nextCursor as string },
      { now: NOW, pageSize: 1 },
    );
    expect(second.jobs.map((job) => job.slug)).toEqual([SLUGS.care]);
    expect(second.nextCursor).toBeNull();
    expect(second.invalidCursor).toBe(false);

    const [encoded] = (first.nextCursor as string).split(".");
    const tampered = await listPublicJobs(
      { ...input, after: `${encoded}.invalid` },
      { now: NOW, pageSize: 1 },
    );
    expect(tampered.invalidCursor).toBe(true);
    expect(tampered.jobs.map((job) => job.slug)).toEqual([SLUGS.platform]);
  });

  it.each(["relevance", "newest", "fair-score", "salary"] as const)(
    "applies the physical %s ranking tuple on both cursor pages",
    async (sort) => {
      setRuntimeEnvironment("production");
      const input = {
        ...emptyPublicJobSearchInput(),
        sort,
        ...(sort === "salary" ? { salaryPeriod: "YEARLY" as const } : {}),
      };
      const first = await listPublicJobs(input, { now: NOW, pageSize: 1 });
      expect(first.jobs.map((job) => job.slug)).toEqual([SLUGS.platform]);
      expect(first.nextCursor).toEqual(expect.any(String));

      const second = await listPublicJobs(
        { ...input, after: first.nextCursor as string },
        { now: NOW, pageSize: 1 },
      );
      expect(second.jobs.map((job) => job.slug)).toEqual([SLUGS.care]);
      expect(second.nextCursor).toBeNull();
    },
  );

  it("keeps a cursor gap-free when a newer Job is inserted and an unseen Job expires", async () => {
    setRuntimeEnvironment("production");
    const input = { ...emptyPublicJobSearchInput(), sort: "newest" as const };
    const first = await listPublicJobs(input, { now: NOW, pageSize: 1 });
    expect(first.jobs.map((job) => job.slug)).toEqual([SLUGS.platform]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const secondNow = new Date(NOW.getTime() + 2 * 60 * 60_000);
    await insertJob(pool(), {
      id: IDS.cursorInsertedJob,
      revisionId: IDS.cursorInsertedRevision,
      scoreId: IDS.cursorInsertedScore,
      companyId: IDS.verifiedCompany,
      slug: "phase15-cursor-inserted-after-snapshot",
      title: "Nach Cursor publizierte Stelle",
      description: "Darf in der laufenden Cursor-Sicht nicht auftauchen.",
      status: "PUBLISHED",
      provenance: "LIVE",
      categoryId: IDS.categoryEngineering,
      cantonId: IDS.cantonZh,
      cityId: IDS.cityZurich,
      contentLanguage: "DE",
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      effort: "SIMPLE",
      workloadMin: 80,
      workloadMax: 100,
      salaryMin: 130_000,
      salaryMax: 150_000,
      publishedAt: new Date(NOW.getTime() + 60 * 60_000),
      validThrough: atDay(30),
      score: 99,
    });
    await pool().query(
      'UPDATE "Job" SET "status" = \'EXPIRED\' WHERE "id" = $1',
      [IDS.careJob],
    );
    try {
      const second = await listPublicJobs(
        { ...input, after: first.nextCursor as string },
        { now: secondNow, pageSize: 1 },
      );

      expect(second.jobs).toEqual([]);
      expect(second.totalEligible).toBe(1);
      expect(second.nextCursor).toBeNull();
      expect(second.invalidCursor).toBe(false);
      expect(second.jobs.map((job) => job.slug)).not.toEqual(expect.arrayContaining([
        SLUGS.platform,
        SLUGS.care,
        "phase15-cursor-inserted-after-snapshot",
      ]));
    } finally {
      await pool().query(
        'UPDATE "Job" SET "status" = \'PUBLISHED\' WHERE "id" = $1',
        [IDS.careJob],
      );
      await retireJobFixture(pool(), IDS.cursorInsertedJob);
    }
  });

  it("removes an otherwise eligible Job while an effective hide restriction exists", async () => {
    await pool().query(
      'DELETE FROM "ModerationRestriction" WHERE "id" = $1',
      [IDS.restriction],
    );
    const beforeRestriction = await listPublicJobs(
      { ...emptyPublicJobSearchInput(), sort: "newest" },
      { now: NOW },
    );
    expect(beforeRestriction.jobs.map((job) => job.slug)).toContain(
      SLUGS.restricted,
    );

    await restoreRestriction(pool());
    const whileRestricted = await listPublicJobs(
      { ...emptyPublicJobSearchInput(), sort: "newest" },
      { now: NOW },
    );
    expect(whileRestricted.jobs.map((job) => job.slug)).not.toContain(
      SLUGS.restricted,
    );
    await expect(
      getPublicJobBySlug(SLUGS.restricted, { now: NOW }),
    ).resolves.toBeNull();
  });

  it("allows DEMO data locally but excludes DEMO Jobs and DEMO companies in production", async () => {
    setRuntimeEnvironment("local");
    const local = await listPublicJobs(
      { ...emptyPublicJobSearchInput(), sort: "newest" },
      { now: NOW },
    );
    expect(local.jobs.map((job) => job.slug)).toEqual(
      expect.arrayContaining([SLUGS.demo, SLUGS.demoCompany]),
    );

    setRuntimeEnvironment("production");
    const production = await listPublicJobs(
      { ...emptyPublicJobSearchInput(), sort: "newest" },
      { now: NOW },
    );
    expect(production.jobs.map((job) => job.slug)).toEqual([
      SLUGS.platform,
      SLUGS.care,
    ]);
    expect(production.jobs.every((job) => job.dataProvenance === "LIVE")).toBe(
      true,
    );
  });

  it("accepts UUID catalog references as the same filters as public slugs", async () => {
    setRuntimeEnvironment("production");
    const page = await listPublicJobs(parsePublicJobSearchParams({
      canton: IDS.cantonZh,
      city: IDS.cityZurich,
      category: IDS.categoryEngineering,
    }), { now: NOW });

    expect(page.jobs.map((job) => job.slug)).toEqual([SLUGS.platform]);
  });

  it("fails missing City coordinates closed and applies the PostgreSQL radius", async () => {
    setRuntimeEnvironment("production");
    const missingCoordinates = await listPublicJobs(
      parsePublicJobSearchParams({ city: "zuerich-stadt", radius: "120" }),
      { now: NOW },
    );
    expect(missingCoordinates.jobs).toEqual([]);

    await pool().query(
      'UPDATE "City" SET "latitude" = 47.376900, "longitude" = 8.541700 WHERE "id" = $1',
      [IDS.cityZurich],
    );
    await pool().query(
      'UPDATE "City" SET "latitude" = 46.948090, "longitude" = 7.447440 WHERE "id" = $1',
      [IDS.cityBern],
    );
    try {
      const nearby = await listPublicJobs(
        parsePublicJobSearchParams({ city: "zuerich-stadt", radius: "50" }),
        { now: NOW },
      );
      const wider = await listPublicJobs(
        parsePublicJobSearchParams({ city: "zuerich-stadt", radius: "120" }),
        { now: NOW },
      );

      expect(nearby.jobs.map((job) => job.slug)).toEqual([SLUGS.platform]);
      expect(wider.jobs.map((job) => job.slug)).toEqual([
        SLUGS.platform,
        SLUGS.care,
      ]);
    } finally {
      await pool().query(
        'UPDATE "City" SET "latitude" = NULL, "longitude" = NULL WHERE "id" IN ($1, $2)',
        [IDS.cityZurich, IDS.cityBern],
      );
    }
  });

  it("sorts a coherent 20-case response median before a known null median", async () => {
    setRuntimeEnvironment("production");
    await insertResponseMedianCohort(pool());
    const page = await listPublicJobs(
      { ...emptyPublicJobSearchInput(), sort: "response" },
      { now: NOW },
    );

    expect(page.jobs.map((job) => job.slug)).toEqual([
      SLUGS.care,
      SLUGS.platform,
    ]);
    expect(page.jobs.every((job) => job.response.known)).toBe(true);
    expect(JSON.stringify(page.jobs)).not.toContain("phase15-response-candidate");
  });

  it("keeps a boosted response-sorted Job coherent in the sponsored zone", async () => {
    setRuntimeEnvironment("production");
    const fundingStart = atDay(-10);
    const fundingEnd = atDay(10);
    await pool().query(
      [
        'INSERT INTO "CreditAccount" (',
        '  "id", "companyId", "creditType", "fundingSource", "periodStart", "periodEnd"',
        ") VALUES ($1, $2, 'JOB_BOOST', 'ADMIN_GRANT', $3, $4)",
      ].join("\n"),
      [IDS.responseBoostAccount, IDS.secondVerifiedCompany, fundingStart, fundingEnd],
    );
    await pool().query(
      [
        'INSERT INTO "CreditLedgerEntry" (',
        '  "id", "accountId", "fundingSource", "kind", "amount",',
        '  "validFrom", "validTo", "idempotencyKey", "reasonCode", "actorUserId", "createdAt"',
        ") VALUES ($1, $2, 'ADMIN_GRANT', 'GRANT', 1, $3, $4,",
        "  'phase15-response-boost-grant', 'TEST_FIXTURE', $5, $6)",
      ].join("\n"),
      [IDS.responseBoostGrant, IDS.responseBoostAccount, fundingStart, fundingEnd, IDS.user, NOW],
    );
    await pool().query(
      [
        'INSERT INTO "CreditLedgerEntry" (',
        '  "id", "accountId", "fundingSource", "kind", "amount",',
        '  "consumedGrantEntryId", "validFrom", "validTo", "idempotencyKey",',
        '  "reasonCode", "actorUserId", "createdAt"',
        ") VALUES ($1, $2, 'ADMIN_GRANT', 'CONSUME', -1, $3, $4, $5,",
        "  'phase15-response-boost-consume', 'TEST_FIXTURE', $6, $7)",
      ].join("\n"),
      [
        IDS.responseBoostConsume,
        IDS.responseBoostAccount,
        IDS.responseBoostGrant,
        fundingStart,
        fundingEnd,
        IDS.user,
        NOW,
      ],
    );
    await pool().query(
      [
        'INSERT INTO "JobBoost" (',
        '  "id", "jobId", "companyId", "consumedCreditLedgerEntryId",',
        '  "idempotencyKey", "startsAt", "endsAt", "status"',
        ") VALUES ($1, $2, $3, $4, 'phase15-response-sponsored', $5, $6, 'ACTIVE')",
      ].join("\n"),
      [
        IDS.responseBoost,
        IDS.careJob,
        IDS.secondVerifiedCompany,
        IDS.responseBoostConsume,
        atDay(-1),
        atDay(6),
      ],
    );
    const page = await listPublicJobs(
      { ...emptyPublicJobSearchInput(), sort: "response" },
      { now: NOW, pageSize: 1 },
    );

    expect(page.jobs).toHaveLength(1);
    expect(page.jobs[0]).toMatchObject({
      slug: SLUGS.care,
      sponsored: true,
      activeBoost: true,
    });
  });

  it("safely restarts a response cursor when a ranked Company projection changes", async () => {
    setRuntimeEnvironment("production");
    const input = { ...emptyPublicJobSearchInput(), sort: "response" as const };
    const first = await listPublicJobs(input, { now: NOW, pageSize: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.invalidCursor).toBe(false);

    await pool().query(
      'UPDATE "Company" SET "responseWithinTargetBps" = 9000 WHERE "id" = $1',
      [IDS.verifiedCompany],
    );
    try {
      const restarted = await listPublicJobs(
        { ...input, after: first.nextCursor as string },
        { now: new Date(NOW.getTime() + 60_000), pageSize: 1 },
      );

      expect(restarted.invalidCursor).toBe(true);
      expect(restarted.jobs.map((job) => job.slug)).toEqual([SLUGS.care]);
      expect(restarted.nextCursor).toEqual(expect.any(String));
    } finally {
      await pool().query(
        'UPDATE "Company" SET "responseWithinTargetBps" = 10000 WHERE "id" = $1',
        [IDS.verifiedCompany],
      );
    }
  });

  // Append-only publication/application evidence is intentionally left in this
  // isolated disposable database, so the large correctness fixture runs last.
  it("finds the globally strongest older match beyond 2,000 newer candidates", async () => {
    setRuntimeEnvironment("production");
    await insertLargeSearchCohort(pool());
    const page = await listPublicJobs(
      parsePublicJobSearchParams({ keyword: "globalneedle", pageSize: "1" }),
      { now: NOW },
    );

    expect(page.jobs.map((job) => job.slug)).toEqual([
      "phase15-global-needle",
    ]);
    expect(page.totalEligible).toBe(1);
    expect(page.resultCountIsExact).toBe(true);
    expect(page.candidateSetTruncated).toBe(false);
    const broad = await listPublicJobs(
      parsePublicJobSearchParams({
        keyword: "Deterministischer",
        pageSize: "50",
        sort: "newest",
      }),
      { now: NOW },
    );
    expect(broad.totalEligible).toBe(2_006);
    expect(broad.jobs).toHaveLength(50);
    const benchmark = await benchmarkGlobalKeywordSearch();
    expect(benchmark.p50Ms).toBeGreaterThan(0);
    expect(benchmark.p95Ms).toBeGreaterThanOrEqual(benchmark.p50Ms);
    expect(benchmark.broadP50Ms).toBeGreaterThan(0);
    expect(benchmark.broadP95Ms).toBeGreaterThanOrEqual(benchmark.broadP50Ms);
    expect(benchmark.explainExecutionMs).toBeGreaterThanOrEqual(0);
    expect(benchmark.broadExplainExecutionMs).toBeGreaterThanOrEqual(0);
    expect(benchmark.structuredExplainIndexes.length).toBeGreaterThan(0);
    process.stdout.write(`PHASE15_SEARCH_BENCHMARK ${JSON.stringify(benchmark)}\n`);
  }, 30_000);
});

function setRuntimeEnvironment(appEnvironment: "local" | "production") {
  if (migrated === undefined) {
    throw new Error("Cannot configure the runtime before database migration.");
  }
  runtime.environment = parseEnvironment({
    APP_ENV: appEnvironment,
    NODE_ENV: "test",
    DATABASE_URL: migrated.connectionString,
    APP_URL:
      appEnvironment === "production"
        ? "https://phase07.example.test"
        : "http://localhost:3000",
    NEXT_PUBLIC_APP_NAME: "SwissTalentHub Integration",
    APP_BUILD_ID: "phase15-public-read-model-integration",
    SESSION_SECRET: secret(1),
    AUDIT_IP_HASH_KEYS: `v1:${secret(2)}`,
    RADAR_OPAQUE_LOOKUP_KEYS: `v1:${secret(3)}`,
    RADAR_OPAQUE_ENCRYPTION_KEYS: `v1:${secret(4)}`,
    REVEAL_CONFIRMATION_KEYS: `v1:${secret(5)}`,
    PII_REVEAL_KEYS: `v1:${secret(6)}`,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: appEnvironment === "production" ? "1" : "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    ABUSE_REPORT_ADMIN_EMAILS: "admin@phase07.example.test",
    LOG_LEVEL: "error",
  });
}

function secret(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64");
}

async function insertFixtures(target: Pool) {
  await target.query(
    [
      'INSERT INTO "User" (',
      '  "id", "email", "emailNormalized", "role", "status",',
      '  "dataProvenance", "updatedAt"',
      ") VALUES ($1, $2, $2, 'EMPLOYER', 'ACTIVE', 'LIVE', $3)",
    ].join("\n"),
    [IDS.user, "phase07-owner@example.test", NOW],
  );
  await target.query(
    [
      'INSERT INTO "Canton" ("id", "code", "name", "slug", "language", "updatedAt")',
      "VALUES",
      "  ($1, 'ZH', 'Zürich', 'zuerich', 'DE', $3),",
      "  ($2, 'BE', 'Bern', 'bern', 'DE', $3)",
    ].join("\n"),
    [IDS.cantonZh, IDS.cantonBe, NOW],
  );
  await target.query(
    [
      'INSERT INTO "City" ("id", "cantonId", "name", "slug", "updatedAt")',
      "VALUES",
      "  ($1, $2, 'Zürich', 'zuerich-stadt', $5),",
      "  ($3, $4, 'Bern', 'bern-stadt', $5)",
    ].join("\n"),
    [IDS.cityZurich, IDS.cantonZh, IDS.cityBern, IDS.cantonBe, NOW],
  );
  await target.query(
    [
      'INSERT INTO "Category" ("id", "name", "slug", "isActive", "sortOrder", "updatedAt")',
      "VALUES",
      "  ($1, 'Engineering/Technik', 'engineering-technik', true, 10, $3),",
      "  ($2, 'Gesundheit/Pflege', 'gesundheit-pflege', true, 20, $3)",
    ].join("\n"),
    [IDS.categoryEngineering, IDS.categoryHealth, NOW],
  );

  await insertCompany(target, {
    id: IDS.verifiedCompany,
    name: "Zürich Platform AG",
    slug: "zuerich-platform-ag",
    provenance: "LIVE",
    verificationId: IDS.verifiedRequest,
    locationId: IDS.verifiedCompanyLocation,
  });
  await insertCompany(target, {
    id: IDS.secondVerifiedCompany,
    name: "Bern Care AG",
    slug: "bern-care-ag",
    provenance: "LIVE",
    verificationId: IDS.secondVerifiedRequest,
    locationId: IDS.secondVerifiedCompanyLocation,
  });
  await insertCompany(target, {
    id: IDS.unverifiedCompany,
    name: "Unverified AG",
    slug: "unverified-ag",
    provenance: "LIVE",
    verificationId: null,
    locationId: IDS.unverifiedCompanyLocation,
  });
  await insertCompany(target, {
    id: IDS.demoCompany,
    name: "Demo Company AG",
    slug: "demo-company-ag",
    provenance: "DEMO",
    verificationId: IDS.demoVerifiedRequest,
    locationId: IDS.demoCompanyLocation,
  });

  await insertJob(target, {
    id: IDS.platformJob,
    revisionId: IDS.platformRevision,
    scoreId: IDS.platformScore,
    companyId: IDS.verifiedCompany,
    slug: SLUGS.platform,
    title: "Senior Platform Engineer",
    description: "Entwickle sichere Plattformen für den Schweizer Arbeitsmarkt.",
    status: "PUBLISHED",
    provenance: "LIVE",
    categoryId: IDS.categoryEngineering,
    cantonId: IDS.cantonZh,
    cityId: IDS.cityZurich,
    contentLanguage: "DE",
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    effort: "SIMPLE",
    workloadMin: 80,
    workloadMax: 100,
    salaryMin: 120_000,
    salaryMax: 145_000,
    publishedAt: atDay(-1),
    validThrough: atDay(30),
    score: 94,
  });
  await insertJob(target, {
    id: IDS.careJob,
    revisionId: IDS.careRevision,
    scoreId: IDS.careScore,
    companyId: IDS.secondVerifiedCompany,
    slug: SLUGS.care,
    title: "Pflegefachperson Akut",
    description: "Verstärke ein interdisziplinäres Pflegeteam in Bern.",
    status: "PUBLISHED",
    provenance: "LIVE",
    categoryId: IDS.categoryHealth,
    cantonId: IDS.cantonBe,
    cityId: IDS.cityBern,
    contentLanguage: "FR",
    jobType: "TEMPORARY",
    remoteType: "ONSITE",
    effort: "MEDIUM",
    workloadMin: 50,
    workloadMax: 70,
    salaryMin: 82_000,
    salaryMax: 98_000,
    publishedAt: atDay(-2),
    validThrough: atDay(28),
    score: 86,
  });
  await insertJob(target, {
    id: IDS.draftJob,
    revisionId: IDS.draftRevision,
    scoreId: IDS.draftScore,
    companyId: IDS.verifiedCompany,
    slug: SLUGS.draft,
    title: "Draft Platform Role",
    description: "Dieser freigegebene Entwurf darf öffentlich nie erscheinen.",
    status: "DRAFT",
    provenance: "LIVE",
    categoryId: IDS.categoryEngineering,
    cantonId: IDS.cantonZh,
    cityId: IDS.cityZurich,
    contentLanguage: "DE",
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    effort: "SIMPLE",
    workloadMin: 80,
    workloadMax: 100,
    salaryMin: 110_000,
    salaryMax: 130_000,
    publishedAt: atDay(-3),
    validThrough: atDay(20),
    score: 80,
  });
  await insertJob(target, {
    id: IDS.expiredJob,
    revisionId: IDS.expiredRevision,
    scoreId: IDS.expiredScore,
    companyId: IDS.verifiedCompany,
    slug: SLUGS.expired,
    title: "Expired Platform Role",
    description: "Dieses Stelleninserat ist vollständig abgelaufen.",
    status: "EXPIRED",
    provenance: "LIVE",
    categoryId: IDS.categoryEngineering,
    cantonId: IDS.cantonZh,
    cityId: IDS.cityZurich,
    contentLanguage: "DE",
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    effort: "SIMPLE",
    workloadMin: 80,
    workloadMax: 100,
    salaryMin: 100_000,
    salaryMax: 120_000,
    publishedAt: atDay(-30),
    validThrough: atDay(-1),
    score: 78,
  });
  await insertJob(target, {
    id: IDS.restrictedJob,
    revisionId: IDS.restrictedRevision,
    scoreId: IDS.restrictedScore,
    companyId: IDS.verifiedCompany,
    slug: SLUGS.restricted,
    title: "Restricted Platform Role",
    description: "Diese sonst gültige Stelle hat eine aktive Sperre.",
    status: "PUBLISHED",
    provenance: "LIVE",
    categoryId: IDS.categoryEngineering,
    cantonId: IDS.cantonZh,
    cityId: IDS.cityZurich,
    contentLanguage: "DE",
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    effort: "SIMPLE",
    workloadMin: 70,
    workloadMax: 100,
    salaryMin: 115_000,
    salaryMax: 135_000,
    publishedAt: atDay(-3),
    validThrough: atDay(25),
    score: 82,
  });
  await insertJob(target, {
    id: IDS.unverifiedJob,
    revisionId: IDS.unverifiedRevision,
    scoreId: IDS.unverifiedScore,
    companyId: IDS.unverifiedCompany,
    slug: SLUGS.unverified,
    title: "Unverified Platform Role",
    description: "Diese Stelle gehört zu einer nicht verifizierten Firma.",
    status: "PUBLISHED",
    provenance: "LIVE",
    categoryId: IDS.categoryEngineering,
    cantonId: IDS.cantonZh,
    cityId: IDS.cityZurich,
    contentLanguage: "DE",
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    effort: "SIMPLE",
    workloadMin: 80,
    workloadMax: 100,
    salaryMin: 118_000,
    salaryMax: 138_000,
    publishedAt: atDay(-4),
    validThrough: atDay(24),
    score: 84,
  });
  await insertJob(target, {
    id: IDS.demoJob,
    revisionId: IDS.demoRevision,
    scoreId: IDS.demoScore,
    companyId: IDS.verifiedCompany,
    slug: SLUGS.demo,
    title: "Demo Platform Role",
    description: "Explizite Demo-Stelle für den nichtproduktiven Datenkontext.",
    status: "PUBLISHED",
    provenance: "DEMO",
    categoryId: IDS.categoryEngineering,
    cantonId: IDS.cantonZh,
    cityId: IDS.cityZurich,
    contentLanguage: "DE",
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    effort: "SIMPLE",
    workloadMin: 80,
    workloadMax: 100,
    salaryMin: 105_000,
    salaryMax: 125_000,
    publishedAt: atDay(-5),
    validThrough: atDay(18),
    score: 76,
  });
  await insertJob(target, {
    id: IDS.demoCompanyJob,
    revisionId: IDS.demoCompanyRevision,
    scoreId: IDS.demoCompanyScore,
    companyId: IDS.demoCompany,
    slug: SLUGS.demoCompany,
    title: "Live Role of Demo Company",
    description: "LIVE-Datensatz einer Firma mit Demo-Provenienz.",
    status: "PUBLISHED",
    provenance: "LIVE",
    categoryId: IDS.categoryEngineering,
    cantonId: IDS.cantonZh,
    cityId: IDS.cityZurich,
    contentLanguage: "DE",
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    effort: "SIMPLE",
    workloadMin: 60,
    workloadMax: 100,
    salaryMin: 100_000,
    salaryMax: 120_000,
    publishedAt: atDay(-6),
    validThrough: atDay(17),
    score: 74,
  });

  await target.query(
    [
      'INSERT INTO "AbuseReport" (',
      '  "id", "targetType", "targetId", "reasonCode", "description",',
      '  "severity", "status", "dueAt", "updatedAt"',
      ") VALUES ($1, 'JOB', $2, 'PUBLIC_VISIBILITY_REVIEW', $3, 'HIGH', 'IN_REVIEW', $4, $5)",
    ].join("\n"),
    [
      IDS.restrictionReport,
      IDS.restrictedJob,
      "Phase-07 fixture for an effective public visibility restriction.",
      atDay(2),
      NOW,
    ],
  );
  await restoreRestriction(target);
}

async function insertCompany(
  target: Pool,
  input: Readonly<{
    id: string;
    name: string;
    slug: string;
    provenance: "LIVE" | "DEMO";
    verificationId: string | null;
    locationId: string;
  }>,
) {
  await target.query(
    [
      'INSERT INTO "Company" (',
      '  "id", "name", "slug", "industry", "size", "website", "about",',
      '  "values", "benefits", "responseTargetDays", "responseSampleSize",',
      '  "responseWithinTargetBps", "status", "dataProvenance", "updatedAt"',
      ") VALUES (",
      "  $1, $2, $3, 'Technology', '51-200', 'https://example.test',",
      "  'Aktive Schweizer Arbeitgeberin.', ARRAY['Fairness'], ARRAY['Flexibilität'],",
      "  5, 25, 9000, 'DRAFT', $4, $5",
      ")",
    ].join("\n"),
    [input.id, input.name, input.slug, input.provenance, NOW],
  );
  await target.query(
    [
      'INSERT INTO "CompanyLocation" (',
      '  "id", "companyId", "cantonId", "cityId", "address", "postalCode",',
      '  "isPrimary", "updatedAt"',
      ") VALUES ($1, $2, $3, $4, 'Teststrasse 7', '8000', true, $5)",
    ].join("\n"),
    [input.locationId, input.id, IDS.cantonZh, IDS.cityZurich, NOW],
  );
  await target.query(
    'UPDATE "Company" SET "status" = \'ACTIVE\', "updatedAt" = $2 WHERE "id" = $1',
    [input.id, NOW],
  );
  if (input.verificationId === null) return;
  await target.query(
    [
      'INSERT INTO "CompanyVerificationRequest" (',
      '  "id", "companyId", "requestedByUserId", "status",',
      '  "evidenceMetadata", "updatedAt"',
      ") VALUES ($1, $2, $3, 'VERIFIED', '{\"source\":\"phase07\"}'::jsonb, $4)",
    ].join("\n"),
    [input.verificationId, input.id, IDS.user, NOW],
  );
}

async function insertJob(
  target: Pool,
  input: Readonly<{
    id: string;
    revisionId: string;
    scoreId: string;
    companyId: string;
    slug: string;
    title: string;
    description: string;
    status: "DRAFT" | "PUBLISHED" | "EXPIRED";
    provenance: "LIVE" | "DEMO";
    categoryId: string;
    cantonId: string;
    cityId: string;
    contentLanguage: "DE" | "FR";
    jobType: "PERMANENT" | "TEMPORARY";
    remoteType: "ONSITE" | "HYBRID" | "REMOTE";
    effort: "SIMPLE" | "MEDIUM";
    workloadMin: number;
    workloadMax: number;
    salaryMin: number;
    salaryMax: number;
    publishedAt: Date;
    validThrough: Date;
    score: number;
  }>,
) {
  await target.query(
    [
      'INSERT INTO "Job" (',
      '  "id", "companyId", "slug", "status", "origin", "sourceReference",',
      '  "dataProvenance", "createdByUserId", "createdAt", "updatedAt"',
      ") VALUES ($1, $2, $3, 'DRAFT', 'MANUAL', $4, $5, $6, $7, $7)",
    ].join("\n"),
    [
      input.id,
      input.companyId,
      input.slug,
      `phase07:${input.slug}`,
      input.provenance,
      IDS.user,
      atDay(-40),
    ],
  );
  await target.query(
    [
      'INSERT INTO "JobRevision" (',
      '  "id", "jobId", "revisionNumber", "contentLanguage", "title",',
      '  "description", "tasks", "requirements", "applicationProcessSteps",',
      '  "requiredDocumentKinds", "jobType", "remoteType", "categoryId",',
      '  "cantonId", "cityId", "locationLabel", "workloadMin", "workloadMax",',
      '  "salaryPeriod", "salaryMin", "salaryMax", "startByArrangement",',
      '  "validThrough", "responseTargetDays", "applicationEffort",',
      '  "inclusionStatement", "applicationContactKind",',
      '  "applicationContactValue", "authoredByUserId", "contentChecksum",',
      '  "submittedAt", "approvedAt", "createdAt"',
      ") VALUES (",
      "  $1, $2, 1, $3, $4, $5, CASE WHEN $4::varchar = 'Senior Platform Engineer'::varchar",
      "  THEN ARRAY['Kubernetes-Plattform betreiben'] ELSE ARRAY['Verantwortung übernehmen'] END,",
      "  ARRAY['Nachweisbare Erfahrung'], ARRAY['Online bewerben'],",
      "  ARRAY['CV']::\"RequiredDocumentKind\"[], $6, $7, $8, $9, $10,",
      "  'Schweiz', $11, $12, 'YEARLY', $13, $14, true, $15, 5, $16,",
      "  'Alle qualifizierten Menschen sind willkommen.', 'EMAIL',",
      "  'jobs@example.test', $17, $18, $19, $20, $21",
      ")",
    ].join("\n"),
    [
      input.revisionId,
      input.id,
      input.contentLanguage,
      input.title,
      input.description,
      input.jobType,
      input.remoteType,
      input.categoryId,
      input.cantonId,
      input.cityId,
      input.workloadMin,
      input.workloadMax,
      input.salaryMin,
      input.salaryMax,
      input.validThrough,
      input.effort,
      IDS.user,
      input.scoreId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      new Date(input.publishedAt.getTime() - DAY),
      new Date(input.publishedAt.getTime() - DAY),
      new Date(input.publishedAt.getTime() - 2 * DAY),
    ],
  );
  await target.query(
    [
      'UPDATE "Job" SET',
      '  "status" = $2, "currentRevisionId" = $3, "publishedRevisionId" = $3,',
      '  "publishedAt" = $4, "expiresAt" = $5,',
      '  "publishedCategoryId" = $6, "publishedCantonId" = $7,',
      '  "publishedCityId" = $8, "publishedSalaryPeriod" = \'YEARLY\',',
      '  "publishedSalaryMin" = $9, "publishedSalaryMax" = $10, "updatedAt" = $11',
      'WHERE "id" = $1',
    ].join("\n"),
    [
      input.id,
      input.status,
      input.revisionId,
      input.publishedAt,
      input.validThrough,
      input.categoryId,
      input.cantonId,
      input.cityId,
      input.salaryMin,
      input.salaryMax,
      NOW,
    ],
  );
  await target.query(
    [
      'INSERT INTO "JobScoreSnapshot" (',
      '  "id", "jobRevisionId", "scoreVersion", "scorePoints", "maxPoints",',
      '  "inputSnapshot", "evidence", "factorBreakdown", "evidenceHash",',
      '  "calculatedAt"',
      ") VALUES ($1, $2, 'v2', $3, 100, '{}'::jsonb, '{}'::jsonb,",
      "  '{}'::jsonb, $4, $5)",
    ].join("\n"),
    [
      input.scoreId,
      input.revisionId,
      input.score,
      input.revisionId.replaceAll("-", "").padEnd(64, "f").slice(0, 64),
      input.publishedAt,
    ],
  );
}

async function retireJobFixture(
  target: Pool,
  jobId: string,
): Promise<void> {
  await target.query(
    'UPDATE "Job" SET "status" = \'DRAFT\' WHERE "id" = $1',
    [jobId],
  );
}

async function restoreRestriction(target: Pool) {
  await target.query(
    [
      'INSERT INTO "ModerationRestriction" (',
      '  "id", "abuseReportId", "targetType", "targetId", "status",',
      '  "reason", "appliedByUserId", "startsAt", "endsAt", "liftedAt",',
      '  "correlationId", "idempotencyKey"',
      ") VALUES ($1, $2, 'HIDE_JOB', $3, 'ACTIVE', $4, $5, $6, $7, NULL, $8, $9)",
      'ON CONFLICT ("id") DO UPDATE SET',
      '  "status" = EXCLUDED."status", "startsAt" = EXCLUDED."startsAt",',
      '  "endsAt" = EXCLUDED."endsAt", "liftedAt" = NULL',
    ].join("\n"),
    [
      IDS.restriction,
      IDS.restrictionReport,
      IDS.restrictedJob,
      "Aktive Phase-07-Testsperre.",
      IDS.user,
      atDay(-1),
      atDay(2),
      "07000000-0000-4000-8000-000000000041",
      "phase07-public-read-model-hide-job",
    ],
  );
}

async function insertLargeSearchCohort(target: Pool) {
  await target.query(
    [
      'INSERT INTO "Job" (',
      '  "id", "companyId", "slug", "status", "origin", "sourceReference",',
      '  "dataProvenance", "createdByUserId", "createdAt", "updatedAt"',
      ') SELECT',
      "  ('15000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,",
      '  $1, CASE WHEN series = 2006 THEN \'phase15-global-needle\'',
      "    ELSE 'phase15-global-filler-' || series::text END,",
      "  'DRAFT', 'MANUAL', 'phase15-global-search', 'LIVE', $2, $3, $3",
      'FROM generate_series(1, 2006) AS series',
    ].join("\n"),
    [IDS.verifiedCompany, IDS.user, atDay(-50)],
  );
  await target.query(
    [
      'INSERT INTO "JobRevision" (',
      '  "id", "jobId", "revisionNumber", "contentLanguage", "title",',
      '  "description", "tasks", "requirements", "applicationProcessSteps",',
      '  "requiredDocumentKinds", "jobType", "remoteType", "categoryId",',
      '  "cantonId", "cityId", "locationLabel", "workloadMin", "workloadMax",',
      '  "salaryPeriod", "salaryMin", "salaryMax", "startByArrangement",',
      '  "validThrough", "responseTargetDays", "applicationEffort",',
      '  "inclusionStatement", "applicationContactKind",',
      '  "applicationContactValue", "authoredByUserId", "contentChecksum",',
      '  "submittedAt", "approvedAt", "createdAt"',
      ') SELECT',
      "  ('15100000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,",
      "  ('15000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,",
      "  1, 'DE', CASE WHEN series = 2006 THEN 'Globalneedle Spezialist'",
      "    ELSE 'Bulk-Füllstelle ' || series::text END,",
      "  'Deterministischer Phase-15-Suchdatensatz.', ARRAY[]::text[], ARRAY[]::text[],",
      "  ARRAY['Online bewerben'], ARRAY['CV']::\"RequiredDocumentKind\"[],",
      "  'PERMANENT', 'HYBRID', $1, $2, $3, 'Zürich', 80, 100,",
      "  'YEARLY', 100000, 120000, true, $4, 5, 'SIMPLE',",
      "  'Alle qualifizierten Menschen sind willkommen.', 'EMAIL',",
      "  'jobs@example.test', $5, md5('phase15-global-' || series::text) ||",
      "  md5('phase15-global-extra-' || series::text), $6, $6, $6",
      'FROM generate_series(1, 2006) AS series',
    ].join("\n"),
    [
      IDS.categoryEngineering,
      IDS.cantonZh,
      IDS.cityZurich,
      atDay(30),
      IDS.user,
      atDay(-41),
    ],
  );
  await target.query(
    [
      'UPDATE "Job" SET',
      "  \"status\" = 'PUBLISHED',",
      "  \"currentRevisionId\" = ('15100000-0000-4000-8000-' ||",
      "    lpad(right(\"id\"::text, 12), 12, '0'))::uuid,",
      "  \"publishedRevisionId\" = ('15100000-0000-4000-8000-' ||",
      "    lpad(right(\"id\"::text, 12), 12, '0'))::uuid,",
      '  "publishedAt" = CASE WHEN "slug" = \'phase15-global-needle\' THEN $1::timestamptz',
      "    ELSE $2::timestamptz - ((right(\"id\"::text, 12))::bigint * interval '1 second') END,",
      '  "expiresAt" = $3::timestamptz, "publishedCategoryId" = $4, "publishedCantonId" = $5,',
      '  "publishedCityId" = $6, "publishedSalaryPeriod" = \'YEARLY\',',
      '  "publishedSalaryMin" = 100000, "publishedSalaryMax" = 120000,',
      '  "updatedAt" = $2',
      "WHERE \"sourceReference\" = 'phase15-global-search'",
    ].join("\n"),
    [atDay(-40), atDay(-1), atDay(30), IDS.categoryEngineering, IDS.cantonZh, IDS.cityZurich],
  );
}

async function insertResponseMedianCohort(target: Pool) {
  await target.query(
    'UPDATE "Company" SET "responseTargetDays" = 5, "responseSampleSize" = 20, "responseWithinTargetBps" = 10000 WHERE "id" IN ($1, $2)',
    [IDS.verifiedCompany, IDS.secondVerifiedCompany],
  );
  await target.query(
    [
      'INSERT INTO "User" (',
      '  "id", "email", "emailNormalized", "role", "status",',
      '  "dataProvenance", "updatedAt"',
      ') SELECT',
      "  md5('phase15-response-user-' || series::text)::uuid,",
      "  'phase15-response-candidate-' || series::text || '@example.test',",
      "  'phase15-response-candidate-' || series::text || '@example.test',",
      "  'CANDIDATE', 'ACTIVE', 'LIVE', $1",
      'FROM generate_series(1, 20) AS series',
    ].join("\n"),
    [NOW],
  );
  await target.query(
    [
      'INSERT INTO "CandidateProfile" (',
      '  "id", "userId", "firstName", "lastName", "onboardingStatus", "updatedAt"',
      ')',
      'SELECT',
      "  md5('phase15-response-profile-' || series::text)::uuid,",
      "  md5('phase15-response-user-' || series::text)::uuid,",
      "  'Candidate', series::text, 'DRAFT', $1",
      'FROM generate_series(1, 20) AS series',
    ].join("\n"),
    [NOW],
  );
  await target.query(
    [
      'INSERT INTO "Application" (',
      '  "id", "jobId", "submittedJobRevisionId", "candidateProfileId",',
      '  "idempotencyKey", "submissionPayloadHash", "status", "submittedAt", "updatedAt"',
      ') SELECT',
      "  md5('phase15-response-application-' || series::text)::uuid, $1, $2,",
      "  md5('phase15-response-profile-' || series::text)::uuid,",
      "  'phase15-response-application-' || series::text,",
      "  md5('phase15-response-payload-' || series::text) ||",
      "    md5('phase15-response-payload-extra-' || series::text),",
      "  'SUBMITTED', $3::timestamptz - interval '10 days',",
      "  $3::timestamptz - interval '10 days'",
      'FROM generate_series(1, 20) AS series',
    ].join("\n"),
    [IDS.careJob, IDS.careRevision, NOW],
  );
  await target.query(
    [
      'INSERT INTO "ApplicationSubmissionSnapshot" (',
      '  "id", "applicationId", "jobRevisionId", "candidateFirstName",',
      '  "candidateLastName", "candidateEmail", "recipientCompanyName",',
      '  "applicationContactKind", "applicationContactValue", "responseTargetDays",',
      '  "applicationEffort", "requiredDocumentKinds", "confirmationNoticeVersion",',
      '  "confirmationNoticeHash", "confirmationSnapshotHash",',
      '  "confirmationSnapshotHashVersion", "submittedAt"',
      ') SELECT',
      "  md5('phase15-response-snapshot-' || series::text)::uuid,",
      "  md5('phase15-response-application-' || series::text)::uuid, $1,",
      "  'Candidate', series::text,",
      "  'phase15-response-candidate-' || series::text || '@example.test',",
      "  'Bern Care AG', 'EMAIL', 'jobs@example.test', 5, 'MEDIUM',",
      "  ARRAY['CV']::\"RequiredDocumentKind\"[], 'v1',",
      "  md5('phase15-response-notice-' || series::text) ||",
      "    md5('phase15-response-notice-extra-' || series::text),",
      "  md5('phase15-response-confirmation-' || series::text) ||",
      "    md5('phase15-response-confirmation-extra-' || series::text),",
      "  'application-confirmation-snapshot-v1',",
      "  $2::timestamptz - interval '10 days'",
      'FROM generate_series(1, 20) AS series',
    ].join("\n"),
    [IDS.careRevision, NOW],
  );
  await target.query(
    [
      'INSERT INTO "ApplicationEvent" (',
      '  "id", "applicationId", "actorUserId", "kind", "idempotencyKey",',
      '  "correlationId", "createdAt"',
      ') SELECT',
      "  md5('phase15-response-event-' || series::text)::uuid,",
      "  md5('phase15-response-application-' || series::text)::uuid, $1,",
      "  'MESSAGE_SENT', 'phase15-response-event-' || series::text,",
      "  'phase15-response-correlation-' || series::text,",
      "  $2::timestamptz - interval '10 days' + interval '60 minutes'",
      'FROM generate_series(1, 20) AS series',
    ].join("\n"),
    [IDS.user, NOW],
  );
}

async function benchmarkGlobalKeywordSearch() {
  const input = parsePublicJobSearchParams({ keyword: "globalneedle", pageSize: "1" });
  const broadInput = parsePublicJobSearchParams({
    keyword: "Deterministischer",
    pageSize: "50",
    sort: "newest",
  });
  const samples = await measureSearch(input);
  const broadSamples = await measureSearch(broadInput);
  type ExplainNode = Readonly<{
    "Node Type": string;
    "Index Name"?: string;
    "Actual Total Time": number;
    Plans?: readonly ExplainNode[];
  }>;
  const explain = await pool().query<{
    "QUERY PLAN": Array<Readonly<{
      Plan: ExplainNode;
      "Execution Time": number;
    }>>;
  }>(
    [
      'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)',
      'SELECT job."id"',
      'FROM "Job" AS job',
      'JOIN "JobRevision" AS revision ON revision."id" = job."publishedRevisionId"',
      'JOIN "Company" AS company ON company."id" = job."companyId"',
      'WHERE translate(lower(revision."title"), $1, $2) LIKE \'%globalneedle%\'',
      '   OR translate(lower(revision."description"), $1, $2) LIKE \'%globalneedle%\'',
      '   OR translate(lower(COALESCE(revision."offer", \'\')), $1, $2) LIKE \'%globalneedle%\'',
      '   OR translate(lower(company."name"), $1, $2) LIKE \'%globalneedle%\'',
      '   OR translate(lower(array_to_string(revision."tasks", \' \')), $1, $2) LIKE \'%globalneedle%\'',
      '   OR translate(lower(array_to_string(revision."requirements", \' \')), $1, $2) LIKE \'%globalneedle%\'',
      'ORDER BY job."id" ASC LIMIT 500',
    ].join("\n"),
    [
      "àáâãäåçčďèéêëìíîïñňòóôõöřšťùúûüýÿž",
      "aaaaaaccdeeeeiiiinnooooorstuuuuyyz",
    ],
  );
  const plan = explain.rows[0]?.["QUERY PLAN"]?.[0];
  const nodes = plan === undefined ? [] : flattenExplainNodes(plan.Plan);
  const broadExplain = await pool().query<{
    "QUERY PLAN": Array<Readonly<{
      Plan: ExplainNode;
      "Execution Time": number;
    }>>;
  }>(
    [
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)",
      'SELECT job."id"',
      'FROM "Job" AS job',
      'JOIN "JobRevision" AS revision ON revision."id" = job."publishedRevisionId"',
      'JOIN "Company" AS company ON company."id" = job."companyId"',
      "WHERE job.\"status\" = 'PUBLISHED'",
      '  AND job."currentRevisionId" = job."publishedRevisionId"',
      '  AND job."publishedAt" <= $1 AND job."expiresAt" > $1',
      "  AND regexp_replace(normalize(lower(revision.\"description\"), NFKD), $2, '', 'g')",
      "    LIKE '%deterministischer%'",
      "ORDER BY CASE WHEN regexp_replace(normalize(lower(revision.\"description\"), NFKD),",
      "  $2, '', 'g') LIKE '%deterministischer%' THEN 1 ELSE 0 END DESC,",
      '  job."publishedAt" DESC, job."id" ASC',
      "LIMIT 51",
    ].join("\n"),
    [NOW, "[\u0300-\u036f]"],
  );
  const broadPlan = broadExplain.rows[0]?.["QUERY PLAN"]?.[0];
  const broadNodes = broadPlan === undefined ? [] : flattenExplainNodes(broadPlan.Plan);
  const structuredExplain = await pool().query<{
    "QUERY PLAN": Array<Readonly<{
      Plan: ExplainNode;
      "Execution Time": number;
    }>>;
  }>(
    [
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)",
      'SELECT job."id"',
      'FROM "Job" AS job',
      'WHERE job."publishedCategoryId" = $1',
      '  AND job."publishedCantonId" = $2',
      "  AND job.\"status\" = 'PUBLISHED'",
      "  AND job.\"publishedSalaryPeriod\" = 'YEARLY'",
      '  AND job."publishedSalaryMax" >= 80000',
      '  AND job."publishedAt" <= $3',
      '  AND job."expiresAt" > $3',
      'ORDER BY job."publishedAt" DESC, job."id" ASC LIMIT 51',
    ].join("\n"),
    [IDS.categoryHealth, IDS.cantonBe, NOW],
  );
  const structuredPlan = structuredExplain.rows[0]?.["QUERY PLAN"]?.[0];
  const structuredNodes = structuredPlan === undefined
    ? []
    : flattenExplainNodes(structuredPlan.Plan);
  return Object.freeze({
    dataset: "phase15-global-search-v1",
    eligibleFixtureJobs: 2_006,
    measuredRuns: samples.length,
    p50Ms: roundMillis(percentile(samples, 0.5)),
    p95Ms: roundMillis(percentile(samples, 0.95)),
    broadMatchedJobs: 2_006,
    broadHydratedPageSize: 50,
    broadP50Ms: roundMillis(percentile(broadSamples, 0.5)),
    broadP95Ms: roundMillis(percentile(broadSamples, 0.95)),
    explainRootNode: plan?.Plan["Node Type"] ?? "UNKNOWN",
    explainNodeTypes: Object.freeze([...new Set(nodes.map((node) => node["Node Type"]))]),
    explainIndexes: Object.freeze([...new Set(nodes.flatMap(
      (node) => node["Index Name"] === undefined ? [] : [node["Index Name"]],
    ))]),
    explainRootActualMs: roundMillis(plan?.Plan["Actual Total Time"] ?? 0),
    explainExecutionMs: roundMillis(plan?.["Execution Time"] ?? 0),
    broadExplainNodeTypes: Object.freeze([
      ...new Set(broadNodes.map((node) => node["Node Type"])),
    ]),
    broadExplainIndexes: Object.freeze([...new Set(broadNodes.flatMap(
      (node) => node["Index Name"] === undefined ? [] : [node["Index Name"]],
    ))]),
    broadExplainExecutionMs: roundMillis(broadPlan?.["Execution Time"] ?? 0),
    structuredExplainNodeTypes: Object.freeze([
      ...new Set(structuredNodes.map((node) => node["Node Type"])),
    ]),
    structuredExplainIndexes: Object.freeze([...new Set(structuredNodes.flatMap(
      (node) => node["Index Name"] === undefined ? [] : [node["Index Name"]],
    ))]),
    structuredExplainExecutionMs: roundMillis(
      structuredPlan?.["Execution Time"] ?? 0,
    ),
  });
}

async function measureSearch(
  input: ReturnType<typeof parsePublicJobSearchParams>,
): Promise<number[]> {
  for (let index = 0; index < 3; index += 1) {
    await listPublicJobs(input, { now: NOW });
  }
  const samples: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now();
    await listPublicJobs(input, { now: NOW });
    samples.push(performance.now() - startedAt);
  }
  return samples.sort((left, right) => left - right);
}

function flattenExplainNodes<Node extends Readonly<{ Plans?: readonly Node[] }>>(
  node: Node,
): readonly Node[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenExplainNodes)];
}

function percentile(sorted: readonly number[], quantile: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

function roundMillis(value: number): number {
  return Math.round(value * 100) / 100;
}
