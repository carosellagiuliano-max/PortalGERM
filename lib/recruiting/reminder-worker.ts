import "server-only";

import { randomUUID } from "node:crypto";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { enqueueNotification } from "@/lib/notifications/outbox";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import {
  isRecruitingFeatureAvailableV1,
} from "@/lib/recruiting/feature-gates";
import { formatInTimeZone } from "@/lib/recruiting/time-zones";

const DAY = 86_400_000;
const AUDIT_RETENTION = 400 * DAY;
const BATCH_SIZE = 100;

export async function processRecruitingReminderExpiry(
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    now: Date;
  }>,
) {
  const externalEnabled = isRecruitingFeatureAvailableV1(
    dependencies.environment,
    "external_application_tracker",
  );
  const interviewEnabled = isRecruitingFeatureAvailableV1(
    dependencies.environment,
    "interview_scheduler",
  );
  if (!externalEnabled && !interviewEnabled) {
    return summary(0, 0, 0);
  }
  return dependencies.database.$transaction(async (transaction) => {
    const externalReminders = externalEnabled
      ? await processExternalReminders(
          transaction,
          dependencies.environment,
          dependencies.now,
        )
      : 0;
    const interviewReminders = interviewEnabled
      ? await processInterviewReminders(
          transaction,
          dependencies.environment,
          dependencies.now,
        )
      : 0;
    const expiredProposals = interviewEnabled
      ? await expireInterviewProposals(transaction, dependencies.now)
      : 0;
    return summary(externalReminders, interviewReminders, expiredProposals);
  });
}

async function processExternalReminders(
  transaction: Prisma.TransactionClient,
  environment: ServerEnvironment,
  now: Date,
) {
  const rows = await transaction.externalApplicationTracker.findMany({
    where: {
      reminderAt: { lte: now },
      status: { notIn: ["HIRED", "REJECTED", "WITHDRAWN", "ARCHIVED"] },
      candidateProfile: { user: { status: "ACTIVE" } },
    },
    orderBy: [{ reminderAt: "asc" }, { id: "asc" }],
    take: BATCH_SIZE,
    select: {
      id: true,
      status: true,
      version: true,
      reminderAt: true,
      candidateProfile: { select: { userId: true } },
      snapshot: { select: { jobTitle: true, companyName: true } },
    },
  });
  let processed = 0;
  for (const row of rows) {
    if (row.reminderAt === null || row.snapshot === null) continue;
    const updated = await transaction.externalApplicationTracker.updateMany({
      where: {
        id: row.id,
        version: row.version,
        reminderAt: row.reminderAt,
      },
      data: { reminderAt: null, version: { increment: 1 }, updatedAt: now },
    });
    if (updated.count !== 1) continue;
    const dedupeKey = `external-reminder:${row.id}:${row.reminderAt.toISOString()}`;
    await transaction.externalApplicationEvent.create({
      data: {
        trackerId: row.id,
        kind: "REMINDER_CHANGED",
        source: "CANDIDATE_CONFIRMED",
        actorUserId: row.candidateProfile.userId,
        reasonCode: "REMINDER_DELIVERED",
        idempotencyKey: dedupeKey,
        correlationId: randomUUID(),
        createdAt: now,
      },
    });
    await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
      recipientUserId: row.candidateProfile.userId,
      kind: "EXTERNAL_APPLICATION_CHANGED",
      dedupeKey,
      payload: {
        trackerId: row.id,
        status: row.status,
        reasonCode: "REMINDER_DUE",
      },
    });
    if (environment.NOTIFICATION_OUTBOX_PRODUCERS) {
      await enqueueNotification(transaction, {
        recipient: { userId: row.candidateProfile.userId },
        templateKey: "external_application_reminder",
        payloadSchemaVersion: "external-application-reminder-v1",
        payload: {
          trackerId: row.id,
          jobTitle: row.snapshot.jobTitle,
          companyName: row.snapshot.companyName,
        },
        dedupeKey: `email:${dedupeKey}`.slice(0, 160),
        availableAt: now,
      });
    }
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "EXTERNAL_APPLICATION_REMINDER_CHANGED",
      actorKind: "SYSTEM",
      capability: "SYSTEM_RECRUITING_REMINDER",
      correlationId: randomUUID(),
      result: "SUCCEEDED",
      retainUntil: new Date(now.getTime() + AUDIT_RETENTION),
      targetId: row.id,
      targetType: "EXTERNAL_APPLICATION_TRACKER",
    });
    processed += 1;
  }
  return processed;
}

async function processInterviewReminders(
  transaction: Prisma.TransactionClient,
  environment: ServerEnvironment,
  now: Date,
) {
  const rows = await transaction.interviewReminder.findMany({
    where: {
      status: "PENDING",
      dueAt: { lte: now },
      interview: {
        status: "SCHEDULED",
        scheduledStartAt: { gt: now },
      },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: BATCH_SIZE,
    select: {
      id: true,
      interviewId: true,
      recipientUserId: true,
      dedupeKey: true,
      interview: {
        select: {
          status: true,
          scheduledStartAt: true,
          timeZone: true,
          application: {
            select: { submittedJobRevision: { select: { title: true } } },
          },
        },
      },
    },
  });
  let processed = 0;
  for (const row of rows) {
    if (row.interview.scheduledStartAt === null) continue;
    const updated = await transaction.interviewReminder.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "QUEUED", queuedAt: now, updatedAt: now },
    });
    if (updated.count !== 1) continue;
    await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
      recipientUserId: row.recipientUserId,
      kind: "INTERVIEW_REMINDER",
      dedupeKey: row.dedupeKey,
      payload: { interviewId: row.interviewId, status: "REMINDER" },
    });
    let outboxId: string | null = null;
    if (environment.NOTIFICATION_OUTBOX_PRODUCERS) {
      const outbox = await enqueueNotification(transaction, {
        recipient: { userId: row.recipientUserId },
        templateKey: "interview_reminder",
        payloadSchemaVersion: "interview-reminder-v1",
        payload: {
          interviewId: row.interviewId,
          jobTitle: row.interview.application.submittedJobRevision.title,
          timeLabel: formatInTimeZone(
            row.interview.scheduledStartAt,
            row.interview.timeZone,
          ),
        },
        dedupeKey: `email:${row.dedupeKey}`.slice(0, 160),
        availableAt: now,
      });
      outboxId = outbox.id;
      await transaction.interviewReminder.update({
        where: { id: row.id },
        data: { outboxId, updatedAt: now },
      });
    }
    await transaction.interviewEvent.create({
      data: {
        interviewId: row.interviewId,
        kind: "REMINDER_QUEUED",
        actorUserId: null,
        idempotencyKey: `event:${row.dedupeKey}`.slice(0, 160),
        correlationId: randomUUID(),
        createdAt: now,
      },
    });
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "INTERVIEW_REMINDER_PROCESSED",
      actorKind: "SYSTEM",
      capability: "SYSTEM_RECRUITING_REMINDER",
      correlationId: randomUUID(),
      result: "SUCCEEDED",
      retainUntil: new Date(now.getTime() + AUDIT_RETENTION),
      targetId: row.interviewId,
      targetType: "INTERVIEW",
    });
    processed += 1;
  }
  return processed;
}

async function expireInterviewProposals(
  transaction: Prisma.TransactionClient,
  now: Date,
) {
  const proposals = await transaction.interviewProposal.findMany({
    where: { status: "OPEN", expiresAt: { lte: now } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: BATCH_SIZE,
    select: {
      id: true,
      interviewId: true,
      version: true,
      interview: {
        select: {
          status: true,
          activeProposalVersion: true,
          scheduledStartAt: true,
        },
      },
    },
  });
  let expired = 0;
  for (const proposal of proposals) {
    const updated = await transaction.interviewProposal.updateMany({
      where: { id: proposal.id, status: "OPEN", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });
    if (updated.count !== 1) continue;
    const openCount = await transaction.interviewProposal.count({
      where: {
        interviewId: proposal.interviewId,
        version: proposal.version,
        status: "OPEN",
      },
    });
    if (
      openCount === 0 &&
      proposal.version === proposal.interview.activeProposalVersion &&
      ["PROPOSED", "RESCHEDULE_PENDING"].includes(proposal.interview.status)
    ) {
      await transaction.interview.update({
        where: { id: proposal.interviewId },
        data: {
          status:
            proposal.interview.scheduledStartAt === null
              ? "DECLINED"
              : "SCHEDULED",
          activeProposalVersion:
            proposal.interview.scheduledStartAt === null
              ? proposal.interview.activeProposalVersion
              : Math.max(1, proposal.interview.activeProposalVersion - 1),
          version: { increment: 1 },
          updatedAt: now,
        },
      });
      await transaction.interviewEvent.create({
        data: {
          interviewId: proposal.interviewId,
          kind: "DECLINED",
          actorUserId: null,
          proposalVersion: proposal.version,
          reasonCode: "PROPOSAL_EXPIRED",
          idempotencyKey: `interview:expiry:${proposal.interviewId}:v${proposal.version}`,
          correlationId: randomUUID(),
          createdAt: now,
        },
      });
    }
    expired += 1;
  }
  return expired;
}

function summary(
  externalReminders: number,
  interviewReminders: number,
  expiredProposals: number,
) {
  return Object.freeze({
    externalReminders,
    interviewReminders,
    expiredProposals,
  });
}
