import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  Prisma,
  type InterviewStatus,
} from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { enqueueNotification } from "@/lib/notifications/outbox";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import {
  isRecruitingFeatureAvailableV1,
  RECRUITING_FEATURE_UNAVAILABLE,
} from "@/lib/recruiting/feature-gates";
import {
  hashInterviewCalendarV1,
  renderInterviewCalendarV1,
} from "@/lib/recruiting/ics";
import {
  formatInTimeZone,
  isIanaTimeZone,
} from "@/lib/recruiting/time-zones";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";

const MINUTE = 60_000;
const DAY = 86_400_000;
const AUDIT_RETENTION = 400 * DAY;
const MAXIMUM_SCHEDULE_HORIZON = 366 * DAY;

export const INTERVIEW_STATUS_LABELS_V1 = Object.freeze({
  PROPOSED: "Vorgeschlagen",
  SCHEDULED: "Bestätigt",
  RESCHEDULE_PENDING: "Neue Zeit vorgeschlagen",
  DECLINED: "Abgelehnt",
  CANCELLED: "Abgesagt",
  COMPLETED: "Abgeschlossen",
} satisfies Record<InterviewStatus, string>);

export type InterviewEmployerAccess = Readonly<{
  companyId: string;
  membershipId: string;
  userId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
}>;

type Dependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: AuthRequestContext;
  now?: Date;
}>;

type InterviewFailureCode =
  | typeof RECRUITING_FEATURE_UNAVAILABLE
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "EXPIRED"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_CONFLICT"
  | "WRITE_FAILED";

const slotSchema = z.strictObject({
  startsAt: z.date(),
  endsAt: z.date(),
});
const createSchema = z.strictObject({
  applicationId: z.uuid(),
  timeZone: z.string().min(3).max(64),
  subject: z.string().trim().min(2).max(200),
  location: z.string().trim().max(300).optional(),
  slots: z.array(slotSchema).min(1).max(20),
  idempotencyKey: z.string().trim().min(8).max(128),
});
const respondSchema = z
  .strictObject({
    actorUserId: z.uuid(),
    interviewId: z.uuid(),
    kind: z.enum(["ACCEPT", "DECLINE", "RESCHEDULE"]),
    proposalId: z.uuid().optional(),
    requestedStartsAt: z.date().optional(),
    requestedEndsAt: z.date().optional(),
    requestedTimeZone: z.string().min(3).max(64).optional(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .superRefine((value, context) => {
    if (
      (value.kind === "ACCEPT" || value.kind === "DECLINE") &&
      value.proposalId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposalId"],
        message: "A proposal is required.",
      });
    }
    const requested = [
      value.requestedStartsAt,
      value.requestedEndsAt,
      value.requestedTimeZone,
    ];
    if (
      value.kind === "RESCHEDULE"
        ? requested.some((item) => item === undefined)
        : requested.some((item) => item !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestedStartsAt"],
        message: "Reschedule fields must be supplied together.",
      });
    }
  });
const cancelSchema = z.strictObject({
  actorUserId: z.uuid(),
  interviewId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export async function proposeInterview(
  access: InterviewEmployerAccess,
  rawInput: unknown,
  dependencies: Dependencies,
) {
  const input = createSchema.safeParse(rawInput);
  const now = dependencies.now ?? new Date();
  if (
    !input.success ||
    !validDate(now) ||
    access.membershipRole === "VIEWER" ||
    !isIanaTimeZone(input.success ? input.data.timeZone : "")
  ) {
    return failure("INVALID_INPUT");
  }
  if (
    !isRecruitingFeatureAvailableV1(
      dependencies.environment,
      "interview_scheduler",
    )
  ) {
    return failure(RECRUITING_FEATURE_UNAVAILABLE);
  }
  const slots = canonicalSlots(input.data.slots, input.data.timeZone, now);
  const subject = sanitizeText(input.data.subject, 200);
  const location =
    input.data.location === undefined
      ? null
      : sanitizeText(input.data.location, 300);
  if (
    slots === null ||
    subject === null ||
    (input.data.location !== undefined && location === null)
  ) {
    return failure("INVALID_INPUT");
  }
  try {
    // Resolve the target through the current Company membership/assignment
    // before consuming a target-scoped bucket. An attacker therefore cannot
    // use foreign Application IDs to spend another tenant's rate budget.
    const authorizedApplication = await loadAuthorizedApplication(
      dependencies.database,
      input.data.applicationId,
      access,
      now,
    );
    if (authorizedApplication === null) return failure("NOT_FOUND");

    const key = eventKey("interview:propose", input.data.idempotencyKey);
    const replay = await dependencies.database.interviewEvent.findUnique({
      where: { idempotencyKey: key },
      select: {
        interview: {
          select: {
            id: true,
            applicationId: true,
            companyId: true,
            status: true,
            version: true,
          },
        },
      },
    });
    if (replay !== null) {
      return replay.interview.applicationId === authorizedApplication.id &&
        replay.interview.companyId === authorizedApplication.companyId
        ? success(replay.interview, true)
        : failure("IDEMPOTENCY_CONFLICT");
    }

    const rate = await consumeRequestRateLimit(
      "INTERVIEW_PROPOSE",
      {
        actorId: access.userId,
        userId: access.userId,
        companyId: authorizedApplication.companyId,
        targetId: authorizedApplication.id,
      },
      dependencies.request,
      now,
      {
        database: dependencies.database,
        environment: dependencies.environment,
      },
    );
    if (!rate.allowed) {
      await recordRateLimitDenial(
        rate.audit,
        {
          actorKind: "USER",
          actorUserId: access.userId,
          capability: "COMPANY_INTERVIEW_MANAGE",
          companyId: authorizedApplication.companyId,
          targetId: authorizedApplication.id,
          targetType: "APPLICATION",
        },
        {
          database: dependencies.database,
          environment: dependencies.environment,
          request: dependencies.request,
          now,
        },
      );
      return failure("RATE_LIMITED");
    }

    return await runSerializable(dependencies.database, async (transaction) => {
      const replay = await transaction.interviewEvent.findUnique({
        where: { idempotencyKey: key },
        select: {
          interview: {
            select: {
              id: true,
              applicationId: true,
              companyId: true,
              status: true,
              version: true,
            },
          },
        },
      });
      if (replay !== null) {
        return replay.interview.applicationId === input.data.applicationId &&
          replay.interview.companyId === access.companyId
          ? success(replay.interview, true)
          : failure("IDEMPOTENCY_CONFLICT");
      }
      const application = await loadAuthorizedApplication(
        transaction,
        input.data.applicationId,
        access,
        now,
      );
      if (application === null) return failure("NOT_FOUND");
      const interview = await transaction.interview.create({
        data: {
          applicationId: application.id,
          companyId: application.companyId,
          candidateProfileId: application.candidateProfileId,
          status: "PROPOSED",
          timeZone: input.data.timeZone,
          activeProposalVersion: 1,
          version: 1,
          subject,
          location,
          createdByUserId: access.userId,
          updatedByUserId: access.userId,
          createdAt: now,
          updatedAt: now,
          participants: {
            create: [
              {
                userId: application.candidateUserId,
                kind: "CANDIDATE",
                status: "PENDING",
                required: true,
                createdAt: now,
              },
              {
                userId: access.userId,
                kind: "COMPANY_MEMBER",
                status: "ACCEPTED",
                required: true,
                respondedAt: now,
                createdAt: now,
              },
            ],
          },
          proposals: {
            create: slots.map((slot, index) => ({
              version: 1,
              slotIndex: index + 1,
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
              timeZone: input.data.timeZone,
              status: "OPEN" as const,
              createdByUserId: access.userId,
              expiresAt: proposalExpiry(now, slot.startsAt),
              createdAt: now,
            })),
          },
          events: {
            create: {
              kind: "PROPOSED",
              actorUserId: access.userId,
              proposalVersion: 1,
              idempotencyKey: key,
              correlationId: dependencies.request.correlationId,
              createdAt: now,
            },
          },
        },
        select: {
          id: true,
          applicationId: true,
          companyId: true,
          status: true,
          version: true,
        },
      });
      await notifyInterviewParticipants(
        transaction,
        {
          interviewId: interview.id,
          recipients: [application.candidateUserId],
          status: interview.status,
          jobTitle: application.jobTitle,
          timeLabel: formatInTimeZone(
            slots[0]!.startsAt,
            input.data.timeZone,
          ),
          dedupeKey: key,
        },
        dependencies.environment,
        now,
      );
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "INTERVIEW_PROPOSED",
        actorKind: "USER",
        actorUserId: access.userId,
        capability: "COMPANY_INTERVIEW_MANAGE",
        companyId: access.companyId,
        correlationId: dependencies.request.correlationId,
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + AUDIT_RETENTION),
        targetId: interview.id,
        targetType: "INTERVIEW",
      });
      return success(interview, false);
    });
  } catch {
    return failure("WRITE_FAILED");
  }
}

export async function respondToInterview(
  rawInput: unknown,
  dependencies: Dependencies,
) {
  const input = respondSchema.safeParse(rawInput);
  const now = dependencies.now ?? new Date();
  if (!input.success || !validDate(now)) return failure("INVALID_INPUT");
  if (
    !isRecruitingFeatureAvailableV1(
      dependencies.environment,
      "interview_scheduler",
    )
  ) {
    return failure(RECRUITING_FEATURE_UNAVAILABLE);
  }
  if (
    input.data.kind === "RESCHEDULE" &&
    (!isIanaTimeZone(input.data.requestedTimeZone!) ||
      !validSlot(
        input.data.requestedStartsAt!,
        input.data.requestedEndsAt!,
        now,
      ))
  ) {
    return failure("INVALID_INPUT");
  }
  try {
    return await runSerializable(dependencies.database, async (transaction) => {
      const key = eventKey("interview:response", input.data.idempotencyKey);
      const existing = await transaction.interviewResponse.findUnique({
        where: { idempotencyKey: key },
        select: {
          interviewId: true,
          proposalId: true,
          kind: true,
          interview: { select: { status: true, version: true } },
        },
      });
      if (existing !== null) {
        return existing.interviewId === input.data.interviewId &&
          existing.kind === input.data.kind &&
          existing.proposalId === (input.data.proposalId ?? null)
          ? Object.freeze({
              ok: true as const,
              replay: true,
              interviewId: existing.interviewId,
              status: existing.interview.status,
              version: existing.interview.version,
            })
          : failure("IDEMPOTENCY_CONFLICT");
      }
      const loaded = await loadInterviewForActor(
        transaction,
        input.data.interviewId,
        input.data.actorUserId,
        now,
      );
      if (loaded === null) return failure("NOT_FOUND");
      await transaction.$queryRaw`
        SELECT "id" FROM "Interview"
        WHERE "id" = ${loaded.id}::uuid FOR UPDATE
      `;
      const current = await transaction.interview.findUniqueOrThrow({
        where: { id: loaded.id },
        select: {
          id: true,
          status: true,
          version: true,
          activeProposalVersion: true,
          scheduledStartAt: true,
          scheduledEndAt: true,
          timeZone: true,
          subject: true,
          location: true,
        },
      });
      if (current.version !== input.data.expectedVersion) return failure("CONFLICT");
      if (["CANCELLED", "COMPLETED", "DECLINED"].includes(current.status)) {
        return failure("CONFLICT");
      }
      const participant = await ensureParticipant(
        transaction,
        loaded,
        input.data.actorUserId,
        now,
      );
      if (participant === null) return failure("FORBIDDEN");
      const proposal =
        input.data.proposalId === undefined
          ? null
          : await transaction.interviewProposal.findFirst({
              where: {
                id: input.data.proposalId,
                interviewId: current.id,
              },
              select: {
                id: true,
                version: true,
                startsAt: true,
                endsAt: true,
                timeZone: true,
                status: true,
                expiresAt: true,
              },
            });
      if (input.data.kind !== "RESCHEDULE" && proposal === null) {
        return failure("NOT_FOUND");
      }
      if (input.data.kind === "ACCEPT") {
        if (
          proposal!.version !== current.activeProposalVersion ||
          proposal!.status !== "OPEN" ||
          proposal!.expiresAt <= now
        ) {
          return proposal!.expiresAt <= now ? failure("EXPIRED") : failure("CONFLICT");
        }
        const nextVersion = current.version + 1;
        await transaction.interviewResponse.create({
          data: {
            interviewId: current.id,
            proposalId: proposal!.id,
            participantId: participant.id,
            kind: "ACCEPT",
            idempotencyKey: key,
            createdAt: now,
          },
        });
        await transaction.interviewParticipant.update({
          where: { id: participant.id },
          data: { status: "ACCEPTED", respondedAt: now, updatedAt: now },
        });
        await transaction.interviewProposal.update({
          where: { id: proposal!.id },
          data: { status: "ACCEPTED" },
        });
        await transaction.interviewProposal.updateMany({
          where: {
            interviewId: current.id,
            version: current.activeProposalVersion,
            id: { not: proposal!.id },
            status: "OPEN",
          },
          data: { status: "SUPERSEDED" },
        });
        await transaction.interviewReminder.updateMany({
          where: { interviewId: current.id, status: "PENDING" },
          data: { status: "CANCELLED", cancelledAt: now, updatedAt: now },
        });
        await transaction.calendarArtifact.updateMany({
          where: { interviewId: current.id, status: "ACTIVE" },
          data: { status: "SUPERSEDED" },
        });
        const updated = await transaction.interview.update({
          where: { id: current.id },
          data: {
            status: "SCHEDULED",
            scheduledStartAt: proposal!.startsAt,
            scheduledEndAt: proposal!.endsAt,
            timeZone: proposal!.timeZone,
            version: nextVersion,
            updatedByUserId: input.data.actorUserId,
            updatedAt: now,
          },
          select: { id: true, status: true, version: true },
        });
        await createCalendarArtifact(transaction, {
          interviewId: current.id,
          interviewVersion: nextVersion,
          method: "REQUEST",
          startsAt: proposal!.startsAt,
          endsAt: proposal!.endsAt,
          subject: current.subject,
          location: current.location,
          now,
        });
        await createInterviewReminders(
          transaction,
          current.id,
          nextVersion,
          proposal!.startsAt,
          now,
        );
        await transaction.interviewEvent.create({
          data: {
            interviewId: current.id,
            kind:
              current.status === "RESCHEDULE_PENDING"
                ? "RESCHEDULED"
                : "ACCEPTED",
            actorUserId: input.data.actorUserId,
            proposalVersion: proposal!.version,
            idempotencyKey: eventKey("interview:event", input.data.idempotencyKey),
            correlationId: dependencies.request.correlationId,
            createdAt: now,
          },
        });
        await notifyOtherParticipants(
          transaction,
          loaded,
          input.data.actorUserId,
          updated.status,
          proposal!.startsAt,
          proposal!.timeZone,
          key,
          dependencies.environment,
          now,
        );
        await auditInterviewResponse(
          transaction,
          loaded,
          input.data.actorUserId,
          current.status === "RESCHEDULE_PENDING"
            ? "INTERVIEW_RESCHEDULED"
            : "INTERVIEW_RESPONDED",
          dependencies.request,
          now,
        );
        return success(updated, false);
      }
      if (input.data.kind === "DECLINE") {
        if (
          proposal!.version !== current.activeProposalVersion ||
          proposal!.status !== "OPEN"
        ) {
          return failure("CONFLICT");
        }
        await transaction.interviewResponse.create({
          data: {
            interviewId: current.id,
            proposalId: proposal!.id,
            participantId: participant.id,
            kind: "DECLINE",
            idempotencyKey: key,
            createdAt: now,
          },
        });
        await transaction.interviewParticipant.update({
          where: { id: participant.id },
          data: { status: "DECLINED", respondedAt: now, updatedAt: now },
        });
        await transaction.interviewProposal.updateMany({
          where: {
            interviewId: current.id,
            version: current.activeProposalVersion,
            status: "OPEN",
          },
          data: { status: "DECLINED" },
        });
        const retainOldAppointment =
          current.status === "RESCHEDULE_PENDING" &&
          current.scheduledStartAt !== null &&
          current.scheduledEndAt !== null;
        const updated = await transaction.interview.update({
          where: { id: current.id },
          data: {
            status: retainOldAppointment ? "SCHEDULED" : "DECLINED",
            activeProposalVersion: retainOldAppointment
              ? Math.max(1, current.activeProposalVersion - 1)
              : current.activeProposalVersion,
            version: { increment: 1 },
            updatedByUserId: input.data.actorUserId,
            updatedAt: now,
          },
          select: { id: true, status: true, version: true },
        });
        await transaction.interviewEvent.create({
          data: {
            interviewId: current.id,
            kind: "DECLINED",
            actorUserId: input.data.actorUserId,
            proposalVersion: proposal!.version,
            idempotencyKey: eventKey("interview:event", input.data.idempotencyKey),
            correlationId: dependencies.request.correlationId,
            createdAt: now,
          },
        });
        await notifyOtherParticipants(
          transaction,
          loaded,
          input.data.actorUserId,
          updated.status,
          retainOldAppointment
            ? (current.scheduledStartAt ?? proposal!.startsAt)
            : proposal!.startsAt,
          current.timeZone,
          key,
          dependencies.environment,
          now,
        );
        await auditInterviewResponse(
          transaction,
          loaded,
          input.data.actorUserId,
          "INTERVIEW_RESPONDED",
          dependencies.request,
          now,
        );
        return success(updated, false);
      }

      const requestedStartsAt = input.data.requestedStartsAt!;
      const requestedEndsAt = input.data.requestedEndsAt!;
      const requestedTimeZone = input.data.requestedTimeZone!;
      const nextProposalVersion = current.activeProposalVersion + 1;
      await transaction.interviewResponse.create({
        data: {
          interviewId: current.id,
          proposalId: proposal?.id,
          participantId: participant.id,
          kind: "RESCHEDULE",
          requestedStartAt: requestedStartsAt,
          requestedEndAt: requestedEndsAt,
          requestedTimeZone,
          idempotencyKey: key,
          createdAt: now,
        },
      });
      await transaction.interviewProposal.updateMany({
        where: { interviewId: current.id, status: "OPEN" },
        data: { status: "SUPERSEDED" },
      });
      await transaction.interviewProposal.create({
        data: {
          interviewId: current.id,
          version: nextProposalVersion,
          slotIndex: 1,
          startsAt: requestedStartsAt,
          endsAt: requestedEndsAt,
          timeZone: requestedTimeZone,
          status: "OPEN",
          createdByUserId: input.data.actorUserId,
          expiresAt: proposalExpiry(now, requestedStartsAt),
          createdAt: now,
        },
      });
      await transaction.interviewParticipant.update({
        where: { id: participant.id },
        data: { status: "ACCEPTED", respondedAt: now, updatedAt: now },
      });
      const updated = await transaction.interview.update({
        where: { id: current.id },
        data: {
          status: "RESCHEDULE_PENDING",
          activeProposalVersion: nextProposalVersion,
          version: { increment: 1 },
          updatedByUserId: input.data.actorUserId,
          updatedAt: now,
        },
        select: { id: true, status: true, version: true },
      });
      await transaction.interviewEvent.create({
        data: {
          interviewId: current.id,
          kind: "RESCHEDULE_REQUESTED",
          actorUserId: input.data.actorUserId,
          proposalVersion: nextProposalVersion,
          idempotencyKey: eventKey("interview:event", input.data.idempotencyKey),
          correlationId: dependencies.request.correlationId,
          createdAt: now,
        },
      });
      await notifyOtherParticipants(
        transaction,
        loaded,
        input.data.actorUserId,
        updated.status,
        requestedStartsAt,
        requestedTimeZone,
        key,
        dependencies.environment,
        now,
      );
      await auditInterviewResponse(
        transaction,
        loaded,
        input.data.actorUserId,
        "INTERVIEW_RESCHEDULED",
        dependencies.request,
        now,
      );
      return success(updated, false);
    });
  } catch {
    return failure("WRITE_FAILED");
  }
}

/**
 * Cancellation is intentionally still available after the kill switch. It can
 * only terminate an already-authorized persisted appointment and never creates
 * a new recruiting workflow.
 */
export async function cancelInterview(
  rawInput: unknown,
  dependencies: Dependencies,
) {
  const input = cancelSchema.safeParse(rawInput);
  const now = dependencies.now ?? new Date();
  if (!input.success || !validDate(now)) return failure("INVALID_INPUT");
  try {
    return await runSerializable(dependencies.database, async (transaction) => {
      const key = eventKey("interview:cancel", input.data.idempotencyKey);
      const replay = await transaction.interviewEvent.findUnique({
        where: { idempotencyKey: key },
        select: {
          interviewId: true,
          kind: true,
          interview: { select: { status: true, version: true } },
        },
      });
      if (replay !== null) {
        return replay.interviewId === input.data.interviewId &&
          replay.kind === "CANCELLED"
          ? Object.freeze({
              ok: true as const,
              replay: true,
              interviewId: replay.interviewId,
              status: replay.interview.status,
              version: replay.interview.version,
            })
          : failure("IDEMPOTENCY_CONFLICT");
      }
      const loaded = await loadInterviewForActor(
        transaction,
        input.data.interviewId,
        input.data.actorUserId,
        now,
      );
      if (loaded === null) return failure("NOT_FOUND");
      await transaction.$queryRaw`
        SELECT "id" FROM "Interview"
        WHERE "id" = ${loaded.id}::uuid FOR UPDATE
      `;
      const current = await transaction.interview.findUniqueOrThrow({
        where: { id: loaded.id },
        select: {
          id: true,
          status: true,
          version: true,
          scheduledStartAt: true,
          scheduledEndAt: true,
          subject: true,
          location: true,
        },
      });
      if (current.version !== input.data.expectedVersion) return failure("CONFLICT");
      if (current.status === "CANCELLED") return failure("CONFLICT");
      if (current.status === "COMPLETED") return failure("CONFLICT");
      const nextVersion = current.version + 1;
      await transaction.interviewProposal.updateMany({
        where: { interviewId: current.id, status: "OPEN" },
        data: { status: "CANCELLED" },
      });
      await transaction.interviewReminder.updateMany({
        where: { interviewId: current.id, status: "PENDING" },
        data: { status: "CANCELLED", cancelledAt: now, updatedAt: now },
      });
      await transaction.calendarArtifact.updateMany({
        where: { interviewId: current.id, status: "ACTIVE" },
        data: { status: "SUPERSEDED" },
      });
      if (
        current.scheduledStartAt !== null &&
        current.scheduledEndAt !== null
      ) {
        await createCalendarArtifact(transaction, {
          interviewId: current.id,
          interviewVersion: nextVersion,
          method: "CANCEL",
          startsAt: current.scheduledStartAt,
          endsAt: current.scheduledEndAt,
          subject: current.subject,
          location: current.location,
          now,
        });
      }
      const updated = await transaction.interview.update({
        where: { id: current.id },
        data: {
          status: "CANCELLED",
          version: nextVersion,
          cancelledAt: now,
          updatedByUserId: input.data.actorUserId,
          updatedAt: now,
        },
        select: { id: true, status: true, version: true },
      });
      await transaction.interviewEvent.create({
        data: {
          interviewId: current.id,
          kind: "CANCELLED",
          actorUserId: input.data.actorUserId,
          idempotencyKey: key,
          correlationId: dependencies.request.correlationId,
          createdAt: now,
        },
      });
      await notifyOtherParticipants(
        transaction,
        loaded,
        input.data.actorUserId,
        "CANCELLED",
        current.scheduledStartAt ?? now,
        loaded.timeZone,
        key,
        dependencies.environment,
        now,
      );
      await auditInterviewResponse(
        transaction,
        loaded,
        input.data.actorUserId,
        "INTERVIEW_CANCELLED",
        dependencies.request,
        now,
      );
      return success(updated, false);
    });
  } catch {
    return failure("WRITE_FAILED");
  }
}

export async function listCandidateInterviews(
  candidateUserId: string,
  dependencies: Pick<Dependencies, "database" | "environment">,
) {
  if (!z.uuid().safeParse(candidateUserId).success) {
    return Object.freeze([]);
  }
  return Object.freeze(
    await dependencies.database.interview.findMany({
      where: {
        candidateProfile: { userId: candidateUserId },
        participants: { some: { userId: candidateUserId, kind: "CANDIDATE" } },
      },
      orderBy: [
        { scheduledStartAt: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
        { id: "asc" },
      ],
      take: 200,
      select: interviewCardSelect,
    }),
  );
}

export async function getCandidateInterview(
  candidateUserId: string,
  interviewId: string,
  dependencies: Pick<Dependencies, "database" | "environment">,
) {
  if (
    !z.uuid().safeParse(candidateUserId).success ||
    !z.uuid().safeParse(interviewId).success
  ) {
    return null;
  }
  return dependencies.database.interview.findFirst({
    where: {
      id: interviewId,
      candidateProfile: { userId: candidateUserId },
      participants: { some: { userId: candidateUserId, kind: "CANDIDATE" } },
    },
    select: interviewDetailSelect,
  });
}

export async function listEmployerInterviews(
  applicationId: string,
  access: InterviewEmployerAccess,
  dependencies: Pick<Dependencies, "database" | "environment">,
  now = new Date(),
) {
  if (!z.uuid().safeParse(applicationId).success) {
    return null;
  }
  const application = await loadAuthorizedApplication(
    dependencies.database,
    applicationId,
    access,
    now,
  );
  if (application === null) return null;
  const interviews = await dependencies.database.interview.findMany({
    where: { applicationId: application.id, companyId: access.companyId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
    select: interviewCardSelect,
  });
  return Object.freeze({ application, interviews: Object.freeze(interviews) });
}

export async function getEmployerInterview(
  applicationId: string,
  interviewId: string,
  access: InterviewEmployerAccess,
  dependencies: Pick<Dependencies, "database" | "environment">,
  now = new Date(),
) {
  if (
    !z.uuid().safeParse(interviewId).success
  ) {
    return null;
  }
  const application = await loadAuthorizedApplication(
    dependencies.database,
    applicationId,
    access,
    now,
  );
  if (application === null) return null;
  return dependencies.database.interview.findFirst({
    where: {
      id: interviewId,
      applicationId: application.id,
      companyId: access.companyId,
    },
    select: interviewDetailSelect,
  });
}

export async function getInterviewCalendarForActor(
  interviewId: string,
  actorUserId: string,
  database: DatabaseClient,
  now = new Date(),
) {
  if (
    !z.uuid().safeParse(interviewId).success ||
    !z.uuid().safeParse(actorUserId).success
  ) {
    return null;
  }
  const interview = await database.interview.findUnique({
    where: { id: interviewId },
    select: {
      id: true,
      applicationId: true,
      companyId: true,
      candidateProfileId: true,
      candidateProfile: {
        select: {
          userId: true,
          user: { select: { status: true } },
        },
      },
      status: true,
      timeZone: true,
      subject: true,
      location: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      participants: {
        where: { userId: actorUserId },
        take: 1,
        select: { id: true, kind: true },
      },
      calendarArtifacts: {
        orderBy: [{ sequence: "desc" }, { createdAt: "desc" }],
        take: 20,
        select: {
          uid: true,
          sequence: true,
          method: true,
          payloadHash: true,
          issuedAt: true,
        },
      },
    },
  });
  if (
    interview === null ||
    interview.scheduledStartAt === null ||
    interview.scheduledEndAt === null ||
    interview.calendarArtifacts[0] === undefined
  ) {
    return null;
  }
  const participant = interview.participants[0];
  const candidateActor =
    participant?.kind === "CANDIDATE" &&
    interview.candidateProfile.userId === actorUserId &&
    interview.candidateProfile.user.status === "ACTIVE";
  const companyActor = candidateActor
    ? false
    : await hasCurrentCompanyApplicationAccess(
        database,
        interview.applicationId,
        interview.companyId,
        actorUserId,
        now,
      );
  if (!candidateActor && !companyActor) return null;
  const artifact = interview.calendarArtifacts.find(
    ({ method }) =>
      method ===
      (interview.status === "CANCELLED" ? "CANCEL" : "REQUEST"),
  );
  if (artifact === undefined) return null;
  const calendar = renderInterviewCalendarV1({
    uid: artifact.uid,
    sequence: artifact.sequence,
    method: artifact.method,
    issuedAt: artifact.issuedAt,
    startsAt: interview.scheduledStartAt,
    endsAt: interview.scheduledEndAt,
    subject: interview.subject,
    location: interview.location,
  });
  if (hashInterviewCalendarV1(calendar) !== artifact.payloadHash) return null;
  return Object.freeze({
    calendar,
    filename: `swisstalenthub-interview-${interview.id}.ics`,
  });
}

const interviewCardSelect = {
  id: true,
  applicationId: true,
  status: true,
  timeZone: true,
  scheduledStartAt: true,
  scheduledEndAt: true,
  version: true,
  subject: true,
  location: true,
  createdAt: true,
  updatedAt: true,
  application: {
    select: {
      submittedJobRevision: { select: { title: true } },
      submissionSnapshot: { select: { recipientCompanyName: true } },
    },
  },
} as const satisfies Prisma.InterviewSelect;

const interviewDetailSelect = {
  ...interviewCardSelect,
  activeProposalVersion: true,
  createdByUserId: true,
  updatedByUserId: true,
  cancelledAt: true,
  completedAt: true,
  proposals: {
    orderBy: [{ version: "desc" as const }, { slotIndex: "asc" as const }],
    take: 100,
    select: {
      id: true,
      version: true,
      slotIndex: true,
      startsAt: true,
      endsAt: true,
      timeZone: true,
      status: true,
      expiresAt: true,
      createdByUserId: true,
      createdAt: true,
    },
  },
  participants: {
    orderBy: [{ kind: "asc" as const }, { createdAt: "asc" as const }],
    take: 20,
    select: {
      id: true,
      userId: true,
      kind: true,
      status: true,
      required: true,
      respondedAt: true,
      user: { select: { name: true } },
    },
  },
  events: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 100,
    select: {
      id: true,
      kind: true,
      proposalVersion: true,
      reasonCode: true,
      createdAt: true,
    },
  },
  calendarArtifacts: {
    orderBy: [{ sequence: "desc" as const }, { createdAt: "desc" as const }],
    take: 20,
    select: {
      id: true,
      sequence: true,
      method: true,
      status: true,
      issuedAt: true,
    },
  },
  reminders: {
    orderBy: [{ dueAt: "desc" as const }, { id: "desc" as const }],
    take: 20,
    select: { id: true, dueAt: true, status: true, queuedAt: true },
  },
} as const satisfies Prisma.InterviewSelect;

async function loadAuthorizedApplication(
  database: DatabaseClient | Prisma.TransactionClient,
  applicationId: string,
  access: InterviewEmployerAccess,
  now: Date,
) {
  if (access.membershipRole === "VIEWER") return null;
  const membershipWhere = {
    id: access.membershipId,
    userId: access.userId,
    status: "ACTIVE" as const,
    removedAt: null,
    user: { status: "ACTIVE" as const },
  };
  return database.application.findFirst({
    where: {
      id: applicationId,
      job: {
        companyId: access.companyId,
        company: {
          status: "ACTIVE",
          memberships: {
            some:
              access.membershipRole === "OWNER" ||
              access.membershipRole === "ADMIN"
                ? { ...membershipWhere, role: access.membershipRole }
                : { ...membershipWhere, role: "RECRUITER" },
          },
        },
        ...(access.membershipRole === "RECRUITER"
          ? {
              assignments: {
                some: {
                  membershipId: access.membershipId,
                  companyId: access.companyId,
                  userId: access.userId,
                  role: { in: ["EDITOR", "PIPELINE"] as const },
                  status: "ACTIVE" as const,
                  revokedAt: null,
                  validFrom: { lte: now },
                  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                },
              },
            }
          : {}),
      },
    },
    select: {
      id: true,
      candidateProfileId: true,
      candidateProfile: { select: { userId: true } },
      submittedJobRevision: { select: { title: true } },
      job: { select: { companyId: true } },
    },
  }).then((row) =>
    row === null
      ? null
      : Object.freeze({
          id: row.id,
          candidateProfileId: row.candidateProfileId,
          candidateUserId: row.candidateProfile.userId,
          companyId: row.job.companyId,
          jobTitle: row.submittedJobRevision.title,
        }),
  );
}

async function loadInterviewForActor(
  transaction: Prisma.TransactionClient,
  interviewId: string,
  actorUserId: string,
  now: Date,
) {
  const row = await transaction.interview.findUnique({
    where: { id: interviewId },
    select: {
      id: true,
      applicationId: true,
      companyId: true,
      candidateProfileId: true,
      timeZone: true,
      application: {
        select: {
          submittedJobRevision: { select: { title: true } },
          candidateProfile: { select: { userId: true } },
        },
      },
      participants: {
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      },
    },
  });
  if (row === null) return null;
  if (row.application.candidateProfile.userId === actorUserId) return row;
  return (await hasCurrentCompanyApplicationAccess(
    transaction,
    row.applicationId,
    row.companyId,
    actorUserId,
    now,
  ))
    ? row
    : null;
}

async function hasCurrentCompanyApplicationAccess(
  database: DatabaseClient | Prisma.TransactionClient,
  applicationId: string,
  companyId: string,
  actorUserId: string,
  now: Date,
) {
  const membership = await database.companyMembership.findFirst({
    where: {
      companyId,
      userId: actorUserId,
      status: "ACTIVE",
      removedAt: null,
      user: { status: "ACTIVE" },
      company: { status: "ACTIVE" },
    },
    select: { id: true, role: true },
  });
  if (membership === null || membership.role === "VIEWER") return false;
  if (membership.role === "OWNER" || membership.role === "ADMIN") return true;
  return (
    (await database.application.count({
      where: {
        id: applicationId,
        job: {
          companyId,
          assignments: {
            some: {
              membershipId: membership.id,
              userId: actorUserId,
              status: "ACTIVE",
              role: { in: ["EDITOR", "PIPELINE"] },
              revokedAt: null,
              validFrom: { lte: now },
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          },
        },
      },
    })) === 1
  );
}

async function ensureParticipant(
  transaction: Prisma.TransactionClient,
  interview: NonNullable<Awaited<ReturnType<typeof loadInterviewForActor>>>,
  actorUserId: string,
  now: Date,
) {
  const existing = await transaction.interviewParticipant.findUnique({
    where: {
      interviewId_userId: { interviewId: interview.id, userId: actorUserId },
    },
    select: { id: true, kind: true, status: true },
  });
  if (existing !== null) return existing;
  if (
    !(await hasCurrentCompanyApplicationAccess(
      transaction,
      interview.applicationId,
      interview.companyId,
      actorUserId,
      now,
    ))
  ) {
    return null;
  }
  return transaction.interviewParticipant.create({
    data: {
      interviewId: interview.id,
      userId: actorUserId,
      kind: "COMPANY_MEMBER",
      status: "PENDING",
      required: true,
      createdAt: now,
    },
    select: { id: true, kind: true, status: true },
  });
}

async function createInterviewReminders(
  transaction: Prisma.TransactionClient,
  interviewId: string,
  interviewVersion: number,
  startsAt: Date,
  now: Date,
) {
  const participants = await transaction.interviewParticipant.findMany({
    where: { interviewId, status: { not: "DECLINED" } },
    orderBy: { userId: "asc" },
    select: { userId: true },
  });
  const dueAt = new Date(Math.max(now.getTime(), startsAt.getTime() - DAY));
  await transaction.interviewReminder.createMany({
    data: participants.map(({ userId }) => ({
      interviewId,
      recipientUserId: userId,
      dueAt,
      status: "PENDING" as const,
      dedupeKey: `interview:${interviewId}:v${interviewVersion}:${userId}:24h`,
      createdAt: now,
      updatedAt: now,
    })),
    skipDuplicates: true,
  });
}

async function createCalendarArtifact(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    interviewId: string;
    interviewVersion: number;
    method: "REQUEST" | "CANCEL";
    startsAt: Date;
    endsAt: Date;
    subject: string;
    location: string | null;
    now: Date;
  }>,
) {
  const uid = `${input.interviewId}@calendar.swisstalenthub.ch`;
  const calendar = renderInterviewCalendarV1({
    uid,
    sequence: input.interviewVersion,
    method: input.method,
    issuedAt: input.now,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    subject: input.subject,
    location: input.location,
  });
  return transaction.calendarArtifact.create({
    data: {
      interviewId: input.interviewId,
      interviewVersion: input.interviewVersion,
      uid,
      sequence: input.interviewVersion,
      method: input.method,
      status: input.method === "CANCEL" ? "CANCELLED" : "ACTIVE",
      payloadHash: hashInterviewCalendarV1(calendar),
      issuedAt: input.now,
      createdAt: input.now,
    },
  });
}

async function notifyOtherParticipants(
  transaction: Prisma.TransactionClient,
  interview: NonNullable<Awaited<ReturnType<typeof loadInterviewForActor>>>,
  actorUserId: string,
  status: InterviewStatus,
  instant: Date,
  timeZone: string,
  dedupeKey: string,
  environment: ServerEnvironment,
  now: Date,
) {
  await notifyInterviewParticipants(
    transaction,
    {
      interviewId: interview.id,
      recipients: interview.participants
        .map(({ userId }) => userId)
        .filter((userId) => userId !== actorUserId),
      status,
      jobTitle: interview.application.submittedJobRevision.title,
      timeLabel: formatInTimeZone(instant, timeZone),
      dedupeKey,
    },
    environment,
    now,
  );
}

async function notifyInterviewParticipants(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    interviewId: string;
    recipients: readonly string[];
    status: InterviewStatus;
    jobTitle: string;
    timeLabel: string;
    dedupeKey: string;
  }>,
  environment: ServerEnvironment,
  now: Date,
) {
  for (const recipientUserId of [...new Set(input.recipients)]) {
    await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
      recipientUserId,
      kind: "INTERVIEW_CHANGED",
      dedupeKey: input.dedupeKey,
      payload: { interviewId: input.interviewId, status: input.status },
    });
    if (environment.NOTIFICATION_OUTBOX_PRODUCERS) {
      await enqueueNotification(transaction, {
        recipient: { userId: recipientUserId },
        templateKey: "interview_changed",
        payloadSchemaVersion: "interview-change-v1",
        payload: {
          interviewId: input.interviewId,
          jobTitle: input.jobTitle,
          statusLabel: INTERVIEW_STATUS_LABELS_V1[input.status],
          timeLabel: input.timeLabel,
        },
        dedupeKey: `email:${input.dedupeKey}:${recipientUserId}`.slice(0, 160),
        availableAt: now,
      });
    }
  }
}

async function auditInterviewResponse(
  transaction: Prisma.TransactionClient,
  interview: NonNullable<Awaited<ReturnType<typeof loadInterviewForActor>>>,
  actorUserId: string,
  action:
    | "INTERVIEW_RESPONDED"
    | "INTERVIEW_RESCHEDULED"
    | "INTERVIEW_CANCELLED",
  request: AuthRequestContext,
  now: Date,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action,
    actorKind: "USER",
    actorUserId,
    capability:
      interview.application.candidateProfile.userId === actorUserId
        ? "CANDIDATE_INTERVIEW_RESPOND"
        : "COMPANY_INTERVIEW_MANAGE",
    companyId: interview.companyId,
    correlationId: request.correlationId,
    result: "SUCCEEDED",
    retainUntil: new Date(now.getTime() + AUDIT_RETENTION),
    targetId: interview.id,
    targetType: "INTERVIEW",
  });
}

function canonicalSlots(
  slots: readonly Readonly<{ startsAt: Date; endsAt: Date }>[],
  _timeZone: string,
  now: Date,
) {
  if (slots.some((slot) => !validSlot(slot.startsAt, slot.endsAt, now))) {
    return null;
  }
  const canonical = [...slots].sort(
    (left, right) =>
      left.startsAt.getTime() - right.startsAt.getTime() ||
      left.endsAt.getTime() - right.endsAt.getTime(),
  );
  const keys = canonical.map(
    ({ startsAt, endsAt }) => `${startsAt.toISOString()}/${endsAt.toISOString()}`,
  );
  return new Set(keys).size === keys.length ? Object.freeze(canonical) : null;
}

function validSlot(startsAt: Date, endsAt: Date, now: Date) {
  const duration = endsAt.getTime() - startsAt.getTime();
  return (
    validDate(startsAt) &&
    validDate(endsAt) &&
    startsAt.getTime() >= now.getTime() + 15 * MINUTE &&
    startsAt.getTime() <= now.getTime() + MAXIMUM_SCHEDULE_HORIZON &&
    duration >= 15 * MINUTE &&
    duration <= 12 * 60 * MINUTE
  );
}

function proposalExpiry(now: Date, startsAt: Date) {
  return new Date(Math.min(now.getTime() + 7 * DAY, startsAt.getTime() - MINUTE));
}

function sanitizeText(value: string, maximum: number): string | null {
  const safe = stripUnsafeHtml(value)
    .replaceAll(/[\u0000-\u001f\u007f]/gu, " ")
    .trim()
    .slice(0, maximum);
  return safe.length === 0 ? null : safe;
}

function eventKey(scope: string, key: string): string {
  return `${scope}:${createHash("sha256").update(key, "utf8").digest("hex")}`.slice(
    0,
    160,
  );
}

function success(
  interview: Readonly<{
    id: string;
    status: InterviewStatus;
    version: number;
  }>,
  replay: boolean,
) {
  return Object.freeze({
    ok: true as const,
    replay,
    interviewId: interview.id,
    status: interview.status,
    version: interview.version,
  });
}

function failure(code: InterviewFailureCode) {
  return Object.freeze({ ok: false as const, code });
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

async function runSerializable<T>(
  database: DatabaseClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("unreachable");
}
