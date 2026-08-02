import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { consumeStepUpGrant } from "@/lib/auth/assurance/step-up-service";
import {
  openDunningForPaymentFailureInTransaction,
  resolveCompanyDunningInTransaction,
  resolveProviderInvoiceDunningInTransaction,
} from "@/lib/billing/dunning";
import { projectProviderRefundEvent } from "@/lib/billing/finance-operations";
import { projectRealPaymentSuccess } from "@/lib/billing/orders";
import {
  decideSubscriptionProviderOrdering,
  paymentAttemptProviderRank,
  subscriptionProviderInvoiceProjectionDigestV1,
  type SubscriptionProviderSignal,
} from "@/lib/billing/subscription-provider-ordering";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type { EmailProvider } from "@/lib/providers/email";
import type {
  HostedPaymentProvider,
  NormalizedPaymentProviderEvent,
  PaymentRuntimeMode,
  StripePaymentAdapterKey,
} from "@/lib/providers/payments";
import { StripePaymentProviderError } from "@/lib/providers/payments";

const FINANCE_RETENTION_MS = 10 * 365 * 86_400_000;
const uuidSchema = z.uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const normalizedPayloadSchema = z.strictObject({
  amountRappen: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  providerCancelAtPeriodEnd: z.boolean().nullable().default(null),
  orderId: z.uuid().nullable(),
  paymentAttemptId: z.uuid().nullable(),
  refundId: z.uuid().nullable().default(null),
  providerObjectReference: z.string().min(3).max(255).nullable(),
  providerPaymentReference: z.string().min(3).max(255).nullable(),
  providerSessionReference: z.string().min(3).max(255).nullable(),
  providerCustomerReference: z
    .string()
    .min(3)
    .max(255)
    .nullable()
    .default(null),
  providerInvoiceReference: z.string().min(3).max(255).nullable().default(null),
  providerPriceReference: z.string().min(3).max(255).nullable().default(null),
  providerSubscriptionReference: z
    .string()
    .min(3)
    .max(255)
    .nullable()
    .default(null),
  providerPeriodStart: z.iso
    .datetime({ offset: true })
    .nullable()
    .default(null),
  providerPeriodEnd: z.iso.datetime({ offset: true }).nullable().default(null),
  providerStatus: z.string().min(1).max(64).nullable(),
});

export const PAYMENT_INBOX_POLICY_V1 = Object.freeze({
  provider: "STRIPE" as const,
  payloadSchemaVersion: "phase33-v1" as const,
  handlerKey: "payments.inbox-project" as const,
  handlerVersion: "v1" as const,
  maximumAttempts: 16,
});

export type PaymentInboxIngestionResult = Readonly<{
  inboxId: string;
  queued: boolean;
  replay: boolean;
}>;

export type PaymentInboxBacklogResumeResult = Readonly<{
  selected: number;
  created: number;
  replayed: number;
}>;

export const PAYMENT_SETTLEMENT_RELEASE_POLICY_V1 = Object.freeze({
  action: "PAYMENT_SETTLEMENT_RELEASE" as const,
  capability: "ADMIN_BILLING_MUTATE" as const,
  purpose: "FINANCE_RECONCILIATION" as const,
});

export type HeldSettlementReleaseResult =
  | Readonly<{ ok: true; inboxId: string; queued: true }>
  | Readonly<{
      ok: false;
      code:
        | "DISABLED"
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "STEP_UP_REQUIRED"
        | "CONFLICT"
        | "WRITE_FAILED";
    }>;

export async function ingestVerifiedPaymentEvent(
  input: Readonly<{
    adapterKey: StripePaymentAdapterKey;
    adapterVersion: "v1";
    correlationId: string;
    environment: "local" | "ci" | "preview" | "staging" | "production";
    event: NormalizedPaymentProviderEvent;
    expectedLiveMode: boolean;
    outboundActivationActive?: boolean;
    projectionEnabled: boolean;
    providerMode: PaymentRuntimeMode;
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
      select: {
        id: true,
        adapterKey: true,
        adapterVersion: true,
        expectedLiveMode: true,
        liveMode: true,
        providerAccountReference: true,
        providerMode: true,
        rawBodyDigest: true,
        status: true,
      },
    });
    if (existing !== null) {
      // Stripe signs every delivery attempt independently, so a legitimate
      // retry can carry a fresh timestamp/signature. The immutable first
      // signature remains evidence; replay identity is the provider event
      // scope plus the exact authenticated raw-body digest.
      if (
        existing.adapterKey !== input.adapterKey ||
        existing.adapterVersion !== input.adapterVersion ||
        existing.providerMode !== input.providerMode ||
        existing.expectedLiveMode !== input.expectedLiveMode ||
        existing.liveMode !== input.event.liveMode ||
        existing.providerAccountReference !==
          input.event.providerAccountReference ||
        existing.rawBodyDigest !== rawBodyDigest
      ) {
        throw new TypeError("Payment event replay envelope conflicts.");
      }
      let workItem = await transaction.workItem.findUnique({
        where: {
          dedupeKey: inboxWorkDedupeKey(existing.id),
        },
        select: { id: true },
      });
      if (
        workItem === null &&
        input.projectionEnabled &&
        (existing.status === "RECEIVED" || existing.status === "FAILED")
      ) {
        await createPaymentInboxWorkItem(
          transaction,
          existing.id,
          input.receivedAt,
        );
        workItem = await transaction.workItem.findUnique({
          where: { dedupeKey: inboxWorkDedupeKey(existing.id) },
          select: { id: true },
        });
      }
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
      input.adapterKey,
      input.providerMode,
      input.expectedLiveMode,
    );
    const paymentAttemptId = candidates.length === 1 ? candidates[0]!.id : null;
    const settlementHeld =
      input.outboundActivationActive === false &&
      paymentAttemptId !== null &&
      input.event.providerStatus === "paid" &&
      (isSuccessEvent(input.event.eventType) ||
        isPaidSubscriptionInvoiceEvent(input.event.eventType));
    if (settlementHeld) {
      await transaction.paymentAttempt.updateMany({
        where: {
          id: paymentAttemptId!,
          status: { not: "SUCCEEDED" },
        },
        data: {
          status: "HELD",
          failureCode: "SETTLEMENT_AFTER_PROVIDER_REVOKE",
          updatedAt: input.receivedAt,
        },
      });
    }
    const inboxId = randomUUID();
    await transaction.providerEventInbox.create({
      data: {
        id: inboxId,
        paymentAttemptId,
        provider: "STRIPE",
        environment: input.environment,
        adapterKey: input.adapterKey,
        adapterVersion: input.adapterVersion,
        providerMode: input.providerMode,
        expectedLiveMode: input.expectedLiveMode,
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
        status: settlementHeld ? "HELD" : "RECEIVED",
        processedAt: settlementHeld ? input.receivedAt : null,
        failureClass: settlementHeld ? "PERMANENT_VALIDATION" : null,
        errorCode: settlementHeld ? "SETTLEMENT_AFTER_PROVIDER_REVOKE" : null,
        receivedAt: input.receivedAt,
        createdAt: input.receivedAt,
        updatedAt: input.receivedAt,
      },
    });
    if (input.projectionEnabled && !settlementHeld) {
      await createPaymentInboxWorkItem(transaction, inboxId, input.receivedAt);
    }
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "PAYMENT_EVENT_INGESTED",
      actorKind: "SYSTEM",
      capability: "PAYMENT_WEBHOOK_INGEST",
      correlationId: input.correlationId,
      reasonCode: settlementHeld
        ? "SETTLEMENT_AFTER_PROVIDER_REVOKE"
        : candidates.length <= 1
          ? "SIGNATURE_VERIFIED"
          : "IDENTIFIER_CONFLICT_HELD",
      result: "SUCCEEDED",
      retainUntil: new Date(input.receivedAt.getTime() + FINANCE_RETENTION_MS),
      targetId: inboxId,
      targetType: "PROVIDER_EVENT",
    });
    return Object.freeze({
      inboxId,
      queued: input.projectionEnabled && !settlementHeld,
      replay: false,
    });
  });
}

/**
 * Bounded operational bridge for events accepted while projection was
 * intentionally disabled. Row locks and the WorkItem dedupe key make
 * concurrent scheduler/recovery calls exactly-once at the queue boundary.
 * Existing retry/DLQ items are never replaced with a second attempt chain.
 */
export async function resumePaymentInboxProjectionBacklog(
  input: Readonly<{
    batchSize?: number;
    now: Date;
  }>,
  database: DatabaseClient,
): Promise<PaymentInboxBacklogResumeResult> {
  const batchSize = input.batchSize ?? 100;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100 ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError("Payment inbox backlog resume input is invalid.");
  }
  return database.$transaction(async (transaction) => {
    const candidates = await transaction.$queryRaw<
      Array<{ id: string; nextRetryAt: Date | null }>
    >`
      SELECT inbox."id", inbox."nextRetryAt"
      FROM "ProviderEventInbox" inbox
      WHERE inbox."status" IN ('RECEIVED', 'FAILED')
        AND NOT EXISTS (
          SELECT 1
          FROM "WorkItem" work
          WHERE work."handlerKey" = ${PAYMENT_INBOX_POLICY_V1.handlerKey}
            AND work."handlerVersion" = ${PAYMENT_INBOX_POLICY_V1.handlerVersion}
            AND work."subjectType" = 'PROVIDER_EVENT_INBOX'
            AND work."subjectId" = inbox."id"::text
        )
      ORDER BY inbox."receivedAt" ASC, inbox."id" ASC
      FOR UPDATE OF inbox SKIP LOCKED
      LIMIT ${batchSize}
    `;
    let created = 0;
    for (const candidate of candidates) {
      const availableAt =
        candidate.nextRetryAt !== null &&
        candidate.nextRetryAt.getTime() > input.now.getTime()
          ? candidate.nextRetryAt
          : input.now;
      if (
        await createPaymentInboxWorkItem(transaction, candidate.id, availableAt)
      ) {
        created += 1;
      }
    }
    return Object.freeze({
      selected: candidates.length,
      created,
      replayed: candidates.length - created,
    });
  });
}

/**
 * Human-authorised recovery for a valid signed settlement that arrived after
 * outbound provider authority was revoked. Revocation must stop new effects,
 * but cannot make money already collected disappear. This path is therefore
 * separately feature-gated, capability-gated and bound to a single-use AAL2
 * grant for the exact tenant and inbox row.
 */
export async function releaseHeldSettlementForProjection(
  raw: unknown,
  dependencies: Readonly<{
    actor: Readonly<{
      capabilities: readonly string[];
      role: string;
      sessionId: string;
      status: string;
      userId: string;
    }>;
    database: DatabaseClient;
    financeRepairActionsEnabled: boolean;
    now: Date;
  }>,
): Promise<HeldSettlementReleaseResult> {
  const parsed = z
    .strictObject({
      correlationId: z.uuid(),
      inboxId: z.uuid(),
      reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
      stepUpEvidenceId: z.uuid(),
      stepUpGrantToken: z.string().min(32).max(128),
    })
    .safeParse(raw);
  if (!parsed.success || !Number.isFinite(dependencies.now.getTime())) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (!dependencies.financeRepairActionsEnabled) {
    return { ok: false, code: "DISABLED" };
  }
  if (
    dependencies.actor.role !== "ADMIN" ||
    dependencies.actor.status !== "ACTIVE" ||
    !dependencies.actor.capabilities.includes(
      PAYMENT_SETTLEMENT_RELEASE_POLICY_V1.capability,
    )
  ) {
    return { ok: false, code: "FORBIDDEN" };
  }

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "ProviderEventInbox"
          WHERE "id" = ${parsed.data.inboxId}::uuid
          FOR UPDATE
        `;
        const inbox = await transaction.providerEventInbox.findUnique({
          where: { id: parsed.data.inboxId },
          include: {
            paymentAttempt: {
              select: {
                companyId: true,
                failureCode: true,
                id: true,
                status: true,
              },
            },
          },
        });
        if (inbox === null || inbox.paymentAttempt === null) {
          return { ok: false as const, code: "NOT_FOUND" as const };
        }
        const attempt = inbox.paymentAttempt;
        if (
          inbox.provider !== "STRIPE" ||
          inbox.status !== "HELD" ||
          inbox.errorCode !== "SETTLEMENT_AFTER_PROVIDER_REVOKE" ||
          inbox.failureClass !== "PERMANENT_VALIDATION" ||
          attempt.status !== "HELD" ||
          attempt.failureCode !== "SETTLEMENT_AFTER_PROVIDER_REVOKE"
        ) {
          return { ok: false as const, code: "CONFLICT" as const };
        }
        const payload = normalizedPayloadSchema.safeParse(
          inbox.normalizedPayload,
        );
        if (
          !payload.success ||
          payload.data.providerStatus !== "paid" ||
          (!isSuccessEvent(inbox.eventType) &&
            !isPaidSubscriptionInvoiceEvent(inbox.eventType))
        ) {
          return { ok: false as const, code: "CONFLICT" as const };
        }
        const consumed = await consumeStepUpGrant(transaction, {
          evidenceId: parsed.data.stepUpEvidenceId,
          grantToken: parsed.data.stepUpGrantToken,
          actor: dependencies.actor,
          purpose: PAYMENT_SETTLEMENT_RELEASE_POLICY_V1.purpose,
          action: PAYMENT_SETTLEMENT_RELEASE_POLICY_V1.action,
          tenantId: attempt.companyId,
          resourceId: inbox.id,
          correlationId: parsed.data.correlationId,
          now: dependencies.now,
        });
        if (!consumed) {
          return {
            ok: false as const,
            code: "STEP_UP_REQUIRED" as const,
          };
        }
        const attemptReleased = await transaction.paymentAttempt.updateMany({
          where: {
            id: attempt.id,
            status: "HELD",
            failureCode: "SETTLEMENT_AFTER_PROVIDER_REVOKE",
          },
          data: {
            status: "PENDING",
            failureCode: null,
            updatedAt: dependencies.now,
          },
        });
        const inboxReleased = await transaction.providerEventInbox.updateMany({
          where: {
            id: inbox.id,
            status: "HELD",
            errorCode: "SETTLEMENT_AFTER_PROVIDER_REVOKE",
          },
          data: {
            status: "RECEIVED",
            processedAt: null,
            nextRetryAt: null,
            failureClass: null,
            errorCode: null,
            updatedAt: dependencies.now,
          },
        });
        if (attemptReleased.count !== 1 || inboxReleased.count !== 1) {
          throw new Error("HELD_SETTLEMENT_RELEASE_CONFLICT");
        }
        const queued = await createPaymentInboxWorkItem(
          transaction,
          inbox.id,
          dependencies.now,
        );
        if (!queued) throw new Error("HELD_SETTLEMENT_QUEUE_CONFLICT");
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "RECONCILIATION_ITEM_REPAIRED",
            actorKind: "USER",
            actorUserId: dependencies.actor.userId,
            capability: PAYMENT_SETTLEMENT_RELEASE_POLICY_V1.capability,
            companyId: attempt.companyId,
            correlationId: parsed.data.correlationId,
            reasonCode: parsed.data.reasonCode,
            result: "SUCCEEDED",
            retainUntil: new Date(
              dependencies.now.getTime() + FINANCE_RETENTION_MS,
            ),
            targetId: inbox.id,
            targetType: "PROVIDER_EVENT",
          },
        );
        return { ok: true as const, inboxId: inbox.id, queued: true as const };
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return { ok: false, code: "WRITE_FAILED" };
  }
}

async function createPaymentInboxWorkItem(
  transaction: Prisma.TransactionClient,
  inboxId: string,
  availableAt: Date,
) {
  const dedupeKey = inboxWorkDedupeKey(inboxId);
  const result = await transaction.workItem.createMany({
    data: [
      {
        handlerKey: PAYMENT_INBOX_POLICY_V1.handlerKey,
        handlerVersion: PAYMENT_INBOX_POLICY_V1.handlerVersion,
        subjectType: "PROVIDER_EVENT_INBOX",
        subjectId: inboxId,
        dedupeKey,
        effectKey: `effect:${dedupeKey}`,
        priority: 10,
        availableAt,
        maxAttempts: PAYMENT_INBOX_POLICY_V1.maximumAttempts,
        payloadVersion: PAYMENT_INBOX_POLICY_V1.payloadSchemaVersion,
        payloadReference: { providerEventInboxId: inboxId },
        createdAt: availableAt,
        updatedAt: availableAt,
      },
    ],
    skipDuplicates: true,
  });
  return result.count === 1;
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
    paymentProvider?: HostedPaymentProvider;
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
  let payload = normalizedPayloadSchema.parse(inbox.normalizedPayload);
  if (
    isPaidSubscriptionInvoiceEvent(inbox.eventType) &&
    payload.providerPaymentReference === null &&
    payload.providerInvoiceReference !== null &&
    payload.amountRappen !== null &&
    payload.amountRappen > 0 &&
    payload.currency === "CHF" &&
    payload.providerStatus === "paid"
  ) {
    const hydrated = await hydratePaidInvoicePayment(
      dependencies.database,
      inbox,
      payload,
      dependencies.paymentProvider,
      input,
    );
    if ("status" in hydrated) return hydrated;
    payload = hydrated;
  }
  if (
    inbox.eventType === "refund.created" ||
    inbox.eventType === "refund.updated"
  ) {
    if (
      payload.amountRappen === null ||
      payload.currency !== "CHF" ||
      payload.providerObjectReference === null ||
      payload.providerPaymentReference === null ||
      payload.orderId === null ||
      payload.paymentAttemptId === null ||
      payload.refundId === null ||
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
        adapterKey: inbox.adapterKey,
        environment: inbox.environment,
        orderId: payload.orderId,
        paymentAttemptId: payload.paymentAttemptId,
        providerAccountReference: inbox.providerAccountReference,
        providerMode: inbox.providerMode,
        providerPaymentReference: payload.providerPaymentReference,
        providerRefundReference: payload.providerObjectReference,
        providerStatus: payload.providerStatus,
        refundId: payload.refundId,
      },
      dependencies.database,
    );
    if (!projected.ok) {
      if (projected.code === "WRITE_FAILED" || projected.code === "NOT_FOUND") {
        await markPaymentInboxForRetry(
          dependencies.database,
          inbox.id,
          input.now,
          projected.code === "NOT_FOUND"
            ? "REFUND_BINDING_NOT_YET_VISIBLE"
            : "REFUND_WRITE_FAILED",
        );
        throw new Error(
          projected.code === "NOT_FOUND"
            ? "REFUND_BINDING_NOT_YET_VISIBLE"
            : "REFUND_PROJECTION_WRITE_FAILED",
        );
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
    isSuccessEvent(inbox.eventType) &&
    payload.providerSubscriptionReference !== null &&
    payload.providerPaymentReference === null
  ) {
    return projectSubscriptionCheckoutBinding(
      dependencies.database,
      inbox,
      payload,
      input,
    );
  }
  if (isSubscriptionLifecycleEvent(inbox.eventType)) {
    return projectSubscriptionLifecycleEvent(
      dependencies.database,
      inbox,
      payload,
      input,
      dependencies.emailProvider,
    );
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
      payload.providerCustomerReference === null ||
      payload.providerPriceReference === null ||
      payload.providerSubscriptionReference === null ||
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
        providerCustomerReference: payload.providerCustomerReference,
        providerInvoiceReference: payload.providerInvoiceReference,
        providerPaymentReference: payload.providerPaymentReference,
        providerPriceReference: payload.providerPriceReference,
        providerSubscriptionReference: payload.providerSubscriptionReference,
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

async function hydratePaidInvoicePayment(
  database: DatabaseClient,
  inbox: Readonly<{
    adapterKey: string;
    adapterVersion: string;
    environment: string;
    expectedLiveMode: boolean;
    hydratedAt: Date | null;
    hydratedPaymentReference: string | null;
    hydrationEvidenceDigest: string | null;
    hydrationSource: string | null;
    id: string;
    providerAccountReference: string;
    providerMode: PaymentRuntimeMode;
    receivedAt: Date;
  }>,
  payload: z.infer<typeof normalizedPayloadSchema>,
  paymentProvider: HostedPaymentProvider | undefined,
  input: Readonly<{ correlationId: string; now: Date }>,
) {
  const existingHydration = [
    inbox.hydratedPaymentReference,
    inbox.hydrationEvidenceDigest,
    inbox.hydrationSource,
    inbox.hydratedAt,
  ];
  if (existingHydration.every((value) => value !== null)) {
    if (
      inbox.hydrationSource !== "STRIPE_INVOICE_PAYMENTS_LIST_V1" ||
      !sha256Schema.safeParse(inbox.hydrationEvidenceDigest).success
    ) {
      return terminalizeInbox(database, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "INVOICE_PAYMENT_HYDRATION_EVIDENCE_CONFLICT",
        status: "HELD",
      });
    }
    return normalizedPayloadSchema.parse({
      ...payload,
      providerPaymentReference: inbox.hydratedPaymentReference,
    });
  }
  if (existingHydration.some((value) => value !== null)) {
    return terminalizeInbox(database, {
      ...input,
      inboxId: inbox.id,
      reasonCode: "INVOICE_PAYMENT_HYDRATION_PARTIAL",
      status: "HELD",
    });
  }
  if (
    paymentProvider === undefined ||
    paymentProvider.adapterKey !== inbox.adapterKey ||
    paymentProvider.adapterVersion !== inbox.adapterVersion ||
    paymentProvider.providerMode !== inbox.providerMode ||
    paymentProvider.expectedLiveMode !== inbox.expectedLiveMode ||
    paymentProvider.providerAccountReference !==
      inbox.providerAccountReference ||
    payload.providerInvoiceReference === null ||
    payload.amountRappen === null ||
    payload.amountRappen <= 0 ||
    payload.currency !== "CHF"
  ) {
    await markPaymentInboxForRetry(
      database,
      inbox.id,
      input.now,
      "INVOICE_PAYMENT_PROVIDER_AUTHORITY_UNAVAILABLE",
    );
    throw new Error("INVOICE_PAYMENT_PROVIDER_AUTHORITY_UNAVAILABLE");
  }

  let resolution: Awaited<
    ReturnType<HostedPaymentProvider["resolveInvoicePayment"]>
  >;
  try {
    resolution = await paymentProvider.resolveInvoicePayment({
      amountRappen: payload.amountRappen,
      currency: payload.currency,
      providerInvoiceReference: payload.providerInvoiceReference,
    });
  } catch (error) {
    if (
      error instanceof StripePaymentProviderError &&
      error.code === "INVOICE_PAYMENT_CONFLICT"
    ) {
      return terminalizeInbox(database, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "INVOICE_PAYMENT_HYDRATION_CONFLICT",
        status: "HELD",
      });
    }
    await markPaymentInboxForRetry(
      database,
      inbox.id,
      input.now,
      "INVOICE_PAYMENT_HYDRATION_UNAVAILABLE",
    );
    throw new Error("INVOICE_PAYMENT_HYDRATION_UNAVAILABLE", {
      cause: error,
    });
  }
  if (
    resolution.amountRappen !== payload.amountRappen ||
    resolution.currency !== payload.currency ||
    resolution.providerInvoiceReference !==
      payload.providerInvoiceReference ||
    resolution.source !== "STRIPE_INVOICE_PAYMENTS_LIST_V1" ||
    !sha256Schema.safeParse(resolution.evidenceDigest).success
  ) {
    return terminalizeInbox(database, {
      ...input,
      inboxId: inbox.id,
      reasonCode: "INVOICE_PAYMENT_HYDRATION_RESULT_CONFLICT",
      status: "HELD",
    });
  }
  const persisted = await database.providerEventInbox.updateMany({
    where: {
      id: inbox.id,
      status: { in: ["RECEIVED", "FAILED"] },
      hydratedPaymentReference: null,
      hydrationEvidenceDigest: null,
      hydrationSource: null,
      hydratedAt: null,
    },
    data: {
      hydratedPaymentReference: resolution.providerPaymentReference,
      hydrationEvidenceDigest: resolution.evidenceDigest,
      hydrationSource: resolution.source,
      hydratedAt: input.now,
      updatedAt: input.now,
    },
  });
  if (persisted.count !== 1) {
    const concurrent = await database.providerEventInbox.findUnique({
      where: { id: inbox.id },
      select: {
        hydratedPaymentReference: true,
        hydrationEvidenceDigest: true,
        hydrationSource: true,
      },
    });
    if (
      concurrent?.hydratedPaymentReference !==
        resolution.providerPaymentReference ||
      concurrent.hydrationEvidenceDigest !== resolution.evidenceDigest ||
      concurrent.hydrationSource !== resolution.source
    ) {
      return terminalizeInbox(database, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "INVOICE_PAYMENT_HYDRATION_WRITE_CONFLICT",
        status: "HELD",
      });
    }
  }
  return normalizedPayloadSchema.parse({
    ...payload,
    providerPaymentReference: resolution.providerPaymentReference,
  });
}

async function markPaymentInboxForRetry(
  database: DatabaseClient,
  inboxId: string,
  now: Date,
  errorCode: string,
) {
  await database.providerEventInbox.updateMany({
    where: { id: inboxId, status: { in: ["RECEIVED", "FAILED"] } },
    data: {
      status: "FAILED",
      processedAt: now,
      nextRetryAt: new Date(now.getTime() + 60_000),
      attemptCount: { increment: 1 },
      failureClass: "TRANSIENT",
      errorCode,
      updatedAt: now,
    },
  });
}

/**
 * A subscription Checkout Session intentionally has no `payment_intent`.
 * Bind its durable customer/subscription/session identity to the attempt, but
 * wait for the signed `invoice.paid` fact before creating paid entitlements.
 */
async function projectSubscriptionCheckoutBinding(
  database: DatabaseClient,
  inbox: Readonly<{
    eventCreatedAt: Date;
    id: string;
    paymentAttemptId: string | null;
  }>,
  payload: z.infer<typeof normalizedPayloadSchema>,
  input: Readonly<{ correlationId: string; now: Date }>,
) {
  if (
    inbox.paymentAttemptId === null ||
    payload.amountRappen === null ||
    payload.currency !== "CHF" ||
    payload.providerCustomerReference === null ||
    payload.providerPriceReference === null ||
    payload.providerSessionReference === null ||
    payload.providerSubscriptionReference === null ||
    payload.providerStatus !== "paid"
  ) {
    return terminalizeInbox(database, {
      ...input,
      inboxId: inbox.id,
      reasonCode: "SUBSCRIPTION_CHECKOUT_BINDING_INCOMPLETE",
      status: "HELD",
    });
  }

  return database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "PaymentAttempt"
      WHERE "id" = ${inbox.paymentAttemptId!}::uuid
      FOR UPDATE
    `;
    const attempt = await transaction.paymentAttempt.findUnique({
      where: { id: inbox.paymentAttemptId! },
      select: {
        amountRappen: true,
        currency: true,
        id: true,
        failureCode: true,
        providerCustomerReference: true,
        providerInvoiceReference: true,
        providerPriceReference: true,
        providerSessionReference: true,
        providerSubscriptionReference: true,
        status: true,
        lastProviderEventAt: true,
        lastProviderEventRank: true,
      },
    });
    if (attempt === null) {
      return markInboxInTransaction(transaction, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "PAYMENT_ATTEMPT_UNRESOLVED",
        status: "HELD",
      });
    }
    const conflicts =
      attempt.amountRappen !== payload.amountRappen ||
      attempt.currency !== payload.currency ||
      attempt.providerPriceReference !== payload.providerPriceReference ||
      (attempt.providerSessionReference !== null &&
        attempt.providerSessionReference !==
          payload.providerSessionReference) ||
      (attempt.providerCustomerReference !== null &&
        attempt.providerCustomerReference !==
          payload.providerCustomerReference) ||
      (attempt.providerSubscriptionReference !== null &&
        attempt.providerSubscriptionReference !==
          payload.providerSubscriptionReference) ||
      (payload.providerInvoiceReference !== null &&
        attempt.providerInvoiceReference !== null &&
        attempt.providerInvoiceReference !== payload.providerInvoiceReference);
    if (conflicts) {
      await transaction.paymentAttempt.updateMany({
        where: { id: attempt.id, status: { not: "SUCCEEDED" } },
        data: {
          failureCode: "SUBSCRIPTION_CHECKOUT_BINDING_CONFLICT",
          status: "HELD",
          updatedAt: input.now,
        },
      });
      return markInboxInTransaction(transaction, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_CHECKOUT_BINDING_CONFLICT",
        status: "HELD",
      });
    }
    if (attempt.status === "SUCCEEDED") {
      return markInboxInTransaction(transaction, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_CHECKOUT_ALREADY_SETTLED",
        status: "IGNORED",
      });
    }
    if (
      attempt.status === "CANCELLED" ||
      (attempt.status === "HELD" &&
        attempt.failureCode !== "CHECKOUT_CALL_UNCERTAIN")
    ) {
      return markInboxInTransaction(transaction, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_CHECKOUT_ATTEMPT_NOT_SETTLEABLE",
        status: "HELD",
      });
    }
    const advancesCursor =
      attempt.lastProviderEventAt === null ||
      inbox.eventCreatedAt.getTime() > attempt.lastProviderEventAt.getTime() ||
      (inbox.eventCreatedAt.getTime() ===
        attempt.lastProviderEventAt.getTime() &&
        attempt.lastProviderEventRank < paymentAttemptProviderRank("PENDING"));
    if (!advancesCursor && attempt.status !== "CREATED") {
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
        providerCustomerReference:
          attempt.providerCustomerReference ??
          payload.providerCustomerReference,
        providerInvoiceReference:
          attempt.providerInvoiceReference ?? payload.providerInvoiceReference,
        providerSessionReference:
          attempt.providerSessionReference ?? payload.providerSessionReference,
        providerSubscriptionReference:
          attempt.providerSubscriptionReference ??
          payload.providerSubscriptionReference,
        status: "PENDING",
        failureCode: null,
        ...(advancesCursor
          ? {
              lastProviderEventAt: inbox.eventCreatedAt,
              lastProviderEventRank: paymentAttemptProviderRank("PENDING"),
            }
          : {}),
        updatedAt: input.now,
      },
    });
    return markInboxInTransaction(transaction, {
      ...input,
      inboxId: inbox.id,
      reasonCode: "SUBSCRIPTION_CHECKOUT_BOUND_AWAITING_INVOICE",
      status: "PROJECTED",
    });
  });
}

async function projectSubscriptionLifecycleEvent(
  database: DatabaseClient,
  inbox: Readonly<{
    adapterKey: string;
    adapterVersion: string;
    environment: string;
    eventCreatedAt: Date;
    eventType: string;
    id: string;
    paymentAttemptId: string | null;
    providerAccountReference: string;
    providerEventId: string;
    providerMode: PaymentRuntimeMode;
  }>,
  payload: z.infer<typeof normalizedPayloadSchema>,
  input: Readonly<{ correlationId: string; now: Date }>,
  emailProvider: EmailProvider,
) {
  if (
    payload.providerSubscriptionReference === null ||
    payload.providerCustomerReference === null ||
    payload.providerPriceReference === null
  ) {
    return terminalizeInbox(database, {
      ...input,
      inboxId: inbox.id,
      reasonCode: "SUBSCRIPTION_EVENT_INCOMPLETE",
      status: "HELD",
    });
  }
  const subscriptionReference = payload.providerSubscriptionReference;
  const subscription = await database.employerSubscription.findUnique({
    where: { providerSubscriptionReference: subscriptionReference },
    select: { id: true },
  });
  if (subscription === null) {
    if (isPaidSubscriptionInvoiceEvent(inbox.eventType)) {
      const period = providerPeriod(payload);
      if (
        inbox.paymentAttemptId === null ||
        payload.amountRappen === null ||
        payload.amountRappen <= 0 ||
        payload.currency !== "CHF" ||
        payload.providerInvoiceReference === null ||
        payload.providerPaymentReference === null ||
        payload.providerStatus !== "paid" ||
        period === null
      ) {
        return terminalizeInbox(database, {
          ...input,
          inboxId: inbox.id,
          reasonCode: "SUBSCRIPTION_INITIAL_INVOICE_INCOMPLETE",
          status: "HELD",
        });
      }
      const projected = await projectRealPaymentSuccess(
        {
          amountRappen: payload.amountRappen,
          correlationId: input.correlationId,
          eventCreatedAt: inbox.eventCreatedAt,
          paymentAttemptId: inbox.paymentAttemptId,
          providerCustomerReference: payload.providerCustomerReference,
          providerEventId: inbox.providerEventId,
          providerInvoiceReference: payload.providerInvoiceReference,
          providerPaymentReference: payload.providerPaymentReference,
          providerPeriodEnd: period.end,
          providerPeriodStart: period.start,
          providerPriceReference: payload.providerPriceReference,
          providerSubscriptionReference: subscriptionReference,
        },
        { database, emailProvider, now: input.now },
      );
      if (!projected.ok) {
        if (
          projected.code === "PAYMENT_HELD" ||
          projected.code === "CONFLICT" ||
          projected.code === "NOT_FOUND"
        ) {
          return terminalizeInbox(database, {
            ...input,
            inboxId: inbox.id,
            reasonCode: `PAYMENT_${projected.code}`,
            status: "HELD",
          });
        }
        await database.providerEventInbox.updateMany({
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
      return terminalizeInbox(database, {
        ...input,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_INITIAL_INVOICE_PAID",
        status: "PROJECTED",
      });
    }
    if (
      inbox.eventType === "invoice.payment_failed" &&
      inbox.paymentAttemptId !== null
    ) {
      return projectNonSuccessState(database, inbox, "FAILED", input);
    }
    await markSubscriptionEventForRetry(database, inbox.id, input.now);
    throw new Error("PAYMENT_SUBSCRIPTION_NOT_YET_BOUND");
  }

  return database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "EmployerSubscription"
      WHERE "id" = ${subscription.id}::uuid
      FOR UPDATE
    `;
    const current = await transaction.employerSubscription.findUnique({
      where: { id: subscription.id },
      select: {
        id: true,
        companyId: true,
        sourceOrderId: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        currencySnapshot: true,
        paymentRuntimeMode: true,
        paymentAdapterKey: true,
        paymentAdapterVersion: true,
        providerAccountReference: true,
        providerCustomerReference: true,
        providerPriceReference: true,
        providerRecurringAmountRappenSnapshot: true,
        providerLastEventAt: true,
        providerStatusEventAt: true,
        providerStatusRank: true,
        providerCancellationAt: true,
        sourceOrder: {
          select: {
            paymentAttempts: {
              where: {
                providerSubscriptionReference: subscriptionReference,
              },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    if (current === null || current.sourceOrderId === null) {
      throw new Error("PAYMENT_SUBSCRIPTION_BINDING_MISSING");
    }
    if (
      current.paymentRuntimeMode !== inbox.providerMode ||
      current.paymentAdapterKey !== inbox.adapterKey ||
      current.paymentAdapterVersion !== inbox.adapterVersion ||
      current.providerAccountReference !== inbox.providerAccountReference ||
      current.providerCustomerReference !== payload.providerCustomerReference ||
      current.providerPriceReference !== payload.providerPriceReference
    ) {
      return markInboxInTransaction(transaction, {
        ...input,
        companyId: current.companyId,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_PROVIDER_BINDING_CONFLICT",
        status: "HELD",
      });
    }
    const period = providerPeriod(payload);
    const attemptId = current.sourceOrder?.paymentAttempts[0]?.id ?? null;

    if (
      isPaidSubscriptionInvoiceEvent(inbox.eventType) ||
      inbox.eventType === "invoice.payment_failed"
    ) {
      return projectSubscriptionProviderInvoiceInTransaction(
        transaction,
        {
          attemptId,
          companyId: current.companyId,
          currentPeriodEnd: current.currentPeriodEnd,
          currentPeriodStart: current.currentPeriodStart,
          currentStatus: current.status,
          expectedCurrency: current.currencySnapshot,
          expectedRecurringAmountRappen:
            current.providerRecurringAmountRappenSnapshot,
          orderId: current.sourceOrderId,
          providerLastEventAt: current.providerLastEventAt,
          providerStatusEventAt: current.providerStatusEventAt,
          providerStatusRank: current.providerStatusRank,
          subscriptionId: current.id,
          subscriptionReference,
        },
        inbox,
        payload,
        period,
        input,
      );
    }

    const cancellation =
      inbox.eventType === "customer.subscription.deleted" ||
      payload.providerStatus === "canceled";
    const dunningRequired =
      payload.providerStatus === "past_due" ||
      payload.providerStatus === "unpaid";
    const recoverable =
      payload.providerStatus === "active" ||
      payload.providerStatus === "trialing";
    if (!cancellation && !dunningRequired && !recoverable) {
      return markInboxInTransaction(transaction, {
        ...input,
        companyId: current.companyId,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_STATUS_NOT_PROJECTED",
        status: "IGNORED",
      });
    }
    const signal: SubscriptionProviderSignal = cancellation
      ? "CANCELLED"
      : dunningRequired
        ? "DUNNING"
        : payload.providerCancelAtPeriodEnd === true
          ? "CANCELLING"
          : "RECOVERED";
    const ordering = decideSubscriptionProviderOrdering({
      currentAt: current.providerStatusEventAt,
      currentRank: current.providerStatusRank,
      incomingAt: inbox.eventCreatedAt,
      incomingSignal: signal,
    });
    if (!ordering.apply) {
      return markInboxInTransaction(transaction, {
        ...input,
        companyId: current.companyId,
        inboxId: inbox.id,
        reasonCode: ordering.reason,
        status: "IGNORED",
      });
    }
    if (period !== null && !isMonotonicProviderPeriod(current, period)) {
      return markInboxInTransaction(transaction, {
        ...input,
        companyId: current.companyId,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_PERIOD_CONFLICT",
        status: "HELD",
      });
    }
    const unresolvedProviderInvoices = recoverable
      ? await transaction.subscriptionProviderInvoice.count({
          where: { subscriptionId: current.id, status: "FAILED" },
        })
      : 0;
    const canRecover = recoverable && unresolvedProviderInvoices === 0;
    const providerLastEventAt = maximumDate(
      current.providerLastEventAt,
      inbox.eventCreatedAt,
    );
    const nextStatus = cancellation
      ? ("CANCELLED" as const)
      : canRecover &&
          payload.providerCancelAtPeriodEnd === true &&
          current.status === "ACTIVE"
        ? ("CANCELLING" as const)
        : canRecover &&
            payload.providerCancelAtPeriodEnd === false &&
            current.status === "CANCELLING"
          ? ("ACTIVE" as const)
          : current.status;
    await transaction.employerSubscription.update({
      where: { id: current.id },
      data: {
        ...(period === null
          ? {}
          : {
              currentPeriodStart: period.start,
              currentPeriodEnd: period.end,
            }),
        status: nextStatus,
        ...(cancellation
          ? {
              endedAt: inbox.eventCreatedAt,
              providerCancellationAt: inbox.eventCreatedAt,
            }
          : {}),
        providerLastEventAt,
        providerStatusEventAt: inbox.eventCreatedAt,
        providerStatusRank: ordering.rank,
        updatedAt: input.now,
      },
    });
    if (cancellation) {
      await transaction.subscriptionEvent.createMany({
        data: [
          {
            subscriptionId: current.id,
            kind: "CANCELLED",
            actorUserId: null,
            reasonCode: "PROVIDER_SUBSCRIPTION_CANCELLED",
            idempotencyKey: `provider-subscription-cancelled:${inbox.providerEventId}`,
            correlationId: input.correlationId,
            createdAt: input.now,
          },
        ],
        skipDuplicates: true,
      });
    } else if (dunningRequired && attemptId !== null) {
      await openDunningForPaymentFailureInTransaction(transaction, {
        companyId: current.companyId,
        correlationId: input.correlationId,
        now: input.now,
        paymentAttemptId: attemptId,
        ...(payload.providerInvoiceReference === null
          ? {}
          : { providerInvoiceReference: payload.providerInvoiceReference }),
      });
    } else if (canRecover) {
      await resolveCompanyDunningInTransaction(transaction, {
        companyId: current.companyId,
        correlationId: input.correlationId,
        now: input.now,
      });
    }
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: current.companyId,
      inboxId: inbox.id,
      reasonCode: cancellation
        ? "SUBSCRIPTION_CANCELLED"
        : dunningRequired
          ? "SUBSCRIPTION_DUNNING_STARTED"
          : canRecover
            ? "SUBSCRIPTION_STATE_RECOVERED"
            : "SUBSCRIPTION_RECOVERY_BLOCKED_BY_FAILED_INVOICE",
      status: "PROJECTED",
    });
  });
}

async function projectSubscriptionProviderInvoiceInTransaction(
  transaction: Prisma.TransactionClient,
  current: Readonly<{
    attemptId: string | null;
    companyId: string;
    currentPeriodEnd: Date;
    currentPeriodStart: Date;
    currentStatus: string;
    expectedCurrency: string;
    expectedRecurringAmountRappen: number | null;
    orderId: string;
    providerLastEventAt: Date | null;
    providerStatusEventAt: Date | null;
    providerStatusRank: number | null;
    subscriptionId: string;
    subscriptionReference: string;
  }>,
  inbox: Readonly<{
    adapterKey: string;
    adapterVersion: string;
    environment: string;
    eventCreatedAt: Date;
    eventType: string;
    id: string;
    providerAccountReference: string;
    providerEventId: string;
    providerMode: PaymentRuntimeMode;
  }>,
  payload: z.infer<typeof normalizedPayloadSchema>,
  period: Readonly<{ end: Date; start: Date }> | null,
  input: Readonly<{ correlationId: string; now: Date }>,
) {
  const paid = isPaidSubscriptionInvoiceEvent(inbox.eventType);
  if (
    current.attemptId === null ||
    payload.providerInvoiceReference === null ||
    (paid &&
      (payload.amountRappen === null ||
        payload.amountRappen <= 0 ||
        payload.currency !== "CHF" ||
        payload.providerPaymentReference === null ||
        payload.providerStatus !== "paid" ||
        period === null))
  ) {
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: current.companyId,
      inboxId: inbox.id,
      reasonCode: paid
        ? "SUBSCRIPTION_INVOICE_PAID_INCOMPLETE"
        : "SUBSCRIPTION_INVOICE_FAILED_INCOMPLETE",
      status: "HELD",
    });
  }
  const providerInvoiceReference = payload.providerInvoiceReference;
  const scope = {
    provider: "STRIPE" as const,
    environment: inbox.environment,
    adapterKey: inbox.adapterKey,
    providerAccountReference: inbox.providerAccountReference,
    providerInvoiceReference,
  };
  const existing = await transaction.subscriptionProviderInvoice.findUnique({
    where: {
      provider_environment_adapterKey_providerAccountReference_providerInvoiceReference:
        scope,
    },
  });
  if (
    existing !== null &&
    (existing.subscriptionId !== current.subscriptionId ||
      existing.paymentAttemptId !== current.attemptId ||
      existing.orderId !== current.orderId ||
      existing.companyId !== current.companyId ||
      existing.adapterVersion !== inbox.adapterVersion ||
      existing.providerMode !== inbox.providerMode ||
      existing.providerSubscriptionReference !== current.subscriptionReference)
  ) {
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: current.companyId,
      inboxId: inbox.id,
      reasonCode: "SUBSCRIPTION_INVOICE_BINDING_CONFLICT",
      status: "HELD",
    });
  }
  if (
    paid &&
    (current.expectedRecurringAmountRappen === null ||
      payload.amountRappen !== current.expectedRecurringAmountRappen ||
      payload.currency !== current.expectedCurrency)
  ) {
    const conflictFacts = {
      amountRappen: payload.amountRappen!,
      currency: payload.currency as "CHF",
      paidAt: inbox.eventCreatedAt,
      periodEnd: period!.end,
      periodStart: period!.start,
      providerPaymentReference: payload.providerPaymentReference!,
    };
    const conflictDigest = subscriptionProviderInvoiceProjectionDigestV1(
      scope,
      conflictFacts,
      current.subscriptionId,
    );
    if (existing === null) {
      await transaction.subscriptionProviderInvoice.create({
        data: {
          ...scope,
          ...conflictFacts,
          adapterVersion: inbox.adapterVersion,
          companyId: current.companyId,
          conflictedAt: input.now,
          orderId: current.orderId,
          paidProjectionDigest: conflictDigest,
          paymentAttemptId: current.attemptId,
          providerMode: inbox.providerMode,
          providerSubscriptionReference: current.subscriptionReference,
          status: "CONFLICT",
          subscriptionId: current.subscriptionId,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
    } else if (existing.status !== "CONFLICT") {
      await transaction.subscriptionProviderInvoice.update({
        where: { id: existing.id },
        data: {
          status: "CONFLICT",
          conflictedAt: input.now,
          updatedAt: input.now,
        },
      });
    }
    if (["ACTIVE", "CANCELLING"].includes(current.currentStatus)) {
      await transaction.employerSubscription.update({
        where: { id: current.subscriptionId },
        data: { status: "SUSPENDED", updatedAt: input.now },
      });
      await transaction.subscriptionEvent.createMany({
        data: [
          {
            subscriptionId: current.subscriptionId,
            kind: "SUSPENDED",
            actorUserId: null,
            reasonCode: "PROVIDER_INVOICE_AMOUNT_CURRENCY_CONFLICT",
            idempotencyKey: `provider-invoice-authority-conflict:${providerInvoiceEffectKey(scope)}`,
            correlationId: input.correlationId,
            createdAt: input.now,
          },
        ],
        skipDuplicates: true,
      });
    }
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: current.companyId,
      inboxId: inbox.id,
      reasonCode: "SUBSCRIPTION_INVOICE_AMOUNT_CURRENCY_CONFLICT",
      status: "HELD",
    });
  }
  if (!paid) {
    if (existing?.status === "PAID") {
      return markInboxInTransaction(transaction, {
        ...input,
        companyId: current.companyId,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_INVOICE_ALREADY_PAID",
        status: "IGNORED",
      });
    }
    if (existing?.status === "CONFLICT") {
      return markInboxInTransaction(transaction, {
        ...input,
        companyId: current.companyId,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_INVOICE_CONFLICT_HELD",
        status: "HELD",
      });
    }
    if (existing !== null) {
      if (
        existing.firstFailureAt !== null &&
        inbox.eventCreatedAt.getTime() < existing.firstFailureAt.getTime()
      ) {
        await transaction.subscriptionProviderInvoice.update({
          where: { id: existing.id },
          data: { firstFailureAt: inbox.eventCreatedAt, updatedAt: input.now },
        });
      }
      return markInboxInTransaction(transaction, {
        ...input,
        companyId: current.companyId,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_INVOICE_FAILURE_ALREADY_RECORDED",
        status: "IGNORED",
      });
    }
    await transaction.subscriptionProviderInvoice.create({
      data: {
        ...scope,
        adapterVersion: inbox.adapterVersion,
        companyId: current.companyId,
        firstFailureAt: inbox.eventCreatedAt,
        orderId: current.orderId,
        paymentAttemptId: current.attemptId,
        providerMode: inbox.providerMode,
        providerSubscriptionReference: current.subscriptionReference,
        status: "FAILED",
        subscriptionId: current.subscriptionId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    await updateSubscriptionLastProviderEvent(
      transaction,
      current,
      inbox,
      input,
    );
    const invoiceEffectKey = providerInvoiceEffectKey(scope);
    await transaction.paymentEvent.createMany({
      data: [
        {
          orderId: current.orderId,
          provider: "STRIPE",
          kind: "RENEWAL_FAILED",
          idempotencyKey: `provider-renewal-failed:${invoiceEffectKey}`,
          payload: {
            schemaVersion: "phase33-v2",
            providerEventId: inbox.providerEventId,
            providerInvoiceReference,
            providerSubscriptionReference: current.subscriptionReference,
            recurring: true,
            externalChargeClaimed: false,
          },
          createdAt: input.now,
        },
      ],
      skipDuplicates: true,
    });
    await openDunningForPaymentFailureInTransaction(transaction, {
      companyId: current.companyId,
      correlationId: input.correlationId,
      now: input.now,
      paymentAttemptId: current.attemptId,
      providerInvoiceReference,
    });
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: current.companyId,
      inboxId: inbox.id,
      reasonCode: "SUBSCRIPTION_RENEWAL_FAILED",
      status: "PROJECTED",
    });
  }

  const paidFacts = {
    amountRappen: payload.amountRappen!,
    currency: "CHF" as const,
    paidAt: inbox.eventCreatedAt,
    periodEnd: period!.end,
    periodStart: period!.start,
    providerPaymentReference: payload.providerPaymentReference!,
  };
  const paidProjectionDigest = subscriptionProviderInvoiceProjectionDigestV1(
    scope,
    paidFacts,
    current.subscriptionId,
  );
  if (existing?.status === "CONFLICT") {
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: current.companyId,
      inboxId: inbox.id,
      reasonCode: "SUBSCRIPTION_INVOICE_CONFLICT_HELD",
      status: "HELD",
    });
  }
  if (existing?.status === "PAID") {
    if (existing.paidProjectionDigest === paidProjectionDigest) {
      return markInboxInTransaction(transaction, {
        ...input,
        companyId: current.companyId,
        inboxId: inbox.id,
        reasonCode: "SUBSCRIPTION_INVOICE_PAID_ALREADY_PROJECTED",
        status: "IGNORED",
      });
    }
    await transaction.subscriptionProviderInvoice.update({
      where: { id: existing.id },
      data: {
        status: "CONFLICT",
        conflictedAt: input.now,
        updatedAt: input.now,
      },
    });
    if (["ACTIVE", "CANCELLING"].includes(current.currentStatus)) {
      await transaction.employerSubscription.update({
        where: { id: current.subscriptionId },
        data: { status: "SUSPENDED", updatedAt: input.now },
      });
      await transaction.subscriptionEvent.createMany({
        data: [
          {
            subscriptionId: current.subscriptionId,
            kind: "SUSPENDED",
            actorUserId: null,
            reasonCode: "PROVIDER_INVOICE_CONFLICT",
            idempotencyKey: `provider-invoice-conflict:${providerInvoiceEffectKey(scope)}`,
            correlationId: input.correlationId,
            createdAt: input.now,
          },
        ],
        skipDuplicates: true,
      });
    }
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: current.companyId,
      inboxId: inbox.id,
      reasonCode: "SUBSCRIPTION_INVOICE_PAID_FACT_CONFLICT",
      status: "HELD",
    });
  }
  // Stripe can emit both invoice.paid and invoice.payment_succeeded for the
  // same immutable invoice fact. Exact aliases are handled above before the
  // period cursor check because initial fulfillment may have a slightly later
  // local activation timestamp than Stripe's signed period start.
  if (period !== null && !isMonotonicProviderPeriod(current, period)) {
    return markInboxInTransaction(transaction, {
      ...input,
      companyId: current.companyId,
      inboxId: inbox.id,
      reasonCode: "SUBSCRIPTION_INVOICE_PERIOD_CONFLICT",
      status: "HELD",
    });
  }
  if (existing === null) {
    await transaction.subscriptionProviderInvoice.create({
      data: {
        ...scope,
        ...paidFacts,
        adapterVersion: inbox.adapterVersion,
        companyId: current.companyId,
        orderId: current.orderId,
        paidProjectionDigest,
        paymentAttemptId: current.attemptId,
        providerMode: inbox.providerMode,
        providerSubscriptionReference: current.subscriptionReference,
        status: "PAID",
        subscriptionId: current.subscriptionId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
  } else {
    await transaction.subscriptionProviderInvoice.update({
      where: { id: existing.id },
      data: {
        ...paidFacts,
        paidProjectionDigest,
        status: "PAID",
        updatedAt: input.now,
      },
    });
  }
  await transaction.employerSubscription.update({
    where: { id: current.subscriptionId },
    data: {
      currentPeriodStart: paidFacts.periodStart,
      currentPeriodEnd: paidFacts.periodEnd,
      providerLastEventAt: maximumDate(
        current.providerLastEventAt,
        inbox.eventCreatedAt,
      ),
      ...(current.providerStatusEventAt === null ||
      inbox.eventCreatedAt.getTime() > current.providerStatusEventAt.getTime()
        ? {
            providerStatusEventAt: inbox.eventCreatedAt,
            providerStatusRank: current.providerStatusRank,
          }
        : {}),
      updatedAt: input.now,
    },
  });
  const invoiceEffectKey = providerInvoiceEffectKey(scope);
  await transaction.paymentEvent.createMany({
    data: [
      {
        orderId: current.orderId,
        provider: "STRIPE",
        kind: "RENEWAL_PAID",
        providerReference: paidFacts.providerPaymentReference,
        idempotencyKey: `provider-renewal-paid:${invoiceEffectKey}`,
        payload: {
          schemaVersion: "phase33-v2",
          providerEventId: inbox.providerEventId,
          providerInvoiceReference,
          providerSubscriptionReference: current.subscriptionReference,
          recurring: true,
          externalChargeClaimed: true,
        },
        createdAt: input.now,
      },
    ],
    skipDuplicates: true,
  });
  await resolveProviderInvoiceDunningInTransaction(transaction, {
    companyId: current.companyId,
    correlationId: input.correlationId,
    now: input.now,
    providerInvoiceReference,
  });
  return markInboxInTransaction(transaction, {
    ...input,
    companyId: current.companyId,
    inboxId: inbox.id,
    reasonCode: "SUBSCRIPTION_RENEWAL_PAID",
    status: "PROJECTED",
  });
}

async function updateSubscriptionLastProviderEvent(
  transaction: Prisma.TransactionClient,
  current: Readonly<{
    providerLastEventAt: Date | null;
    providerStatusEventAt: Date | null;
    providerStatusRank: number | null;
    subscriptionId: string;
  }>,
  inbox: Readonly<{ eventCreatedAt: Date }>,
  input: Readonly<{ now: Date }>,
) {
  const maximum = maximumDate(
    current.providerLastEventAt,
    inbox.eventCreatedAt,
  );
  const statusAdvances =
    current.providerStatusEventAt === null ||
    inbox.eventCreatedAt.getTime() > current.providerStatusEventAt.getTime();
  if (
    current.providerLastEventAt?.getTime() === maximum.getTime() &&
    !statusAdvances
  ) {
    return;
  }
  await transaction.employerSubscription.update({
    where: { id: current.subscriptionId },
    data: {
      providerLastEventAt: maximum,
      ...(statusAdvances
        ? {
            providerStatusEventAt: inbox.eventCreatedAt,
            providerStatusRank: current.providerStatusRank,
          }
        : {}),
      updatedAt: input.now,
    },
  });
}

function providerInvoiceEffectKey(input: Readonly<Record<string, string>>) {
  return digest(JSON.stringify(input)).slice(0, 48);
}

function isMonotonicProviderPeriod(
  current: Readonly<{ currentPeriodEnd: Date; currentPeriodStart: Date }>,
  period: Readonly<{ end: Date; start: Date }>,
) {
  return (
    period.start.getTime() >= current.currentPeriodStart.getTime() &&
    period.end.getTime() >= current.currentPeriodEnd.getTime() &&
    period.end.getTime() > period.start.getTime()
  );
}

function maximumDate(left: Date | null, right: Date) {
  return left !== null && left.getTime() >= right.getTime() ? left : right;
}

async function markSubscriptionEventForRetry(
  database: DatabaseClient,
  inboxId: string,
  now: Date,
) {
  await database.providerEventInbox.updateMany({
    where: { id: inboxId, status: { in: ["RECEIVED", "FAILED"] } },
    data: {
      status: "FAILED",
      processedAt: now,
      nextRetryAt: new Date(now.getTime() + 60_000),
      attemptCount: { increment: 1 },
      failureClass: "TRANSIENT",
      errorCode: "SUBSCRIPTION_NOT_YET_BOUND",
      updatedAt: now,
    },
  });
}

function providerPeriod(payload: z.infer<typeof normalizedPayloadSchema>) {
  if (
    payload.providerPeriodStart === null ||
    payload.providerPeriodEnd === null
  ) {
    return null;
  }
  const start = new Date(payload.providerPeriodStart);
  const end = new Date(payload.providerPeriodEnd);
  return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    ? Object.freeze({ start, end })
    : null;
}

async function resolveAttemptCandidates(
  transaction: Prisma.TransactionClient,
  event: NormalizedPaymentProviderEvent,
  environment: string,
  adapterKey: StripePaymentAdapterKey,
  providerMode: PaymentRuntimeMode,
  expectedLiveMode: boolean,
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
  if (event.providerSubscriptionReference !== null) {
    or.push({
      providerSubscriptionReference: event.providerSubscriptionReference,
    });
  }
  if (event.orderId !== null) or.push({ orderId: event.orderId });
  if (or.length === 0) return [];
  return transaction.paymentAttempt.findMany({
    where: {
      provider: "STRIPE",
      environment,
      adapterKey,
      adapterVersion: "v1",
      providerMode,
      expectedLiveMode,
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
        lastProviderEventRank: true,
      },
    });
    if (attempt === null) throw new Error("PAYMENT_ATTEMPT_NOT_FOUND");
    const incomingRank = paymentAttemptProviderRank(target);
    if (
      attempt.status === "SUCCEEDED" ||
      (attempt.lastProviderEventAt !== null &&
        (inbox.eventCreatedAt.getTime() <
          attempt.lastProviderEventAt.getTime() ||
          (inbox.eventCreatedAt.getTime() ===
            attempt.lastProviderEventAt.getTime() &&
            incomingRank <= attempt.lastProviderEventRank)))
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
        lastProviderEventRank: incomingRank,
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
    providerCancelAtPeriodEnd: event.providerCancelAtPeriodEnd,
    orderId: event.orderId,
    paymentAttemptId: event.paymentAttemptId,
    refundId: event.refundId,
    providerObjectReference: event.providerObjectReference,
    providerPaymentReference: event.providerPaymentReference,
    providerSessionReference: event.providerSessionReference,
    providerCustomerReference: event.providerCustomerReference,
    providerInvoiceReference: event.providerInvoiceReference,
    providerPriceReference: event.providerPriceReference,
    providerSubscriptionReference: event.providerSubscriptionReference,
    providerPeriodStart: event.providerPeriodStart?.toISOString() ?? null,
    providerPeriodEnd: event.providerPeriodEnd?.toISOString() ?? null,
    providerStatus: event.providerStatus,
  });
}

function isSuccessEvent(eventType: string) {
  return (
    eventType === "checkout.session.completed" ||
    eventType === "checkout.session.async_payment_succeeded"
  );
}

function isSubscriptionLifecycleEvent(eventType: string) {
  return (
    isPaidSubscriptionInvoiceEvent(eventType) ||
    eventType === "invoice.payment_failed" ||
    eventType === "customer.subscription.updated" ||
    eventType === "customer.subscription.deleted"
  );
}

function isPaidSubscriptionInvoiceEvent(eventType: string) {
  return (
    eventType === "invoice.paid" || eventType === "invoice.payment_succeeded"
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
    adapterKey: StripePaymentAdapterKey;
    adapterVersion: "v1";
    correlationId: string;
    environment: string;
    event: NormalizedPaymentProviderEvent;
    expectedLiveMode: boolean;
    providerMode: PaymentRuntimeMode;
    rawBody: string;
    receivedAt: Date;
    signatureHeader: string;
  }>,
) {
  if (
    !uuidSchema.safeParse(input.correlationId).success ||
    !["local", "ci", "preview", "staging", "production"].includes(
      input.environment,
    ) ||
    input.adapterVersion !== "v1" ||
    input.event.liveMode !== input.expectedLiveMode ||
    !isExactPaymentRuntimeBinding(input) ||
    !Number.isFinite(input.receivedAt.getTime()) ||
    input.rawBody.length === 0 ||
    input.signatureHeader.length === 0 ||
    !sha256Schema.safeParse(digest(input.rawBody)).success
  ) {
    throw new TypeError("Verified payment event envelope is invalid.");
  }
}

function isExactPaymentRuntimeBinding(
  input: Readonly<{
    adapterKey: StripePaymentAdapterKey;
    environment: string;
    expectedLiveMode: boolean;
    providerMode: PaymentRuntimeMode;
  }>,
) {
  if (input.providerMode === "CONTRACT") {
    return (
      input.adapterKey === "stripe_contract" &&
      !input.expectedLiveMode &&
      input.environment === "ci"
    );
  }
  if (input.providerMode === "SANDBOX") {
    return (
      input.adapterKey === "stripe_sandbox" &&
      !input.expectedLiveMode &&
      ["local", "ci", "staging"].includes(input.environment)
    );
  }
  return (
    input.adapterKey === "stripe_live" &&
    input.expectedLiveMode &&
    input.environment === "production"
  );
}
