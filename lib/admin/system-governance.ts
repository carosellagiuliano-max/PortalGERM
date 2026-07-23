import "server-only";

import { z } from "zod";

import {
  adminErrorResult,
  adminFailure,
  adminIdempotencyKeySchema,
  adminNow,
  adminReasonCodeSchema,
  adminSuccess,
  adminUuidSchema,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";
import { Prisma } from "@/lib/generated/prisma/client";

const systemTaskOutcomeSchema = z.strictObject({
  taskId: adminUuidSchema,
  expectedStatus: z.enum(["OPEN", "ASSIGNED", "IN_PROGRESS"]),
  status: z.enum(["DONE", "DISMISSED"]),
  outcomeCode: adminReasonCodeSchema,
  idempotencyKey: adminIdempotencyKeySchema,
});

const taxRateApprovalSchema = z.strictObject({
  taxRateVersionId: adminUuidSchema,
  expectedReviewStatus: z.literal("DRAFT"),
  reasonCode: adminReasonCodeSchema,
  idempotencyKey: adminIdempotencyKeySchema,
});

export async function listOpenSystemTasks(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_COCKPIT_READ")) return null;
  return dependencies.database.systemTask.findMany({
    where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] } },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      companyId: true,
      kind: true,
      reasonCode: true,
      ownerUserId: true,
      dueAt: true,
      status: true,
      company: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  });
}

export async function listDraftTaxRateVersions(
  dependencies: AdminDependencies,
) {
  if (!requireCapability(dependencies, "ADMIN_CATALOG_READ")) return null;
  return dependencies.database.taxRateVersion.findMany({
    where: { reviewStatus: "DRAFT" },
    orderBy: [
      { jurisdiction: "asc" },
      { taxType: "asc" },
      { validFrom: "asc" },
      { id: "asc" },
    ],
    take: 100,
    select: {
      id: true,
      jurisdiction: true,
      taxType: true,
      rateBasisPoints: true,
      validFrom: true,
      validTo: true,
      source: true,
      referenceUrl: true,
      reviewStatus: true,
    },
  });
}

/**
 * Records the bounded, non-content outcome of an operational SystemTask.
 *
 * The task row and required audit evidence commit together. Company scope is
 * derived from the locked row rather than accepted from the caller.
 */
export async function recordSystemTaskOutcome(
  raw: unknown,
  dependencies: AdminDependencies,
) {
  const parsed = systemTaskOutcomeSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_SYSTEM_TASK_MANAGE")) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  const correlationId = parsed.data.idempotencyKey;

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const task = await transaction.systemTask.findUnique({
          where: { id: parsed.data.taskId },
          select: {
            id: true,
            companyId: true,
            status: true,
            outcomeCode: true,
          },
        });
        if (task === null) return adminFailure("NOT_FOUND");

        const replay = await transaction.auditLog.findFirst({
          where: {
            action: "SYSTEM_TASK_OUTCOME_RECORDED",
            targetId: task.id,
            correlationId,
          },
          select: { id: true, reasonCode: true },
        });
        if (replay !== null) {
          if (
            replay.reasonCode !== parsed.data.outcomeCode ||
            task.status !== parsed.data.status ||
            task.outcomeCode !== parsed.data.outcomeCode
          ) {
            return adminFailure("CONFLICT");
          }
          return adminSuccess(
            {
              taskId: task.id,
              status: task.status,
              outcomeCode: task.outcomeCode,
            },
            true,
          );
        }

        if (task.status !== parsed.data.expectedStatus) {
          return adminFailure("CONFLICT");
        }
        const changed = await transaction.systemTask.updateMany({
          where: {
            id: task.id,
            status: parsed.data.expectedStatus,
          },
          data: {
            status: parsed.data.status,
            outcomeCode: parsed.data.outcomeCode,
            updatedAt: now,
          },
        });
        if (changed.count !== 1) return adminFailure("CONFLICT");

        await writeAdminAudit(
          transaction,
          { ...dependencies, correlationId },
          now,
          {
            action: "SYSTEM_TASK_OUTCOME_RECORDED",
            capability: "ADMIN_SYSTEM_TASK_MANAGE",
            targetType: "SYSTEM_TASK",
            targetId: task.id,
            companyId: task.companyId,
            reasonCode: parsed.data.outcomeCode,
          },
        );

        return adminSuccess({
          taskId: task.id,
          status: parsed.data.status,
          outcomeCode: parsed.data.outcomeCode,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

/**
 * Approves one immutable tax-rate version after serializing its jurisdiction
 * and tax-type range. PostgreSQL's exclusion constraint remains the final
 * overlap backstop.
 */
export async function approveTaxRateVersion(
  raw: unknown,
  dependencies: AdminDependencies,
) {
  const parsed = taxRateApprovalSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CATALOG_MUTATE")) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  const correlationId = parsed.data.idempotencyKey;

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const initial = await transaction.taxRateVersion.findUnique({
          where: { id: parsed.data.taxRateVersionId },
          select: {
            id: true,
            jurisdiction: true,
            taxType: true,
          },
        });
        if (initial === null) return adminFailure("NOT_FOUND");

        const lockKey =
          `${initial.jurisdiction.length}:${initial.jurisdiction}:${initial.taxType}`;
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${lockKey}, 0)
          ) IS NULL AS "locked"
        `;

        const taxRate = await transaction.taxRateVersion.findUnique({
          where: { id: initial.id },
          select: {
            id: true,
            jurisdiction: true,
            taxType: true,
            validFrom: true,
            validTo: true,
            reviewStatus: true,
            reviewedByUserId: true,
            reviewedAt: true,
          },
        });
        if (taxRate === null) return adminFailure("NOT_FOUND");

        const replay = await transaction.auditLog.findFirst({
          where: {
            action: "TAX_RATE_APPROVED",
            targetId: taxRate.id,
            correlationId,
          },
          select: { id: true, reasonCode: true },
        });
        if (replay !== null) {
          if (
            replay.reasonCode !== parsed.data.reasonCode ||
            taxRate.reviewStatus !== "APPROVED" ||
            taxRate.reviewedByUserId !== dependencies.actor.userId ||
            taxRate.reviewedAt === null
          ) {
            return adminFailure("CONFLICT");
          }
          return adminSuccess(
            {
              taxRateVersionId: taxRate.id,
              reviewStatus: taxRate.reviewStatus,
              reviewedAt: taxRate.reviewedAt,
            },
            true,
          );
        }

        if (taxRate.reviewStatus !== parsed.data.expectedReviewStatus) {
          return adminFailure("CONFLICT");
        }
        const overlap = await transaction.taxRateVersion.findFirst({
          where: {
            id: { not: taxRate.id },
            jurisdiction: taxRate.jurisdiction,
            taxType: taxRate.taxType,
            reviewStatus: "APPROVED",
            ...(taxRate.validTo === null
              ? {}
              : { validFrom: { lt: taxRate.validTo } }),
            OR: [
              { validTo: null },
              { validTo: { gt: taxRate.validFrom } },
            ],
          },
          select: { id: true },
        });
        if (overlap !== null) return adminFailure("CONFLICT");

        const changed = await transaction.taxRateVersion.updateMany({
          where: {
            id: taxRate.id,
            reviewStatus: parsed.data.expectedReviewStatus,
          },
          data: {
            reviewStatus: "APPROVED",
            reviewedByUserId: dependencies.actor.userId,
            reviewedAt: now,
          },
        });
        if (changed.count !== 1) return adminFailure("CONFLICT");

        await writeAdminAudit(
          transaction,
          { ...dependencies, correlationId },
          now,
          {
            action: "TAX_RATE_APPROVED",
            capability: "ADMIN_CATALOG_MUTATE",
            targetType: "TAX_RATE_VERSION",
            targetId: taxRate.id,
            reasonCode: parsed.data.reasonCode,
          },
        );

        return adminSuccess({
          taxRateVersionId: taxRate.id,
          reviewStatus: "APPROVED" as const,
          reviewedAt: now,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}
