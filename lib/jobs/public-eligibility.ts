import "server-only";

import type {
  DataProvenance,
  JobType,
  RemoteType,
  SalaryPeriod,
} from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import { evaluateCompanyTrustForCompanies } from "@/lib/companies/verification/read-model";
import type { CompanyTrustPublicDescriptor } from "@/lib/companies/verification/policy-v2";
import { isJobFreshnessEligibleV1 } from "@/lib/jobs/freshness-policy";
import type { PublicJobProjection } from "@/lib/search/types";

export type PublicEligibilityEnvironment = "production" | "non-production";

export type PublicEligibilitySnapshot = Readonly<{
  id: string;
  slug: string;
  companyId: string;
  status: string;
  dataProvenance: DataProvenance;
  currentRevisionId: string | null;
  publishedRevisionId: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  company: Readonly<{
    name: string;
    status: string;
    dataProvenance: DataProvenance;
    hasCurrentVerifiedCycle: boolean;
    /**
     * Runtime readers always populate the Phase-26 trust decision. Optionality
     * only preserves the pure historical fixture contract while old tests are
     * migrated; it is never omitted by a database-backed public read.
     */
    hasCurrentTrustEligibility?: boolean;
  }>;
  revision: Readonly<{
    id: string;
    title: string;
    description: string;
    approvedAt: Date | null;
    rejectedAt: Date | null;
    validThrough: Date | null;
    categoryId: string;
    categoryIsActive: boolean;
    cantonId: string | null;
    cityId: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryPeriod: SalaryPeriod | null;
    responseTargetDays: number;
    remoteType: RemoteType;
    jobType: JobType;
    workloadMin: number;
    workloadMax: number;
    fairScore: number | null;
  }> | null;
  hasEffectivePublicHideRestriction: boolean;
  freshness?: Readonly<{
    state: "ACTIVE" | "REVIEW_PENDING" | "HOLD" | "STALE" | "FILLED" | "CLOSED";
    dueAt: Date;
    enforceAt: Date;
    reviewDueAt: Date | null;
  }> | null;
}>;

export type PublicEligibilityResult =
  | Readonly<{ eligible: true; job: PublicJobProjection }>
  | Readonly<{ eligible: false }>;

export type PubliclyEligibleJobWithTrust = Readonly<{
  job: PublicJobProjection;
  trustBadge: CompanyTrustPublicDescriptor | null;
}>;

const MAX_PUBLIC_ELIGIBILITY_BATCH_SIZE = 500;
const MAX_PUBLIC_ELIGIBILITY_SNAPSHOT_SIZE = 20_000;
const publicEligibilityJobSelect = {
  id: true,
  slug: true,
  companyId: true,
  status: true,
  dataProvenance: true,
  currentRevisionId: true,
  publishedRevisionId: true,
  publishedAt: true,
  expiresAt: true,
  company: {
    select: {
      name: true,
      status: true,
      dataProvenance: true,
      verificationRequests: {
        where: { status: "VERIFIED", supersededBy: null },
        select: { id: true },
        take: 2,
      },
    },
  },
  publishedRevision: {
    select: {
      id: true,
      title: true,
      description: true,
      approvedAt: true,
      rejectedAt: true,
      validThrough: true,
      categoryId: true,
      category: { select: { isActive: true } },
      cantonId: true,
      cityId: true,
      salaryMin: true,
      salaryMax: true,
      salaryPeriod: true,
      responseTargetDays: true,
      remoteType: true,
      jobType: true,
      workloadMin: true,
      workloadMax: true,
      scoreSnapshots: {
        where: { scoreVersion: "v2" },
        select: { scorePoints: true },
        take: 2,
      },
    },
  },
} as const satisfies Prisma.JobSelect;

type PublicEligibilityJobRow = Prisma.JobGetPayload<{
  select: typeof publicEligibilityJobSelect;
}>;

export function evaluatePublicJobEligibility(
  snapshot: PublicEligibilitySnapshot | null,
  now: Date,
  environment: PublicEligibilityEnvironment,
): PublicEligibilityResult {
  if (snapshot === null || snapshot.revision === null) {
    return Object.freeze({ eligible: false });
  }
  const revision = snapshot.revision;
  if (
    snapshot.status !== "PUBLISHED" ||
    snapshot.currentRevisionId !== snapshot.publishedRevisionId ||
    snapshot.publishedRevisionId !== revision.id ||
    revision.approvedAt === null ||
    revision.rejectedAt !== null ||
    snapshot.publishedAt === null ||
    snapshot.expiresAt === null ||
    revision.validThrough === null ||
    snapshot.publishedAt.getTime() > now.getTime() ||
    now.getTime() >= snapshot.expiresAt.getTime() ||
    snapshot.expiresAt.getTime() !== revision.validThrough.getTime() ||
    !revision.categoryIsActive ||
    snapshot.company.status !== "ACTIVE" ||
    !(
      snapshot.company.hasCurrentTrustEligibility ??
      snapshot.company.hasCurrentVerifiedCycle
    ) ||
    snapshot.hasEffectivePublicHideRestriction ||
    !isJobFreshnessEligibleV1(snapshot.freshness, now) ||
    (environment === "production" &&
      (snapshot.dataProvenance !== "LIVE" ||
        snapshot.company.dataProvenance !== "LIVE"))
  ) {
    return Object.freeze({ eligible: false });
  }

  return Object.freeze({
    eligible: true,
    job: Object.freeze({
      id: snapshot.id,
      slug: snapshot.slug,
      companyId: snapshot.companyId,
      companyName: snapshot.company.name,
      title: revision.title,
      description: revision.description,
      publishedAt: new Date(snapshot.publishedAt),
      expiresAt: new Date(snapshot.expiresAt),
      fairScore: revision.fairScore,
      responseTargetDays: revision.responseTargetDays,
      salaryMin: revision.salaryMin,
      salaryMax: revision.salaryMax,
      salaryPeriod: revision.salaryPeriod,
      categoryId: revision.categoryId,
      cantonId: revision.cantonId,
      cityId: revision.cityId,
      remoteType: revision.remoteType,
      jobType: revision.jobType,
      workloadMin: revision.workloadMin,
      workloadMax: revision.workloadMax,
    }),
  });
}

export async function isJobPubliclyEligible(
  jobId: string,
  now: Date,
  environment: PublicEligibilityEnvironment,
  database: DatabaseClient = getDatabase(),
): Promise<PublicEligibilityResult> {
  const snapshot = await database.$transaction(
    async (transaction) =>
      loadPublicEligibilitySnapshot(jobId, now, transaction),
    { isolationLevel: "RepeatableRead" },
  );
  return evaluatePublicJobEligibility(snapshot, now, environment);
}

/**
 * Transaction-aware variant for state-changing paths such as Apply. The
 * caller owns transaction isolation and every subsequent write therefore sees
 * the same eligibility decision instead of opening a second transaction.
 */
export async function isJobPubliclyEligibleInTransaction(
  jobId: string,
  now: Date,
  environment: PublicEligibilityEnvironment,
  transaction: Prisma.TransactionClient,
): Promise<PublicEligibilityResult> {
  const snapshot = await loadPublicEligibilitySnapshot(jobId, now, transaction);
  return evaluatePublicJobEligibility(snapshot, now, environment);
}

/**
 * Bounded database-level adapter for analytical readers that already loaded
 * Job IDs. Chunks share one RepeatableRead snapshot, preserving one canonical
 * eligibility instant without opening one transaction per Job.
 */
export async function filterPubliclyEligibleJobs(
  jobIds: readonly string[],
  now: Date,
  environment: PublicEligibilityEnvironment,
  database: DatabaseClient = getDatabase(),
): Promise<readonly PublicJobProjection[]> {
  const uniqueJobIds = [...new Set(jobIds)];
  if (uniqueJobIds.length > MAX_PUBLIC_ELIGIBILITY_SNAPSHOT_SIZE) {
    throw new RangeError(
      "A public-eligibility snapshot exceeded its analytical safety bound.",
    );
  }
  return database.$transaction(
    async (transaction) => {
      const eligible: PublicJobProjection[] = [];
      for (
        let offset = 0;
        offset < uniqueJobIds.length;
        offset += MAX_PUBLIC_ELIGIBILITY_BATCH_SIZE
      ) {
        eligible.push(
          ...(await filterPubliclyEligibleJobsInTransaction(
            uniqueJobIds.slice(
              offset,
              offset + MAX_PUBLIC_ELIGIBILITY_BATCH_SIZE,
            ),
            now,
            environment,
            transaction,
          )),
        );
      }
      return Object.freeze(eligible);
    },
    { isolationLevel: "RepeatableRead", timeout: 30_000 },
  );
}

/**
 * Batch variant for paginated readers. Snapshot loading is shared with the
 * single-job path and every row still passes through the canonical evaluator,
 * so batching cannot introduce a second public-eligibility policy.
 */
export async function filterPubliclyEligibleJobsInTransaction(
  jobIds: readonly string[],
  now: Date,
  environment: PublicEligibilityEnvironment,
  transaction: Prisma.TransactionClient,
): Promise<readonly PublicJobProjection[]> {
  const entries = await filterPubliclyEligibleJobsWithTrustInTransaction(
    jobIds,
    now,
    environment,
    transaction,
  );
  return Object.freeze(entries.map(({ job }) => job));
}

/**
 * The recommendation projection needs the same canonical eligibility
 * decision and the already evaluated public trust badge. Returning both from
 * one snapshot avoids repeating the two trust reads solely for card display.
 */
export async function filterPubliclyEligibleJobsWithTrustInTransaction(
  jobIds: readonly string[],
  now: Date,
  environment: PublicEligibilityEnvironment,
  transaction: Prisma.TransactionClient,
): Promise<readonly PubliclyEligibleJobWithTrust[]> {
  const uniqueJobIds = [...new Set(jobIds)];
  if (uniqueJobIds.length > MAX_PUBLIC_ELIGIBILITY_BATCH_SIZE) {
    throw new RangeError(
      "A public-eligibility batch exceeded its safety bound.",
    );
  }
  const batch = await loadPublicEligibilitySnapshots(
    uniqueJobIds,
    now,
    transaction,
  );
  const eligible: PubliclyEligibleJobWithTrust[] = [];
  for (const jobId of uniqueJobIds) {
    const result = evaluatePublicJobEligibility(
      batch.snapshots.get(jobId) ?? null,
      now,
      environment,
    );
    if (result.eligible) {
      const companyId = batch.snapshots.get(jobId)?.companyId;
      eligible.push(
        Object.freeze({
          job: result.job,
          trustBadge:
            companyId === undefined
              ? null
              : (batch.trustByCompanyId.get(companyId)?.badge ?? null),
        }),
      );
    }
  }
  return Object.freeze(eligible);
}

async function loadPublicEligibilitySnapshot(
  jobId: string,
  now: Date,
  database: Prisma.TransactionClient,
): Promise<PublicEligibilitySnapshot | null> {
  const batch = await loadPublicEligibilitySnapshots([jobId], now, database);
  return batch.snapshots.get(jobId) ?? null;
}

async function loadPublicEligibilitySnapshots(
  jobIds: readonly string[],
  now: Date,
  database: Prisma.TransactionClient,
): Promise<
  Readonly<{
    snapshots: ReadonlyMap<string, PublicEligibilitySnapshot>;
    trustByCompanyId: Awaited<
      ReturnType<typeof evaluateCompanyTrustForCompanies>
    >;
  }>
> {
  if (jobIds.length === 0) {
    return Object.freeze({
      snapshots: new Map(),
      trustByCompanyId: new Map(),
    });
  }
  const jobs = await database.job.findMany({
    where: { id: { in: [...jobIds] } },
    select: publicEligibilityJobSelect,
  });
  if (jobs.length === 0) {
    return Object.freeze({
      snapshots: new Map(),
      trustByCompanyId: new Map(),
    });
  }

  // Interactive transactions use one PostgreSQL connection. These bounded
  // reads must remain sequential; concurrent client.query calls are not a
  // supported source of latency improvement and become an error in pg 9.
  const restrictions = await database.moderationRestriction.findMany({
    where: {
      status: "ACTIVE",
      startsAt: { lte: now },
      liftedAt: null,
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      AND: [
        {
          OR: [
            {
              targetType: "HIDE_JOB",
              targetId: { in: jobs.map(({ id }) => id) },
            },
            {
              targetType: "PAUSE_COMPANY",
              targetId: { in: jobs.map(({ companyId }) => companyId) },
            },
          ],
        },
      ],
    },
    select: { targetType: true, targetId: true },
  });
  const trustByCompanyId = await evaluateCompanyTrustForCompanies(
    database,
    jobs.map(({ companyId }) => companyId),
    { now },
  );
  const freshnessRows = await database.jobFreshnessProjection.findMany({
    where: { jobId: { in: jobs.map(({ id }) => id) } },
    select: {
      jobId: true,
      state: true,
      dueAt: true,
      enforceAt: true,
      reviewDueAt: true,
    },
  });
  const hiddenJobIds = new Set(
    restrictions
      .filter(({ targetType }) => targetType === "HIDE_JOB")
      .map(({ targetId }) => targetId),
  );
  const pausedCompanyIds = new Set(
    restrictions
      .filter(({ targetType }) => targetType === "PAUSE_COMPANY")
      .map(({ targetId }) => targetId),
  );
  const freshnessByJobId = new Map(
    freshnessRows.map((row) => [row.jobId, row]),
  );
  return Object.freeze({
    snapshots: new Map(
      jobs.map((job) => [
        job.id,
        toPublicEligibilitySnapshot(
          job,
          hiddenJobIds.has(job.id) || pausedCompanyIds.has(job.companyId),
          trustByCompanyId.get(job.companyId)?.publicEligible === true,
          freshnessByJobId.get(job.id) ?? null,
        ),
      ]),
    ),
    trustByCompanyId,
  });
}

function toPublicEligibilitySnapshot(
  job: PublicEligibilityJobRow,
  hasEffectivePublicHideRestriction: boolean,
  hasCurrentTrustEligibility: boolean,
  freshness: Readonly<{
    state: "ACTIVE" | "REVIEW_PENDING" | "HOLD" | "STALE" | "FILLED" | "CLOSED";
    dueAt: Date;
    enforceAt: Date;
    reviewDueAt: Date | null;
  }> | null,
): PublicEligibilitySnapshot {
  const revision = job.publishedRevision;
  return {
    id: job.id,
    slug: job.slug,
    companyId: job.companyId,
    status: job.status,
    dataProvenance: job.dataProvenance,
    currentRevisionId: job.currentRevisionId,
    publishedRevisionId: job.publishedRevisionId,
    publishedAt: job.publishedAt,
    expiresAt: job.expiresAt,
    company: {
      name: job.company.name,
      status: job.company.status,
      dataProvenance: job.company.dataProvenance,
      hasCurrentVerifiedCycle: job.company.verificationRequests.length === 1,
      hasCurrentTrustEligibility,
    },
    revision:
      revision === null
        ? null
        : {
            id: revision.id,
            title: revision.title,
            description: revision.description,
            approvedAt: revision.approvedAt,
            rejectedAt: revision.rejectedAt,
            validThrough: revision.validThrough,
            categoryId: revision.categoryId,
            categoryIsActive: revision.category.isActive,
            cantonId: revision.cantonId,
            cityId: revision.cityId,
            salaryMin: revision.salaryMin,
            salaryMax: revision.salaryMax,
            salaryPeriod: revision.salaryPeriod,
            responseTargetDays: revision.responseTargetDays,
            remoteType: revision.remoteType,
            jobType: revision.jobType,
            workloadMin: revision.workloadMin,
            workloadMax: revision.workloadMax,
            fairScore:
              revision.scoreSnapshots.length === 1
                ? (revision.scoreSnapshots[0]?.scorePoints ?? null)
                : null,
          },
    hasEffectivePublicHideRestriction,
    freshness,
  };
}
