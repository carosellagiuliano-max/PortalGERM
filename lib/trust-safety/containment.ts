import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma/client";

export type TrustContainmentMode = "HOLD" | "REVOKE";

export async function applyTrustContainment(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    caseId: string;
    companyId: string | null;
    subjectType: string;
    subjectId: string;
    mode: TrustContainmentMode;
    actorUserId: string | null;
    correlationId: string;
    reasonCode: string;
    effectScope: readonly string[];
    now: Date;
  }>,
): Promise<Readonly<{ effects: number; sessionsRevoked: number }>> {
  let effects = 0;
  let sessionsRevoked = 0;
  const companyId =
    input.companyId ??
    (input.subjectType === "COMPANY" ? input.subjectId : null);
  const scopes = new Set(input.effectScope);
  const containsCompany = scopes.has("COMPANY") || scopes.has("BADGE");
  const containsSessions =
    scopes.has("SESSION") ||
    scopes.has("ACCOUNT_SECURITY") ||
    scopes.has("PRIVILEGED_ACTIONS") ||
    scopes.has("MESSAGING") ||
    scopes.has("RADAR") ||
    scopes.has("EXPORT") ||
    scopes.has("IDENTITY_REVEAL");

  if (companyId !== null) {
    const company = await transaction.company.findUnique({
      where: { id: companyId },
      select: { id: true, status: true },
    });
    if (containsCompany && company !== null && company.status === "ACTIVE") {
      effects += await createEffect(transaction, {
        caseId: input.caseId,
        effectScope: "COMPANY_STATUS",
        targetType: "COMPANY",
        targetId: company.id,
        previousState: company.status,
        appliedState: "SUSPENDED",
        reversible: true,
        reasonCode: input.reasonCode,
        now: input.now,
      });
      await transaction.company.update({
        where: { id: company.id },
        data: { status: "SUSPENDED", updatedAt: input.now },
        select: { id: true },
      });
      await transaction.companyStatusEvent.create({
        data: {
          id: randomUUID(),
          companyId: company.id,
          kind: "SUSPENDED",
          fromStatus: "ACTIVE",
          toStatus: "SUSPENDED",
          actorUserId: input.actorUserId,
          reasonCode: input.reasonCode,
          correlationId: input.correlationId,
          createdAt: input.now,
        },
        select: { id: true },
      });
    }

    const publishedJobs = scopes.has("PUBLIC_JOBS")
      ? await transaction.job.findMany({
          where: {
            companyId,
            status: "PUBLISHED",
            ...(input.subjectType === "JOB" ? { id: input.subjectId } : {}),
          },
          orderBy: { id: "asc" },
          select: { id: true, currentRevisionId: true },
        })
      : [];
    for (const job of publishedJobs) {
      effects += await createEffect(transaction, {
        caseId: input.caseId,
        effectScope: "PUBLIC_JOB",
        targetType: "JOB",
        targetId: job.id,
        previousState: "PUBLISHED",
        appliedState: "PAUSED",
        reversible: true,
        reasonCode: input.reasonCode,
        now: input.now,
      });
      await transaction.job.updateMany({
        where: { id: job.id, status: "PUBLISHED" },
        data: { status: "PAUSED", updatedAt: input.now },
      });
      await transaction.jobStatusEvent.create({
        data: {
          id: randomUUID(),
          jobId: job.id,
          jobRevisionId: job.currentRevisionId,
          kind: "PAUSED",
          fromStatus: "PUBLISHED",
          toStatus: "PAUSED",
          actorUserId: input.actorUserId,
          reasonCode: input.reasonCode,
          idempotencyKey: `trust:${input.caseId}:job:${job.id}`,
          correlationId: input.correlationId,
          createdAt: input.now,
        },
        select: { id: true },
      });
    }

    const members = containsSessions
      ? await transaction.companyMembership.findMany({
          where: { companyId, status: "ACTIVE" },
          orderBy: { userId: "asc" },
          select: { userId: true },
        })
      : [];
    const userIds = [...new Set(members.map(({ userId }) => userId))];
    if (userIds.length > 0) {
      const sessions = await transaction.session.findMany({
        where: { userId: { in: userIds }, revokedAt: null },
        orderBy: { id: "asc" },
        select: { id: true, userId: true },
      });
      for (const session of sessions) {
        effects += await createEffect(transaction, {
          caseId: input.caseId,
          effectScope: "SESSION",
          targetType: "SESSION",
          targetId: session.id,
          previousState: "ACTIVE",
          appliedState: "REVOKED",
          reversible: false,
          reasonCode: input.reasonCode,
          now: input.now,
        });
      }
      const revoked = await transaction.session.updateMany({
        where: { id: { in: sessions.map(({ id }) => id) }, revokedAt: null },
        data: { revokedAt: input.now },
      });
      sessionsRevoked += revoked.count;
      await revokeDerivedSecurityState(transaction, userIds, input.now);
    }

    const attempts =
      scopes.has("PAYMENT") || scopes.has("FULFILLMENT")
        ? await transaction.paymentAttempt.findMany({
            where: {
              companyId,
              status: { in: ["CREATED", "CHECKOUT_CREATED", "PENDING"] },
              ...(input.subjectType === "PAYMENT"
                ? { id: input.subjectId }
                : {}),
            },
            orderBy: { id: "asc" },
            select: { id: true, status: true },
          })
        : [];
    for (const attempt of attempts) {
      effects += await createEffect(transaction, {
        caseId: input.caseId,
        effectScope: "PAYMENT",
        targetType: "PAYMENT_ATTEMPT",
        targetId: attempt.id,
        previousState: attempt.status,
        appliedState: "HELD",
        reversible: false,
        reasonCode: input.reasonCode,
        now: input.now,
      });
      await transaction.paymentAttempt.updateMany({
        where: { id: attempt.id, status: attempt.status },
        data: {
          status: "HELD",
          failureCode: input.reasonCode,
          updatedAt: input.now,
        },
      });
    }

    if (input.mode === "REVOKE" && containsCompany) {
      const verifications =
        await transaction.companyVerificationRequest.findMany({
          where: {
            companyId,
            status: "VERIFIED",
            supersededBy: null,
          },
          orderBy: { id: "asc" },
          select: { id: true },
        });
      for (const verification of verifications) {
        effects += await createEffect(transaction, {
          caseId: input.caseId,
          effectScope: "COMPANY_VERIFICATION",
          targetType: "VERIFICATION_REQUEST",
          targetId: verification.id,
          previousState: "VERIFIED",
          appliedState: "REVOKED",
          reversible: false,
          reasonCode: input.reasonCode,
          now: input.now,
        });
        await transaction.companyVerificationRequest.updateMany({
          where: { id: verification.id, status: "VERIFIED" },
          data: { status: "REVOKED", updatedAt: input.now },
        });
        await transaction.companyVerificationEvent.create({
          data: {
            id: randomUUID(),
            verificationRequestId: verification.id,
            kind: "REVOKED",
            fromStatus: "VERIFIED",
            toStatus: "REVOKED",
            actorUserId: input.actorUserId,
            reasonCode: input.reasonCode,
            evidenceRef: `trust-case:${input.caseId}`,
            idempotencyKey: `trust:${input.caseId}:verify:${verification.id}`,
            correlationId: input.correlationId,
            createdAt: input.now,
          },
          select: { id: true },
        });
      }
    }
    if (input.mode === "REVOKE" && scopes.has("RADAR")) {
      const requests = await transaction.employerContactRequest.findMany({
        where: { companyId, status: "PENDING" },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      for (const request of requests) {
        effects += await createEffect(transaction, {
          caseId: input.caseId,
          effectScope: "RADAR_CONTACT",
          targetType: "CONTACT_REQUEST",
          targetId: request.id,
          previousState: "PENDING",
          appliedState: "CANCELLED",
          reversible: false,
          reasonCode: input.reasonCode,
          now: input.now,
        });
        await transaction.employerContactRequest.updateMany({
          where: { id: request.id, status: "PENDING" },
          data: {
            status: "CANCELLED",
            terminalAt: input.now,
            updatedAt: input.now,
          },
        });
        await transaction.contactRequestEvent.create({
          data: {
            id: randomUUID(),
            contactRequestId: request.id,
            kind: "CANCELLED",
            actorUserId: input.actorUserId,
            reasonCode: input.reasonCode,
            correlationId: input.correlationId,
            idempotencyKey: `trust:${input.caseId}:contact:${request.id}`,
            createdAt: input.now,
          },
          select: { id: true },
        });
      }
    }
  } else if (input.subjectType === "USER") {
    const sessions = await transaction.session.findMany({
      where: { userId: input.subjectId, revokedAt: null },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    for (const session of sessions) {
      effects += await createEffect(transaction, {
        caseId: input.caseId,
        effectScope: "SESSION",
        targetType: "SESSION",
        targetId: session.id,
        previousState: "ACTIVE",
        appliedState: "REVOKED",
        reversible: false,
        reasonCode: input.reasonCode,
        now: input.now,
      });
    }
    const revoked = await transaction.session.updateMany({
      where: { id: { in: sessions.map(({ id }) => id) }, revokedAt: null },
      data: { revokedAt: input.now },
    });
    sessionsRevoked += revoked.count;
    await revokeDerivedSecurityState(transaction, [input.subjectId], input.now);
  } else if (input.subjectType === "SESSION") {
    const session = await transaction.session.findUnique({
      where: { id: input.subjectId },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (session?.revokedAt === null) {
      effects += await createEffect(transaction, {
        caseId: input.caseId,
        effectScope: "SESSION",
        targetType: "SESSION",
        targetId: session.id,
        previousState: "ACTIVE",
        appliedState: "REVOKED",
        reversible: false,
        reasonCode: input.reasonCode,
        now: input.now,
      });
      const revoked = await transaction.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: input.now },
      });
      sessionsRevoked += revoked.count;
      await revokeDerivedSecurityState(
        transaction,
        [session.userId],
        input.now,
      );
    }
  } else if (input.subjectType === "EXPORT" && scopes.has("EXPORT")) {
    const request = await transaction.privacyRequest.findFirst({
      where: { id: input.subjectId, type: "EXPORT" },
      select: { requesterUserId: true },
    });
    if (request !== null) {
      const sessions = await transaction.session.findMany({
        where: { userId: request.requesterUserId, revokedAt: null },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      for (const session of sessions) {
        effects += await createEffect(transaction, {
          caseId: input.caseId,
          effectScope: "SESSION",
          targetType: "SESSION",
          targetId: session.id,
          previousState: "ACTIVE",
          appliedState: "REVOKED",
          reversible: false,
          reasonCode: input.reasonCode,
          now: input.now,
        });
      }
      const revoked = await transaction.session.updateMany({
        where: { id: { in: sessions.map(({ id }) => id) }, revokedAt: null },
        data: { revokedAt: input.now },
      });
      sessionsRevoked += revoked.count;
      await revokeDerivedSecurityState(
        transaction,
        [request.requesterUserId],
        input.now,
      );
    }
  }

  return Object.freeze({ effects, sessionsRevoked });
}

export async function restoreReversibleContainment(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    caseId: string;
    actorUserId: string;
    correlationId: string;
    reasonCode: string;
    now: Date;
  }>,
): Promise<Readonly<{ restored: number }>> {
  const effects = await transaction.trustSafetyContainmentEffect.findMany({
    where: {
      trustSafetyCaseId: input.caseId,
      reversible: true,
      reversedAt: null,
    },
    orderBy: [{ appliedAt: "desc" }, { id: "desc" }],
  });
  let restored = 0;
  for (const effect of effects) {
    if (effect.effectScope === "COMPANY_STATUS") {
      if (
        effect.appliedState !== "SUSPENDED" ||
        effect.previousState !== "ACTIVE"
      ) {
        throw new Error("TRUST_RESTORE_PRECONDITION_FAILED");
      }
      const changed = await transaction.company.updateMany({
        where: { id: effect.targetId, status: "SUSPENDED" },
        data: { status: "ACTIVE", updatedAt: input.now },
      });
      if (changed.count !== 1) {
        throw new Error("TRUST_RESTORE_PRECONDITION_FAILED");
      }
      await transaction.companyStatusEvent.create({
        data: {
          id: randomUUID(),
          companyId: effect.targetId,
          kind: "REACTIVATED",
          fromStatus: "SUSPENDED",
          toStatus: "ACTIVE",
          actorUserId: input.actorUserId,
          reasonCode: input.reasonCode,
          correlationId: input.correlationId,
          createdAt: input.now,
        },
        select: { id: true },
      });
    } else if (effect.effectScope === "PUBLIC_JOB") {
      if (
        effect.appliedState !== "PAUSED" ||
        effect.previousState !== "PUBLISHED"
      ) {
        throw new Error("TRUST_RESTORE_PRECONDITION_FAILED");
      }
      const job = await transaction.job.findUnique({
        where: { id: effect.targetId },
        select: { id: true, status: true, currentRevisionId: true },
      });
      if (job?.status !== "PAUSED") {
        throw new Error("TRUST_RESTORE_PRECONDITION_FAILED");
      }
      await transaction.job.update({
        where: { id: job.id },
        data: { status: "PUBLISHED", updatedAt: input.now },
        select: { id: true },
      });
      await transaction.jobStatusEvent.create({
        data: {
          id: randomUUID(),
          jobId: job.id,
          jobRevisionId: job.currentRevisionId,
          kind: "REACTIVATED",
          fromStatus: "PAUSED",
          toStatus: "PUBLISHED",
          actorUserId: input.actorUserId,
          reasonCode: input.reasonCode,
          idempotencyKey: `trust:${input.caseId}:restore:${job.id}`,
          correlationId: input.correlationId,
          createdAt: input.now,
        },
        select: { id: true },
      });
    } else {
      throw new Error("TRUST_RESTORE_PRECONDITION_FAILED");
    }
    const reversed = await transaction.trustSafetyContainmentEffect.updateMany({
      where: { id: effect.id, reversedAt: null, reversible: true },
      data: { reversedAt: input.now },
    });
    if (reversed.count !== 1) {
      throw new Error("TRUST_RESTORE_PRECONDITION_FAILED");
    }
    restored += 1;
  }
  return Object.freeze({ restored });
}

async function createEffect(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    caseId: string;
    effectScope: string;
    targetType: string;
    targetId: string;
    previousState: string;
    appliedState: string;
    reversible: boolean;
    reasonCode: string;
    now: Date;
  }>,
): Promise<number> {
  await transaction.trustSafetyContainmentEffect.upsert({
    where: {
      idempotencyKey: `trust:${input.caseId}:${input.effectScope}:${input.targetId}`,
    },
    update: {},
    create: {
      id: randomUUID(),
      trustSafetyCaseId: input.caseId,
      effectScope: input.effectScope,
      targetType: input.targetType,
      targetId: input.targetId,
      previousState: input.previousState,
      appliedState: input.appliedState,
      reversible: input.reversible,
      reasonCode: input.reasonCode,
      idempotencyKey: `trust:${input.caseId}:${input.effectScope}:${input.targetId}`,
      appliedAt: input.now,
    },
    select: { id: true },
  });
  return 1;
}

async function revokeDerivedSecurityState(
  transaction: Prisma.TransactionClient,
  userIds: readonly string[],
  now: Date,
): Promise<void> {
  if (userIds.length === 0) return;
  await Promise.all([
    transaction.sessionAssurance.updateMany({
      where: { userId: { in: [...userIds] }, revokedAt: null },
      data: { revokedAt: now },
    }),
    transaction.authAssuranceEvidence.updateMany({
      where: {
        userId: { in: [...userIds] },
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    }),
    transaction.stepUpChallenge.updateMany({
      where: {
        userId: { in: [...userIds] },
        status: "PENDING",
      },
      data: { status: "REVOKED", cancelledAt: now },
    }),
  ]);
}
