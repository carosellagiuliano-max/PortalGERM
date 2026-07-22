import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";

const JOB_AUDIT_RETENTION_MILLISECONDS = 365 * 86_400_000;
const JOB_EXPIRY_BATCH_SIZE = 200;

export const JOB_EXPIRY_EVENT_KEY_VERSION = "job-expiry:v1";

export type JobExpiryProjectionSnapshot = Readonly<{
  status: string;
  currentRevisionId: string | null;
  publishedRevisionId: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  publishedRevision: Readonly<{
    id: string;
    approvedAt: Date | null;
    rejectedAt: Date | null;
    validThrough: Date | null;
  }> | null;
}>;

export type JobExpiryProjectionDecision =
  | "DUE"
  | "INCONSISTENT"
  | "NOT_DUE";

export type JobStatusProjectionResult = Readonly<{
  examined: number;
  expired: number;
  skippedInconsistent: number;
  failed: number;
}>;

export function getJobExpiryProjectionDecision(
  snapshot: JobExpiryProjectionSnapshot,
  now: Date,
): JobExpiryProjectionDecision {
  assertValidDate(now, "Job status projection requires a valid clock.");

  if (snapshot.status !== "PUBLISHED" || snapshot.expiresAt === null) {
    return "NOT_DUE";
  }
  if (!Number.isFinite(snapshot.expiresAt.getTime())) {
    return "INCONSISTENT";
  }
  if (snapshot.expiresAt.getTime() > now.getTime()) {
    return "NOT_DUE";
  }

  const revision = snapshot.publishedRevision;
  if (
    revision === null ||
    snapshot.currentRevisionId === null ||
    snapshot.publishedRevisionId === null ||
    snapshot.currentRevisionId !== snapshot.publishedRevisionId ||
    snapshot.publishedRevisionId !== revision.id ||
    snapshot.publishedAt === null ||
    !Number.isFinite(snapshot.publishedAt.getTime()) ||
    snapshot.publishedAt.getTime() >= snapshot.expiresAt.getTime() ||
    revision.approvedAt === null ||
    !Number.isFinite(revision.approvedAt.getTime()) ||
    revision.rejectedAt !== null ||
    revision.validThrough === null ||
    !Number.isFinite(revision.validThrough.getTime()) ||
    revision.validThrough.getTime() !== snapshot.expiresAt.getTime()
  ) {
    return "INCONSISTENT";
  }

  return "DUE";
}

export function jobExpiryEventIdempotencyKey(
  jobId: string,
  publishedRevisionId: string,
): string {
  return `${JOB_EXPIRY_EVENT_KEY_VERSION}:${jobId}:${publishedRevisionId}`;
}

/**
 * Explicit operations command for persisting effective Job expiry. Public GET
 * paths must keep using the effective eligibility predicate and never call this
 * projector. A status row, its canonical event and the required SYSTEM audit
 * are committed atomically for each coherent due Job.
 */
export async function syncJobStatusProjection(input: Readonly<{
  database: DatabaseClient;
  correlationId: string;
  now: Date;
}>): Promise<JobStatusProjectionResult> {
  const now = new Date(input.now);
  assertValidDate(now, "Job status projection requires a valid clock.");
  if (!z.uuid().safeParse(input.correlationId).success) {
    throw new TypeError("Job status projection requires a valid correlation id.");
  }

  let examined = 0;
  let expired = 0;
  let skippedInconsistent = 0;
  let failed = 0;
  let after: Readonly<{ expiresAt: Date; id: string }> | null = null;

  while (true) {
    const candidates: Array<{ id: string; expiresAt: Date | null }> =
      await input.database.job.findMany({
        where: {
          status: "PUBLISHED",
          expiresAt: { lte: now },
          ...(after === null
            ? {}
            : {
                OR: [
                  { expiresAt: { gt: after.expiresAt } },
                  { expiresAt: after.expiresAt, id: { gt: after.id } },
                ],
              }),
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: JOB_EXPIRY_BATCH_SIZE,
        select: { id: true, expiresAt: true },
      });
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      examined += 1;
      try {
        const result = await projectOneDueJob(input, candidate.id, now);
        if (result === "EXPIRED") expired += 1;
        if (result === "INCONSISTENT") skippedInconsistent += 1;
      } catch {
        // Required evidence is atomic with the state transition. A failed row
        // remains PUBLISHED and due for a later operational retry without
        // starving later Jobs in the deterministic keyset walk.
        failed += 1;
      }
    }

    const last: { id: string; expiresAt: Date | null } | undefined =
      candidates.at(-1);
    if (
      candidates.length < JOB_EXPIRY_BATCH_SIZE ||
      last === undefined ||
      last.expiresAt === null
    ) {
      break;
    }
    after = { expiresAt: last.expiresAt, id: last.id };
  }

  return Object.freeze({
    examined,
    expired,
    skippedInconsistent,
    failed,
  });
}

async function projectOneDueJob(
  input: Readonly<{
    database: DatabaseClient;
    correlationId: string;
  }>,
  jobId: string,
  now: Date,
): Promise<"EXPIRED" | "INCONSISTENT" | "NOT_DUE"> {
  return input.database.$transaction(
    async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "Job"
          WHERE "id" = ${jobId}::uuid
          FOR UPDATE
        `,
      );
      if (locked.length !== 1) return "NOT_DUE";

      const job = await transaction.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          companyId: true,
          status: true,
          version: true,
          currentRevisionId: true,
          publishedRevisionId: true,
          publishedAt: true,
          expiresAt: true,
          publishedRevision: {
            select: {
              id: true,
              approvedAt: true,
              rejectedAt: true,
              validThrough: true,
            },
          },
        },
      });
      if (job === null) return "NOT_DUE";

      const decision = getJobExpiryProjectionDecision(job, now);
      if (decision !== "DUE") return decision;

      const revisionId = job.publishedRevisionId;
      const expiresAt = job.expiresAt;
      if (revisionId === null || expiresAt === null) return "INCONSISTENT";
      const eventKey = jobExpiryEventIdempotencyKey(job.id, revisionId);
      const existingEvent = await transaction.jobStatusEvent.findUnique({
        where: { idempotencyKey: eventKey },
        select: { id: true },
      });
      if (existingEvent !== null) return "INCONSISTENT";

      const changed = await transaction.job.updateMany({
        where: {
          id: job.id,
          status: "PUBLISHED",
          version: job.version,
          currentRevisionId: revisionId,
          publishedRevisionId: revisionId,
          expiresAt,
        },
        data: { status: "EXPIRED", version: { increment: 1 } },
      });
      if (changed.count !== 1) return "NOT_DUE";

      await transaction.jobStatusEvent.create({
        data: {
          id: randomUUID(),
          jobId: job.id,
          jobRevisionId: revisionId,
          kind: "EXPIRED",
          fromStatus: "PUBLISHED",
          toStatus: "EXPIRED",
          actorUserId: null,
          reasonCode: "VALID_THROUGH_REACHED",
          idempotencyKey: eventKey,
          correlationId: input.correlationId,
          createdAt: now,
        },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "JOB_EXPIRED",
        actorKind: "SYSTEM",
        capability: "SYSTEM_JOB_EXPIRY_PROJECT",
        companyId: job.companyId,
        correlationId: input.correlationId,
        reasonCode: "VALID_THROUGH_REACHED",
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + JOB_AUDIT_RETENTION_MILLISECONDS),
        targetId: job.id,
        targetType: "JOB",
      });

      return "EXPIRED";
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

function assertValidDate(value: Date, message: string): void {
  if (!Number.isFinite(value.getTime())) throw new TypeError(message);
}
