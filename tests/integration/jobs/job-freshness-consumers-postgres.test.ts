import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_CAPABILITIES_V1 } from "@/lib/admin/capabilities";
import { getBusinessCockpit } from "@/lib/admin/cockpit";
import { getAdminOverview } from "@/lib/admin/overview";
import { listCandidateRecommendationProjections } from "@/lib/candidate/recommendation-read-model";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { getEmployerDashboardData } from "@/lib/employer/dashboard";
import { filterPubliclyEligibleJobs } from "@/lib/jobs/public-eligibility";
import { calculateJobFreshnessScheduleV1 } from "@/lib/jobs/freshness-policy";
import { backfillJobPublicationFingerprints } from "@/lib/jobs/freshness";
import {
  emptyPublicJobSearchInput,
  getPublicJobsBySlugs,
  listPublicJobs,
} from "@/lib/jobs/public-read-model";
import { listEligibleJobSitemapRows } from "@/lib/seo/public-sitemap";
import { orchestrateDemoSeed } from "@/prisma/seed/orchestrator";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase30_freshness_consumers");
  database = createDatabaseClient(migrated.connectionString);
  await orchestrateDemoSeed(db());
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase 30 freshness consumer parity", () => {
  it("removes one stale Job from Search, Recommendations, Sitemap and both analytical dashboards at the same instant", async () => {
    const client = db();
    const now = new Date();
    const initialRecommendations = await listCandidateRecommendationProjections(
      client,
      {
        categorySlugs: Object.freeze([]),
        jobTypes: Object.freeze([]),
        remoteTypes: Object.freeze([]),
      },
      now,
    );
    const sample = initialRecommendations[0]?.job;
    expect(sample).toBeDefined();
    if (sample === undefined) return;

    const sampleJob = await client.job.findUniqueOrThrow({
      where: { id: sample.id },
      select: {
        companyId: true,
        publishedRevision: {
          select: {
            categoryId: true,
            cantonId: true,
            cityId: true,
          },
        },
      },
    });
    if (sampleJob.publishedRevision === null) {
      throw new Error("Phase 30 consumer sample lost its published revision.");
    }
    await client.company.update({
      where: { id: sampleJob.companyId },
      data: { dataProvenance: "LIVE" },
    });

    const membership = await client.companyMembership.findFirstOrThrow({
      where: {
        companyId: sampleJob.companyId,
        role: { in: ["OWNER", "ADMIN"] },
        status: "ACTIVE",
        removedAt: null,
      },
      orderBy: [{ role: "asc" }, { id: "asc" }],
      select: { id: true, role: true, userId: true },
    });
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new Error("Phase 30 consumer fixture requires a managing member.");
    }
    const managingMembership = Object.freeze({
      ...membership,
      role: membership.role,
    });
    const job = await createLiveFixtureJob(client, {
      companyId: sampleJob.companyId,
      createdByUserId: membership.userId,
      categoryId: sampleJob.publishedRevision.categoryId,
      cantonId: sampleJob.publishedRevision.cantonId,
      cityId: sampleJob.publishedRevision.cityId,
      now,
    });
    await expect(
      client.jobPublicationFingerprint.findUnique({ where: { jobId: job.id } }),
    ).resolves.toBeNull();
    const backfill = await backfillJobPublicationFingerprints({
      database: client,
      correlationId: randomUUID(),
      now,
    });
    expect(backfill.fingerprinted).toBeGreaterThanOrEqual(1);
    await expect(
      client.jobPublicationFingerprint.findUniqueOrThrow({
        where: { jobId: job.id },
        select: { active: true, sourceScope: true },
      }),
    ).resolves.toEqual({ active: true, sourceScope: "manual" });
    const admin = await client.user.findFirstOrThrow({
      where: { role: "ADMIN", status: "ACTIVE" },
      orderBy: { id: "asc" },
      select: { id: true, email: true },
    });
    const before = await loadConsumerSnapshot({
      admin,
      client,
      jobId: job.id,
      jobSlug: job.slug,
      membership: managingMembership,
      now,
    });

    await client.jobFreshnessProjection.update({
      where: { jobId: job.id },
      data: {
        state: "STALE",
        enforceAt: new Date(now.getTime() - 1),
      },
    });

    const after = await loadConsumerSnapshot({
      admin,
      client,
      jobId: job.id,
      jobSlug: job.slug,
      membership: managingMembership,
      now,
    });

    expect(before.directEligible).toBe(true);
    expect(after.directEligible).toBe(false);
    expect(before.publicDetailIds).toContain(job.id);
    expect(after.publicDetailIds).not.toContain(job.id);
    expect(before.searchTotal - after.searchTotal).toBe(1);
    expect(before.recommendationIds).toContain(job.id);
    expect(after.recommendationIds).not.toContain(job.id);
    expect(before.sitemapPaths).toContain(`/jobs/${job.slug}`);
    expect(after.sitemapPaths).not.toContain(`/jobs/${job.slug}`);
    expect(before.employerActiveJobs - after.employerActiveJobs).toBe(1);
    expect(before.adminActiveJobs - after.adminActiveJobs).toBe(1);
    expect(
      before.adminOverviewActiveSupply - after.adminOverviewActiveSupply,
    ).toBe(1);
    expect(after.adminSignalJobIds).not.toContain(job.id);
  }, 120_000);
});

async function loadConsumerSnapshot(
  input: Readonly<{
    admin: Readonly<{ id: string; email: string }>;
    client: DatabaseClient;
    jobId: string;
    jobSlug: string;
    membership: Readonly<{
      id: string;
      role: "OWNER" | "ADMIN";
      userId: string;
    }>;
    now: Date;
  }>,
) {
  const adminDependencies = {
    actor: {
      userId: input.admin.id,
      email: input.admin.email,
      role: "ADMIN" as const,
      status: "ACTIVE" as const,
      capabilities: ADMIN_CAPABILITIES_V1,
    },
    correlationId: randomUUID(),
    database: input.client,
    now: input.now,
  };
  const [
    eligible,
    publicDetails,
    search,
    recommendations,
    sitemap,
    employer,
    cockpit,
    overview,
  ] = await Promise.all([
    filterPubliclyEligibleJobs(
      [input.jobId],
      input.now,
      "non-production",
      input.client,
    ),
    getPublicJobsBySlugs([input.jobSlug], {
      database: input.client,
      now: input.now,
    }),
    listPublicJobs(emptyPublicJobSearchInput(), {
      database: input.client,
      now: input.now,
      pageSize: 50,
    }),
    listCandidateRecommendationProjections(
      input.client,
      {
        categorySlugs: Object.freeze([]),
        jobTypes: Object.freeze([]),
        remoteTypes: Object.freeze([]),
      },
      input.now,
    ),
    listEligibleJobSitemapRows(input.now, input.client, 50_000),
    getEmployerDashboardData(
      {
        companyId: (
          await input.client.companyMembership.findUniqueOrThrow({
            where: { id: input.membership.id },
            select: { companyId: true },
          })
        ).companyId,
        membershipId: input.membership.id,
        membershipRole: input.membership.role,
        userId: input.membership.userId,
      },
      input.client,
      input.now,
    ),
    getBusinessCockpit(adminDependencies),
    getAdminOverview(adminDependencies),
  ]);
  if (employer === null || cockpit === null || overview === null) {
    throw new Error("Phase 30 consumer fixture lost authorized dashboards.");
  }
  return Object.freeze({
    directEligible: eligible.some(({ id }) => id === input.jobId),
    publicDetailIds: Object.freeze(publicDetails.map(({ id }) => id)),
    searchTotal: search.totalEligible,
    recommendationIds: Object.freeze(recommendations.map(({ job }) => job.id)),
    sitemapPaths: Object.freeze(sitemap.map(({ path }) => path)),
    employerActiveJobs: employer.activeJobs,
    adminActiveJobs: cockpit.demandOverview.reduce(
      (sum, row) => sum + row.activeJobCount,
      0,
    ),
    adminOverviewActiveSupply: overview.metrics.activeSupply,
    adminSignalJobIds: Object.freeze(
      cockpit.signals.flatMap(({ jobId }) =>
        jobId === undefined ? [] : [jobId],
      ),
    ),
  });
}

function db(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Phase 30 freshness-consumer database unavailable.");
  }
  return database;
}

async function createLiveFixtureJob(
  client: DatabaseClient,
  input: Readonly<{
    companyId: string;
    createdByUserId: string;
    categoryId: string;
    cantonId: string | null;
    cityId: string | null;
    now: Date;
  }>,
) {
  const jobId = randomUUID();
  const revisionId = randomUUID();
  const publishedAt = new Date(input.now.getTime() - 60_000);
  const validThrough = new Date(input.now.getTime() + 90 * 86_400_000);
  const schedule = calculateJobFreshnessScheduleV1(publishedAt, validThrough);
  const slug = `phase30-consumer-${jobId}`;
  await client.job.create({
    data: {
      id: jobId,
      companyId: input.companyId,
      slug,
      status: "DRAFT",
      sourceReference: "platform-manual",
      createdByUserId: input.createdByUserId,
      dataProvenance: "LIVE",
    },
  });
  await client.jobRevision.create({
    data: {
      id: revisionId,
      jobId,
      revisionNumber: 1,
      title: "Phase 30 kanonischer Consumer Job",
      description:
        "Ein isolierter LIVE-Testjob für Search, Empfehlung, Sitemap und Analytics.",
      tasks: ["Consumer-Parität prüfen"],
      requirements: ["Nachweisbare Fachkenntnisse"],
      applicationProcessSteps: ["Online-Bewerbung"],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId: input.categoryId,
      cantonId: input.cantonId,
      cityId: input.cityId,
      locationLabel: "Schweiz",
      workloadMin: 80,
      workloadMax: 100,
      startByArrangement: true,
      validThrough,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "phase30@example.test",
      authoredByUserId: input.createdByUserId,
      contentChecksum: createHash("sha256")
        .update(`phase30-consumer:${jobId}`)
        .digest("hex"),
      submittedAt: new Date(publishedAt.getTime() - 60_000),
      approvedAt: publishedAt,
    },
  });
  await client.job.update({
    where: { id: jobId },
    data: {
      status: "PUBLISHED",
      currentRevisionId: revisionId,
      publishedRevisionId: revisionId,
      publishedAt,
      expiresAt: validThrough,
      publishedCategoryId: input.categoryId,
      publishedCantonId: input.cantonId,
      publishedCityId: input.cityId,
    },
  });
  await client.jobFreshnessProjection.create({
    data: {
      jobId,
      policyVersion: "JOB_FRESHNESS_POLICY_V1",
      state: "ACTIVE",
      publishedAt,
      lastConfirmedAt: publishedAt,
      dueAt: schedule.dueAt,
      reminder7At: schedule.reminder7At,
      reminder24At: schedule.reminder24At,
      enforceAt: schedule.dueAt,
    },
  });
  return Object.freeze({ id: jobId, slug });
}
