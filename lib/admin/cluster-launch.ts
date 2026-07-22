import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import { filterPubliclyEligibleJobsInTransaction } from "@/lib/jobs/public-eligibility";
import { calculateRelevanceProxy } from "@/lib/search/relevance";
import {
  calculateClusterLaunchMetricsV1,
  clusterLaunchEvidenceHashV1,
  CLUSTER_LAUNCH_POLICY_V1,
  promotedQueriesForClusterV1,
  type ClusterLaunchEvidenceV1,
} from "@/lib/seo/cluster-launch-policy";
import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminSuccess,
  operationKey,
  requireCapability,
  type AdminDependencies,
} from "@/lib/admin/common";

const DAY_MS = 86_400_000;
const EVALUATION_BATCH_SIZE = 500;

const evaluationSchema = z.strictObject({
  cantonId: z.uuid(),
  categoryId: z.uuid(),
  idempotencyKey: z.uuid(),
});

export async function evaluateClusterLaunch(
  raw: unknown,
  dependencies: AdminDependencies,
) {
  const parsed = evaluationSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CONTENT_MANAGE")) {
    return adminFailure("FORBIDDEN");
  }
  const evaluatedAt = adminNow(dependencies.now);
  const eventKey = operationKey(
    "admin-cluster-evaluate",
    parsed.data.idempotencyKey,
  );

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const replay = await transaction.clusterLaunchEvent.findFirst({
          where: { kind: "EVALUATED", correlationId: eventKey },
          select: {
            clusterLaunchAssessment: {
              select: {
                id: true,
                status: true,
                evidenceHash: true,
                liveJobCount: true,
                activeCandidateCount: true,
                activeEmployerCount: true,
                medianApplicationsTimes2: true,
                responseRateBasisPoints: true,
                contentCoverageBasisPoints: true,
              },
            },
          },
        });
        if (replay !== null) {
          return adminSuccess(
            assessmentResult(replay.clusterLaunchAssessment),
            true,
          );
        }

        const [canton, category] = await Promise.all([
          transaction.canton.findFirst({
            where: { id: parsed.data.cantonId, isActive: true },
            select: { id: true, code: true, name: true },
          }),
          transaction.category.findFirst({
            where: { id: parsed.data.categoryId, isActive: true },
            select: { id: true, name: true },
          }),
        ]);
        if (canton === null || category === null) return adminFailure("NOT_FOUND");

        const evidenceWindowStart = new Date(
          evaluatedAt.getTime() -
            CLUSTER_LAUNCH_POLICY_V1.evidenceWindowDays * DAY_MS,
        );
        const candidateActivityWindowStart = new Date(
          evaluatedAt.getTime() -
            CLUSTER_LAUNCH_POLICY_V1.candidateActivityWindowDays * DAY_MS,
        );
        const eligibleJobs = await loadEligibleClusterJobs(
          transaction,
          canton.id,
          category.id,
          evaluatedAt,
        );
        const eligibleJobIds = eligibleJobs.map(({ id }) => id);
        const applicationCounts = await loadApplicationCounts(
          transaction,
          eligibleJobIds,
          evidenceWindowStart,
          evaluatedAt,
        );
        const responseEvidence = await loadResponseEvidence(
          transaction,
          eligibleJobIds,
          evidenceWindowStart,
          evaluatedAt,
        );
        const activeCandidateCount = await transaction.candidateProfile.count({
          where: {
            cantonId: canton.id,
            onboardingStatus: "COMPLETE",
            user: { is: { status: "ACTIVE", dataProvenance: "LIVE" } },
            preference: {
              is: { categories: { some: { categoryId: category.id } } },
            },
            OR: [
              {
                savedJobs: {
                  some: {
                    createdAt: {
                      gte: candidateActivityWindowStart,
                      lt: evaluatedAt,
                    },
                  },
                },
              },
              {
                applications: {
                  some: {
                    submittedAt: {
                      gte: candidateActivityWindowStart,
                      lt: evaluatedAt,
                    },
                  },
                },
              },
              {
                jobAlerts: {
                  some: {
                    events: {
                      some: {
                        kind: { in: ["CREATED", "RESUMED"] },
                        createdAt: {
                          gte: candidateActivityWindowStart,
                          lt: evaluatedAt,
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        });
        const promotedQueries = promotedQueriesForClusterV1({
          cantonName: canton.name,
          cantonCode: canton.code,
          categoryName: category.name,
        });
        const promotedQueryResultCounts = promotedQueries.map((query) => ({
          query,
          relevantJobCount: eligibleJobs.filter((job) =>
            calculateRelevanceProxy(query, {
              title: job.title,
              companyName: job.companyName,
              body: [
                job.description,
                ...job.tasks,
                ...job.requirements,
                job.offer ?? "",
              ].join(" "),
            }).score > 0
          ).length,
        }));
        const evidence: ClusterLaunchEvidenceV1 = Object.freeze({
          policyVersion: CLUSTER_LAUNCH_POLICY_V1.version,
          cantonId: canton.id,
          categoryId: category.id,
          evaluatedAt: evaluatedAt.toISOString(),
          evidenceWindowStart: evidenceWindowStart.toISOString(),
          evidenceWindowEnd: evaluatedAt.toISOString(),
          candidateActivityWindowStart: candidateActivityWindowStart.toISOString(),
          liveJobCount: eligibleJobs.length,
          activeCandidateCount,
          activeEmployerCount: new Set(eligibleJobs.map(({ companyId }) => companyId)).size,
          applicationCountsByEligibleJob: Object.freeze(
            eligibleJobIds.map((jobId) => applicationCounts.get(jobId) ?? 0),
          ),
          dueApplicationCount: responseEvidence.due,
          onTimeResponseCount: responseEvidence.onTime,
          promotedQueryResultCounts: Object.freeze(promotedQueryResultCounts),
          dataProvenance: "LIVE",
        });
        const metrics = calculateClusterLaunchMetricsV1(evidence);
        const assessment = await transaction.clusterLaunchAssessment.create({
          data: {
            id: randomUUID(),
            cantonId: canton.id,
            categoryId: category.id,
            policyVersion: CLUSTER_LAUNCH_POLICY_V1.version,
            evaluatedAt,
            evidenceWindowStart,
            evidenceWindowEnd: evaluatedAt,
            liveJobCount: metrics.liveJobCount,
            activeCandidateCount: metrics.activeCandidateCount,
            activeEmployerCount: metrics.activeEmployerCount,
            responseRateBasisPoints: metrics.responseRateBasisPoints,
            contentCoverageBasisPoints: metrics.contentCoverageBasisPoints,
            medianApplicationsTimes2: metrics.medianApplicationsTimes2,
            dataProvenance: "LIVE",
            evidenceHash: clusterLaunchEvidenceHashV1(evidence),
            validUntil: new Date(
              evaluatedAt.getTime() +
                CLUSTER_LAUNCH_POLICY_V1.validityDays * DAY_MS,
            ),
            status: metrics.ready ? "READY" : "DRAFT",
            createdAt: evaluatedAt,
          },
          select: {
            id: true,
            status: true,
            evidenceHash: true,
            liveJobCount: true,
            activeCandidateCount: true,
            activeEmployerCount: true,
            medianApplicationsTimes2: true,
            responseRateBasisPoints: true,
            contentCoverageBasisPoints: true,
          },
        });
        await transaction.clusterLaunchEvent.create({
          data: {
            id: randomUUID(),
            clusterLaunchAssessmentId: assessment.id,
            kind: "EVALUATED",
            actorUserId: dependencies.actor.userId,
            reasonCode: metrics.ready
              ? "CLUSTER_THRESHOLDS_PASSED"
              : "CLUSTER_THRESHOLDS_NOT_MET",
            correlationId: eventKey,
            createdAt: evaluatedAt,
          },
        });
        return adminSuccess(assessmentResult(assessment));
      },
      { isolationLevel: "Serializable", timeout: 60_000 },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

type EligibleClusterJob = Readonly<{
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  description: string;
  tasks: readonly string[];
  requirements: readonly string[];
  offer: string | null;
}>;

async function loadEligibleClusterJobs(
  transaction: Prisma.TransactionClient,
  cantonId: string,
  categoryId: string,
  now: Date,
): Promise<readonly EligibleClusterJob[]> {
  const eligibleIds: string[] = [];
  let afterId: string | undefined;
  while (true) {
    const rows = await transaction.job.findMany({
      where: {
        ...(afterId === undefined ? {} : { id: { gt: afterId } }),
        status: "PUBLISHED",
        dataProvenance: "LIVE",
        publishedCantonId: cantonId,
        publishedCategoryId: categoryId,
        publishedAt: { lte: now },
        expiresAt: { gt: now },
      },
      orderBy: { id: "asc" },
      take: EVALUATION_BATCH_SIZE,
      select: { id: true },
    });
    if (rows.length === 0) break;
    const eligible = await filterPubliclyEligibleJobsInTransaction(
      rows.map(({ id }) => id),
      now,
      "production",
      transaction,
    );
    eligibleIds.push(...eligible.map(({ id }) => id));
    if (rows.length < EVALUATION_BATCH_SIZE) break;
    afterId = rows.at(-1)?.id;
    if (afterId === undefined) break;
  }
  const jobs: EligibleClusterJob[] = [];
  for (const ids of chunks(eligibleIds, EVALUATION_BATCH_SIZE)) {
    const rows = await transaction.job.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        companyId: true,
        company: { select: { name: true } },
        publishedRevision: {
          select: {
            title: true,
            description: true,
            tasks: true,
            requirements: true,
            offer: true,
          },
        },
      },
    });
    for (const row of rows) {
      if (row.publishedRevision === null) continue;
      jobs.push(Object.freeze({
        id: row.id,
        companyId: row.companyId,
        companyName: row.company.name,
        ...row.publishedRevision,
      }));
    }
  }
  return Object.freeze(jobs.sort((left, right) => left.id.localeCompare(right.id)));
}

async function loadApplicationCounts(
  transaction: Prisma.TransactionClient,
  jobIds: readonly string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>();
  for (const ids of chunks(jobIds, EVALUATION_BATCH_SIZE)) {
    const applications = await transaction.application.findMany({
      where: {
        jobId: { in: [...ids] },
        submittedAt: { gte: windowStart, lt: windowEnd },
        candidateProfile: {
          is: { user: { is: { status: "ACTIVE", dataProvenance: "LIVE" } } },
        },
      },
      select: { id: true, jobId: true },
    });
    const seen = new Set<string>();
    for (const application of applications) {
      const key = `${application.jobId}:${application.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(application.jobId, (counts.get(application.jobId) ?? 0) + 1);
    }
  }
  return counts;
}

async function loadResponseEvidence(
  transaction: Prisma.TransactionClient,
  jobIds: readonly string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<Readonly<{ due: number; onTime: number }>> {
  let due = 0;
  let onTime = 0;
  for (const ids of chunks(jobIds, EVALUATION_BATCH_SIZE)) {
    const [applications, canonicalResponses] = await Promise.all([
      transaction.application.findMany({
        where: {
          jobId: { in: [...ids] },
          submittedAt: { gte: windowStart, lt: windowEnd },
          candidateProfile: {
            is: { user: { is: { status: "ACTIVE", dataProvenance: "LIVE" } } },
          },
        },
        select: {
          id: true,
          jobId: true,
          submittedAt: true,
          job: { select: { companyId: true } },
          submissionSnapshot: { select: { responseTargetDays: true } },
        },
      }),
      transaction.analyticsEvent.findMany({
        where: {
          jobId: { in: [...ids] },
          kind: "EMPLOYER_RESPONSE_RECORDED",
          producer: "employer-application",
          schemaVersion: "1",
          purpose: "ESSENTIAL_OPERATIONAL",
          actorProvenanceSnapshot: "LIVE",
          companyProvenanceSnapshot: "LIVE",
          jobProvenanceSnapshot: "LIVE",
          occurredAt: { lte: windowEnd },
        },
        select: { dedupeKey: true, companyId: true, jobId: true, occurredAt: true },
      }),
    ]);
    const firstResponseByApplication = new Map<string, Date>();
    for (const response of canonicalResponses) {
      const applicationId = response.dedupeKey.startsWith("EMPLOYER_RESPONSE:")
        ? response.dedupeKey.slice("EMPLOYER_RESPONSE:".length)
        : "";
      if (applicationId.length === 0) continue;
      if (response.companyId === null || response.jobId === null) continue;
      const key = `${response.companyId}:${response.jobId}:${applicationId}`;
      const previous = firstResponseByApplication.get(key);
      if (previous === undefined || response.occurredAt < previous) {
        firstResponseByApplication.set(key, response.occurredAt);
      }
    }
    for (const application of applications) {
      const targetDays = application.submissionSnapshot?.responseTargetDays;
      if (!Number.isSafeInteger(targetDays) || targetDays === undefined || targetDays < 1) {
        continue;
      }
      const dueAt = new Date(application.submittedAt.getTime() + targetDays * DAY_MS);
      if (dueAt > windowEnd) continue;
      due += 1;
      const firstEmployerResponse = firstResponseByApplication.get(
        `${application.job.companyId}:${application.jobId}:${application.id}`,
      );
      if (
        firstEmployerResponse !== undefined &&
        firstEmployerResponse >= application.submittedAt &&
        firstEmployerResponse <= dueAt
      ) {
        onTime += 1;
      }
    }
  }
  return Object.freeze({ due, onTime });
}

function chunks<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function assessmentResult(assessment: Readonly<{
  id: string;
  status: string;
  evidenceHash: string;
  liveJobCount: number;
  activeCandidateCount: number;
  activeEmployerCount: number;
  medianApplicationsTimes2: number;
  responseRateBasisPoints: number;
  contentCoverageBasisPoints: number;
}>) {
  return Object.freeze({ ...assessment });
}
