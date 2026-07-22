import { randomUUID } from "node:crypto";

import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { writeRequiredAudit } from "@/lib/audit/log";
import { Prisma } from "@/lib/generated/prisma/client";
import { buildNotificationPersistenceRecord } from "@/lib/notifications/writer";

const AUDIT_RETENTION_MS = 10 * 365 * 24 * 60 * 60 * 1_000;

export type CandidateRadarLossReason =
  | "CANDIDATE_OPTED_OUT"
  | "CANDIDATE_PROFILE_INCOMPLETE"
  | "CANDIDATE_USER_UNAVAILABLE";
export type CompanyRadarLossReason =
  | "COMPANY_INACTIVE"
  | "COMPANY_VERIFICATION_LOST";
export type RadarEligibilityLossReason =
  | CandidateRadarLossReason
  | CompanyRadarLossReason;

type EffectActor = Readonly<{
  kind: "USER" | "SYSTEM";
  userId?: string;
}>;

export async function applyCandidateRadarEligibilityLoss(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    candidateProfileId: string;
    candidateUserId: string;
    reason: CandidateRadarLossReason;
    actor: EffectActor;
    correlationId: string;
    now: Date;
  }>,
) {
  await transaction.radarProfile.updateMany({
    where: {
      candidateProfileId: input.candidateProfileId,
      withdrawnAt: null,
    },
    data: { withdrawnAt: input.now, updatedAt: input.now },
  });
  const revokedMappings = await transaction.radarOpaqueMapping.updateMany({
    where: {
      candidateProfileId: input.candidateProfileId,
      revokedAt: null,
      validTo: { gt: input.now },
    },
    data: {
      revokedAt: input.now,
      revocationReason: input.reason,
    },
  });
  const cancelledRequests = await cancelPendingRequests(transaction, {
    where: { candidateProfileId: input.candidateProfileId },
    candidateUserId: input.candidateUserId,
    reason: input.reason,
    actor: input.actor,
    correlationId: input.correlationId,
    now: input.now,
  });
  return Object.freeze({
    revokedMappings: revokedMappings.count,
    cancelledRequests,
  });
}

export async function applyCompanyRadarEligibilityLoss(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    companyId: string;
    reason: CompanyRadarLossReason;
    actor: EffectActor;
    correlationId: string;
    now: Date;
  }>,
) {
  const revokedMappings = await transaction.radarOpaqueMapping.updateMany({
    where: {
      companyId: input.companyId,
      revokedAt: null,
      validTo: { gt: input.now },
    },
    data: {
      revokedAt: input.now,
      revocationReason: input.reason,
    },
  });
  const pending = await transaction.employerContactRequest.findMany({
    where: {
      companyId: input.companyId,
      status: "PENDING",
      terminalAt: null,
      createdAt: { lte: input.now },
      expiresAt: { gt: input.now },
    },
    select: {
      candidateProfile: { select: { userId: true } },
    },
    distinct: ["candidateProfileId"],
  });
  let cancelledRequests = 0;
  for (const candidate of pending) {
    cancelledRequests += await cancelPendingRequests(transaction, {
      where: {
        companyId: input.companyId,
        candidateProfile: { userId: candidate.candidateProfile.userId },
      },
      candidateUserId: candidate.candidateProfile.userId,
      reason: input.reason,
      actor: input.actor,
      correlationId: input.correlationId,
      now: input.now,
    });
  }
  return Object.freeze({
    revokedMappings: revokedMappings.count,
    cancelledRequests,
  });
}

async function cancelPendingRequests(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    where: Prisma.EmployerContactRequestWhereInput;
    candidateUserId: string;
    reason: RadarEligibilityLossReason;
    actor: EffectActor;
    correlationId: string;
    now: Date;
  }>,
) {
  const requests = await transaction.employerContactRequest.findMany({
    where: {
      ...input.where,
      status: "PENDING",
      terminalAt: null,
      createdAt: { lte: input.now },
      expiresAt: { gt: input.now },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      companyId: true,
      requestingUserId: true,
    },
  });
  let count = 0;
  for (const request of requests) {
    const changed = await transaction.employerContactRequest.updateMany({
      where: {
        id: request.id,
        status: "PENDING",
        terminalAt: null,
        createdAt: { lte: input.now },
        expiresAt: { gt: input.now },
      },
      data: { status: "CANCELLED", terminalAt: input.now, updatedAt: input.now },
    });
    if (changed.count !== 1) continue;
    count += 1;
    await transaction.contactRequestEvent.create({
      data: {
        contactRequestId: request.id,
        kind: "CANCELLED",
        actorUserId: input.actor.kind === "USER" ? input.actor.userId : null,
        reasonCode: input.reason,
        correlationId: input.correlationId,
        idempotencyKey: `eligibility-loss:${input.reason}:${request.id}`,
        createdAt: input.now,
      },
    });
    for (const recipientUserId of new Set([
      input.candidateUserId,
      request.requestingUserId,
    ])) {
      const notification = buildNotificationPersistenceRecord({
        recipientUserId,
        kind: "CONTACT_REQUEST_CANCELLED",
        dedupeKey: `eligibility-loss:${input.reason}:${request.id}`,
        payload: {
          requestId: request.id,
          status: "CANCELLED",
          reasonCode: input.reason,
        },
      });
      await transaction.notification.upsert({
        where: {
          recipientUserId_kind_dedupeKey: {
            recipientUserId: notification.recipientUserId,
            kind: notification.kind,
            dedupeKey: notification.dedupeKey,
          },
        },
        update: {},
        create: {
          ...notification,
          payload: notification.payload as Prisma.InputJsonObject,
        },
      });
    }
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "CONTACT_REQUEST_CANCELLED",
      actorKind: input.actor.kind,
      ...(input.actor.kind === "USER" ? { actorUserId: input.actor.userId } : {}),
      capability: "RADAR_ELIGIBILITY_LOSS",
      companyId: request.companyId,
      correlationId: input.correlationId || randomUUID(),
      reasonCode: input.reason,
      result: "SUCCEEDED",
      retainUntil: new Date(input.now.getTime() + AUDIT_RETENTION_MS),
      targetId: request.id,
      targetType: "CONTACT_REQUEST",
    });
  }
  return count;
}
