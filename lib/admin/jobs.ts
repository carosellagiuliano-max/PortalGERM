import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  createPrismaTransactionAnalyticsWriter,
  trackAnalyticsEventV1,
} from "@/lib/analytics/track";
import { createPrismaPublishQuotaPort } from "@/lib/billing/prisma-publish-quota";
import {
  cancelAdminBoost,
  syncBoostStatusProjection,
  type BoostProjectionResult,
} from "@/lib/billing/boosts";
import { publishWithQuota } from "@/lib/billing/usage";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import { decideJobTransition, type JobStatus } from "@/lib/policies/status/job";
import type { EmailProvider } from "@/lib/providers/email";
import { renderEmailTemplate } from "@/lib/providers/email/templates";
import { createLogger } from "@/lib/utils/logger";
import {
  adminErrorResult,
  AdminDomainError,
  adminFailure,
  adminNow,
  adminSuccess,
  operationKey,
  requireCapability,
  writeAdminAudit,
  type AdminCommandResult,
  type AdminDependencies,
} from "@/lib/admin/common";

const DAY = 86_400_000;
const MAX_PUBLICATION_DAYS = 90;
const logger = createLogger();

export const adminJobCommandSchema = z.strictObject({
  jobId: z.uuid(),
  expectedJobVersion: z.coerce.number().int().positive(),
  expectedRevisionVersion: z.coerce.number().int().positive(),
  idempotencyKey: z.uuid(),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u).optional(),
});

export type AdminJobCommand = z.infer<typeof adminJobCommandSchema>;

export type AdminJobCommandValue = Readonly<{
  jobId: string;
  revisionId: string;
  jobVersion: number;
  revisionVersion: number;
  status: JobStatus;
}>;

export async function listAdminJobs(
  database: DatabaseClient,
  status: "PENDING" | JobStatus | "ALL" = "PENDING",
  now = new Date(),
) {
  const statusWhere = status === "ALL"
    ? { not: "REMOVED" as const }
    : status === "PENDING"
      ? { in: ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] as JobStatus[] }
      : status;
  return database.job.findMany({
    where: { status: statusWhere },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      slug: true,
      status: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      company: { select: { id: true, name: true, status: true } },
      boosts: {
        where: {
          status: { not: "CANCELLED" },
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        orderBy: [{ endsAt: "asc" }, { id: "asc" }],
        take: 1,
        select: { id: true, endsAt: true },
      },
      currentRevision: {
        select: {
          id: true,
          version: true,
          title: true,
          submittedAt: true,
          validThrough: true,
          scoreSnapshots: {
            orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { scorePoints: true, maxPoints: true },
          },
        },
      },
    },
  });
}

export async function getAdminJobDetail(database: DatabaseClient, jobId: string) {
  if (!z.uuid().safeParse(jobId).success) return null;
  return database.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      slug: true,
      status: true,
      version: true,
      publishedAt: true,
      expiresAt: true,
      company: { select: { id: true, name: true, slug: true, status: true } },
      currentRevision: {
        select: {
          id: true,
          version: true,
          revisionNumber: true,
          title: true,
          companyIntro: true,
          description: true,
          tasks: true,
          requirements: true,
          niceToHave: true,
          offer: true,
          workloadMin: true,
          workloadMax: true,
          remoteType: true,
          locationLabel: true,
          salaryPeriod: true,
          salaryMin: true,
          salaryMax: true,
          validThrough: true,
          submittedAt: true,
          approvedAt: true,
          rejectedAt: true,
          category: { select: { name: true } },
          canton: { select: { name: true } },
          city: { select: { name: true } },
          scoreSnapshots: {
            orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              scorePoints: true,
              maxPoints: true,
              factorBreakdown: true,
              evidence: true,
              calculatedAt: true,
              scoreVersion: true,
            },
          },
        },
      },
      statusEvents: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { kind: true, fromStatus: true, toStatus: true, reasonCode: true, createdAt: true },
      },
      applications: { select: { id: true }, take: 1 },
      boosts: {
        where: { status: { not: "CANCELLED" } },
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, status: true, startsAt: true, endsAt: true },
      },
    },
  });
}

export async function cancelAdminJobBoost(
  input: unknown,
  dependencies: AdminDependencies,
): Promise<AdminCommandResult<{ boostId: string; jobId: string }>> {
  if (!requireCapability(dependencies, "ADMIN_JOB_BOOST_MANAGE")) {
    return adminFailure("FORBIDDEN");
  }
  const result = await cancelAdminBoost(input, {
    actorUserId: dependencies.actor.userId,
    correlationId: dependencies.correlationId,
    database: dependencies.database,
    now: dependencies.now,
  });
  if (result.ok) return adminSuccess(result.value, result.replay === true);
  return adminFailure(
    result.code === "INVALID_INPUT" ||
      result.code === "NOT_FOUND" ||
      result.code === "CONFLICT" ||
      result.code === "FORBIDDEN"
      ? result.code
      : "WRITE_FAILED",
  );
}

export async function projectAdminBoostStatuses(
  _input: unknown,
  dependencies: AdminDependencies,
): Promise<AdminCommandResult<BoostProjectionResult>> {
  if (!requireCapability(dependencies, "ADMIN_JOB_BOOST_MANAGE")) {
    return adminFailure("FORBIDDEN");
  }
  try {
    return adminSuccess(await syncBoostStatusProjection({
      database: dependencies.database,
      correlationId: dependencies.correlationId,
      now: dependencies.now,
    }));
  } catch {
    return adminFailure("WRITE_FAILED");
  }
}

export async function startAdminJobReview(
  input: AdminJobCommand,
  dependencies: AdminDependencies,
) {
  return transitionReviewJob(input, dependencies, {
    action: "START_REVIEW",
    auditAction: "JOB_REVIEW_STARTED",
    eventKind: "REVIEW_STARTED",
    notificationStatus: "IN_REVIEW",
    operation: "admin-job-review",
    toStatus: "IN_REVIEW",
  });
}

export async function requestAdminJobChanges(
  input: AdminJobCommand,
  dependencies: AdminDependencies,
) {
  return transitionReviewJob(input, dependencies, {
    action: "REQUEST_CHANGES",
    auditAction: "JOB_CHANGES_REQUESTED",
    eventKind: "CHANGES_REQUESTED",
    notificationStatus: "CHANGES_REQUESTED",
    operation: "admin-job-changes",
    reasonRequired: true,
    toStatus: "CHANGES_REQUESTED",
  });
}

export async function approveAdminJob(
  input: AdminJobCommand,
  dependencies: AdminDependencies,
  email?: EmailProvider,
) {
  const result = await transitionReviewJob(input, dependencies, {
    action: "APPROVE",
    auditAction: "JOB_APPROVED",
    eventKind: "APPROVED",
    notificationStatus: "APPROVED",
    operation: "admin-job-approve",
    toStatus: "APPROVED",
  });
  if (result.ok && !result.replay && email !== undefined) {
    await sendJobReviewEmailsAfterCommit(
      dependencies,
      result.value.jobId,
      "job_approved",
      undefined,
      email,
    );
  }
  return result;
}

export async function rejectAdminJob(
  input: AdminJobCommand,
  dependencies: AdminDependencies,
  email?: EmailProvider,
) {
  const result = await transitionReviewJob(input, dependencies, {
    action: "REJECT",
    auditAction: "JOB_REJECTED",
    eventKind: "REJECTED",
    notificationStatus: "REJECTED",
    operation: "admin-job-reject",
    reasonRequired: true,
    toStatus: "REJECTED",
  });
  if (result.ok && !result.replay && email !== undefined) {
    await sendJobReviewEmailsAfterCommit(
      dependencies,
      result.value.jobId,
      "job_rejected",
      input.reasonCode,
      email,
    );
  }
  return result;
}

export async function publishAdminJob(
  input: AdminJobCommand,
  dependencies: AdminDependencies,
): Promise<AdminCommandResult<AdminJobCommandValue>> {
  const parsed = adminJobCommandSchema.safeParse(input);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_JOB_PUBLISH")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey("admin-job-publish", parsed.data.idempotencyKey);
  const preflight = await dependencies.database.job.findUnique({
    where: { id: parsed.data.jobId },
    select: {
      id: true,
      companyId: true,
      status: true,
      version: true,
      currentRevisionId: true,
      currentRevision: { select: { id: true, version: true, validThrough: true } },
      statusEvents: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } },
    },
  });
  if (preflight === null || preflight.currentRevision === null) return adminFailure("NOT_FOUND");
  if (preflight.statusEvents.length > 0 && preflight.status === "PUBLISHED") {
    return adminSuccess({
      jobId: preflight.id,
      revisionId: preflight.currentRevision.id,
      jobVersion: preflight.version,
      revisionVersion: preflight.currentRevision.version,
      status: "PUBLISHED",
    }, true);
  }
  if (preflight.status !== "APPROVED") return adminFailure("CONFLICT");

  const port = createPrismaPublishQuotaPort(dependencies.database, async (transaction) => {
    await lockJob(transaction, preflight.id);
    const job = await transaction.job.findUnique({
      where: { id: preflight.id },
      select: {
        id: true,
        companyId: true,
        status: true,
        version: true,
        dataProvenance: true,
        currentRevisionId: true,
        company: { select: { status: true, dataProvenance: true } },
        currentRevision: {
          select: {
            id: true,
            version: true,
            approvedAt: true,
            rejectedAt: true,
            validThrough: true,
            categoryId: true,
            cantonId: true,
            cityId: true,
            salaryPeriod: true,
            salaryMin: true,
            salaryMax: true,
            category: { select: { isActive: true } },
            canton: { select: { isActive: true } },
            city: { select: { isActive: true, cantonId: true } },
          },
        },
        statusEvents: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } },
      },
    });
    if (job === null || job.currentRevision === null) return adminFailure("NOT_FOUND");
    const revision = job.currentRevision;
    if (job.statusEvents.length > 0 && job.status === "PUBLISHED") {
      return adminSuccess(currentJobValue(job, revision, "PUBLISHED"), true);
    }
    if (
      job.status !== "APPROVED" ||
      job.company.status !== "ACTIVE" ||
      job.version !== parsed.data.expectedJobVersion ||
      revision.version !== parsed.data.expectedRevisionVersion ||
      job.currentRevisionId !== revision.id ||
      revision.approvedAt === null ||
      revision.rejectedAt !== null ||
      !validPublicationDate(revision.validThrough, now) ||
      !revision.category.isActive ||
      (revision.canton !== null && !revision.canton.isActive) ||
      (revision.city !== null && (!revision.city.isActive || revision.city.cantonId !== revision.cantonId))
    ) return adminFailure("CONFLICT");

    const verificationCount = await transaction.companyVerificationRequest.count({
      where: { companyId: job.companyId, status: "VERIFIED", supersededBy: null },
    });
    if (verificationCount !== 1) return adminFailure("VERIFICATION_REQUIRED");
    const restrictionCount = await transaction.moderationRestriction.count({
      where: {
        status: "ACTIVE",
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        AND: [{ OR: [
          { targetType: "HIDE_JOB", targetId: job.id },
          { targetType: "PAUSE_COMPANY", targetId: job.companyId },
        ] }],
      },
    });
    if (restrictionCount > 0) return adminFailure("RESTRICTED");
    const decision = decideJobTransition({ action: "PUBLISH", actor: "PLATFORM_PUBLISHER", currentStatus: job.status as JobStatus });
    if (decision.type !== "OK") return adminFailure("CONFLICT");

    const changed = await transaction.job.updateMany({
      where: { id: job.id, status: "APPROVED", version: job.version, currentRevisionId: revision.id },
      data: {
        status: "PUBLISHED",
        version: { increment: 1 },
        publishedRevisionId: revision.id,
        publishedAt: now,
        expiresAt: revision.validThrough,
        publishedCategoryId: revision.categoryId,
        publishedCantonId: revision.cantonId,
        publishedCityId: revision.cityId,
        publishedSalaryPeriod: revision.salaryPeriod,
        publishedSalaryMin: revision.salaryMin,
        publishedSalaryMax: revision.salaryMax,
      },
    });
    if (changed.count !== 1) return adminFailure("CONFLICT");
    await transaction.jobStatusEvent.create({ data: {
      id: randomUUID(),
      jobId: job.id,
      jobRevisionId: revision.id,
      kind: "PUBLISHED",
      fromStatus: "APPROVED",
      toStatus: "PUBLISHED",
      actorUserId: dependencies.actor.userId,
      reasonCode: parsed.data.reasonCode ?? "ADMIN_APPROVED_PUBLICATION",
      idempotencyKey: eventKey,
      correlationId: dependencies.correlationId,
      createdAt: now,
    } });
    await trackAnalyticsEventV1(
      {
        schemaVersion: "1",
        producerEventId: `JOB_PUBLISHED:${job.id}`,
        occurredAt: now,
        kind: "JOB_PUBLISHED",
        companyId: job.companyId,
        jobId: job.id,
        properties: { fromStatus: "APPROVED", toStatus: "PUBLISHED" },
      },
      {
        producer: "admin-job-publish",
        productAnalyticsEnabled: false,
        provenance: {
          company: job.company.dataProvenance,
          job: job.dataProvenance,
        },
      },
      createPrismaTransactionAnalyticsWriter(transaction),
    );
    await notifyJobManagers(transaction, job.companyId, job.id, "PUBLISHED", eventKey);
    await writeAdminAudit(transaction, dependencies, now, {
      action: "JOB_PUBLISHED",
      capability: "ADMIN_JOB_PUBLISH",
      targetType: "JOB",
      targetId: job.id,
      companyId: job.companyId,
      reasonCode: parsed.data.reasonCode ?? "ADMIN_APPROVED_PUBLICATION",
    });
    return adminSuccess(currentJobValue({ ...job, version: job.version + 1 }, revision, "PUBLISHED"));
  });

  try {
    const result = await publishWithQuota({
      companyId: preflight.companyId,
      jobId: preflight.id,
      revisionId: preflight.currentRevision.id,
      revisionValidThrough: preflight.currentRevision.validThrough,
      now,
    }, port);
    if (!result.ok) {
      return adminFailure(result.reason === "ACTIVE_JOB_LIMIT_REACHED" || result.reason.includes("PERMIT")
        ? "QUOTA_EXCEEDED"
        : "CONFLICT");
    }
    return result.value;
  } catch (error) {
    return adminErrorResult(error);
  }
}

async function transitionReviewJob(
  input: AdminJobCommand,
  dependencies: AdminDependencies,
  transition: Readonly<{
    action: "START_REVIEW" | "REQUEST_CHANGES" | "APPROVE" | "REJECT";
    auditAction: "JOB_REVIEW_STARTED" | "JOB_CHANGES_REQUESTED" | "JOB_APPROVED" | "JOB_REJECTED";
    eventKind: "REVIEW_STARTED" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";
    notificationStatus: "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";
    operation: string;
    reasonRequired?: boolean;
    toStatus: "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";
  }>,
): Promise<AdminCommandResult<AdminJobCommandValue>> {
  const parsed = adminJobCommandSchema.safeParse(input);
  if (!parsed.success || (transition.reasonRequired === true && parsed.data.reasonCode === undefined)) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_JOB_REVIEW")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey(transition.operation, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await lockJob(transaction, parsed.data.jobId);
      const job = await transaction.job.findUnique({
        where: { id: parsed.data.jobId },
        select: {
          id: true,
          companyId: true,
          status: true,
          version: true,
          currentRevisionId: true,
          currentRevision: { select: { id: true, version: true, submittedAt: true, approvedAt: true, rejectedAt: true } },
          statusEvents: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } },
        },
      });
      if (job === null || job.currentRevision === null) return adminFailure("NOT_FOUND");
      const revision = job.currentRevision;
      if (job.statusEvents.length > 0 && job.status === transition.toStatus) {
        return adminSuccess(currentJobValue(job, revision, transition.toStatus), true);
      }
      if (
        job.version !== parsed.data.expectedJobVersion ||
        revision.version !== parsed.data.expectedRevisionVersion ||
        job.currentRevisionId !== revision.id ||
        revision.submittedAt === null
      ) return adminFailure("CONFLICT");
      const decision = decideJobTransition({
        action: transition.action,
        actor: "PLATFORM_REVIEWER",
        currentStatus: job.status as JobStatus,
        reasonCode: parsed.data.reasonCode,
      });
      if (decision.type !== "OK") return adminFailure(decision.type === "FORBIDDEN" ? "FORBIDDEN" : "CONFLICT");
      const changedJob = await transaction.job.updateMany({
        where: { id: job.id, status: job.status, version: job.version, currentRevisionId: revision.id },
        data: { status: transition.toStatus, version: { increment: 1 } },
      });
      if (changedJob.count !== 1) return adminFailure("CONFLICT");
      const revisionPatch = transition.toStatus === "APPROVED"
        ? { approvedAt: now, rejectedAt: null, version: { increment: 1 as const } }
        : transition.toStatus === "REJECTED"
          ? { rejectedAt: now, approvedAt: null, version: { increment: 1 as const } }
          : null;
      let nextRevisionVersion = revision.version;
      if (revisionPatch !== null) {
        const changedRevision = await transaction.jobRevision.updateMany({
          where: { id: revision.id, jobId: job.id, version: revision.version },
          data: revisionPatch,
        });
        if (changedRevision.count !== 1) throw new AdminDomainError("CONFLICT");
        nextRevisionVersion += 1;
      }
      await transaction.jobStatusEvent.create({ data: {
        id: randomUUID(),
        jobId: job.id,
        jobRevisionId: revision.id,
        kind: transition.eventKind,
        fromStatus: job.status,
        toStatus: transition.toStatus,
        actorUserId: dependencies.actor.userId,
        reasonCode: parsed.data.reasonCode ?? null,
        idempotencyKey: eventKey,
        correlationId: dependencies.correlationId,
        createdAt: now,
      } });
      await notifyJobManagers(transaction, job.companyId, job.id, transition.notificationStatus, eventKey);
      await writeAdminAudit(transaction, dependencies, now, {
        action: transition.auditAction,
        capability: "ADMIN_JOB_REVIEW",
        targetType: "JOB",
        targetId: job.id,
        companyId: job.companyId,
        reasonCode: parsed.data.reasonCode ?? null,
      });
      return adminSuccess({
        jobId: job.id,
        revisionId: revision.id,
        jobVersion: job.version + 1,
        revisionVersion: nextRevisionVersion,
        status: transition.toStatus,
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

async function lockJob(transaction: Prisma.TransactionClient, jobId: string) {
  await transaction.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
}

async function notifyJobManagers(
  transaction: Prisma.TransactionClient,
  companyId: string,
  jobId: string,
  status: "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED" | "PUBLISHED",
  dedupeKey: string,
) {
  const managers = await transaction.companyMembership.findMany({
    where: { companyId, status: "ACTIVE", removedAt: null, role: { in: ["OWNER", "ADMIN"] }, user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  for (const manager of managers) {
    await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
      recipientUserId: manager.userId,
      kind: "JOB_REVIEW_CHANGED",
      dedupeKey,
      payload: { jobId, status, ...(status === "IN_REVIEW" ? {} : { reasonCode: status }) },
    });
  }
}

async function sendJobReviewEmails(
  database: DatabaseClient,
  jobId: string,
  templateKey: "job_approved" | "job_rejected",
  reason: string | undefined,
  email: EmailProvider,
) {
  const job = await database.job.findUnique({
    where: { id: jobId },
    select: {
      currentRevision: { select: { title: true } },
      company: {
        select: {
          memberships: {
            where: { status: "ACTIVE", removedAt: null, role: { in: ["OWNER", "ADMIN"] }, user: { status: "ACTIVE" } },
            select: { user: { select: { email: true } } },
          },
        },
      },
    },
  });
  if (job === null) return;
  for (const membership of job.company.memberships) {
    const data = {
      jobTitle: job.currentRevision?.title ?? "Stelleninserat",
      ...(reason === undefined ? {} : { reason }),
    };
    await email.send({
      to: membership.user.email,
      templateKey,
      subject: renderEmailTemplate(templateKey, data).subject,
      data,
    });
  }
}

async function sendJobReviewEmailsAfterCommit(
  dependencies: AdminDependencies,
  jobId: string,
  templateKey: "job_approved" | "job_rejected",
  reason: string | undefined,
  email: EmailProvider,
) {
  try {
    await sendJobReviewEmails(
      dependencies.database,
      jobId,
      templateKey,
      reason,
      email,
    );
  } catch (error) {
    // The transactional status event, audit and in-app notification are the
    // authoritative result. A post-commit email failure must never make the
    // caller retry an already committed review transition.
    logger.error(
      "admin_job.review_email_retryable",
      { entityId: jobId, error, operation: templateKey },
      dependencies.correlationId,
    );
  }
}

function validPublicationDate(value: Date | null, now: Date): value is Date {
  return value !== null && value > now && value <= new Date(now.getTime() + MAX_PUBLICATION_DAYS * DAY);
}

function currentJobValue(
  job: Readonly<{ id: string; version: number }>,
  revision: Readonly<{ id: string; version: number }>,
  status: JobStatus,
): AdminJobCommandValue {
  return Object.freeze({ jobId: job.id, revisionId: revision.id, jobVersion: job.version, revisionVersion: revision.version, status });
}
