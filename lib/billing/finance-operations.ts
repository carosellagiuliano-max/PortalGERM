import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  HostedPaymentProvider,
  ProviderRefundResult,
} from "@/lib/providers/payments";

const FINANCE_STEP_UP_MAXIMUM_AGE_MS = 5 * 60_000;
const FINANCE_RETENTION_MS = 10 * 365 * 86_400_000;

export const FINANCE_PAYMENT_POLICY_V1 = Object.freeze({
  version: "phase24-v1" as const,
  requestCapability: "FINANCE_REFUND_REQUEST" as const,
  approvalCapability: "FINANCE_REFUND_EXECUTE" as const,
  requestPurpose: "FINANCE_REFUND_REQUEST" as const,
  approvalPurpose: "FINANCE_REFUND_APPROVE" as const,
});

type FinanceActor = Readonly<{
  capabilities: readonly string[];
  userId: string;
}>;

export type FinanceOperationResult =
  | Readonly<{
      ok: true;
      refundId: string;
      replay: boolean;
      status: "REQUESTED" | "PENDING" | "SUCCEEDED" | "FAILED";
    }>
  | Readonly<{
      ok: false;
      code:
        | "CONFLICT"
        | "DISABLED"
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "PROVIDER_UNAVAILABLE"
        | "STEP_UP_REQUIRED"
        | "WRITE_FAILED";
    }>;

const requestSchema = z.strictObject({
  amountRappen: z.number().int().positive().max(100_000_000),
  companyId: z.uuid(),
  correlationId: z.uuid(),
  idempotencyKey: z.string().min(8).max(160),
  orderId: z.uuid(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  stepUpEvidenceId: z.uuid(),
  subscriptionProviderInvoiceId: z.uuid().optional(),
});

export async function requestFinanceRefund(
  raw: unknown,
  dependencies: Readonly<{
    actor: FinanceActor;
    database: DatabaseClient;
    financeRepairActionsEnabled: boolean;
    now: Date;
  }>,
): Promise<FinanceOperationResult> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success || !Number.isFinite(dependencies.now.getTime())) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (!dependencies.financeRepairActionsEnabled) {
    return { ok: false, code: "DISABLED" };
  }
  if (
    !dependencies.actor.capabilities.includes(
      FINANCE_PAYMENT_POLICY_V1.requestCapability,
    )
  ) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const input = parsed.data;
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const replay = await transaction.refund.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (replay !== null) {
          if (
            replay.orderId !== input.orderId ||
            replay.companyId !== input.companyId ||
            replay.amountRappen !== input.amountRappen ||
            replay.reasonCode !== input.reasonCode ||
            replay.stepUpEvidenceId !== input.stepUpEvidenceId ||
            replay.requestedByUserId !== dependencies.actor.userId ||
            replay.subscriptionProviderInvoiceId !==
              (input.subscriptionProviderInvoiceId ?? null)
          ) {
            return { ok: false as const, code: "CONFLICT" as const };
          }
          return {
            ok: true as const,
            refundId: replay.id,
            replay: true,
            status: replay.status as
              "REQUESTED" | "PENDING" | "SUCCEEDED" | "FAILED",
          };
        }
        const source =
          input.subscriptionProviderInvoiceId === undefined
            ? await loadInitialRefundSource(transaction, {
                companyId: input.companyId,
                orderId: input.orderId,
              })
            : await loadSubscriptionInvoiceRefundSource(transaction, {
                companyId: input.companyId,
                orderId: input.orderId,
                subscriptionProviderInvoiceId:
                  input.subscriptionProviderInvoiceId,
              });
        if (source === null) {
          return { ok: false as const, code: "NOT_FOUND" as const };
        }
        const committedRefunds = await transaction.refund.aggregate({
          where: {
            sourceKind: source.sourceKind,
            ...(source.subscriptionProviderInvoiceId === null
              ? { paymentAttemptId: source.paymentAttemptId }
              : {
                  subscriptionProviderInvoiceId:
                    source.subscriptionProviderInvoiceId,
                }),
            status: { in: ["REQUESTED", "PENDING", "SUCCEEDED"] },
          },
          _sum: { amountRappen: true },
        });
        if (
          (committedRefunds._sum.amountRappen ?? 0) + input.amountRappen >
          source.sourceAmountRappen
        ) {
          return { ok: false as const, code: "CONFLICT" as const };
        }
        const action = financeRefundRequestAction({
          amountRappen: input.amountRappen,
          companyId: input.companyId,
          orderId: input.orderId,
          reasonCode: input.reasonCode,
          ...(source.subscriptionProviderInvoiceId === null
            ? {}
            : {
                sourceKind: source.sourceKind,
                subscriptionProviderInvoiceId:
                  source.subscriptionProviderInvoiceId,
              }),
        });
        const consumed = await consumeFinanceStepUp(transaction, {
          action,
          evidenceId: input.stepUpEvidenceId,
          now: dependencies.now,
          purpose: FINANCE_PAYMENT_POLICY_V1.requestPurpose,
          tenantId: input.companyId,
          userId: dependencies.actor.userId,
        });
        if (!consumed) {
          return {
            ok: false as const,
            code: "STEP_UP_REQUIRED" as const,
          };
        }
        const refundId = randomUUID();
        await transaction.refund.create({
          data: {
            id: refundId,
            orderId: source.orderId,
            invoiceId: source.invoiceId,
            subscriptionProviderInvoiceId:
              source.subscriptionProviderInvoiceId,
            paymentAttemptId: source.paymentAttemptId,
            companyId: input.companyId,
            amountRappen: input.amountRappen,
            currency: "CHF",
            sourceKind: source.sourceKind,
            sourceProviderPaymentReference:
              source.sourceProviderPaymentReference,
            sourceAmountRappen: source.sourceAmountRappen,
            status: "REQUESTED",
            reasonCode: input.reasonCode,
            idempotencyKey: input.idempotencyKey,
            stepUpEvidenceId: input.stepUpEvidenceId,
            requestedByUserId: dependencies.actor.userId,
            requestedAt: dependencies.now,
            createdAt: dependencies.now,
            updatedAt: dependencies.now,
          },
        });
        await writeFinanceAudit(transaction, dependencies.now, {
          action: "REFUND_REQUESTED",
          actorUserId: dependencies.actor.userId,
          capability: FINANCE_PAYMENT_POLICY_V1.requestCapability,
          companyId: input.companyId,
          correlationId: input.correlationId,
          reasonCode: input.reasonCode,
          targetId: refundId,
          targetType: "REFUND",
        });
        return {
          ok: true as const,
          refundId,
          replay: false,
          status: "REQUESTED" as const,
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return { ok: false, code: "WRITE_FAILED" };
  }
}

const approveSchema = z.strictObject({
  approvalStepUpEvidenceId: z.uuid(),
  correlationId: z.uuid(),
  refundId: z.uuid(),
});

export async function approveAndSubmitFinanceRefund(
  raw: unknown,
  dependencies: Readonly<{
    actor: FinanceActor;
    database: DatabaseClient;
    financeRepairActionsEnabled: boolean;
    now: Date;
    paymentProvider: HostedPaymentProvider;
  }>,
): Promise<FinanceOperationResult> {
  const parsed = approveSchema.safeParse(raw);
  if (!parsed.success || !Number.isFinite(dependencies.now.getTime())) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (!dependencies.financeRepairActionsEnabled) {
    return { ok: false, code: "DISABLED" };
  }
  if (
    !dependencies.actor.capabilities.includes(
      FINANCE_PAYMENT_POLICY_V1.approvalCapability,
    )
  ) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const input = parsed.data;
  let prepared:
    | Readonly<{
        amountRappen: number;
        orderId: string;
        paymentAttemptId: string;
        providerPaymentReference: string;
        reasonCode: string;
        refundId: string;
        sourceKind: "INITIAL_ORDER" | "SUBSCRIPTION_PROVIDER_INVOICE";
      }>
    | FinanceOperationResult;
  try {
    prepared = await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "Refund"
          WHERE "id" = ${input.refundId}::uuid
          FOR UPDATE
        `;
        const refund = await transaction.refund.findUnique({
          where: { id: input.refundId },
          include: { paymentAttempt: { select: { id: true } } },
        });
        if (
          refund === null ||
          refund.paymentAttempt.id !== refund.paymentAttemptId ||
          refund.sourceProviderPaymentReference.length < 3
        ) {
          return { ok: false as const, code: "NOT_FOUND" as const };
        }
        if (refund.status === "SUCCEEDED" || refund.status === "FAILED") {
          return {
            ok: true as const,
            refundId: refund.id,
            replay: true,
            status: refund.status,
          };
        }
        if (refund.requestedByUserId === dependencies.actor.userId) {
          return { ok: false as const, code: "FORBIDDEN" as const };
        }
        if (
          refund.status === "PENDING" &&
          (refund.approvedByUserId !== dependencies.actor.userId ||
            refund.approvalStepUpEvidenceId !== input.approvalStepUpEvidenceId)
        ) {
          return { ok: false as const, code: "CONFLICT" as const };
        }
        if (refund.status === "REQUESTED") {
          const consumed = await consumeFinanceStepUp(transaction, {
            action: financeRefundApprovalAction(refund.id),
            evidenceId: input.approvalStepUpEvidenceId,
            now: dependencies.now,
            purpose: FINANCE_PAYMENT_POLICY_V1.approvalPurpose,
            tenantId: refund.companyId,
            userId: dependencies.actor.userId,
          });
          if (!consumed) {
            return {
              ok: false as const,
              code: "STEP_UP_REQUIRED" as const,
            };
          }
          await transaction.refund.update({
            where: { id: refund.id },
            data: {
              status: "PENDING",
              approvedByUserId: dependencies.actor.userId,
              approvalStepUpEvidenceId: input.approvalStepUpEvidenceId,
              updatedAt: dependencies.now,
            },
          });
        }
        return {
          amountRappen: refund.amountRappen,
          orderId: refund.orderId,
          paymentAttemptId: refund.paymentAttemptId,
          providerPaymentReference: refund.sourceProviderPaymentReference,
          reasonCode: refund.reasonCode,
          refundId: refund.id,
          sourceKind: refund.sourceKind,
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return { ok: false, code: "WRITE_FAILED" };
  }
  if ("ok" in prepared) return prepared;

  let providerResult: ProviderRefundResult;
  try {
    providerResult = await dependencies.paymentProvider.createRefund({
      amountRappen: prepared.amountRappen,
      idempotencyKey: `refund:${prepared.refundId}`,
      orderId: prepared.orderId,
      paymentAttemptId: prepared.paymentAttemptId,
      providerPaymentReference: prepared.providerPaymentReference,
      reasonCode: prepared.reasonCode,
      refundId: prepared.refundId,
      sourceKind: prepared.sourceKind,
    });
  } catch {
    // Ambiguous provider outcomes remain PENDING. The next idempotent retry or
    // signed webhook/reconciliation resolves the truth.
    return { ok: false, code: "PROVIDER_UNAVAILABLE" };
  }
  try {
    const persisted = await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "Refund"
          WHERE "id" = ${prepared.refundId}::uuid
          FOR UPDATE
        `;
        const refund = await transaction.refund.findUnique({
          where: { id: prepared.refundId },
          select: {
            amountRappen: true,
            currency: true,
            providerRefundReference: true,
            sourceKind: true,
            sourceProviderPaymentReference: true,
            status: true,
          },
        });
        if (
          refund === null ||
          refund.amountRappen !== providerResult.amountRappen ||
          refund.currency !== providerResult.currency ||
          refund.sourceKind !== prepared.sourceKind ||
          refund.sourceProviderPaymentReference !==
            prepared.providerPaymentReference ||
          (refund.providerRefundReference !== null &&
            refund.providerRefundReference !==
              providerResult.providerRefundReference)
        ) {
          throw new Error("REFUND_PROVIDER_RESULT_CONFLICT");
        }
        if (refund.status === "SUCCEEDED") return refund.status;
        if (refund.status !== "PENDING") {
          throw new Error("REFUND_PROVIDER_RESULT_STATE_CONFLICT");
        }
        await transaction.refund.update({
          where: { id: prepared.refundId },
          data: {
            providerRefundReference:
              refund.providerRefundReference ??
              providerResult.providerRefundReference,
            ...(providerResult.status === "FAILED"
              ? {
                  status: "FAILED" as const,
                  completedAt: dependencies.now,
                  failureCode: "PROVIDER_REFUND_FAILED",
                }
              : {}),
            updatedAt: dependencies.now,
          },
        });
        return providerResult.status === "FAILED" ? "FAILED" : "PENDING";
      },
      { isolationLevel: "Serializable" },
    );
    if (persisted === "SUCCEEDED") {
      return {
        ok: true,
        refundId: prepared.refundId,
        replay: true,
        status: "SUCCEEDED",
      };
    }
  } catch {
    return { ok: false, code: "WRITE_FAILED" };
  }
  return {
    ok: true,
    refundId: prepared.refundId,
    replay: false,
    status: providerResult.status === "FAILED" ? "FAILED" : "PENDING",
  };
}

export async function projectProviderRefundEvent(
  input: Readonly<{
    adapterKey: string;
    amountRappen: number;
    correlationId: string;
    currency: string;
    environment: string;
    now: Date;
    orderId: string;
    paymentAttemptId: string;
    providerAccountReference: string;
    providerEventId: string;
    providerMode: "CONTRACT" | "SANDBOX" | "LIVE";
    providerPaymentReference: string;
    providerRefundReference: string;
    providerStatus: string;
    refundId: string;
  }>,
  database: DatabaseClient,
): Promise<FinanceOperationResult> {
  if (
    !Number.isSafeInteger(input.amountRappen) ||
    input.amountRappen <= 0 ||
    input.currency !== "CHF" ||
    !z.uuid().safeParse(input.correlationId).success ||
    !z.uuid().safeParse(input.orderId).success ||
    !z.uuid().safeParse(input.paymentAttemptId).success ||
    !z.uuid().safeParse(input.refundId).success ||
    !Number.isFinite(input.now.getTime())
  ) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  try {
    return await database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "Refund"
          WHERE "id" = ${input.refundId}::uuid
          FOR UPDATE
        `;
        const refund = await transaction.refund.findUnique({
          where: { id: input.refundId },
          include: {
            order: {
              select: {
                id: true,
              },
            },
            paymentAttempt: {
              select: {
                adapterKey: true,
                environment: true,
                id: true,
                provider: true,
                providerAccountReference: true,
                providerMode: true,
              },
            },
          },
        });
        if (refund === null) {
          return { ok: false as const, code: "NOT_FOUND" as const };
        }
        if (
          refund.orderId !== input.orderId ||
          refund.paymentAttemptId !== input.paymentAttemptId ||
          refund.paymentAttempt.id !== input.paymentAttemptId ||
          refund.paymentAttempt.provider !== "STRIPE" ||
          refund.paymentAttempt.environment !== input.environment ||
          refund.paymentAttempt.adapterKey !== input.adapterKey ||
          refund.paymentAttempt.providerMode !== input.providerMode ||
          refund.paymentAttempt.providerAccountReference !==
            input.providerAccountReference ||
          refund.sourceProviderPaymentReference !==
            input.providerPaymentReference ||
          refund.amountRappen !== input.amountRappen ||
          refund.currency !== input.currency ||
          (refund.providerRefundReference !== null &&
            refund.providerRefundReference !== input.providerRefundReference)
        ) {
          return { ok: false as const, code: "CONFLICT" as const };
        }
        if (refund.providerRefundReference === null) {
          const bound = await transaction.refund.updateMany({
            where: {
              id: refund.id,
              providerRefundReference: null,
            },
            data: {
              providerRefundReference: input.providerRefundReference,
              updatedAt: input.now,
            },
          });
          if (bound.count !== 1) {
            return { ok: false as const, code: "CONFLICT" as const };
          }
        }
        if (refund.status === "SUCCEEDED") {
          return {
            ok: true as const,
            refundId: refund.id,
            replay: true,
            status: "SUCCEEDED" as const,
          };
        }
        if (input.providerStatus !== "succeeded") {
          const terminalFailure =
            input.providerStatus === "failed" ||
            input.providerStatus === "canceled";
          await transaction.refund.update({
            where: { id: refund.id },
            data: terminalFailure
              ? {
                  status: "FAILED",
                  completedAt: input.now,
                  failureCode: `PROVIDER_${input.providerStatus.toUpperCase()}`,
                  updatedAt: input.now,
                }
              : {
                  status: "PENDING",
                  updatedAt: input.now,
                },
          });
          return {
            ok: true as const,
            refundId: refund.id,
            replay: false,
            status: terminalFailure
              ? ("FAILED" as const)
              : ("PENDING" as const),
          };
        }
        await transaction.refund.update({
          where: { id: refund.id },
          data: {
            status: "SUCCEEDED",
            completedAt: input.now,
            failureCode: null,
            updatedAt: input.now,
          },
        });
        const totalSucceeded = await transaction.refund.aggregate({
          where: {
            sourceKind: refund.sourceKind,
            ...(refund.subscriptionProviderInvoiceId === null
              ? { paymentAttemptId: refund.paymentAttemptId }
              : {
                  subscriptionProviderInvoiceId:
                    refund.subscriptionProviderInvoiceId,
                }),
            status: "SUCCEEDED",
          },
          _sum: { amountRappen: true },
        });
        const paymentKind =
          (totalSucceeded._sum.amountRappen ?? 0) >= refund.sourceAmountRappen
            ? "REFUNDED"
            : "PARTIALLY_REFUNDED";
        await transaction.paymentEvent.createMany({
          data: [
            {
              orderId: refund.orderId,
              provider: "STRIPE",
              kind: paymentKind,
              providerReference: input.providerRefundReference,
              idempotencyKey: `provider-refund:${input.providerEventId}`,
              payload: {
                schemaVersion: "1",
                providerEventId: input.providerEventId,
                externalChargeClaimed: true,
                amountRappen: input.amountRappen,
                currency: "CHF",
              },
              createdAt: input.now,
            },
          ],
          skipDuplicates: true,
        });
        const creditNote = await transaction.creditNote.create({
          data: {
            id: randomUUID(),
            invoiceId: refund.invoiceId,
            subscriptionProviderInvoiceId:
              refund.subscriptionProviderInvoiceId,
            refundId: refund.id,
            companyId: refund.companyId,
            number: creditNoteNumber(refund.id),
            amountRappen: refund.amountRappen,
            currency: "CHF",
            status: "ISSUED",
            reasonCode: refund.reasonCode,
            idempotencyKey: `credit-note:${refund.id}`,
            issuedAt: input.now,
            createdAt: input.now,
          },
          select: { id: true },
        });
        await writeFinanceAudit(transaction, input.now, {
          action: "REFUND_COMPLETED",
          actorUserId: null,
          capability: "PAYMENT_WEBHOOK_PROJECT",
          companyId: refund.companyId,
          correlationId: input.correlationId,
          reasonCode: "SIGNED_REFUND_SUCCEEDED",
          targetId: refund.id,
          targetType: "REFUND",
        });
        await writeFinanceAudit(transaction, input.now, {
          action: "CREDIT_NOTE_ISSUED",
          actorUserId: null,
          capability: "PAYMENT_WEBHOOK_PROJECT",
          companyId: refund.companyId,
          correlationId: input.correlationId,
          reasonCode: "SIGNED_REFUND_SUCCEEDED",
          targetId: creditNote.id,
          targetType: "CREDIT_NOTE",
        });
        return {
          ok: true as const,
          refundId: refund.id,
          replay: false,
          status: "SUCCEEDED" as const,
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return { ok: false, code: "WRITE_FAILED" };
  }
}

type RefundSourceAuthority = Readonly<{
  invoiceId: string | null;
  orderId: string;
  paymentAttemptId: string;
  sourceAmountRappen: number;
  sourceKind: "INITIAL_ORDER" | "SUBSCRIPTION_PROVIDER_INVOICE";
  sourceProviderPaymentReference: string;
  subscriptionProviderInvoiceId: string | null;
}>;

async function loadInitialRefundSource(
  transaction: Prisma.TransactionClient,
  input: Readonly<{ companyId: string; orderId: string }>,
): Promise<RefundSourceAuthority | null> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Order"
    WHERE "id" = ${input.orderId}::uuid
    FOR UPDATE
  `;
  const order = await transaction.order.findFirst({
    where: {
      id: input.orderId,
      companyId: input.companyId,
      provider: "STRIPE",
      status: "PAID",
    },
    select: {
      id: true,
      invoice: { select: { id: true, status: true } },
      paymentAttempts: {
        where: { provider: "STRIPE", status: "SUCCEEDED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 2,
        select: {
          amountRappen: true,
          currency: true,
          id: true,
          providerPaymentReference: true,
        },
      },
    },
  });
  const attempt = order?.paymentAttempts[0];
  if (
    order === null ||
    order.invoice?.status !== "PAID" ||
    order.paymentAttempts.length !== 1 ||
    attempt === undefined ||
    attempt.currency !== "CHF" ||
    attempt.amountRappen <= 0 ||
    attempt.providerPaymentReference === null
  ) {
    return null;
  }
  return Object.freeze({
    invoiceId: order.invoice.id,
    orderId: order.id,
    paymentAttemptId: attempt.id,
    sourceAmountRappen: attempt.amountRappen,
    sourceKind: "INITIAL_ORDER" as const,
    sourceProviderPaymentReference: attempt.providerPaymentReference,
    subscriptionProviderInvoiceId: null,
  });
}

async function loadSubscriptionInvoiceRefundSource(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    companyId: string;
    orderId: string;
    subscriptionProviderInvoiceId: string;
  }>,
): Promise<RefundSourceAuthority | null> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "SubscriptionProviderInvoice"
    WHERE "id" = ${input.subscriptionProviderInvoiceId}::uuid
    FOR UPDATE
  `;
  const providerInvoice =
    await transaction.subscriptionProviderInvoice.findFirst({
      where: {
        id: input.subscriptionProviderInvoiceId,
        companyId: input.companyId,
        orderId: input.orderId,
        provider: "STRIPE",
        status: "PAID",
      },
      select: {
        amountRappen: true,
        companyId: true,
        currency: true,
        id: true,
        orderId: true,
        paymentAttemptId: true,
        providerPaymentReference: true,
      },
    });
  if (
    providerInvoice === null ||
    providerInvoice.amountRappen === null ||
    providerInvoice.amountRappen <= 0 ||
    providerInvoice.currency !== "CHF" ||
    providerInvoice.providerPaymentReference === null
  ) {
    return null;
  }
  return Object.freeze({
    invoiceId: null,
    orderId: providerInvoice.orderId,
    paymentAttemptId: providerInvoice.paymentAttemptId,
    sourceAmountRappen: providerInvoice.amountRappen,
    sourceKind: "SUBSCRIPTION_PROVIDER_INVOICE" as const,
    sourceProviderPaymentReference:
      providerInvoice.providerPaymentReference,
    subscriptionProviderInvoiceId: providerInvoice.id,
  });
}

export function financeRefundRequestAction(
  input: Readonly<{
    amountRappen: number;
    companyId: string;
    orderId: string;
    reasonCode: string;
    sourceKind?: "INITIAL_ORDER" | "SUBSCRIPTION_PROVIDER_INVOICE";
    subscriptionProviderInvoiceId?: string;
  }>,
) {
  return `FINANCE_REFUND_REQUEST:${digestJson(input).slice(0, 48)}`;
}

export function financeRefundApprovalAction(refundId: string) {
  return `FINANCE_REFUND_APPROVE:${refundId}`;
}

async function consumeFinanceStepUp(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    action: string;
    evidenceId: string;
    now: Date;
    purpose: string;
    tenantId: string;
    userId: string;
  }>,
) {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "AuthAssuranceEvidence"
    WHERE "id" = ${input.evidenceId}::uuid
    FOR UPDATE
  `;
  const evidence = await transaction.authAssuranceEvidence.findFirst({
    where: {
      id: input.evidenceId,
      userId: input.userId,
      tenantId: input.tenantId,
      purpose: input.purpose,
      action: input.action,
      method: { in: ["PASSWORD", "TOTP", "WEBAUTHN"] },
      issuedAt: {
        lte: input.now,
        gt: new Date(input.now.getTime() - FINANCE_STEP_UP_MAXIMUM_AGE_MS),
      },
      expiresAt: { gt: input.now },
      usedAt: null,
      revokedAt: null,
    },
    select: { id: true },
  });
  if (evidence === null) return false;
  const consumed = await transaction.authAssuranceEvidence.updateMany({
    where: {
      id: evidence.id,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: input.now },
    },
    data: { usedAt: input.now },
  });
  return consumed.count === 1;
}

async function writeFinanceAudit(
  transaction: Prisma.TransactionClient,
  now: Date,
  input: Readonly<{
    action: "REFUND_REQUESTED" | "REFUND_COMPLETED" | "CREDIT_NOTE_ISSUED";
    actorUserId: string | null;
    capability: string;
    companyId: string;
    correlationId: string;
    reasonCode: string;
    targetId: string;
    targetType: "REFUND" | "CREDIT_NOTE";
  }>,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: input.action,
    actorKind: input.actorUserId === null ? "SYSTEM" : "USER",
    ...(input.actorUserId === null ? {} : { actorUserId: input.actorUserId }),
    capability: input.capability,
    companyId: input.companyId,
    correlationId: input.correlationId,
    reasonCode: input.reasonCode,
    result: "SUCCEEDED",
    retainUntil: new Date(now.getTime() + FINANCE_RETENTION_MS),
    targetId: input.targetId,
    targetType: input.targetType,
  });
}

function creditNoteNumber(refundId: string) {
  return `CN-${refundId.replaceAll("-", "").slice(0, 29)}`;
}

function digestJson(value: object) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
