import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { writeRequiredAudit } from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type { JobFreshnessState } from "@/lib/generated/prisma/enums";
import {
  JOB_FRESHNESS_POLICY_V1,
  buildJobPublicationSourceScopeV1,
  buildPublicationFingerprintV1,
  calculateJobFreshnessScheduleV1,
  dueFreshnessActionsV1,
  nearDuplicateScoreBpsV1,
  type PublicationFingerprintInputV1,
} from "@/lib/jobs/freshness-policy";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";

const DAY_MS = 86_400_000;
const commandSchema = z.strictObject({
  jobId: z.uuid(),
  expectedJobVersion: z.coerce.number().int().positive(),
  expectedRevisionVersion: z.coerce.number().int().positive(),
  idempotencyKey: z
    .string()
    .min(8)
    .max(96)
    .regex(/^[A-Za-z0-9:._-]+$/u),
});

export type FreshnessEmployerActor = Readonly<{
  userId: string;
  membershipId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
  companyId: string;
}>;

export type FreshnessCommandResult =
  | Readonly<{
      ok: true;
      jobId: string;
      jobVersion: number;
      freshnessVersion: number;
      state: JobFreshnessState;
      dueAt: Date;
      replay?: boolean;
    }>
  | Readonly<{
      ok: false;
      code: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT";
    }>;

export type PublicationFreshnessInput = Readonly<{
  jobId: string;
  revisionId: string;
  companyId: string;
  sourceScope: string;
  publishedAt: Date;
  expiresAt: Date;
  fingerprint: PublicationFingerprintInputV1;
  correlationId: string;
  actorUserId: string;
}>;

export type PublicationFreshnessResult =
  | Readonly<{ ok: false; code: "EXACT_DUPLICATE"; duplicateJobId: string }>
  | Readonly<{
      ok: true;
      nearDuplicateJobIds: readonly string[];
      dueAt: Date;
    }>;

/**
 * Must run in the same transaction as publish/reactivate. The partial unique
 * index is the final concurrency backstop for exact duplicates.
 */
export async function establishPublicationFreshness(
  transaction: Prisma.TransactionClient,
  input: PublicationFreshnessInput,
): Promise<PublicationFreshnessResult> {
  const fingerprint = buildPublicationFingerprintV1(input.fingerprint);
  const sourceScope = safeSourceScope(input.sourceScope);
  const duplicateLockKey = `${input.companyId}:${sourceScope}:${fingerprint.exactFingerprint}`;
  await transaction.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(hashtextextended(${duplicateLockKey}, 0))
  `;
  const exact = await transaction.jobPublicationFingerprint.findFirst({
    where: {
      jobId: { not: input.jobId },
      companyId: input.companyId,
      sourceScope,
      exactFingerprint: fingerprint.exactFingerprint,
      active: true,
    },
    orderBy: { jobId: "asc" },
    select: { jobId: true },
  });
  if (exact !== null) {
    return Object.freeze({
      ok: false,
      code: "EXACT_DUPLICATE",
      duplicateJobId: exact.jobId,
    });
  }
  const nearCandidates = await transaction.jobPublicationFingerprint.findMany({
    where: {
      jobId: { not: input.jobId },
      companyId: input.companyId,
      sourceScope,
      active: true,
    },
    orderBy: { jobId: "asc" },
    take: 100,
    select: { jobId: true, signatureTokens: true },
  });
  const nearDuplicateJobIds = nearCandidates.flatMap((candidate) =>
    nearDuplicateScoreBpsV1(
      fingerprint.signatureTokens,
      candidate.signatureTokens,
    ) >= JOB_FRESHNESS_POLICY_V1.nearDuplicateThresholdBps
      ? [candidate.jobId]
      : [],
  );
  const schedule = calculateJobFreshnessScheduleV1(
    input.publishedAt,
    input.expiresAt,
  );
  await transaction.jobPublicationFingerprint.upsert({
    where: { jobId: input.jobId },
    create: {
      id: randomUUID(),
      jobId: input.jobId,
      companyId: input.companyId,
      sourceScope,
      exactFingerprint: fingerprint.exactFingerprint,
      signatureTokens: [...fingerprint.signatureTokens],
      active: true,
      createdAt: input.publishedAt,
      updatedAt: input.publishedAt,
    },
    update: {
      companyId: input.companyId,
      sourceScope,
      exactFingerprint: fingerprint.exactFingerprint,
      signatureTokens: [...fingerprint.signatureTokens],
      active: true,
      updatedAt: input.publishedAt,
    },
  });
  await transaction.jobFreshnessProjection.upsert({
    where: { jobId: input.jobId },
    create: {
      jobId: input.jobId,
      policyVersion: JOB_FRESHNESS_POLICY_V1.version,
      state: "ACTIVE",
      publishedAt: input.publishedAt,
      lastConfirmedAt: input.publishedAt,
      ...schedule,
      enforceAt: input.publishedAt,
      updatedAt: input.publishedAt,
    },
    update: {
      policyVersion: JOB_FRESHNESS_POLICY_V1.version,
      state: "ACTIVE",
      publishedAt: input.publishedAt,
      lastConfirmedAt: input.publishedAt,
      ...schedule,
      reminder7SentAt: null,
      reminder24SentAt: null,
      reviewDueAt: null,
      enforceAt: input.publishedAt,
      version: { increment: 1 },
      updatedAt: input.publishedAt,
    },
  });
  await transaction.jobFreshnessEvent.upsert({
    where: {
      idempotencyKey: `freshness:published:${input.jobId}:${input.revisionId}`,
    },
    create: {
      id: randomUUID(),
      jobId: input.jobId,
      kind: "PUBLISHED",
      fromState: null,
      toState: "ACTIVE",
      actorUserId: input.actorUserId,
      reasonCode: "PUBLICATION_CONFIRMED",
      idempotencyKey: `freshness:published:${input.jobId}:${input.revisionId}`,
      correlationId: input.correlationId,
      createdAt: input.publishedAt,
    },
    update: {},
  });
  for (const duplicateJobId of nearDuplicateJobIds) {
    const pair = [input.jobId, duplicateJobId].sort().join(":");
    await transaction.systemTask.upsert({
      where: { idempotencyKey: `job-near-duplicate:${pair}` },
      create: {
        id: randomUUID(),
        companyId: input.companyId,
        kind: "MODERATION",
        reasonCode: "JOB_NEAR_DUPLICATE",
        policyVersion: JOB_FRESHNESS_POLICY_V1.version,
        evidenceReference: `job-pair:${pair}`,
        dueAt: new Date(input.publishedAt.getTime() + DAY_MS),
        idempotencyKey: `job-near-duplicate:${pair}`,
        createdAt: input.publishedAt,
        updatedAt: input.publishedAt,
      },
      update: {},
    });
  }
  return Object.freeze({
    ok: true,
    nearDuplicateJobIds: Object.freeze(nearDuplicateJobIds),
    dueAt: schedule.dueAt,
  });
}

export async function deactivatePublicationFingerprint(
  transaction: Prisma.TransactionClient,
  jobId: string,
  now: Date,
) {
  return transaction.jobPublicationFingerprint.updateMany({
    where: { jobId, active: true },
    data: { active: false, updatedAt: now },
  });
}

export async function reconfirmEmployerJobFreshness(
  raw: unknown,
  dependencies: Readonly<{
    actor: FreshnessEmployerActor;
    correlationId: string;
    database: DatabaseClient;
    now?: Date;
  }>,
): Promise<FreshnessCommandResult> {
  const parsed = commandSchema.safeParse(raw);
  const now = dependencies.now ?? new Date();
  if (!parsed.success || !Number.isFinite(now.getTime()))
    return failure("INVALID_INPUT");
  if (!["OWNER", "ADMIN"].includes(dependencies.actor.membershipRole)) {
    return failure("FORBIDDEN");
  }
  return dependencies.database.$transaction(
    async (transaction) => {
      const replayKey = `freshness:reconfirmed:${parsed.data.idempotencyKey}`;
      const replay = await loadAuthorizedFreshnessReplay(
        transaction,
        replayKey,
        parsed.data.jobId,
        dependencies.actor,
      );
      if (replay !== null) {
        const projection =
          await transaction.jobFreshnessProjection.findUniqueOrThrow({
            where: { jobId: replay.jobId },
          });
        const job = await transaction.job.findUniqueOrThrow({
          where: { id: replay.jobId },
          select: { version: true },
        });
        return success(job.version, projection, true);
      }
      const job = await loadOwnedPublishedJob(
        transaction,
        parsed.data.jobId,
        dependencies.actor,
      );
      if (job === null) return failure("NOT_FOUND");
      if (await freshnessReplayKeyExists(transaction, replayKey)) {
        return failure("CONFLICT");
      }
      if (
        job.version !== parsed.data.expectedJobVersion ||
        job.currentRevision === null ||
        job.currentRevision.version !== parsed.data.expectedRevisionVersion ||
        job.currentRevisionId !== job.publishedRevisionId ||
        job.expiresAt === null ||
        job.expiresAt <= now
      )
        return failure("CONFLICT");
      await transaction.$queryRaw`SELECT "jobId" FROM "JobFreshnessProjection" WHERE "jobId" = ${job.id}::uuid FOR UPDATE`;
      const current = await transaction.jobFreshnessProjection.findUnique({
        where: { jobId: job.id },
      });
      if (
        current !== null &&
        (current.state === "REVIEW_PENDING" || current.state === "HOLD")
      ) {
        return failure("CONFLICT");
      }
      const schedule = calculateJobFreshnessScheduleV1(now, job.expiresAt);
      const projection = await transaction.jobFreshnessProjection.upsert({
        where: { jobId: job.id },
        create: {
          jobId: job.id,
          policyVersion: JOB_FRESHNESS_POLICY_V1.version,
          state: "ACTIVE",
          publishedAt: job.publishedAt ?? now,
          lastConfirmedAt: now,
          ...schedule,
          enforceAt: now,
          updatedAt: now,
        },
        update: {
          state: "ACTIVE",
          lastConfirmedAt: now,
          ...schedule,
          reminder7SentAt: null,
          reminder24SentAt: null,
          reviewDueAt: null,
          enforceAt: now,
          version: { increment: 1 },
          updatedAt: now,
        },
      });
      await transaction.jobFreshnessEvent.create({
        data: {
          id: randomUUID(),
          jobId: job.id,
          kind: "RECONFIRMED",
          fromState: current?.state ?? null,
          toState: "ACTIVE",
          actorUserId: dependencies.actor.userId,
          reasonCode: "EMPLOYER_RECONFIRMED",
          idempotencyKey: replayKey,
          correlationId: dependencies.correlationId,
          createdAt: now,
        },
      });
      await writeFreshnessAudit(transaction, dependencies, now, {
        action: "JOB_FRESHNESS_CONFIRMED",
        jobId: job.id,
        reasonCode: "EMPLOYER_RECONFIRMED",
      });
      await notifyJobManagers(transaction, job.companyId, job.id, {
        status: "RECONFIRMED",
        dueAt: projection.dueAt,
        dedupeKey: replayKey,
      });
      return success(job.version, projection);
    },
    { isolationLevel: "Serializable" },
  );
}

export async function markEmployerJobFilled(
  raw: unknown,
  dependencies: Readonly<{
    actor: FreshnessEmployerActor;
    correlationId: string;
    database: DatabaseClient;
    now?: Date;
  }>,
): Promise<FreshnessCommandResult> {
  const parsed = commandSchema.safeParse(raw);
  const now = dependencies.now ?? new Date();
  if (!parsed.success || !Number.isFinite(now.getTime()))
    return failure("INVALID_INPUT");
  if (!["OWNER", "ADMIN"].includes(dependencies.actor.membershipRole)) {
    return failure("FORBIDDEN");
  }
  return dependencies.database.$transaction(
    async (transaction) => {
      const replayKey = `freshness:filled:${parsed.data.idempotencyKey}`;
      const replay = await loadAuthorizedFreshnessReplay(
        transaction,
        replayKey,
        parsed.data.jobId,
        dependencies.actor,
      );
      if (replay !== null) {
        const projection =
          await transaction.jobFreshnessProjection.findUniqueOrThrow({
            where: { jobId: replay.jobId },
          });
        const job = await transaction.job.findUniqueOrThrow({
          where: { id: replay.jobId },
          select: { version: true },
        });
        return success(job.version, projection, true);
      }
      const job = await loadOwnedPublishedJob(
        transaction,
        parsed.data.jobId,
        dependencies.actor,
      );
      if (job === null) return failure("NOT_FOUND");
      if (await freshnessReplayKeyExists(transaction, replayKey)) {
        return failure("CONFLICT");
      }
      if (
        job.version !== parsed.data.expectedJobVersion ||
        job.currentRevision === null ||
        job.currentRevision.version !== parsed.data.expectedRevisionVersion
      )
        return failure("CONFLICT");
      const current = await transaction.jobFreshnessProjection.findUnique({
        where: { jobId: job.id },
      });
      if (current === null) return failure("CONFLICT");
      const changed = await transaction.job.updateMany({
        where: { id: job.id, status: "PUBLISHED", version: job.version },
        data: { status: "CLOSED", version: { increment: 1 }, updatedAt: now },
      });
      if (changed.count !== 1) return failure("CONFLICT");
      await transaction.jobStatusEvent.create({
        data: {
          id: randomUUID(),
          jobId: job.id,
          jobRevisionId: job.currentRevision.id,
          kind: "CLOSED",
          fromStatus: "PUBLISHED",
          toStatus: "CLOSED",
          actorUserId: dependencies.actor.userId,
          reasonCode: "POSITION_FILLED",
          idempotencyKey: `job-filled:${parsed.data.idempotencyKey}`,
          correlationId: dependencies.correlationId,
          createdAt: now,
        },
      });
      const projection = await transaction.jobFreshnessProjection.update({
        where: { jobId: job.id },
        data: {
          state: "FILLED",
          reviewDueAt: null,
          enforceAt: now,
          version: { increment: 1 },
          updatedAt: now,
        },
      });
      await deactivatePublicationFingerprint(transaction, job.id, now);
      await transaction.jobFreshnessEvent.create({
        data: {
          id: randomUUID(),
          jobId: job.id,
          kind: "FILLED",
          fromState: current.state,
          toState: "FILLED",
          actorUserId: dependencies.actor.userId,
          reasonCode: "POSITION_FILLED",
          idempotencyKey: replayKey,
          correlationId: dependencies.correlationId,
          createdAt: now,
        },
      });
      await writeFreshnessAudit(transaction, dependencies, now, {
        action: "JOB_MARKED_FILLED",
        jobId: job.id,
        reasonCode: "POSITION_FILLED",
      });
      await notifyJobManagers(transaction, job.companyId, job.id, {
        status: "FILLED",
        dedupeKey: replayKey,
      });
      return success(job.version + 1, projection);
    },
    { isolationLevel: "Serializable" },
  );
}

export async function recordCandidateFreshnessReport(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    jobId: string;
    abuseReportId: string;
    reporterUserId: string;
    correlationId: string;
    now: Date;
  }>,
) {
  const job = await transaction.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      companyId: true,
      status: true,
      publishedAt: true,
      expiresAt: true,
    },
  });
  if (
    job === null ||
    job.status !== "PUBLISHED" ||
    job.publishedAt === null ||
    job.expiresAt === null ||
    job.expiresAt <= input.now
  )
    return null;
  const reporterLockKey = `job-freshness-report:${job.id}:${input.reporterUserId}`;
  await transaction.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(hashtextextended(${reporterLockKey}, 0))
  `;
  const existing = await transaction.jobFreshnessReport.findFirst({
    where: {
      jobId: job.id,
      reporterUserId: input.reporterUserId,
      status: { in: ["OPEN", "HELD"] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (existing !== null) return existing;
  const reviewDueAt = new Date(
    input.now.getTime() +
      JOB_FRESHNESS_POLICY_V1.candidateReviewSlaHours * 60 * 60_000,
  );
  const schedule = calculateJobFreshnessScheduleV1(
    job.publishedAt,
    job.expiresAt,
  );
  const current = await transaction.jobFreshnessProjection.findUnique({
    where: { jobId: job.id },
  });
  const nextState: JobFreshnessState =
    current !== null &&
    ["HOLD", "STALE", "FILLED", "CLOSED"].includes(current.state)
      ? current.state
      : "REVIEW_PENDING";
  await transaction.jobFreshnessProjection.upsert({
    where: { jobId: job.id },
    create: {
      jobId: job.id,
      policyVersion: JOB_FRESHNESS_POLICY_V1.version,
      state: nextState,
      publishedAt: job.publishedAt,
      lastConfirmedAt: job.publishedAt,
      ...schedule,
      reviewDueAt,
      enforceAt: input.now,
      updatedAt: input.now,
    },
    update: {
      state: nextState,
      reviewDueAt:
        nextState === "REVIEW_PENDING" &&
        current?.reviewDueAt !== null &&
        current?.reviewDueAt !== undefined &&
        current.reviewDueAt < reviewDueAt
          ? current.reviewDueAt
          : nextState === "REVIEW_PENDING"
            ? reviewDueAt
            : (current?.reviewDueAt ?? null),
      enforceAt: input.now,
      version: { increment: 1 },
      updatedAt: input.now,
    },
  });
  const report = await transaction.jobFreshnessReport.create({
    data: {
      id: randomUUID(),
      jobId: job.id,
      abuseReportId: input.abuseReportId,
      reporterUserId: input.reporterUserId,
      status: "OPEN",
      reviewDueAt,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
  await transaction.jobFreshnessEvent.create({
    data: {
      id: randomUUID(),
      jobId: job.id,
      kind: "CANDIDATE_REPORTED",
      fromState: current?.state ?? null,
      toState: nextState,
      actorUserId: input.reporterUserId,
      reasonCode: "CANDIDATE_OUTDATED_REPORT",
      idempotencyKey: `freshness:report:${input.abuseReportId}`,
      correlationId: input.correlationId,
      createdAt: input.now,
    },
  });
  await transaction.systemTask.upsert({
    where: { idempotencyKey: `freshness-review:${input.abuseReportId}` },
    create: {
      id: randomUUID(),
      companyId: job.companyId,
      kind: "MODERATION",
      reasonCode: "JOB_FRESHNESS_REVIEW",
      policyVersion: JOB_FRESHNESS_POLICY_V1.version,
      evidenceReference: `abuse-report:${input.abuseReportId}`,
      dueAt: reviewDueAt,
      idempotencyKey: `freshness-review:${input.abuseReportId}`,
      createdAt: input.now,
      updatedAt: input.now,
    },
    update: {},
  });
  return report;
}

export async function closeCandidateFreshnessReport(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    abuseReportId: string;
    status: "RESOLVED" | "DISMISSED";
    actorUserId: string;
    correlationId: string;
    now: Date;
  }>,
) {
  const report = await transaction.jobFreshnessReport.findUnique({
    where: { abuseReportId: input.abuseReportId },
  });
  if (report === null || !["OPEN", "HELD"].includes(report.status)) return null;
  await transaction.$queryRaw`
    SELECT "jobId"
    FROM "JobFreshnessProjection"
    WHERE "jobId" = ${report.jobId}::uuid
    FOR UPDATE
  `;
  const projection = await transaction.jobFreshnessProjection.findUnique({
    where: { jobId: report.jobId },
  });
  if (projection === null) return null;
  await transaction.jobFreshnessReport.update({
    where: { id: report.id },
    data: {
      status: input.status === "DISMISSED" ? "DISMISSED" : "CONFIRMED_OUTDATED",
      resolvedAt: input.now,
      updatedAt: input.now,
    },
  });
  const remainingReports = await transaction.jobFreshnessReport.findMany({
    where: {
      jobId: report.jobId,
      id: { not: report.id },
      status: { in: ["OPEN", "HELD", "CONFIRMED_OUTDATED"] },
    },
    orderBy: [{ reviewDueAt: "asc" }, { id: "asc" }],
    select: { status: true, reviewDueAt: true },
  });
  const confirmedOrHeld =
    input.status === "RESOLVED" ||
    remainingReports.some(
      ({ status }) => status === "HELD" || status === "CONFIRMED_OUTDATED",
    );
  const openReports = remainingReports.filter(
    ({ status }) => status === "OPEN",
  );
  const toState: JobFreshnessState = confirmedOrHeld
    ? "HOLD"
    : openReports.length > 0
      ? "REVIEW_PENDING"
      : "ACTIVE";
  const nextReviewDueAt =
    toState === "REVIEW_PENDING" ? (openReports[0]?.reviewDueAt ?? null) : null;
  await transaction.jobFreshnessProjection.update({
    where: { jobId: report.jobId },
    data: {
      state: toState,
      reviewDueAt: nextReviewDueAt,
      enforceAt: input.now,
      version: { increment: 1 },
      updatedAt: input.now,
    },
  });
  await transaction.jobFreshnessEvent.create({
    data: {
      id: randomUUID(),
      jobId: report.jobId,
      kind:
        input.status === "DISMISSED" ? "REVIEW_DISMISSED" : "REVIEW_RESOLVED",
      fromState: projection.state,
      toState,
      actorUserId: input.actorUserId,
      reasonCode:
        input.status === "DISMISSED"
          ? "REPORT_NOT_CONFIRMED"
          : "REPORT_CONFIRMED",
      idempotencyKey: `freshness:report-close:${report.id}:${input.status}`,
      correlationId: input.correlationId,
      createdAt: input.now,
    },
  });
  if (toState === "HOLD" && projection.state !== "HOLD") {
    const job = await transaction.job.findUnique({
      where: { id: report.jobId },
      select: { companyId: true },
    });
    if (job !== null) {
      await writeFreshnessStateAudit(transaction, input.now, {
        actorKind: "USER",
        actorUserId: input.actorUserId,
        capability: "ADMIN_REPORT_REVIEW",
        companyId: job.companyId,
        correlationId: input.correlationId,
        jobId: report.jobId,
        reasonCode: "REPORT_CONFIRMED",
      });
      await notifyJobManagers(transaction, job.companyId, report.jobId, {
        status: "HOLD",
        dedupeKey: `freshness:report-hold:${report.id}`,
      });
    }
  }
  return Object.freeze({ jobId: report.jobId, state: toState });
}

export async function projectJobFreshness(
  input: Readonly<{
    database: DatabaseClient;
    correlationId: string;
    now?: Date;
  }>,
) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()))
    throw new TypeError("Invalid freshness worker clock.");
  const fingerprintBackfill = await backfillJobPublicationFingerprints({
    database: input.database,
    correlationId: input.correlationId,
    now,
  });
  const due = await input.database.jobFreshnessProjection.findMany({
    where: {
      state: { in: ["ACTIVE", "REVIEW_PENDING"] },
      OR: [
        { dueAt: { lte: now } },
        { reminder7At: { lte: now }, reminder7SentAt: null },
        { reminder24At: { lte: now }, reminder24SentAt: null },
        { reviewDueAt: { lte: now } },
      ],
    },
    orderBy: [{ dueAt: "asc" }, { jobId: "asc" }],
    take: 500,
  });
  const totals = {
    reminder7: 0,
    reminder24: 0,
    stale: 0,
    held: 0,
  };
  for (const candidate of due) {
    await input.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT "jobId" FROM "JobFreshnessProjection" WHERE "jobId" = ${candidate.jobId}::uuid FOR UPDATE`;
        const current = await transaction.jobFreshnessProjection.findUnique({
          where: { jobId: candidate.jobId },
        });
        if (current === null) return;
        const actions = dueFreshnessActionsV1(current, now);
        if (actions.includes("REVIEW_SLA_EXCEEDED")) {
          const changed = await transaction.jobFreshnessProjection.updateMany({
            where: {
              jobId: current.jobId,
              version: current.version,
              state: "REVIEW_PENDING",
            },
            data: {
              state: "HOLD",
              version: { increment: 1 },
              updatedAt: now,
            },
          });
          if (changed.count === 1) {
            await transaction.jobFreshnessReport.updateMany({
              where: {
                jobId: current.jobId,
                status: "OPEN",
                reviewDueAt: { lte: now },
              },
              data: { status: "HELD", updatedAt: now },
            });
            await createProjectionEvent(transaction, current, {
              kind: "REVIEW_SLA_EXCEEDED",
              toState: "HOLD",
              reasonCode: "REVIEW_SLA_EXCEEDED",
              idempotencyKey: `freshness:review-sla:${current.jobId}:${current.reviewDueAt?.toISOString() ?? "missing"}`,
              correlationId: input.correlationId,
              now,
            });
            await recordAutomaticFreshnessStateChange(
              transaction,
              current.jobId,
              input.correlationId,
              now,
              "HOLD",
              "REVIEW_SLA_EXCEEDED",
              `freshness:review-sla:${current.jobId}:${current.reviewDueAt?.toISOString() ?? "missing"}`,
            );
            totals.held += 1;
          }
          return;
        }
        if (actions.includes("DUE")) {
          const changed = await transaction.jobFreshnessProjection.updateMany({
            where: {
              jobId: current.jobId,
              version: current.version,
              state: { in: ["ACTIVE", "REVIEW_PENDING"] },
            },
            data: {
              state: "STALE",
              version: { increment: 1 },
              updatedAt: now,
            },
          });
          if (changed.count === 1) {
            await createProjectionEvent(transaction, current, {
              kind: "DUE",
              toState: "STALE",
              reasonCode: "RECONFIRMATION_DUE",
              idempotencyKey: `freshness:due:${current.jobId}:${current.dueAt.toISOString()}`,
              correlationId: input.correlationId,
              now,
            });
            await recordAutomaticFreshnessStateChange(
              transaction,
              current.jobId,
              input.correlationId,
              now,
              "STALE",
              "RECONFIRMATION_DUE",
              `freshness:due:${current.jobId}:${current.dueAt.toISOString()}`,
            );
            totals.stale += 1;
          }
          return;
        }
        for (const action of actions) {
          if (action !== "REMINDER_7D" && action !== "REMINDER_24H") continue;
          const sentField =
            action === "REMINDER_7D" ? "reminder7SentAt" : "reminder24SentAt";
          const changed = await transaction.jobFreshnessProjection.updateMany({
            where: {
              jobId: current.jobId,
              version: current.version,
              [sentField]: null,
            },
            data: {
              [sentField]: now,
              version: { increment: 1 },
              updatedAt: now,
            },
          });
          if (changed.count !== 1) continue;
          await createProjectionEvent(transaction, current, {
            kind: action,
            toState: current.state,
            reasonCode: action,
            idempotencyKey: `freshness:${action.toLowerCase()}:${current.jobId}:${current.dueAt.toISOString()}`,
            correlationId: input.correlationId,
            now,
          });
          const job = await transaction.job.findUnique({
            where: { id: current.jobId },
            select: { companyId: true },
          });
          if (job !== null) {
            await notifyJobManagers(transaction, job.companyId, current.jobId, {
              status: action,
              dueAt: current.dueAt,
              dedupeKey: `freshness:${action}:${current.jobId}:${current.dueAt.toISOString()}`,
            });
          }
          if (action === "REMINDER_7D") totals.reminder7 += 1;
          else totals.reminder24 += 1;
          break;
        }
      },
      { isolationLevel: "Serializable" },
    );
  }
  return Object.freeze({ ...totals, fingerprintBackfill });
}

export async function backfillJobPublicationFingerprints(
  input: Readonly<{
    database: DatabaseClient;
    correlationId: string;
    now?: Date;
  }>,
) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Invalid publication-fingerprint backfill clock.");
  }
  const candidates = await input.database.job.findMany({
    where: {
      status: "PUBLISHED",
      publicationFingerprint: null,
      publishedAt: { not: null },
      expiresAt: { gt: now },
    },
    orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true },
  });
  const totals = { fingerprinted: 0, exactHeld: 0, nearQueued: 0 };
  for (const candidate of candidates) {
    await input.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "Job"
          WHERE "id" = ${candidate.id}::uuid
          FOR UPDATE
        `;
        const job = await transaction.job.findFirst({
          where: {
            id: candidate.id,
            status: "PUBLISHED",
            publicationFingerprint: null,
          },
          select: {
            id: true,
            companyId: true,
            origin: true,
            importSourceId: true,
            currentRevisionId: true,
            publishedRevisionId: true,
            publishedAt: true,
            expiresAt: true,
          },
        });
        const publishedRevision =
          job?.publishedRevisionId === null ||
          job?.publishedRevisionId === undefined
            ? null
            : await transaction.jobRevision.findUnique({
                where: { id: job.publishedRevisionId },
                select: {
                  id: true,
                  jobId: true,
                  title: true,
                  description: true,
                  tasks: true,
                  requirements: true,
                  offer: true,
                  categoryId: true,
                  cantonId: true,
                  cityId: true,
                  workloadMin: true,
                  workloadMax: true,
                  jobType: true,
                  remoteType: true,
                },
              });
        const freshnessProjection =
          job === null
            ? null
            : await transaction.jobFreshnessProjection.findUnique({
                where: { jobId: job.id },
                select: { state: true },
              });
        if (
          job === null ||
          job.publishedAt === null ||
          job.expiresAt === null ||
          publishedRevision === null ||
          job.currentRevisionId !== job.publishedRevisionId ||
          publishedRevision.id !== job.publishedRevisionId ||
          publishedRevision.jobId !== job.id
        ) {
          return;
        }
        if (freshnessProjection === null) {
          const schedule = calculateJobFreshnessScheduleV1(
            job.publishedAt,
            job.expiresAt,
          );
          await transaction.jobFreshnessProjection.create({
            data: {
              jobId: job.id,
              policyVersion: JOB_FRESHNESS_POLICY_V1.version,
              state: "ACTIVE",
              publishedAt: job.publishedAt,
              lastConfirmedAt: job.publishedAt,
              ...schedule,
              enforceAt: now,
              updatedAt: now,
            },
          });
        }
        const sourceScope = buildJobPublicationSourceScopeV1(job);
        const fingerprint = buildPublicationFingerprintV1(publishedRevision);
        const lockKey = `${job.companyId}:${sourceScope}:${fingerprint.exactFingerprint}`;
        await transaction.$queryRaw`
          SELECT 1 AS "locked"
          FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        const exact = await transaction.jobPublicationFingerprint.findFirst({
          where: {
            jobId: { not: job.id },
            companyId: job.companyId,
            sourceScope,
            exactFingerprint: fingerprint.exactFingerprint,
            active: true,
          },
          orderBy: { jobId: "asc" },
          select: { jobId: true },
        });
        const near = await transaction.jobPublicationFingerprint.findMany({
          where: {
            jobId: { not: job.id },
            companyId: job.companyId,
            sourceScope,
            active: true,
          },
          orderBy: { jobId: "asc" },
          take: 100,
          select: { jobId: true, signatureTokens: true },
        });
        const nearDuplicateJobIds = near.flatMap((other) =>
          nearDuplicateScoreBpsV1(
            fingerprint.signatureTokens,
            other.signatureTokens,
          ) >= JOB_FRESHNESS_POLICY_V1.nearDuplicateThresholdBps
            ? [other.jobId]
            : [],
        );
        await transaction.jobPublicationFingerprint.create({
          data: {
            id: randomUUID(),
            jobId: job.id,
            companyId: job.companyId,
            sourceScope,
            exactFingerprint: fingerprint.exactFingerprint,
            signatureTokens: [...fingerprint.signatureTokens],
            active: exact === null,
            createdAt: job.publishedAt,
            updatedAt: now,
          },
        });
        if (exact !== null) {
          const changed = await transaction.jobFreshnessProjection.updateMany({
            where: {
              jobId: job.id,
              state: { notIn: ["HOLD", "STALE", "FILLED", "CLOSED"] },
            },
            data: {
              state: "HOLD",
              enforceAt: now,
              version: { increment: 1 },
              updatedAt: now,
            },
          });
          const pair = [job.id, exact.jobId].sort().join(":");
          await transaction.systemTask.upsert({
            where: { idempotencyKey: `job-exact-duplicate:${pair}` },
            create: {
              id: randomUUID(),
              companyId: job.companyId,
              kind: "MODERATION",
              reasonCode: "JOB_EXACT_DUPLICATE",
              policyVersion: JOB_FRESHNESS_POLICY_V1.version,
              evidenceReference: `job-pair:${pair}`,
              dueAt: now,
              idempotencyKey: `job-exact-duplicate:${pair}`,
              createdAt: now,
              updatedAt: now,
            },
            update: {},
          });
          if (changed.count === 1) {
            await transaction.jobFreshnessEvent.upsert({
              where: {
                idempotencyKey: `freshness:duplicate-hold:${job.id}:${exact.jobId}`,
              },
              create: {
                id: randomUUID(),
                jobId: job.id,
                kind: "DUPLICATE_HELD",
                fromState: freshnessProjection?.state ?? "ACTIVE",
                toState: "HOLD",
                actorUserId: null,
                reasonCode: "EXACT_DUPLICATE_BACKFILL",
                idempotencyKey: `freshness:duplicate-hold:${job.id}:${exact.jobId}`,
                correlationId: input.correlationId,
                createdAt: now,
              },
              update: {},
            });
            await recordAutomaticFreshnessStateChange(
              transaction,
              job.id,
              input.correlationId,
              now,
              "HOLD",
              "EXACT_DUPLICATE_BACKFILL",
              `freshness:duplicate-hold:${job.id}:${exact.jobId}`,
            );
            totals.exactHeld += 1;
          }
          return;
        }
        totals.fingerprinted += 1;
        for (const duplicateJobId of nearDuplicateJobIds) {
          const pair = [job.id, duplicateJobId].sort().join(":");
          const task = await transaction.systemTask.upsert({
            where: { idempotencyKey: `job-near-duplicate:${pair}` },
            create: {
              id: randomUUID(),
              companyId: job.companyId,
              kind: "MODERATION",
              reasonCode: "JOB_NEAR_DUPLICATE",
              policyVersion: JOB_FRESHNESS_POLICY_V1.version,
              evidenceReference: `job-pair:${pair}`,
              dueAt: new Date(now.getTime() + DAY_MS),
              idempotencyKey: `job-near-duplicate:${pair}`,
              createdAt: now,
              updatedAt: now,
            },
            update: {},
          });
          if (task.createdAt.getTime() === now.getTime()) {
            totals.nearQueued += 1;
          }
        }
      },
      { isolationLevel: "Serializable" },
    );
  }
  return Object.freeze(totals);
}

async function loadOwnedPublishedJob(
  transaction: Prisma.TransactionClient,
  jobId: string,
  actor: FreshnessEmployerActor,
) {
  await transaction.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
  return transaction.job.findFirst({
    where: {
      id: jobId,
      companyId: actor.companyId,
      status: "PUBLISHED",
      company: {
        memberships: {
          some: {
            id: actor.membershipId,
            userId: actor.userId,
            companyId: actor.companyId,
            status: "ACTIVE",
            removedAt: null,
            role: { in: ["OWNER", "ADMIN"] },
          },
        },
      },
    },
    select: {
      id: true,
      companyId: true,
      status: true,
      version: true,
      currentRevisionId: true,
      publishedRevisionId: true,
      publishedAt: true,
      expiresAt: true,
      currentRevision: { select: { id: true, version: true } },
    },
  });
}

async function loadAuthorizedFreshnessReplay(
  transaction: Prisma.TransactionClient,
  idempotencyKey: string,
  jobId: string,
  actor: FreshnessEmployerActor,
) {
  return transaction.jobFreshnessEvent.findFirst({
    where: {
      idempotencyKey,
      jobId,
      job: {
        companyId: actor.companyId,
        company: {
          memberships: {
            some: {
              id: actor.membershipId,
              userId: actor.userId,
              companyId: actor.companyId,
              status: "ACTIVE",
              removedAt: null,
              role: { in: ["OWNER", "ADMIN"] },
            },
          },
        },
      },
    },
    select: { jobId: true },
  });
}

async function freshnessReplayKeyExists(
  transaction: Prisma.TransactionClient,
  idempotencyKey: string,
): Promise<boolean> {
  return (
    (await transaction.jobFreshnessEvent.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    })) !== null
  );
}

async function createProjectionEvent(
  transaction: Prisma.TransactionClient,
  current: Readonly<{ jobId: string; state: JobFreshnessState }>,
  input: Readonly<{
    kind: "REMINDER_7D" | "REMINDER_24H" | "DUE" | "REVIEW_SLA_EXCEEDED";
    toState: JobFreshnessState;
    reasonCode: string;
    idempotencyKey: string;
    correlationId: string;
    now: Date;
  }>,
) {
  await transaction.jobFreshnessEvent.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      id: randomUUID(),
      jobId: current.jobId,
      kind: input.kind,
      fromState: current.state,
      toState: input.toState,
      actorUserId: null,
      reasonCode: input.reasonCode,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      createdAt: input.now,
    },
    update: {},
  });
}

async function recordAutomaticFreshnessStateChange(
  transaction: Prisma.TransactionClient,
  jobId: string,
  correlationId: string,
  now: Date,
  status: "HOLD" | "STALE",
  reasonCode:
    "REVIEW_SLA_EXCEEDED" | "RECONFIRMATION_DUE" | "EXACT_DUPLICATE_BACKFILL",
  dedupeKey: string,
) {
  const job = await transaction.job.findUnique({
    where: { id: jobId },
    select: { companyId: true },
  });
  if (job === null) return;
  await writeFreshnessStateAudit(transaction, now, {
    actorKind: "SYSTEM",
    actorUserId: null,
    capability: "JOB_FRESHNESS_PROJECT",
    companyId: job.companyId,
    correlationId,
    jobId,
    reasonCode,
  });
  await notifyJobManagers(transaction, job.companyId, jobId, {
    status,
    dedupeKey,
  });
}

async function writeFreshnessStateAudit(
  transaction: Prisma.TransactionClient,
  now: Date,
  input: Readonly<{
    actorKind: "USER" | "SYSTEM";
    actorUserId: string | null;
    capability: "ADMIN_REPORT_REVIEW" | "JOB_FRESHNESS_PROJECT";
    companyId: string;
    correlationId: string;
    jobId: string;
    reasonCode:
      | "REPORT_CONFIRMED"
      | "REVIEW_SLA_EXCEEDED"
      | "RECONFIRMATION_DUE"
      | "EXACT_DUPLICATE_BACKFILL";
  }>,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: "JOB_FRESHNESS_HELD",
    actorKind: input.actorKind,
    actorUserId: input.actorUserId,
    capability: input.capability,
    companyId: input.companyId,
    correlationId: input.correlationId,
    reasonCode: input.reasonCode,
    result: "SUCCEEDED",
    retainUntil: new Date(now.getTime() + 365 * DAY_MS),
    targetId: input.jobId,
    targetType: "JOB",
  });
}

async function notifyJobManagers(
  transaction: Prisma.TransactionClient,
  companyId: string,
  jobId: string,
  input: Readonly<{
    status:
      | "REMINDER_7D"
      | "REMINDER_24H"
      | "RECONFIRMED"
      | "REVIEW_PENDING"
      | "HOLD"
      | "STALE"
      | "FILLED";
    dueAt?: Date;
    dedupeKey: string;
  }>,
) {
  const managers = await transaction.companyMembership.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      removedAt: null,
      role: { in: ["OWNER", "ADMIN"] },
      user: { status: "ACTIVE" },
    },
    orderBy: [{ role: "asc" }, { userId: "asc" }],
    select: { userId: true },
  });
  for (const manager of managers) {
    await writeNotificationExactlyOnce(
      createPrismaNotificationPort(transaction),
      {
        recipientUserId: manager.userId,
        kind: "JOB_FRESHNESS_CHANGED",
        dedupeKey: input.dedupeKey,
        payload: {
          jobId,
          status: input.status,
          ...(input.dueAt === undefined
            ? {}
            : { dueAt: input.dueAt.toISOString() }),
        },
      },
    );
  }
}

async function writeFreshnessAudit(
  transaction: Prisma.TransactionClient,
  dependencies: Readonly<{
    actor: FreshnessEmployerActor;
    correlationId: string;
  }>,
  now: Date,
  input: Readonly<{
    action: "JOB_FRESHNESS_CONFIRMED" | "JOB_MARKED_FILLED";
    jobId: string;
    reasonCode: string;
  }>,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: input.action,
    actorKind: "USER",
    actorUserId: dependencies.actor.userId,
    capability:
      input.action === "JOB_MARKED_FILLED"
        ? "EMPLOYER_JOB_MARK_FILLED"
        : "EMPLOYER_JOB_RECONFIRM",
    companyId: dependencies.actor.companyId,
    correlationId: dependencies.correlationId,
    reasonCode: input.reasonCode,
    result: "SUCCEEDED",
    retainUntil: new Date(now.getTime() + 365 * DAY_MS),
    targetId: input.jobId,
    targetType: "JOB",
  });
}

function success(
  jobVersion: number,
  projection: Readonly<{
    jobId: string;
    version: number;
    state: JobFreshnessState;
    dueAt: Date;
  }>,
  replay = false,
): FreshnessCommandResult {
  return Object.freeze({
    ok: true,
    jobId: projection.jobId,
    jobVersion,
    freshnessVersion: projection.version,
    state: projection.state,
    dueAt: new Date(projection.dueAt),
    ...(replay ? { replay: true } : {}),
  });
}

function failure(
  code: Extract<FreshnessCommandResult, { ok: false }>["code"],
): FreshnessCommandResult {
  return Object.freeze({ ok: false, code });
}

function safeSourceScope(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._:-]+/gu, "-")
    .slice(0, 96);
  return normalized.length === 0 ? "platform-manual" : normalized;
}
