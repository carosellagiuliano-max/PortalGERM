import "server-only";

import { randomUUID } from "node:crypto";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";

const FINANCE_RETENTION_MS = 10 * 365 * 86_400_000;

export const DUNNING_POLICY_V1 = Object.freeze({
  version: "phase24-v1" as const,
  graceMilliseconds: 7 * 24 * 60 * 60_000,
  maximumBatchSize: 100,
});

export async function openDunningForPaymentFailureInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    companyId: string;
    correlationId: string;
    now: Date;
    paymentAttemptId: string;
  }>,
) {
  const subscription = await transaction.employerSubscription.findFirst({
    where: {
      companyId: input.companyId,
      status: { in: ["ACTIVE", "CANCELLING"] },
      currentPeriodEnd: { gt: input.now },
    },
    orderBy: [
      { currentPeriodEnd: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: { id: true, status: true },
  });
  if (subscription === null) return null;
  const idempotencyKey = `dunning:${input.paymentAttemptId}`;
  const existing = await transaction.dunningCase.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing !== null) return existing.id;
  const dunningId = randomUUID();
  const graceEndsAt = new Date(
    input.now.getTime() + DUNNING_POLICY_V1.graceMilliseconds,
  );
  await transaction.dunningCase.create({
    data: {
      id: dunningId,
      subscriptionId: subscription.id,
      paymentAttemptId: input.paymentAttemptId,
      companyId: input.companyId,
      previousSubscriptionStatus: subscription.status,
      status: "GRACE",
      reasonCode: "PAYMENT_FAILED",
      idempotencyKey,
      paymentDueAt: input.now,
      graceEndsAt,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
  await transaction.subscriptionEvent.create({
    data: {
      id: randomUUID(),
      subscriptionId: subscription.id,
      kind: "DUNNING_STARTED",
      actorUserId: null,
      reasonCode: "PAYMENT_FAILED",
      idempotencyKey: `dunning-started:${dunningId}`,
      correlationId: input.correlationId,
      createdAt: input.now,
    },
  });
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: "DUNNING_CHANGED",
    actorKind: "SYSTEM",
    capability: "PAYMENT_DUNNING_PROJECT",
    companyId: input.companyId,
    correlationId: input.correlationId,
    reasonCode: "DUNNING_GRACE_STARTED",
    result: "SUCCEEDED",
    retainUntil: new Date(input.now.getTime() + FINANCE_RETENTION_MS),
    targetId: dunningId,
    targetType: "DUNNING_CASE",
  });
  return dunningId;
}

export async function resolveCompanyDunningInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    companyId: string;
    correlationId: string;
    now: Date;
  }>,
) {
  const cases = await transaction.dunningCase.findMany({
    where: {
      companyId: input.companyId,
      status: { in: ["OPEN", "GRACE", "SUSPENDED"] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const dunning of cases) {
    await transaction.dunningCase.update({
      where: { id: dunning.id },
      data: {
        status: "RESOLVED",
        resolvedAt: input.now,
        updatedAt: input.now,
      },
    });
    const subscription = await transaction.employerSubscription.findUnique({
      where: { id: dunning.subscriptionId },
      select: { status: true, currentPeriodEnd: true },
    });
    if (
      subscription?.status === "SUSPENDED" &&
      subscription.currentPeriodEnd.getTime() > input.now.getTime()
    ) {
      const restoredStatus =
        dunning.previousSubscriptionStatus === "CANCELLING"
          ? "CANCELLING"
          : "ACTIVE";
      await transaction.employerSubscription.update({
        where: { id: dunning.subscriptionId },
        data: { status: restoredStatus, updatedAt: input.now },
      });
      await transaction.subscriptionEvent.create({
        data: {
          id: randomUUID(),
          subscriptionId: dunning.subscriptionId,
          kind: "RESUMED",
          actorUserId: null,
          reasonCode: "PAYMENT_RECOVERED",
          idempotencyKey: `dunning-resumed:${dunning.id}`,
          correlationId: input.correlationId,
          createdAt: input.now,
        },
      });
    } else if (
      subscription?.status === "SUSPENDED" &&
      subscription.currentPeriodEnd.getTime() <= input.now.getTime()
    ) {
      await transaction.employerSubscription.update({
        where: { id: dunning.subscriptionId },
        data: {
          status: "EXPIRED",
          endedAt: input.now,
          updatedAt: input.now,
        },
      });
      await transaction.subscriptionEvent.create({
        data: {
          id: randomUUID(),
          subscriptionId: dunning.subscriptionId,
          kind: "EXPIRED",
          actorUserId: null,
          reasonCode: "DUNNING_RECOVERY_AFTER_PERIOD_END",
          idempotencyKey: `dunning-expired:${dunning.id}`,
          correlationId: input.correlationId,
          createdAt: input.now,
        },
      });
    }
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "DUNNING_CHANGED",
      actorKind: "SYSTEM",
      capability: "PAYMENT_DUNNING_PROJECT",
      companyId: input.companyId,
      correlationId: input.correlationId,
      reasonCode: "DUNNING_RESOLVED",
      result: "SUCCEEDED",
      retainUntil: new Date(input.now.getTime() + FINANCE_RETENTION_MS),
      targetId: dunning.id,
      targetType: "DUNNING_CASE",
    });
  }
  return cases.length;
}

export async function projectDueDunningCases(
  input: Readonly<{
    correlationId: string;
    database: DatabaseClient;
    enabled: boolean;
    now: Date;
  }>,
) {
  if (!input.enabled) {
    return Object.freeze({ processed: 0, status: "DISABLED" as const });
  }
  const due = await input.database.dunningCase.findMany({
    where: {
      status: { in: ["OPEN", "GRACE"] },
      graceEndsAt: { lte: input.now },
    },
    orderBy: [{ graceEndsAt: "asc" }, { id: "asc" }],
    take: DUNNING_POLICY_V1.maximumBatchSize,
    select: { id: true },
  });
  let processed = 0;
  for (const row of due) {
    const updated = await input.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "DunningCase"
          WHERE "id" = ${row.id}::uuid
          FOR UPDATE
        `;
        const current = await transaction.dunningCase.findFirst({
          where: {
            id: row.id,
            status: { in: ["OPEN", "GRACE"] },
            graceEndsAt: { lte: input.now },
          },
        });
        if (current === null) return false;
        await transaction.employerSubscription.updateMany({
          where: {
            id: current.subscriptionId,
            companyId: current.companyId,
            status: { in: ["ACTIVE", "CANCELLING"] },
          },
          data: { status: "SUSPENDED", updatedAt: input.now },
        });
        await transaction.dunningCase.update({
          where: { id: current.id },
          data: {
            status: "SUSPENDED",
            suspendedAt: input.now,
            updatedAt: input.now,
          },
        });
        await transaction.subscriptionEvent.create({
          data: {
            id: randomUUID(),
            subscriptionId: current.subscriptionId,
            kind: "SUSPENDED",
            actorUserId: null,
            reasonCode: "DUNNING_GRACE_EXPIRED",
            idempotencyKey: `dunning-suspended:${current.id}`,
            correlationId: input.correlationId,
            createdAt: input.now,
          },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "DUNNING_CHANGED",
            actorKind: "SYSTEM",
            capability: "PAYMENT_DUNNING_PROJECT",
            companyId: current.companyId,
            correlationId: input.correlationId,
            reasonCode: "DUNNING_SUSPENDED",
            result: "SUCCEEDED",
            retainUntil: new Date(input.now.getTime() + FINANCE_RETENTION_MS),
            targetId: current.id,
            targetType: "DUNNING_CASE",
          },
        );
        return true;
      },
      { isolationLevel: "Serializable" },
    );
    if (updated) processed += 1;
  }
  return Object.freeze({ processed, status: "COMPLETED" as const });
}
