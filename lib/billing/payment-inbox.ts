import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { openDunningForPaymentFailureInTransaction } from "@/lib/billing/dunning";
import { projectProviderRefundEvent } from "@/lib/billing/finance-operations";
import { projectRealPaymentSuccess } from "@/lib/billing/orders";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type { EmailProvider } from "@/lib/providers/email";
import type { NormalizedPaymentProviderEvent } from "@/lib/providers/payments";

const FINANCE_RETENTION_MS = 10 * 365 * 86_400_000;
const uuidSchema = z.uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const normalizedPayloadSchema = z.strictObject({
  amountRappen: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  orderId: z.uuid().nullable(),
  paymentAttemptId: z.uuid().nullable(),
  providerObjectReference: z.string().min(3).max(255).nullable(),
  providerPaymentReference: z.string().min(3).max(255).nullable(),
  providerSessionReference: z.string().min(3).max(255).nullable(),
  providerStatus: z.string().min(1).max(64).nullable(),
});

export const PAYMENT_INBOX_POLICY_V1 = Object.freeze({
  provider: "STRIPE" as const,
  payloadSchemaVersion: "phase24-v1" as const,
  handlerKey: "payments.inbox-project" as const,
  handlerVersion: "v1" as const,
  maximumAttempts: 16,
});

export type PaymentInboxIngestionResult = Readonly<{
  inboxId: string;
  queued: boolean;
  replay: boolean;
}>;

export async function ingestVerifiedPaymentEvent(
  input: Readonly<{
    correlationId: string;
    environment: "local" | "ci" | "staging";
    event: NormalizedPaymentProviderEvent;
    projectionEnabled: boolean;
    rawBody: string;
    receivedAt: Date;
    signatureHeader: string;
  }>,
  database: DatabaseClient,
): Promise<PaymentInboxIngestionResult> {
  assertIngestionInput(input);
  const rawBodyDigest = digest(input.rawBody);
  const signatureDigest = digest(input.signatureHeader);
  const payload = normalizedPayload(input.event);

  return database.$transaction(async (transaction) => {
    const existing = await transaction.providerEventInbox.findUnique({
      where: {
        provider_environment_providerEventId: {
          provider: "STRIPE",
          environment: input.environment,
          providerEventId: input.event.providerEventId,
        },
      },
      select: { id: true },
    });
    if (existing !== null) {
      const workItem = await transaction.workItem.findUnique({
        where: {
          dedupeKey: inboxWorkDedupeKey(existing.id),
        },
        select: { id: true },
      });
      return Object.freeze({
        inboxId: existing.id,
        queued: workItem !== null,
        replay: true,
      });
    }

    const candidates = await resolveAttemptCandidates(
      transaction,
      input.event,
      input.environment,
    );
    const paymentAttemptId = candidates.length === 1 ? candidates[0]!.id : null;
    const inboxId = randomUUID();
    await transaction.providerEventInbox.create({
      data: {
        id: inboxId,
        paymentAttemptId,
        provider: "STRIPE",
        environment: input.environment,
        providerAccountReference: input.event.providerAccountReference,
        providerEventId: input.event.providerEventId,
        eventType: input.event.eventType,
        eventCreatedAt: input.event.eventCreatedAt,
        apiVersion: input.event.apiVersion,
        liveMode: input.event.liveMode,
        rawBodyDigest,
        signatureDigest,
        payloadSchemaVersion: PAYMENT_INBOX_POLICY_V1.payloadSchemaVersion,
        normalizedPayload: payload,
        status: "RECEIVED",
        receivedAt: input.receivedAt,
        createdAt: input.receivedAt,
        updatedAt: input.receivedAt,
      },
    });
    if (input.projectionEnabled) {
      await transaction.workItem.create({
        data: {
          handlerKey: PAYMENT_INBOX_POLICY_V1.handlerKey,
          handlerVersion: PAYMENT_INBOX_POLICY_V1.handlerVersion,
          subjectType: "PROVIDER_EVENT_INBOX",
          subjectId: inboxId,
          dedupeKey: inboxWorkDedupeKey(inboxId),
          effectKey: `effect:${inboxWorkDedupeKey(inboxId)}`,
          priority: 10,
          availableAt: input.receivedAt,
          maxAttempts: PAYMENT_INBOX_POLICY_V1.maximumAttempts,
          payloadVersion: PAYMENT_INBOX_POLICY_V1.payloadSchemaVersion,
          payloadReference: { providerEventInboxId: inboxId },
          createdAt: input.receivedAt,
          updatedAt: input.receivedAt,
        },
      });
    }
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "PAYMENT_EVENT_INGESTED",
      actorKind: "SYSTEM",
      capability: "PAYMENT_WEBHOOK_INGEST",
      correlationId: input.correlationId,
      reasonCode:
        candidates.length <= 1
          ? "SIGNATURE_VERIFIED"
          : "IDENTIFIER_CONFLICT_HELD",
      result: "SUCCEEDED",
      retainUntil: new Date(input.receivedAt.getTime() + FINANCE_RETENTION_MS),
      targetId: inboxId,
      targetType: "PROVIDER_EVENT",
    });
    return Object.freeze({
      inboxId,
      queued: input.projectionEnabled,
      replay: false,
    });
  });
}

export async function projectPaymentInboxEvent(
  input: Readonly<{
    correlationId: string;
    inboxId: string;
    now: Date;
  }>,
  dependencies: Readonly<{
    database: DatabaseClient;
    emailProvider: EmailProvider;
  }>,
) {
  if (
    !uuidSchema.safeParse(input.inboxId).success ||
    !uuidSchema.safeParse(input.correlationId).success ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError("Payment inbox projection input is invalid.");
  }
  const inbox = await dependencies.database.providerEventInbox.findUnique({
    where: { id: input.inboxId },
  });
  if (inbox === null) throw new Error("PAYMENT_INBOX_NOT_FOUND");
  if (
    inbox.status === "PROJECTED" ||
    inbox.status === "IGNORED" ||
    inbox.status === "HELD"
  ) {
    return Object.freeze({ status: inbox.status, replay: true });
  }
  const payload = normalizedPayloadSchema.parse(inbox.normalizedPayload);
  if (
    inbox.eventType === "refund.created" ||
    inbox.eventType === "refund.updated"
  ) {
    if (
      payload.amountRappen === null ||
      payload.currency !== "CHF" ||
      payload.providerObjectReference === null ||
      payload.providerStatus === null
    ) {
      return terminalizeInbox(dependencies.database, {
        correlationId: input.correlationId,
        inboxId: inbox.id,
        now: input.now,
        reasonCode: "REFUND_EVENT_INCOMPLETE",
        status: "HELD",
      });
    }
    const projected = await projectProviderRefundEvent(
      {
        amountRappen: payload.amountRappen,
        correlationId: input.correlationId,
        currency: payload.currency,
        now: input.now,
        providerEventId: inbox.providerEventId,
        providerRefundReference: payload.providerObjectReference,
        providerStatus: payload.providerStatus,
      },
      dependencies.database,
    );
    if (!projected.ok) {
      if (projected.code === "WRITE_FAILED") {
        await dependencies.database.providerEventInbox.updateMany({
          where: {
            id: inbox.id,
            status: { in: ["RECEIVED", "FAILED"] },
          },
          data: {
            status: "FAILED",
            processedAt: input.now,
            nextRetryAt: new Date(input.now.getTime() + 60_000),
            attemptCount: { increment: 1 },
            failureClass: "TRANSIENT",
            errorCode: "REFUND_WRITE_FAILED",
            updatedAt: input.now,
          },
        });
        throw new Error("REFUND_PROJECTION_WRITE_FAILED");
      }
      return terminalizeInbox(dependencies.database, {
        correlationId: input.correlationId,
        inboxId: inbox.id,
        now: input.now,
        reasonCode: `REFUND_${projected.code}`,
        status: "HELD",
      });
    }
    return terminalizeInbox(dependencies.database, {
      correlationId: input.correlationId,
      inboxId: inbox.id,
      now: input.now,
      reasonCode: `REFUND_${projected.status}`,
      status: "PROJECTED",
    });
  }
  if (
    inbox.eventType === "checkout.session.completed" &&
    payload.providerStatus === "unpaid"
  ) {
    return projectNonSuccessState(
      dependencies.database,
      inbox,
      "PENDING",
      input,
    );
  }
  if (isSuccessEvent(inbox.eventType)) {
    if (
      inbox.paymentAttemptId === null ||
      payload.amountRappen === null ||
      payload.currency !== "CHF" ||
      payload.providerPaymentReference === null ||
      payload.providerStatus !== "paid"
    ) {
      return terminalizeInbox(dependencies.database, {
        correlationId: input.correlationId,
        inboxId: inbox.id,
        now: input.now,
        reasonCode: "SUCCESS_EVENT_INCOMPLETE",
        status: "HELD",
      });
    }
    const projected = await projectRealPaymentSuccess(
      {
        amountRappen: payload.amountRappen,
        correlationId: input.correlationId,
        eventCreatedAt: inbox.eventCreatedAt,
        paymentAttemptId: inbox.paymentAttemptId,
        providerEventId: inbox.providerEventId,
        providerPaymentReference: payload.providerPaymentReference,
      },
      {
        database: dependencies.database,
        emailProvider: dependencies.emailProvider,
        now: input.now,
      },
    );
    if (!projected.ok) {
      if (
        projected.code === "PAYMENT_HELD" ||
        projected.code === "CONFLICT" ||
        projected.code === "NOT_FOUND"
      ) {
        return terminalizeInbox(dependencies.database, {
          correlationId: input.correlationId,
          inboxId: inbox.id,
          now: input.now,
          reasonCode: `PAYMENT_${projected.code}`,
          status: "HELD",
        });
      }
      await dependencies.database.providerEventInbox.updateMany({
        where: {
          id: inbox.id,
          status: { in: ["RECEIVED", "FAILED"] },
        },
        data: {
          status: "FAILED",
          processedAt: input.now,
          nextRetryAt: new Date(input.now.getTime() + 60_000),
          attemptCount: { increment: 1 },
          failureClass: "TRANSIENT",
          errorCode: projected.code,
          updatedAt: input.now,
        },
      });
      throw new Error(`PAYMENT_PROJECTION_${projected.code}`);
    }
    return terminalizeInbox(dependencies.database, {
      correlationId: input.correlationId,
      inboxId: inbox.id,
      now: input.now,
      reasonCode: "SIGNED_PAYMENT_SUCCEEDED",
      status: "PROJECTED",
    });
  }
  if (isPendingEvent(inbox.eventType)) {
    return projectNonSuccessState(
      dependencies.database,
      inbox,
      "PENDING",
      input,
    );
  }
  if (isFailureEvent(inbox.eventType)) {
    return projectNonSuccessState(
      dependencies.database,
      inbox,
      "FAILED",
      input,
    );
  }
  if (inbox.eventType === "checkout.session.expired") {
    return projectNonSuccessState(
      dependencies.database,
      inbox,
      "EXPIRED",
      input,
    );
  }
  if (inbox.eventType === "charge.dispute.created") {
    return projectChargebackOpened(
      dependencies.database,
      inbox,
      payload,
      input,
    );
  }
  if (inbox.eventType === "charge.dispute.closed") {
    return projectChargebackResolved(
      dependencies.database,
      inbox,
      payload,
      input,
    );
  }
  return terminalizeInbox(dependencies.database, {
    correlationId: input.correlationId,
    inboxId: inbox.id,
    now: input.now,
    reasonCode: "EVENT_TYPE_NOT_PROJECTED",
    status: "IGNORED",
  });
}

async function resolveAttemptCandidates(
  transaction: Prisma.TransactionClient,
  event: NormalizedPaymentProviderEvent,
  environment: string,
) {
  const or: Prisma.PaymentAttemptWhereInput[] = [];
  if (event.paymentAttemptId !== null) {
    or.push({ id: event.paymentAttemptId });
  }
  if (event.providerSessionReference !== null) {
    or.push({
      providerSessionReference: event.providerSessionReference,
    });
  }
  if (event.providerPaymentReference !== null) {
    or.push({
      providerPaymentReference: event.providerPaymentReference,
    });
  }
  if (event.orderId !== null) or.push({ orderId: event.orderId });
  if (or.length === 0) return [];
  return transaction.paymentAttempt.findMany({
    where: {
      provider: "STRIPE",
      environment,
      providerAccountReference: event.providerAccountReference,
      OR: or,
    },
    distinct: ["id"],
    select: { id: true },
  });
}

async function projectNonSuccessState(
  database: DatabaseClient,
  inbox: Readonly<{
    id: string;
    paymentAttemptId: string | null;
    eventType: string;
    eventCreatedAt: Date;
    providerEventId: string;
  }>,
  target: "PENDING" | "FAILED" | "EXPIRED",
  input: Readonly<{ correlationId: string; now: Date }>,
) {
  if (inbox.paymentAttemptId === null) {
    return terminalizeInbox(database, {
      ...input,
      inboxId: inbox.id,
      reasonCode: "PAYMENT_ATTEMPT_UNRESOLVED",
      status: "HELD",
    });
  }
  return database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "PaymentAttempt"
      WHERE "id" = ${inbox.paymentAttemptId}::uuid
      FOR UPDATE
    `;
    const attempt = await transaction.paymentAttempt.findUnique({
      where: { id: inbox.paymentAttemptId! },
      select: {
        id: true,
        orderId: true,
        companyId: true,
        status: true,
        lastProviderEventAt: true,
      },
    });
    if (attempt === null) throw new Error("PAYMENT_ATTEMPT_NOT_FOUND");
    if (
      attempt.status === "SUCCEEDED" ||
      (attempt.lastProviderEventAt !== null &&
        inbox.eventCreatedAt.getTime() < attempt.lastProviderEventAt.getTime())
    ) {
      return markInboxInTransaction(transaction, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "OUT_OF_ORDER_EVENT_IGNORED",
        status: "IGNORED",
      });
    }
    await transaction.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: target,
        failureCode: target === "PENDING" ? null : `PROVIDER_${target}`,
        lastProviderEventAt: inbox.eventCreatedAt,
        updatedAt: input.now,
      },
    });
    await transaction.paymentEvent.createMany({
      data: [
        {
          orderId: attempt.orderId,
          provider: "STRIPE",
          kind: target === "PENDING" ? "PENDING" : "FAILED",
          idempotencyKey: `provider-state:${inbox.providerEventId}`,
          payload: {
            schemaVersion: "1",
            providerEventId: inbox.providerEventId,
            providerState: target,
            externalChargeClaimed: false,
          },
          createdAt: input.now,
        },
      ],
      skipDuplicates: true,
    });
    if (target === "FAILED" || target === "EXPIRED") {
      await transaction.order.updateMany({
        where: {
          id: attempt.orderId,
          companyId: attempt.companyId,
          status: "PENDING",
        },
        data:
          target === "FAILED"
            ? { status: "FAILED", failedAt: input.now }
            : { status: "EXPIRED" },
      });
      if (target === "FAILED") {
        await openDunningForPaymentFailureInTransaction(transaction, {
          companyId: attempt.companyId,
          correlationId: input.correlationId,
          now: input.now,
          paymentAttemptId: attempt.id,
        });
      }
    }
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: attempt.companyId,
      inboxId: inbox.id,
      reasonCode: `PROVIDER_${target}`,
      status: "PROJECTED",
    });
  });
}

async function projectChargebackOpened(
  database: DatabaseClient,
  inbox: Readonly<{
    id: string;
    paymentAttemptId: string | null;
    providerEventId: string;
    eventCreatedAt: Date;
  }>,
  payload: z.infer<typeof normalizedPayloadSchema>,
  input: Readonly<{ correlationId: string; now: Date }>,
) {
  if (
    inbox.paymentAttemptId === null ||
    payload.amountRappen === null ||
    payload.currency !== "CHF" ||
    payload.providerObjectReference === null
  ) {
    return terminalizeInbox(database, {
      ...input,
      inboxId: inbox.id,
      reasonCode: "CHARGEBACK_EVENT_INCOMPLETE",
      status: "HELD",
    });
  }
  const amountRappen = payload.amountRappen;
  return database.$transaction(async (transaction) => {
    const attempt = await transaction.paymentAttempt.findUnique({
      where: { id: inbox.paymentAttemptId! },
      select: { id: true, orderId: true, companyId: true },
    });
    if (attempt === null) throw new Error("PAYMENT_ATTEMPT_NOT_FOUND");
    await transaction.chargeback.createMany({
      data: [
        {
          orderId: attempt.orderId,
          paymentAttemptId: attempt.id,
          companyId: attempt.companyId,
          providerDisputeReference: payload.providerObjectReference!,
          amountRappen,
          currency: "CHF",
          status: "OPEN",
          reasonCode: "PROVIDER_DISPUTE_OPENED",
          openedAt: inbox.eventCreatedAt,
          evidenceDigest: digest(
            `${payload.providerObjectReference}:${amountRappen}:CHF`,
          ),
          createdAt: input.now,
          updatedAt: input.now,
        },
      ],
      skipDuplicates: true,
    });
    await transaction.paymentEvent.createMany({
      data: [
        {
          orderId: attempt.orderId,
          provider: "STRIPE",
          kind: "CHARGEBACK_OPENED",
          idempotencyKey: `chargeback:${inbox.providerEventId}`,
          payload: {
            schemaVersion: "1",
            providerEventId: inbox.providerEventId,
          },
          createdAt: input.now,
        },
      ],
      skipDuplicates: true,
    });
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: attempt.companyId,
      inboxId: inbox.id,
      reasonCode: "CHARGEBACK_OPENED",
      status: "PROJECTED",
    });
  });
}

async function projectChargebackResolved(
  database: DatabaseClient,
  inbox: Readonly<{
    id: string;
    providerEventId: string;
    eventCreatedAt: Date;
  }>,
  payload: z.infer<typeof normalizedPayloadSchema>,
  input: Readonly<{ correlationId: string; now: Date }>,
) {
  const status =
    payload.providerStatus === "won"
      ? "WON"
      : payload.providerStatus === "lost"
        ? "LOST"
        : payload.providerStatus === "warning_closed"
          ? "ACCEPTED"
          : null;
  if (payload.providerObjectReference === null || status === null) {
    return terminalizeInbox(database, {
      ...input,
      inboxId: inbox.id,
      reasonCode: "CHARGEBACK_RESOLUTION_INCOMPLETE",
      status: "HELD",
    });
  }
  return database.$transaction(async (transaction) => {
    const chargeback = await transaction.chargeback.findUnique({
      where: {
        providerDisputeReference: payload.providerObjectReference!,
      },
    });
    if (chargeback === null) {
      return markInboxInTransaction(transaction, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "CHARGEBACK_NOT_FOUND",
        status: "HELD",
      });
    }
    if (chargeback.status === "OPEN") {
      await transaction.chargeback.update({
        where: { id: chargeback.id },
        data: {
          status,
          resolvedAt: inbox.eventCreatedAt,
          updatedAt: input.now,
        },
      });
      await transaction.paymentEvent.createMany({
        data: [
          {
            orderId: chargeback.orderId,
            provider: "STRIPE",
            kind: "CHARGEBACK_RESOLVED",
            idempotencyKey: `chargeback-resolution:${inbox.providerEventId}`,
            payload: {
              schemaVersion: "1",
              providerEventId: inbox.providerEventId,
              providerStatus: status,
            },
            createdAt: input.now,
          },
        ],
        skipDuplicates: true,
      });
    }
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: chargeback.companyId,
      inboxId: inbox.id,
      reasonCode: `CHARGEBACK_${status}`,
      status: "PROJECTED",
    });
  });
}

async function terminalizeInbox(
  database: DatabaseClient,
  input: Readonly<{
    companyId?: string;
    correlationId: string;
    inboxId: string;
    now: Date;
    reasonCode: string;
    status: "PROJECTED" | "HELD" | "IGNORED";
  }>,
) {
  return database.$transaction((transaction) =>
    markInboxInTransaction(transaction, input),
  );
}

async function markInboxInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    companyId?: string;
    correlationId: string;
    inboxId: string;
    now: Date;
    reasonCode: string;
    status: "PROJECTED" | "HELD" | "IGNORED";
  }>,
) {
  const updated = await transaction.providerEventInbox.updateMany({
    where: {
      id: input.inboxId,
      status: { in: ["RECEIVED", "FAILED"] },
    },
    data: {
      status: input.status,
      processedAt: input.now,
      nextRetryAt: null,
      attemptCount: { increment: 1 },
      failureClass: input.status === "HELD" ? "PERMANENT_VALIDATION" : null,
      errorCode: input.status === "PROJECTED" ? null : input.reasonCode,
      updatedAt: input.now,
    },
  });
  if (updated.count === 1) {
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "PAYMENT_EVENT_PROJECTED",
      actorKind: "SYSTEM",
      capability: "PAYMENT_WEBHOOK_PROJECT",
      companyId: input.companyId,
      correlationId: input.correlationId,
      reasonCode: input.reasonCode,
      result: "SUCCEEDED",
      retainUntil: new Date(input.now.getTime() + FINANCE_RETENTION_MS),
      targetId: input.inboxId,
      targetType: "PROVIDER_EVENT",
    });
  }
  return Object.freeze({
    status: input.status,
    replay: updated.count === 0,
  });
}

function normalizedPayload(
  event: NormalizedPaymentProviderEvent,
): Prisma.InputJsonObject {
  return normalizedPayloadSchema.parse({
    amountRappen: event.amountRappen,
    currency: event.currency,
    orderId: event.orderId,
    paymentAttemptId: event.paymentAttemptId,
    providerObjectReference: event.providerObjectReference,
    providerPaymentReference: event.providerPaymentReference,
    providerSessionReference: event.providerSessionReference,
    providerStatus: event.providerStatus,
  });
}

function isSuccessEvent(eventType: string) {
  return (
    eventType === "checkout.session.completed" ||
    eventType === "checkout.session.async_payment_succeeded"
  );
}

function isPendingEvent(eventType: string) {
  return eventType === "checkout.session.async_payment_pending";
}

function isFailureEvent(eventType: string) {
  return (
    eventType === "checkout.session.async_payment_failed" ||
    eventType === "payment_intent.payment_failed"
  );
}

function inboxWorkDedupeKey(inboxId: string) {
  return `${PAYMENT_INBOX_POLICY_V1.handlerKey}:v1:${inboxId}`;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertIngestionInput(
  input: Readonly<{
    correlationId: string;
    environment: string;
    event: NormalizedPaymentProviderEvent;
    rawBody: string;
    receivedAt: Date;
    signatureHeader: string;
  }>,
) {
  if (
    !uuidSchema.safeParse(input.correlationId).success ||
    !["local", "ci", "staging"].includes(input.environment) ||
    input.event.liveMode ||
    !Number.isFinite(input.receivedAt.getTime()) ||
    input.rawBody.length === 0 ||
    input.signatureHeader.length === 0 ||
    !sha256Schema.safeParse(digest(input.rawBody)).success
  ) {
    throw new TypeError("Verified payment event envelope is invalid.");
  }
}
