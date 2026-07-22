import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  jobExpiryEventIdempotencyKey,
  syncJobStatusProjection,
} from "@/lib/jobs/effective-status";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-08-01T12:00:00.000Z");
const HOUR = 3_600_000;
const IDS = {
  user: "15000000-0000-4000-8000-000000000101",
  company: "15000000-0000-4000-8000-000000000102",
  category: "15000000-0000-4000-8000-000000000103",
  boundaryJob: "15000000-0000-4000-8000-000000000110",
  boundaryRevision: "15000000-0000-4000-8000-000000000111",
  pastJob: "15000000-0000-4000-8000-000000000120",
  pastRevision: "15000000-0000-4000-8000-000000000121",
  futureJob: "15000000-0000-4000-8000-000000000130",
  futureRevision: "15000000-0000-4000-8000-000000000131",
  expiryDriftJob: "15000000-0000-4000-8000-000000000140",
  expiryDriftRevision: "15000000-0000-4000-8000-000000000141",
  pointerDriftJob: "15000000-0000-4000-8000-000000000150",
  pointerPublishedRevision: "15000000-0000-4000-8000-000000000151",
  pointerCurrentRevision: "15000000-0000-4000-8000-000000000152",
} as const;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function db(): DatabaseClient {
  if (database === undefined) throw new Error("Job expiry test database unavailable.");
  return database;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase15_job_expiry");
  database = createDatabaseClient(migrated.connectionString);
  await insertFixtures();
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-15 PostgreSQL Job expiry projection", () => {
  it("projects coherent due snapshots once with canonical event and required audit", async () => {
    const [left, right] = await Promise.all([
      syncJobStatusProjection({
        database: db(),
        correlationId: "15000000-0000-4000-8000-000000000201",
        now: NOW,
      }),
      syncJobStatusProjection({
        database: db(),
        correlationId: "15000000-0000-4000-8000-000000000202",
        now: NOW,
      }),
    ]);

    expect(left.expired + right.expired).toBe(2);
    expect(left.failed + right.failed).toBe(0);

    const projected = await db().job.findMany({
      where: { id: { in: [IDS.boundaryJob, IDS.pastJob] } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, version: true },
    });
    expect(projected).toEqual([
      { id: IDS.boundaryJob, status: "EXPIRED", version: 2 },
      { id: IDS.pastJob, status: "EXPIRED", version: 2 },
    ]);

    const events = await db().jobStatusEvent.findMany({
      where: { jobId: { in: [IDS.boundaryJob, IDS.pastJob] }, kind: "EXPIRED" },
      orderBy: { jobId: "asc" },
      select: {
        jobId: true,
        jobRevisionId: true,
        fromStatus: true,
        toStatus: true,
        actorUserId: true,
        reasonCode: true,
        idempotencyKey: true,
        createdAt: true,
      },
    });
    expect(events).toEqual([
      {
        jobId: IDS.boundaryJob,
        jobRevisionId: IDS.boundaryRevision,
        fromStatus: "PUBLISHED",
        toStatus: "EXPIRED",
        actorUserId: null,
        reasonCode: "VALID_THROUGH_REACHED",
        idempotencyKey: jobExpiryEventIdempotencyKey(
          IDS.boundaryJob,
          IDS.boundaryRevision,
        ),
        createdAt: NOW,
      },
      {
        jobId: IDS.pastJob,
        jobRevisionId: IDS.pastRevision,
        fromStatus: "PUBLISHED",
        toStatus: "EXPIRED",
        actorUserId: null,
        reasonCode: "VALID_THROUGH_REACHED",
        idempotencyKey: jobExpiryEventIdempotencyKey(
          IDS.pastJob,
          IDS.pastRevision,
        ),
        createdAt: NOW,
      },
    ]);

    const audits = await db().auditLog.findMany({
      where: {
        action: "JOB_EXPIRED",
        targetId: { in: [IDS.boundaryJob, IDS.pastJob] },
      },
      orderBy: { targetId: "asc" },
      select: {
        targetId: true,
        targetType: true,
        companyId: true,
        actorKind: true,
        actorUserId: true,
        capability: true,
        reasonCode: true,
        result: true,
      },
    });
    expect(audits).toEqual([
      {
        targetId: IDS.boundaryJob,
        targetType: "JOB",
        companyId: IDS.company,
        actorKind: "SYSTEM",
        actorUserId: null,
        capability: "SYSTEM_JOB_EXPIRY_PROJECT",
        reasonCode: "VALID_THROUGH_REACHED",
        result: "SUCCEEDED",
      },
      {
        targetId: IDS.pastJob,
        targetType: "JOB",
        companyId: IDS.company,
        actorKind: "SYSTEM",
        actorUserId: null,
        capability: "SYSTEM_JOB_EXPIRY_PROJECT",
        reasonCode: "VALID_THROUGH_REACHED",
        result: "SUCCEEDED",
      },
    ]);

    const replay = await syncJobStatusProjection({
      database: db(),
      correlationId: "15000000-0000-4000-8000-000000000203",
      now: NOW,
    });
    expect(replay.expired).toBe(0);
    await expect(
      db().jobStatusEvent.count({
        where: { jobId: { in: [IDS.boundaryJob, IDS.pastJob] }, kind: "EXPIRED" },
      }),
    ).resolves.toBe(2);
    await expect(
      db().auditLog.count({
        where: {
          action: "JOB_EXPIRED",
          targetId: { in: [IDS.boundaryJob, IDS.pastJob] },
        },
      }),
    ).resolves.toBe(2);
  });

  it("leaves future and inconsistent due snapshots untouched", async () => {
    const rows = await db().job.findMany({
      where: {
        id: {
          in: [
            IDS.futureJob,
            IDS.expiryDriftJob,
            IDS.pointerDriftJob,
          ],
        },
      },
      orderBy: { id: "asc" },
      select: { id: true, status: true, version: true },
    });
    expect(rows).toEqual([
      { id: IDS.futureJob, status: "PUBLISHED", version: 1 },
      { id: IDS.expiryDriftJob, status: "PUBLISHED", version: 1 },
      { id: IDS.pointerDriftJob, status: "PUBLISHED", version: 1 },
    ]);

    const result = await syncJobStatusProjection({
      database: db(),
      correlationId: "15000000-0000-4000-8000-000000000204",
      now: NOW,
    });
    expect(result).toMatchObject({
      expired: 0,
      skippedInconsistent: 2,
      failed: 0,
    });
    await expect(
      db().jobStatusEvent.count({
        where: {
          jobId: {
            in: [
              IDS.futureJob,
              IDS.expiryDriftJob,
              IDS.pointerDriftJob,
            ],
          },
          kind: "EXPIRED",
        },
      }),
    ).resolves.toBe(0);
  });
});

async function insertFixtures() {
  await db().user.create({
    data: {
      id: IDS.user,
      email: "phase15-expiry@example.test",
      emailNormalized: "phase15-expiry@example.test",
      role: "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "TEST",
    },
  });
  await db().company.create({
    data: {
      id: IDS.company,
      name: "Phase 15 Expiry Test AG",
      slug: "phase-15-expiry-test-ag",
      values: [],
      benefits: [],
      status: "DRAFT",
      dataProvenance: "TEST",
    },
  });
  await db().category.create({
    data: {
      id: IDS.category,
      name: "Phase 15 Expiry",
      slug: "phase-15-expiry",
      isActive: true,
    },
  });

  await createPublishedJob({
    jobId: IDS.boundaryJob,
    revisionId: IDS.boundaryRevision,
    slug: "boundary-expiry",
    expiresAt: NOW,
    validThrough: NOW,
  });
  await createPublishedJob({
    jobId: IDS.pastJob,
    revisionId: IDS.pastRevision,
    slug: "past-expiry",
    expiresAt: new Date(NOW.getTime() - HOUR),
    validThrough: new Date(NOW.getTime() - HOUR),
  });
  await createPublishedJob({
    jobId: IDS.futureJob,
    revisionId: IDS.futureRevision,
    slug: "future-expiry",
    expiresAt: new Date(NOW.getTime() + 1),
    validThrough: new Date(NOW.getTime() + 1),
  });
  await createPublishedJob({
    jobId: IDS.expiryDriftJob,
    revisionId: IDS.expiryDriftRevision,
    slug: "expiry-projection-drift",
    expiresAt: new Date(NOW.getTime() - 2 * HOUR),
    validThrough: new Date(NOW.getTime() - 2 * HOUR),
  });
  await createPublishedJob({
    jobId: IDS.pointerDriftJob,
    revisionId: IDS.pointerPublishedRevision,
    currentRevisionId: IDS.pointerCurrentRevision,
    slug: "pointer-projection-drift",
    expiresAt: new Date(NOW.getTime() - HOUR),
    validThrough: new Date(NOW.getTime() - HOUR),
  });
  if (migrated === undefined) throw new Error("Job expiry test pool unavailable.");
  await migrated.pool.query('ALTER TABLE "Job" DISABLE TRIGGER job_published_projection_trigger');
  try {
    await migrated.pool.query('UPDATE "Job" SET "expiresAt" = $2 WHERE "id" = $1', [
      IDS.expiryDriftJob,
      new Date(NOW.getTime() - HOUR),
    ]);
  } finally {
    await migrated.pool.query('ALTER TABLE "Job" ENABLE TRIGGER job_published_projection_trigger');
  }
}

async function createPublishedJob(input: Readonly<{
  jobId: string;
  revisionId: string;
  currentRevisionId?: string;
  slug: string;
  expiresAt: Date;
  validThrough: Date;
}>) {
  await db().job.create({
    data: {
      id: input.jobId,
      companyId: IDS.company,
      slug: input.slug,
      status: "DRAFT",
      origin: "MANUAL",
      sourceReference: "phase15-expiry-test",
      dataProvenance: "TEST",
      createdByUserId: IDS.user,
    },
  });
  await createRevision(input.jobId, input.revisionId, 1, input.validThrough);
  if (input.currentRevisionId !== undefined) {
    await createRevision(
      input.jobId,
      input.currentRevisionId,
      2,
      new Date(NOW.getTime() + HOUR),
    );
  }
  await db().job.update({
    where: { id: input.jobId },
    data: {
      status: "PUBLISHED",
      currentRevisionId: input.currentRevisionId ?? input.revisionId,
      publishedRevisionId: input.revisionId,
      publishedAt: new Date(NOW.getTime() - 24 * HOUR),
      expiresAt: input.expiresAt,
      publishedCategoryId: IDS.category,
    },
  });
}

async function createRevision(
  jobId: string,
  revisionId: string,
  revisionNumber: number,
  validThrough: Date,
) {
  await db().jobRevision.create({
    data: {
      id: revisionId,
      jobId,
      revisionNumber,
      title: `Expiry test ${revisionNumber}`,
      description: "Deterministic Phase-15 expiry projection fixture.",
      tasks: ["Test expiry"],
      requirements: ["Deterministic fixture"],
      applicationProcessSteps: ["Apply"],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "REMOTE",
      remoteCountryCode: "CH",
      categoryId: IDS.category,
      workloadMin: 80,
      workloadMax: 100,
      validThrough,
      responseTargetDays: 5,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@example.test",
      authoredByUserId: IDS.user,
      contentChecksum: `${jobId}:${revisionNumber}`.padEnd(64, "0").slice(0, 64),
      submittedAt: new Date(NOW.getTime() - 26 * HOUR),
      approvedAt: new Date(NOW.getTime() - 25 * HOUR),
      createdAt: new Date(NOW.getTime() - 48 * HOUR),
    },
  });
}
