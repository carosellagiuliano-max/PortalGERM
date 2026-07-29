import "server-only";

import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";

type RecruitingPrivacyDatabase =
  | DatabaseClient
  | Prisma.TransactionClient;

export async function collectRecruitingPrivacyExportV1(
  database: RecruitingPrivacyDatabase,
  ownerUserId: string,
) {
  const profile = await database.candidateProfile.findUnique({
    where: { userId: ownerUserId },
    select: { id: true },
  });
  const [externalApplications, interviews] = await Promise.all([
    profile === null
      ? []
      : database.externalApplicationTracker.findMany({
          where: { candidateProfileId: profile.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            status: true,
            source: true,
            version: true,
            reminderAt: true,
            archivedAt: true,
            createdAt: true,
            updatedAt: true,
            snapshot: {
              select: {
                jobSlug: true,
                jobTitle: true,
                companyName: true,
                companySlug: true,
                applicationUrl: true,
                source: true,
                capturedAt: true,
              },
            },
            events: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                kind: true,
                fromStatus: true,
                toStatus: true,
                source: true,
                reasonCode: true,
                createdAt: true,
              },
            },
          },
        }),
    database.interview.findMany({
      where: { participants: { some: { userId: ownerUserId } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        applicationId: true,
        companyId: true,
        status: true,
        timeZone: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        activeProposalVersion: true,
        version: true,
        subject: true,
        location: true,
        cancelledAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
        proposals: {
          orderBy: [{ version: "asc" }, { slotIndex: "asc" }],
          select: {
            id: true,
            version: true,
            slotIndex: true,
            startsAt: true,
            endsAt: true,
            timeZone: true,
            status: true,
            expiresAt: true,
            createdAt: true,
          },
        },
        participants: {
          where: { userId: ownerUserId },
          select: {
            id: true,
            kind: true,
            status: true,
            required: true,
            respondedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        responses: {
          where: { participant: { userId: ownerUserId } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            proposalId: true,
            kind: true,
            requestedStartAt: true,
            requestedEndAt: true,
            requestedTimeZone: true,
            createdAt: true,
          },
        },
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            kind: true,
            proposalVersion: true,
            reasonCode: true,
            createdAt: true,
          },
        },
        calendarArtifacts: {
          orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            interviewVersion: true,
            uid: true,
            sequence: true,
            method: true,
            status: true,
            payloadHash: true,
            issuedAt: true,
            createdAt: true,
          },
        },
        reminders: {
          where: { recipientUserId: ownerUserId },
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            dueAt: true,
            status: true,
            queuedAt: true,
            cancelledAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
  ]);
  return Object.freeze({
    externalApplications: Object.freeze(externalApplications),
    interviews: Object.freeze(interviews),
  });
}

export async function applyRecruitingPrivacyErasureV1(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    userId: string;
    candidateProfileId: string | null;
    requestId: string;
    now: Date;
  }>,
) {
  const ownedInterviews = await transaction.interview.findMany({
    where: { participants: { some: { userId: input.userId } } },
    select: { id: true, status: true, version: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let cancelledInterviews = 0;
  for (const interview of ownedInterviews) {
    if (["CANCELLED", "COMPLETED", "DECLINED"].includes(interview.status)) {
      continue;
    }
    const queuedReminderOutboxIds =
      await transaction.interviewReminder.findMany({
        where: {
          interviewId: interview.id,
          status: { in: ["PENDING", "QUEUED"] },
          outboxId: { not: null },
        },
        select: { outboxId: true },
      });
    await transaction.interviewProposal.updateMany({
      where: { interviewId: interview.id, status: "OPEN" },
      data: { status: "CANCELLED" },
    });
    await transaction.interviewReminder.updateMany({
      where: {
        interviewId: interview.id,
        status: { in: ["PENDING", "QUEUED"] },
      },
      data: { status: "CANCELLED", cancelledAt: input.now, updatedAt: input.now },
    });
    const outboxIds = queuedReminderOutboxIds.flatMap(({ outboxId }) =>
      outboxId === null ? [] : [outboxId],
    );
    if (outboxIds.length > 0) {
      await transaction.notificationOutbox.updateMany({
        where: {
          id: { in: outboxIds },
          status: { in: ["PENDING", "RETRY", "PAUSED"] },
        },
        data: {
          status: "SUPPRESSED",
          suppressedAt: input.now,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        },
      });
    }
    await transaction.calendarArtifact.updateMany({
      where: { interviewId: interview.id, status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
    await transaction.interview.update({
      where: { id: interview.id },
      data: {
        status: "CANCELLED",
        version: interview.version + 1,
        cancelledAt: input.now,
        updatedByUserId: input.userId,
        updatedAt: input.now,
      },
    });
    await transaction.interviewEvent.create({
      data: {
        interviewId: interview.id,
        kind: "CANCELLED",
        actorUserId: null,
        reasonCode: "PRIVACY_ERASURE",
        idempotencyKey: `privacy:interview:${input.requestId}:${interview.id}`,
        correlationId: input.requestId,
        createdAt: input.now,
      },
    });
    cancelledInterviews += 1;
  }

  const externalTrackers =
    input.candidateProfileId === null
      ? []
      : await transaction.externalApplicationTracker.findMany({
          where: { candidateProfileId: input.candidateProfileId },
          select: { id: true, status: true, version: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
  let archivedExternalTrackers = 0;
  for (const tracker of externalTrackers) {
    if (tracker.status === "ARCHIVED") continue;
    await transaction.externalApplicationTracker.update({
      where: { id: tracker.id },
      data: {
        status: "ARCHIVED",
        reminderAt: null,
        archivedAt: input.now,
        version: tracker.version + 1,
        updatedAt: input.now,
      },
    });
    await transaction.externalApplicationEvent.create({
      data: {
        trackerId: tracker.id,
        kind: "ARCHIVED",
        fromStatus: tracker.status,
        toStatus: "ARCHIVED",
        source: "CANDIDATE_CONFIRMED",
        actorUserId: input.userId,
        reasonCode: "PRIVACY_ERASURE",
        idempotencyKey: `privacy:external:${input.requestId}:${tracker.id}`,
        correlationId: input.requestId,
        createdAt: input.now,
      },
    });
    archivedExternalTrackers += 1;
  }
  return Object.freeze({
    ownedInterviews: ownedInterviews.length,
    cancelledInterviews,
    externalTrackers: externalTrackers.length,
    archivedExternalTrackers,
  });
}
