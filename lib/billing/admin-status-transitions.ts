import "server-only";

import { z } from "zod";

import {
  AdminDomainError,
  adminErrorResult,
  adminFailure,
  adminNow,
  adminReasonCodeSchema,
  adminSuccess,
  adminUuidSchema,
  operationKey,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";
import { decideInvoiceTransition } from "@/lib/policies/status/invoice";
import { decideOrderTransition } from "@/lib/policies/status/order";

const cancelAdminOrderSchema = z.strictObject({
  orderId: adminUuidSchema,
  companyId: adminUuidSchema,
  expectedStatus: z.literal("PENDING"),
  reasonCode: adminReasonCodeSchema,
  idempotencyKey: adminUuidSchema,
});

const voidAdminInvoiceSchema = z.strictObject({
  invoiceId: adminUuidSchema,
  companyId: adminUuidSchema,
  expectedStatus: z.literal("ISSUED"),
  reasonCode: adminReasonCodeSchema,
  idempotencyKey: adminUuidSchema,
});

export type CancelledAdminOrder = Readonly<{
  orderId: string;
  companyId: string;
  status: "CANCELLED";
  cancelledAt: Date;
}>;

export type VoidedAdminInvoice = Readonly<{
  invoiceId: string;
  companyId: string;
  status: "VOID";
  voidedAt: Date;
}>;

/**
 * Cancels one still-pending Order through the canonical Order transition
 * policy. The explicit Company scope is part of the command contract so an
 * identifier copied from another tenant is indistinguishable from a missing
 * record. State, provider evidence, reservation release and audit are atomic.
 */
export async function cancelAdminOrder(
  raw: unknown,
  dependencies: AdminDependencies,
) {
  const parsed = cancelAdminOrderSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_BILLING_MUTATE")) {
    return adminFailure("FORBIDDEN");
  }

  const now = adminNow(dependencies.now);
  const eventKey = operationKey(
    "admin-order-cancel",
    parsed.data.idempotencyKey,
  );

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "Order"
          WHERE "id" = ${parsed.data.orderId}::uuid
            AND "companyId" = ${parsed.data.companyId}::uuid
          FOR UPDATE
        `;

        const order = await transaction.order.findFirst({
          where: {
            id: parsed.data.orderId,
            companyId: parsed.data.companyId,
          },
          select: {
            id: true,
            companyId: true,
            provider: true,
            status: true,
            cancelledAt: true,
            lines: {
              where: {
                fulfillmentContext: "IMPORT_SETUP",
                targetImportSetupApprovalId: { not: null },
              },
              take: 1,
              select: {
                id: true,
                targetImportSetupApprovalId: true,
              },
            },
          },
        });
        if (order === null) return adminFailure("NOT_FOUND");
        if (order.provider !== "MOCK") return adminFailure("CONFLICT");

        const replayAudit = await transaction.auditLog.findFirst({
          where: {
            action: "ORDER_CANCELLED",
            correlationId: parsed.data.idempotencyKey,
          },
          select: {
            actorUserId: true,
            capability: true,
            companyId: true,
            reasonCode: true,
            result: true,
            targetId: true,
            targetType: true,
          },
        });
        const replay = replayAudit !== null;
        if (
          replay &&
          (replayAudit.actorUserId !== dependencies.actor.userId ||
            replayAudit.capability !== "ADMIN_BILLING_MUTATE" ||
            replayAudit.companyId !== order.companyId ||
            replayAudit.reasonCode !== parsed.data.reasonCode ||
            replayAudit.result !== "SUCCEEDED" ||
            replayAudit.targetId !== order.id ||
            replayAudit.targetType !== "ORDER")
        ) {
          return adminFailure("CONFLICT");
        }

        const decision = decideOrderTransition({
          action: "CANCEL",
          actor: "PLATFORM_BILLING_OPERATOR",
          currentStatus: order.status,
          replay,
        });
        if (decision.type !== "OK") {
          return adminFailure(
            decision.type === "FORBIDDEN" ? "FORBIDDEN" : "CONFLICT",
          );
        }
        if (decision.value.idempotent) {
          if (order.cancelledAt === null) return adminFailure("CONFLICT");
          const event = await transaction.paymentEvent.findUnique({
            where: { idempotencyKey: eventKey },
            select: { orderId: true, kind: true },
          });
          if (
            event === null ||
            event.orderId !== order.id ||
            event.kind !== "CANCELLED"
          ) {
            return adminFailure("CONFLICT");
          }
          return adminSuccess(
            {
              orderId: order.id,
              companyId: order.companyId,
              status: "CANCELLED" as const,
              cancelledAt: order.cancelledAt,
            },
            true,
          );
        }
        if (replayAudit !== null) return adminFailure("CONFLICT");

        const changed = await transaction.order.updateMany({
          where: {
            id: order.id,
            companyId: order.companyId,
            status: parsed.data.expectedStatus,
            cancelledAt: null,
          },
          data: {
            status: decision.value.nextStatus,
            cancelledAt: now,
          },
        });
        if (changed.count !== 1) return adminFailure("CONFLICT");

        const importReservation = order.lines[0];
        if (
          importReservation !== undefined &&
          importReservation.targetImportSetupApprovalId !== null
        ) {
          const released =
            await transaction.importSetupApproval.updateMany({
              where: {
                id: importReservation.targetImportSetupApprovalId,
                companyId: order.companyId,
                status: "APPROVED",
                orderLineId: importReservation.id,
              },
              data: { orderLineId: null },
            });
          if (released.count !== 1) {
            throw new AdminDomainError("CONFLICT");
          }
        }

        await transaction.paymentEvent.create({
          data: {
            orderId: order.id,
            provider: order.provider,
            kind: "CANCELLED",
            idempotencyKey: eventKey,
            createdAt: now,
            payload: {
              schemaVersion: "1",
              reasonCode: parsed.data.reasonCode,
              initiatedBy: "PLATFORM_BILLING_OPERATOR",
              externalRefundClaimed: false,
            },
          },
        });
        await writeAdminAudit(
          transaction,
          {
            ...dependencies,
            correlationId: parsed.data.idempotencyKey,
          },
          now,
          {
            action: "ORDER_CANCELLED",
            capability: "ADMIN_BILLING_MUTATE",
            targetType: "ORDER",
            targetId: order.id,
            companyId: order.companyId,
            reasonCode: parsed.data.reasonCode,
          },
        );

        return adminSuccess({
          orderId: order.id,
          companyId: order.companyId,
          status: "CANCELLED" as const,
          cancelledAt: now,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

/**
 * Voids one unpaid issued Invoice. A paid Invoice is deliberately not
 * reversible through this command; refunds/credit notes remain a separate
 * money workflow. The immutable invoice snapshot is never edited.
 */
export async function voidAdminInvoice(
  raw: unknown,
  dependencies: AdminDependencies,
) {
  const parsed = voidAdminInvoiceSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_INVOICE_MUTATE")) {
    return adminFailure("FORBIDDEN");
  }

  const now = adminNow(dependencies.now);

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "Invoice"
          WHERE "id" = ${parsed.data.invoiceId}::uuid
            AND "companyId" = ${parsed.data.companyId}::uuid
          FOR UPDATE
        `;

        const invoice = await transaction.invoice.findFirst({
          where: {
            id: parsed.data.invoiceId,
            companyId: parsed.data.companyId,
          },
          select: {
            id: true,
            companyId: true,
            status: true,
            voidedAt: true,
          },
        });
        if (invoice === null) return adminFailure("NOT_FOUND");

        const replayAudit = await transaction.auditLog.findFirst({
          where: {
            action: "INVOICE_VOIDED",
            correlationId: parsed.data.idempotencyKey,
          },
          select: {
            actorUserId: true,
            capability: true,
            companyId: true,
            reasonCode: true,
            result: true,
            targetId: true,
            targetType: true,
          },
        });
        const replay = replayAudit !== null;
        if (
          replay &&
          (replayAudit.actorUserId !== dependencies.actor.userId ||
            replayAudit.capability !== "ADMIN_INVOICE_MUTATE" ||
            replayAudit.companyId !== invoice.companyId ||
            replayAudit.reasonCode !== parsed.data.reasonCode ||
            replayAudit.result !== "SUCCEEDED" ||
            replayAudit.targetId !== invoice.id ||
            replayAudit.targetType !== "INVOICE")
        ) {
          return adminFailure("CONFLICT");
        }

        const decision = decideInvoiceTransition({
          action: "VOID",
          actor: "PLATFORM_BILLING_OPERATOR",
          currentStatus: invoice.status,
          reasonCode: parsed.data.reasonCode,
          replay,
        });
        if (decision.type !== "OK") {
          return adminFailure(
            decision.type === "FORBIDDEN"
              ? "FORBIDDEN"
              : decision.type === "VALIDATION"
                ? "INVALID_INPUT"
                : "CONFLICT",
          );
        }
        if (decision.value.idempotent) {
          if (invoice.voidedAt === null) return adminFailure("CONFLICT");
          return adminSuccess(
            {
              invoiceId: invoice.id,
              companyId: invoice.companyId,
              status: "VOID" as const,
              voidedAt: invoice.voidedAt,
            },
            true,
          );
        }
        if (replayAudit !== null) return adminFailure("CONFLICT");

        const changed = await transaction.invoice.updateMany({
          where: {
            id: invoice.id,
            companyId: invoice.companyId,
            status: parsed.data.expectedStatus,
            paidAt: null,
            voidedAt: null,
          },
          data: {
            status: decision.value.nextStatus,
            voidedAt: now,
          },
        });
        if (changed.count !== 1) return adminFailure("CONFLICT");

        await writeAdminAudit(
          transaction,
          {
            ...dependencies,
            correlationId: parsed.data.idempotencyKey,
          },
          now,
          {
            action: "INVOICE_VOIDED",
            capability: "ADMIN_INVOICE_MUTATE",
            targetType: "INVOICE",
            targetId: invoice.id,
            companyId: invoice.companyId,
            reasonCode: parsed.data.reasonCode,
          },
        );

        return adminSuccess({
          invoiceId: invoice.id,
          companyId: invoice.companyId,
          status: "VOID" as const,
          voidedAt: now,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}
