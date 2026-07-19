import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaPublishQuotaPort } from "@/lib/billing/prisma-publish-quota";
import { publishWithQuota } from "@/lib/billing/usage";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

const uuid = (sequence: number) =>
  `61000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
const IDS = Object.freeze({
  user: uuid(1),
  company: uuid(2),
  category: uuid(3),
  canton: uuid(4),
  city: uuid(5),
  jobA: uuid(6),
  jobB: uuid(7),
  revisionA: uuid(8),
  revisionB: uuid(9),
  plan: uuid(10),
  planVersion: uuid(11),
  companyLocation: uuid(12),
});

const NOW = new Date();
const VALID_THROUGH = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000);
const RETAIN_UNTIL = new Date(NOW.getTime() + 7 * 365 * 24 * 60 * 60 * 1_000);

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase03_publish_quota");
  database = createDatabaseClient(migrated.connectionString);
  await seed(database);
});

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("PostgreSQL publication quota transaction", () => {
  it("allows exactly one of two parallel publications when the active limit is one", async () => {
    const client = getDatabase();
    const committedJobIds: string[] = [];
    const port = createPrismaPublishQuotaPort(
      client,
      async (transaction, input) => {
        // Keep the winning transaction open long enough for the competing
        // request to reach the advisory lock. Without that lock both requests
        // finish their zero-count read and this test deterministically fails.
        await new Promise((resolve) => setTimeout(resolve, 150));
        const revision = await getRevisionForPublication(
          transaction,
          input.jobId,
          input.revisionId,
        );

        const updated = await transaction.job.updateMany({
          where: {
            id: input.jobId,
            companyId: input.companyId,
            currentRevisionId: input.revisionId,
            status: "APPROVED",
          },
          data: {
            status: "PUBLISHED",
            publishedRevisionId: revision.id,
            publishedAt: input.now,
            expiresAt: revision.validThrough,
            publishedCategoryId: revision.categoryId,
            publishedCantonId: revision.cantonId,
            publishedCityId: revision.cityId,
            publishedSalaryPeriod: revision.salaryPeriod,
            publishedSalaryMin: revision.salaryMin,
            publishedSalaryMax: revision.salaryMax,
          },
        });
        if (updated.count !== 1) {
          throw new Error("Publication target changed before the locked commit.");
        }

        await transaction.jobStatusEvent.create({
          data: {
            jobId: input.jobId,
            jobRevisionId: input.revisionId,
            kind: "PUBLISHED",
            fromStatus: "APPROVED",
            toStatus: "PUBLISHED",
            actorUserId: IDS.user,
            idempotencyKey: `quota-publication:${input.jobId}`,
            correlationId: input.jobId,
          },
        });
        await writeRequiredAudit(createPrismaAuditPort(transaction), {
          action: "JOB_PUBLISHED",
          actorKind: "USER",
          actorUserId: IDS.user,
          capability: "JOB:PUBLISH",
          companyId: input.companyId,
          correlationId: input.jobId,
          result: "SUCCEEDED",
          retainUntil: RETAIN_UNTIL,
          targetId: input.jobId,
          targetType: "JOB",
        });

        committedJobIds.push(input.jobId);
        return Object.freeze({ jobId: input.jobId, status: "PUBLISHED" as const });
      },
    );

    const publish = (jobId: string, revisionId: string) =>
      publishWithQuota(
        {
          companyId: IDS.company,
          jobId,
          revisionId,
          revisionValidThrough: VALID_THROUGH,
          now: NOW,
        },
        port,
      );

    const results = await Promise.all([
      publish(IDS.jobA, IDS.revisionA),
      publish(IDS.jobB, IDS.revisionB),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "ACTIVE_JOB_LIMIT_REACHED" },
    ]);
    expect(committedJobIds).toHaveLength(1);

    const [publishedJobs, statusEvents, auditLogs] = await Promise.all([
      client.job.findMany({
        where: { companyId: IDS.company, status: "PUBLISHED" },
        select: { id: true, publishedAt: true, expiresAt: true },
      }),
      client.jobStatusEvent.findMany({
        where: { jobId: { in: [IDS.jobA, IDS.jobB] }, kind: "PUBLISHED" },
        select: { jobId: true, jobRevisionId: true },
      }),
      client.auditLog.findMany({
        where: {
          companyId: IDS.company,
          action: "JOB_PUBLISHED",
          targetId: { in: [IDS.jobA, IDS.jobB] },
        },
        select: { targetId: true },
      }),
    ]);

    expect(publishedJobs).toEqual([
      {
        id: committedJobIds[0],
        publishedAt: NOW,
        expiresAt: VALID_THROUGH,
      },
    ]);
    expect(statusEvents).toEqual([
      expect.objectContaining({ jobId: committedJobIds[0] }),
    ]);
    expect(auditLogs).toEqual([{ targetId: committedJobIds[0] }]);
  });
});

async function seed(client: DatabaseClient) {
  await client.user.create({
    data: {
      id: IDS.user,
      email: "quota-owner@example.ch",
      emailNormalized: "quota-owner@example.ch",
      role: "EMPLOYER",
    },
  });
  await client.company.create({
    data: {
      id: IDS.company,
      name: "Quota Company",
      slug: "quota-company",
      industry: "Technology",
      size: "10-49",
      about: "A complete company profile used for the quota integration test.",
      website: "https://quota.example.ch",
      values: [],
      benefits: [],
    },
  });
  await client.category.create({
    data: { id: IDS.category, name: "Engineering", slug: "engineering" },
  });
  await client.canton.create({
    data: {
      id: IDS.canton,
      code: "ZH",
      name: "Zuerich",
      slug: "zuerich",
      language: "DE",
    },
  });
  await client.city.create({
    data: {
      id: IDS.city,
      cantonId: IDS.canton,
      name: "Zuerich",
      slug: "zuerich",
    },
  });
  await client.companyLocation.create({
    data: {
      id: IDS.companyLocation,
      companyId: IDS.company,
      cantonId: IDS.canton,
      cityId: IDS.city,
      isPrimary: true,
    },
  });
  await client.company.update({
    where: { id: IDS.company },
    data: { status: "ACTIVE" },
  });
  await client.plan.create({
    data: {
      id: IDS.plan,
      code: "free",
      name: "Free",
      isDefaultFree: true,
    },
  });
  await client.planVersion.create({
    data: {
      id: IDS.planVersion,
      planId: IDS.plan,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: 0,
      monthlyEquivalentRappen: 0,
      validFrom: new Date(NOW.getTime() - 24 * 60 * 60 * 1_000),
    },
  });
  await client.planEntitlement.createMany({
    data: [
      integerEntitlement("ACTIVE_JOB_LIMIT", 1),
      integerEntitlement("SEAT_LIMIT", 1),
      booleanEntitlement("TALENT_RADAR_ACCESS", false),
      integerEntitlement("TALENT_CONTACT_ALLOWANCE", 0),
      integerEntitlement("JOB_BOOST_ALLOWANCE", 0),
      {
        planVersionId: IDS.planVersion,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        analyticsLevelValue: "NONE",
      },
      booleanEntitlement("ENHANCED_COMPANY_PROFILE", false),
      booleanEntitlement("EMPLOYER_IMPORT_ACCESS", false),
    ],
  });
  await client.planVersion.update({
    where: { id: IDS.planVersion },
    data: { status: "ACTIVE" },
  });

  await createApprovedJob(client, IDS.jobA, IDS.revisionA, "quota-job-a", "a");
  await createApprovedJob(client, IDS.jobB, IDS.revisionB, "quota-job-b", "b");
}

function integerEntitlement(
  key:
    | "ACTIVE_JOB_LIMIT"
    | "SEAT_LIMIT"
    | "TALENT_CONTACT_ALLOWANCE"
    | "JOB_BOOST_ALLOWANCE",
  integerValue: number,
) {
  return {
    planVersionId: IDS.planVersion,
    key,
    valueType: "INTEGER" as const,
    integerValue,
  };
}

function booleanEntitlement(
  key:
    | "TALENT_RADAR_ACCESS"
    | "ENHANCED_COMPANY_PROFILE"
    | "EMPLOYER_IMPORT_ACCESS",
  booleanValue: boolean,
) {
  return {
    planVersionId: IDS.planVersion,
    key,
    valueType: "BOOLEAN" as const,
    booleanValue,
  };
}

async function createApprovedJob(
  client: DatabaseClient,
  jobId: string,
  revisionId: string,
  slug: string,
  checksumCharacter: string,
) {
  await client.job.create({
    data: {
      id: jobId,
      companyId: IDS.company,
      slug,
      status: "DRAFT",
      createdByUserId: IDS.user,
    },
  });
  await client.jobRevision.create({
    data: {
      id: revisionId,
      jobId,
      revisionNumber: 1,
      title: `Quota Job ${checksumCharacter.toUpperCase()}`,
      description: "A bounded description for a real quota concurrency test.",
      tasks: ["Build reliable transactional publication workflows."],
      requirements: ["Understand PostgreSQL transaction and lock semantics."],
      applicationProcessSteps: ["Submit the application through the portal."],
      requiredDocumentKinds: ["NONE"],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId: IDS.category,
      cantonId: IDS.canton,
      cityId: IDS.city,
      workloadMin: 80,
      workloadMax: 100,
      startByArrangement: true,
      validThrough: VALID_THROUGH,
      responseTargetDays: 14,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@example.ch",
      authoredByUserId: IDS.user,
      contentChecksum: checksumCharacter.repeat(64),
      approvedAt: NOW,
    },
  });
  await client.job.update({
    where: { id: jobId },
    data: { status: "APPROVED", currentRevisionId: revisionId },
  });
}

async function getRevisionForPublication(
  transaction: Prisma.TransactionClient,
  jobId: string,
  revisionId: string,
) {
  const revision = await transaction.jobRevision.findFirst({
    where: { id: revisionId, jobId },
    select: {
      id: true,
      categoryId: true,
      cantonId: true,
      cityId: true,
      salaryPeriod: true,
      salaryMin: true,
      salaryMax: true,
      validThrough: true,
    },
  });
  if (revision?.validThrough === null || revision === null) {
    throw new Error("The publication revision has no bounded validity.");
  }
  return revision;
}

function createPrismaAuditPort(transaction: Prisma.TransactionClient) {
  return {
    auditLog: {
      async create({ data }: Parameters<
        Parameters<typeof writeRequiredAudit>[0]["auditLog"]["create"]
      >[0]) {
        return transaction.auditLog.create({
          data: {
            ...data,
            metadata:
              data.metadata === null
                ? Prisma.DbNull
                : (data.metadata as Prisma.InputJsonValue),
          },
        });
      },
    },
  };
}

function getDatabase(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The isolated quota database is not initialized.");
  }
  return database;
}
