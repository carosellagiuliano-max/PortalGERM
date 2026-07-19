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

vi.mock("server-only", () => ({}));

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { isJobPubliclyEligible } from "@/lib/jobs/public-eligibility";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const IDS = {
  abuseReport: "00000000-0000-4000-8000-000000003101",
  canton: "00000000-0000-4000-8000-000000003102",
  category: "00000000-0000-4000-8000-000000003103",
  city: "00000000-0000-4000-8000-000000003104",
  company: "00000000-0000-4000-8000-000000003105",
  currentVerification: "00000000-0000-4000-8000-000000003106",
  demoJob: "00000000-0000-4000-8000-000000003107",
  demoRevision: "00000000-0000-4000-8000-000000003108",
  job: "00000000-0000-4000-8000-000000003109",
  location: "00000000-0000-4000-8000-000000003110",
  membership: "00000000-0000-4000-8000-000000003111",
  oldVerification: "00000000-0000-4000-8000-000000003112",
  restriction: "00000000-0000-4000-8000-000000003113",
  revision: "00000000-0000-4000-8000-000000003114",
  unapprovedJob: "00000000-0000-4000-8000-000000003115",
  unapprovedRevision: "00000000-0000-4000-8000-000000003116",
  user: "00000000-0000-4000-8000-000000003117",
} as const;

const SCORE_HASH = "a".repeat(64);

let contractNow = new Date(0);
let publishedAt = new Date(0);
let validThrough = new Date(0);
let database: MigratedDatabase | undefined;
let databaseClient: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (!databaseClient) {
    throw new Error(
      "The isolated eligibility database client is not initialized",
    );
  }

  return databaseClient;
}

function target(): Pool {
  if (!database) {
    throw new Error("The isolated eligibility database is not initialized");
  }

  return database.pool;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);
}

async function insertPublishedJob(
  pool: Pool,
  input: Readonly<{
    approved: boolean;
    checksumCharacter: string;
    id: string;
    provenance: "DEMO" | "LIVE";
    revisionId: string;
    scoreId: string;
    slug: string;
  }>,
) {
  await pool.query(
    [
      'INSERT INTO "Job" (',
      '  "id", "companyId", "slug", "status", "origin",',
      '  "sourceReference", "dataProvenance", "createdByUserId", "updatedAt"',
      ") VALUES ($1, $2, $3, 'DRAFT', 'MANUAL', $4, $5, $6, $7)",
    ].join("\n"),
    [
      input.id,
      IDS.company,
      input.slug,
      `integration:${input.slug}`,
      input.provenance,
      IDS.user,
      contractNow,
    ],
  );
  await pool.query(
    [
      'INSERT INTO "JobRevision" (',
      '  "id", "jobId", "revisionNumber", "title", "description",',
      '  "tasks", "requirements", "applicationProcessSteps",',
      '  "requiredDocumentKinds", "jobType", "remoteType", "remoteCountryCode",',
      '  "categoryId", "cantonId", "cityId", "locationLabel",',
      '  "workloadMin", "workloadMax", "salaryPeriod", "salaryMin", "salaryMax",',
      '  "startByArrangement", "validThrough", "responseTargetDays",',
      '  "applicationEffort", "inclusionStatement", "applicationContactKind",',
      '  "applicationContactValue", "authoredByUserId", "contentChecksum",',
      '  "submittedAt", "approvedAt", "createdAt"',
      ") VALUES (",
      "  $1, $2, 1, $3, $4,",
      "  ARRAY['Build reliable products'], ARRAY['PostgreSQL experience'],",
      "  ARRAY['Submit application'], ARRAY['CV']::\"RequiredDocumentKind\"[],",
      "  'PERMANENT', 'ONSITE', NULL,",
      "  $5, $6, $7, 'Zürich',",
      "  80, 100, 'YEARLY', 100000, 130000,",
      "  false, $8, 7, 'SIMPLE',",
      "  'Applications are assessed against transparent role criteria.',",
      "  'EMAIL', 'jobs@example.test', $9, $10,",
      "  $11, $12, $13",
      ")",
    ].join("\n"),
    [
      input.revisionId,
      input.id,
      `Senior Engineer ${input.slug}`,
      "A complete and verifiable role description for the public contract.",
      IDS.category,
      IDS.canton,
      IDS.city,
      validThrough,
      IDS.user,
      input.checksumCharacter.repeat(64),
      addDays(publishedAt, -1),
      input.approved ? publishedAt : null,
      addDays(publishedAt, -2),
    ],
  );
  await pool.query(
    [
      'UPDATE "Job" SET',
      '  "status" = \'PUBLISHED\', "currentRevisionId" = $2,',
      '  "publishedRevisionId" = $2, "publishedAt" = $3, "expiresAt" = $4,',
      '  "publishedCategoryId" = $5, "publishedCantonId" = $6,',
      '  "publishedCityId" = $7, "publishedSalaryPeriod" = \'YEARLY\',',
      '  "publishedSalaryMin" = 100000, "publishedSalaryMax" = 130000,',
      '  "updatedAt" = $8',
      'WHERE "id" = $1',
    ].join("\n"),
    [
      input.id,
      input.revisionId,
      publishedAt,
      validThrough,
      IDS.category,
      IDS.canton,
      IDS.city,
      contractNow,
    ],
  );
  await pool.query(
    [
      'INSERT INTO "JobScoreSnapshot" (',
      '  "id", "jobRevisionId", "scoreVersion", "scorePoints", "maxPoints",',
      '  "inputSnapshot", "evidence", "factorBreakdown", "evidenceHash", "calculatedAt"',
      ") VALUES ($1, $2, 'v2', 84, 100, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $3, $4)",
    ].join("\n"),
    [input.scoreId, input.revisionId, SCORE_HASH, publishedAt],
  );
}

async function restoreBaseline() {
  const pool = target();

  await pool.query('DELETE FROM "ModerationRestriction"');
  await pool.query(
    [
      'UPDATE "CompanyVerificationRequest"',
      'SET "status" = \'VERIFIED\', "updatedAt" = $2',
      'WHERE "id" = $1',
    ].join("\n"),
    [IDS.currentVerification, contractNow],
  );
  await pool.query(
    [
      'UPDATE "Company"',
      'SET "status" = \'ACTIVE\', "dataProvenance" = \'LIVE\', "updatedAt" = $2',
      'WHERE "id" = $1',
    ].join("\n"),
    [IDS.company, contractNow],
  );
  await pool.query(
    [
      'UPDATE "Job" SET',
      '  "status" = \'PUBLISHED\', "currentRevisionId" = $2,',
      '  "publishedRevisionId" = $2, "publishedAt" = $3, "expiresAt" = $4,',
      '  "publishedCategoryId" = $5, "publishedCantonId" = $6,',
      '  "publishedCityId" = $7, "publishedSalaryPeriod" = \'YEARLY\',',
      '  "publishedSalaryMin" = 100000, "publishedSalaryMax" = 130000,',
      '  "updatedAt" = $8',
      'WHERE "id" = $1',
    ].join("\n"),
    [
      IDS.job,
      IDS.revision,
      publishedAt,
      validThrough,
      IDS.category,
      IDS.canton,
      IDS.city,
      contractNow,
    ],
  );
}

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase_03_public_eligibility");
  databaseClient = createDatabaseClient(database.connectionString);
  contractNow = new Date();
  contractNow.setMilliseconds(0);
  publishedAt = addDays(contractNow, -1);
  validThrough = addDays(contractNow, 30);
  const pool = target();

  await pool.query(
    [
      'INSERT INTO "User" (',
      '  "id", "email", "emailNormalized", "role", "status", "dataProvenance", "updatedAt"',
      ") VALUES ($1, $2, $2, 'EMPLOYER', 'ACTIVE', 'LIVE', $3)",
    ].join("\n"),
    [IDS.user, "eligibility-owner@example.test", contractNow],
  );
  await pool.query(
    [
      'INSERT INTO "Canton" ("id", "code", "name", "slug", "language", "updatedAt")',
      "VALUES ($1, 'ZH', 'Zürich', 'zuerich-contract', 'DE', $2)",
    ].join("\n"),
    [IDS.canton, contractNow],
  );
  await pool.query(
    [
      'INSERT INTO "City" ("id", "cantonId", "name", "slug", "updatedAt")',
      "VALUES ($1, $2, 'Zürich', 'zuerich-contract', $3)",
    ].join("\n"),
    [IDS.city, IDS.canton, contractNow],
  );
  await pool.query(
    [
      'INSERT INTO "Category" ("id", "name", "slug", "isActive", "updatedAt")',
      "VALUES ($1, 'Engineering', 'engineering-contract', true, $2)",
    ].join("\n"),
    [IDS.category, contractNow],
  );
  await pool.query(
    [
      'INSERT INTO "Company" (',
      '  "id", "name", "slug", "industry", "size", "website", "about",',
      '  "values", "benefits", "status", "dataProvenance", "updatedAt"',
      ") VALUES (",
      "  $1, 'Contract AG', 'contract-ag', 'Software', '51-200',",
      "  'https://example.test', 'A fully onboarded Swiss employer.',",
      "  ARRAY['Fairness'], ARRAY['Flexibility'], 'DRAFT', 'LIVE', $2",
      ")",
    ].join("\n"),
    [IDS.company, contractNow],
  );
  await pool.query(
    [
      'INSERT INTO "CompanyLocation" (',
      '  "id", "companyId", "cantonId", "cityId", "address", "postalCode",',
      '  "isPrimary", "updatedAt"',
      ") VALUES ($1, $2, $3, $4, 'Teststrasse 1', '8000', true, $5)",
    ].join("\n"),
    [IDS.location, IDS.company, IDS.canton, IDS.city, contractNow],
  );
  await pool.query(
    [
      'INSERT INTO "CompanyMembership" (',
      '  "id", "companyId", "userId", "role", "status", "updatedAt"',
      ") VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $4)",
    ].join("\n"),
    [IDS.membership, IDS.company, IDS.user, contractNow],
  );
  await pool.query(
    'UPDATE "Company" SET "status" = \'ACTIVE\', "updatedAt" = $2 WHERE "id" = $1',
    [IDS.company, contractNow],
  );
  await pool.query(
    [
      'INSERT INTO "CompanyVerificationRequest" (',
      '  "id", "companyId", "requestedByUserId", "status", "evidenceMetadata", "updatedAt"',
      ") VALUES ($1, $2, $3, 'VERIFIED', '{\"cycle\":1}'::jsonb, $4)",
    ].join("\n"),
    [IDS.oldVerification, IDS.company, IDS.user, contractNow],
  );
  await pool.query(
    [
      'INSERT INTO "CompanyVerificationRequest" (',
      '  "id", "companyId", "requestedByUserId", "supersedesRequestId",',
      '  "status", "evidenceMetadata", "updatedAt"',
      ") VALUES ($1, $2, $3, $4, 'VERIFIED', '{\"cycle\":2}'::jsonb, $5)",
    ].join("\n"),
    [
      IDS.currentVerification,
      IDS.company,
      IDS.user,
      IDS.oldVerification,
      contractNow,
    ],
  );

  await insertPublishedJob(pool, {
    approved: true,
    checksumCharacter: "b",
    id: IDS.job,
    provenance: "LIVE",
    revisionId: IDS.revision,
    scoreId: "00000000-0000-4000-8000-000000003118",
    slug: "senior-engineer-contract",
  });
  await insertPublishedJob(pool, {
    approved: false,
    checksumCharacter: "c",
    id: IDS.unapprovedJob,
    provenance: "LIVE",
    revisionId: IDS.unapprovedRevision,
    scoreId: "00000000-0000-4000-8000-000000003119",
    slug: "unapproved-contract",
  });
  await insertPublishedJob(pool, {
    approved: true,
    checksumCharacter: "d",
    id: IDS.demoJob,
    provenance: "DEMO",
    revisionId: IDS.demoRevision,
    scoreId: "00000000-0000-4000-8000-000000003120",
    slug: "demo-provenance-contract",
  });
  await pool.query(
    [
      'INSERT INTO "AbuseReport" (',
      '  "id", "targetType", "targetId", "reporterUserId", "reasonCode",',
      '  "description", "severity", "status", "dueAt", "updatedAt"',
      ") VALUES (",
      "  $1, 'JOB', $2, $3, 'PUBLIC_VISIBILITY_REVIEW',",
      "  'Integration fixture for an effective visibility restriction.',",
      "  'HIGH', 'IN_REVIEW', $4, $5",
      ")",
    ].join("\n"),
    [IDS.abuseReport, IDS.job, IDS.user, addDays(contractNow, 2), contractNow],
  );
});

afterEach(async () => {
  await restoreBaseline();
});

afterAll(async () => {
  await databaseClient?.$disconnect().catch(() => undefined);
  databaseClient = undefined;
  await database?.dispose();
  database = undefined;
});

describe.sequential("PostgreSQL public job eligibility", () => {
  it("returns the safe projection for a current approved PUBLISHED job", async () => {
    const result = await isJobPubliclyEligible(
      IDS.job,
      contractNow,
      "production",
      client(),
    );

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.job).toMatchObject({
        id: IDS.job,
        companyId: IDS.company,
        companyName: "Contract AG",
        fairScore: 84,
        salaryPeriod: "YEARLY",
        salaryMin: 100000,
        salaryMax: 130000,
      });
      expect(result.job.publishedAt).toEqual(publishedAt);
      expect(result.job.expiresAt).toEqual(validThrough);
    }
  });

  it("requires both PUBLISHED state and approval on the current published revision", async () => {
    await target().query(
      'UPDATE "Job" SET "status" = \'PAUSED\', "updatedAt" = $2 WHERE "id" = $1',
      [IDS.job, contractNow],
    );

    await expect(
      isJobPubliclyEligible(IDS.job, contractNow, "production", client()),
    ).resolves.toEqual({ eligible: false });
    await expect(
      isJobPubliclyEligible(
        IDS.unapprovedJob,
        contractNow,
        "production",
        client(),
      ),
    ).resolves.toEqual({ eligible: false });

    await target().query(
      'ALTER TABLE "JobRevision" DISABLE TRIGGER job_revision_released_immutable_trigger',
    );
    try {
      await target().query(
        'UPDATE "JobRevision" SET "rejectedAt" = $2 WHERE "id" = $1',
        [IDS.revision, contractNow],
      );
      await expect(
        isJobPubliclyEligible(IDS.job, contractNow, "production", client()),
      ).resolves.toEqual({ eligible: false });
    } finally {
      await target().query(
        'UPDATE "JobRevision" SET "rejectedAt" = NULL WHERE "id" = $1',
        [IDS.revision],
      );
      await target().query(
        'ALTER TABLE "JobRevision" ENABLE TRIGGER job_revision_released_immutable_trigger',
      );
    }
  });

  it("rejects the expiry boundary and persisted expiry drift", async () => {
    await expect(
      isJobPubliclyEligible(IDS.job, validThrough, "production", client()),
    ).resolves.toEqual({ eligible: false });

    await target().query(
      'ALTER TABLE "Job" DISABLE TRIGGER job_published_projection_trigger',
    );
    try {
      await target().query(
        'UPDATE "Job" SET "expiresAt" = $2, "updatedAt" = $3 WHERE "id" = $1',
        [
          IDS.job,
          new Date(validThrough.getTime() + 60 * 60 * 1_000),
          contractNow,
        ],
      );
    } finally {
      await target().query(
        'ALTER TABLE "Job" ENABLE TRIGGER job_published_projection_trigger',
      );
    }

    await expect(
      isJobPubliclyEligible(IDS.job, contractNow, "production", client()),
    ).resolves.toEqual({ eligible: false });
  });

  it("requires an ACTIVE company with exactly one current VERIFIED cycle", async () => {
    await target().query(
      'UPDATE "Company" SET "status" = \'SUSPENDED\', "updatedAt" = $2 WHERE "id" = $1',
      [IDS.company, contractNow],
    );
    await expect(
      isJobPubliclyEligible(IDS.job, contractNow, "production", client()),
    ).resolves.toEqual({ eligible: false });

    await target().query(
      'UPDATE "Company" SET "status" = \'ACTIVE\', "updatedAt" = $2 WHERE "id" = $1',
      [IDS.company, contractNow],
    );
    await target().query(
      [
        'UPDATE "CompanyVerificationRequest"',
        'SET "status" = \'REVOKED\', "updatedAt" = $2',
        'WHERE "id" = $1',
      ].join("\n"),
      [IDS.currentVerification, contractNow],
    );

    await expect(
      isJobPubliclyEligible(IDS.job, contractNow, "production", client()),
    ).resolves.toEqual({ eligible: false });
  });

  it.each([
    ["HIDE_JOB", IDS.job],
    ["PAUSE_COMPANY", IDS.company],
  ] as const)(
    "honors an effective %s restriction",
    async (restrictionType, targetId) => {
      await target().query(
        [
          'INSERT INTO "ModerationRestriction" (',
          '  "id", "abuseReportId", "targetType", "targetId", "status",',
          '  "reason", "appliedByUserId", "startsAt", "correlationId"',
          ") VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, $8)",
        ].join("\n"),
        [
          IDS.restriction,
          IDS.abuseReport,
          restrictionType,
          targetId,
          "Public visibility is paused while the report is reviewed.",
          IDS.user,
          addDays(contractNow, -1),
          `eligibility-${restrictionType.toLowerCase()}`,
        ],
      );

      await expect(
        isJobPubliclyEligible(IDS.job, contractNow, "production", client()),
      ).resolves.toEqual({ eligible: false });
    },
  );

  it("excludes non-LIVE job provenance only in production", async () => {
    await expect(
      isJobPubliclyEligible(IDS.demoJob, contractNow, "production", client()),
    ).resolves.toEqual({ eligible: false });
    await expect(
      isJobPubliclyEligible(
        IDS.demoJob,
        contractNow,
        "non-production",
        client(),
      ),
    ).resolves.toMatchObject({ eligible: true });
  });

  it("excludes non-LIVE company provenance only in production", async () => {
    await target().query(
      'UPDATE "Company" SET "dataProvenance" = \'DEMO\', "updatedAt" = $2 WHERE "id" = $1',
      [IDS.company, contractNow],
    );

    await expect(
      isJobPubliclyEligible(IDS.job, contractNow, "production", client()),
    ).resolves.toEqual({ eligible: false });
    await expect(
      isJobPubliclyEligible(IDS.job, contractNow, "non-production", client()),
    ).resolves.toMatchObject({ eligible: true });
  });
});
