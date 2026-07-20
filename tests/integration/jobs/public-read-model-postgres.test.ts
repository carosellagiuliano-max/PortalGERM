import { Buffer } from "node:buffer";

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
      workload: "80-90",
      jobType: "permanent",
      remote: "hybrid",
      language: "de",
      effort: "simple",
      salary: "125000",
      salaryDisclosed: "true",
      companyVerified: "true",
      sort: "salary-desc",
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

  it("paginates a stable production result with a signed cursor and rejects tampering", async () => {
    setRuntimeEnvironment("production");
    const input = { ...emptyPublicJobSearchInput(), sort: "newest" as const };

    const first = await listPublicJobs(input, { now: NOW, pageSize: 1 });
    expect(first.jobs.map((job) => job.slug)).toEqual([SLUGS.platform]);
    expect(first.totalEligible).toBe(2);
    expect(first.invalidCursor).toBe(false);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await listPublicJobs(
      { ...input, cursor: first.nextCursor as string },
      { now: NOW, pageSize: 1 },
    );
    expect(second.jobs.map((job) => job.slug)).toEqual([SLUGS.care]);
    expect(second.nextCursor).toBeNull();
    expect(second.invalidCursor).toBe(false);

    const [encoded] = (first.nextCursor as string).split(".");
    const tampered = await listPublicJobs(
      { ...input, cursor: `${encoded}.invalid` },
      { now: NOW, pageSize: 1 },
    );
    expect(tampered.invalidCursor).toBe(true);
    expect(tampered.jobs.map((job) => job.slug)).toEqual([SLUGS.platform]);
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
    SESSION_SECRET: secret(1),
    AUDIT_IP_HASH_KEYS: `v1:${secret(2)}`,
    RADAR_OPAQUE_LOOKUP_KEYS: `v1:${secret(3)}`,
    RADAR_OPAQUE_ENCRYPTION_KEYS: `v1:${secret(4)}`,
    REVEAL_CONFIRMATION_KEYS: `v1:${secret(5)}`,
    PII_REVEAL_KEYS: `v1:${secret(6)}`,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: appEnvironment === "production" ? "1" : "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
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
      "  $1, $2, 1, $3, $4, $5, ARRAY['Verantwortung übernehmen'],",
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

async function restoreRestriction(target: Pool) {
  await target.query(
    [
      'INSERT INTO "ModerationRestriction" (',
      '  "id", "abuseReportId", "targetType", "targetId", "status",',
      '  "reason", "appliedByUserId", "startsAt", "endsAt", "liftedAt",',
      '  "correlationId"',
      ") VALUES ($1, $2, 'HIDE_JOB', $3, 'ACTIVE', $4, $5, $6, $7, NULL, $8)",
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
    ],
  );
}
