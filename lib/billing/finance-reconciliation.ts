import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type {
  ReconciliationItemStatus,
  ReconciliationMismatchKind,
} from "@/lib/generated/prisma/client";

const FINANCE_RETENTION_MS = 10 * 365 * 86_400_000;
const RECONCILIATION_WINDOW_MS = 24 * 60 * 60_000;
const environmentSchema = z.enum([
  "local",
  "ci",
  "preview",
  "staging",
  "production",
]);
const reconciliationCursorSchema = z.strictObject({
  v: z.literal(1),
  e: environmentSchema,
  ws: z.iso.datetime(),
  we: z.iso.datetime(),
  lc: z.iso.datetime(),
  li: z.uuid(),
});
const subscriptionInvoiceCursorSchema = reconciliationCursorSchema.extend({
  k: z.literal("subscription_invoice"),
});

type ReconciliationEnvironment = ServerEnvironment["APP_ENV"];

export type PaymentReconciliationSummary = Readonly<{
  matched: number;
  mismatched: number;
  nextCursor: string | null;
  processed: number;
  runId: string;
}>;

export async function reconcilePersistedPayments(
  input: Readonly<{
    batchSize?: number;
    correlationId: string;
    cursor?: string | null;
    environment: ReconciliationEnvironment;
    now: Date;
  }>,
  database: DatabaseClient,
): Promise<PaymentReconciliationSummary> {
  const batchSize = input.batchSize ?? 100;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500 ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError("Payment reconciliation bounds are invalid.");
  }
  const startedAt = new Date(input.now);
  const cursor = decodeReconciliationCursor(
    input.cursor ?? null,
    input.environment,
    startedAt,
  );
  const windowStart =
    cursor === null
      ? new Date(startedAt.getTime() - RECONCILIATION_WINDOW_MS)
      : new Date(cursor.ws);
  const windowEnd = cursor === null ? startedAt : new Date(cursor.we);
  const loaded = await database.paymentAttempt.findMany({
    where: {
      environment: input.environment,
      provider: "STRIPE",
      createdAt: { gte: windowStart, lte: windowEnd },
      ...(cursor === null
        ? {}
        : {
            OR: [
              { createdAt: { gt: new Date(cursor.lc) } },
              {
                createdAt: new Date(cursor.lc),
                id: { gt: cursor.li },
              },
            ],
          }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: batchSize + 1,
    include: {
      order: {
        select: {
          id: true,
          companyId: true,
          currency: true,
          totalRappen: true,
          status: true,
          invoice: { select: { id: true, status: true } },
          subscription: { select: { id: true } },
          lines: {
            select: {
              planVersionId: true,
              productVersionId: true,
              creditLedgerEntries: {
                where: { kind: "GRANT" },
                select: { id: true },
                take: 1,
              },
            },
            take: 2,
          },
          paymentEvents: {
            where: { kind: "PAID" },
            select: { id: true },
            take: 2,
          },
        },
      },
      providerEvents: {
        where: {
          eventType: {
            in: [
              "checkout.session.completed",
              "checkout.session.async_payment_succeeded",
            ],
          },
        },
        select: { id: true, status: true },
        take: 2,
      },
    },
  });
  const attempts = loaded.slice(0, batchSize);
  const runId = randomUUID();
  const observations = attempts.map(observeAttempt);
  const matched = observations.filter(
    (item) => item.status === "MATCHED",
  ).length;
  const mismatched = observations.length - matched;
  const manifestDigest = digest({
    environment: input.environment,
    observations: observations.map((item) => ({
      attemptId: item.paymentAttemptId,
      evidenceDigest: item.evidenceDigest,
      mismatchKind: item.mismatchKind,
      status: item.status,
    })),
    policyVersion: "phase24-v1",
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  });

  await database.$transaction(async (transaction) => {
    await transaction.reconciliationRun.create({
      data: {
        id: runId,
        provider: "STRIPE",
        environment: input.environment,
        status: "RUNNING",
        providerWindowStart: windowStart,
        providerWindowEnd: windowEnd,
        cursorReference: input.cursor ?? null,
        correlationId: input.correlationId,
        startedAt,
        createdAt: startedAt,
      },
    });
    if (observations.length > 0) {
      await transaction.reconciliationItem.createMany({
        data: observations.map((observation) => ({
          reconciliationRunId: runId,
          paymentAttemptId: observation.paymentAttemptId,
          orderId: observation.orderId,
          companyId: observation.companyId,
          providerReference: observation.providerReference,
          status: observation.status,
          mismatchKind: observation.mismatchKind,
          expectedAmountRappen: observation.expectedAmountRappen,
          observedAmountRappen: observation.observedAmountRappen,
          expectedCurrency: observation.expectedCurrency,
          observedCurrency: observation.observedCurrency,
          evidenceDigest: observation.evidenceDigest,
          reasonCode: observation.reasonCode,
          createdAt: startedAt,
        })),
      });
    }
    await transaction.reconciliationRun.update({
      where: { id: runId },
      data: {
        status: "COMPLETED",
        matchedCount: matched,
        mismatchCount: mismatched,
        processedCount: observations.length,
        manifestDigest,
        completedAt: startedAt,
      },
    });
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "RECONCILIATION_COMPLETED",
      actorKind: "SYSTEM",
      capability: "PAYMENT_RECONCILIATION_RUN",
      correlationId: input.correlationId,
      reasonCode: mismatched === 0 ? "ALL_ITEMS_MATCHED" : "MISMATCHES_OPENED",
      result: "SUCCEEDED",
      retainUntil: new Date(startedAt.getTime() + FINANCE_RETENTION_MS),
      targetId: runId,
      targetType: "RECONCILIATION_RUN",
    });
  });

  return Object.freeze({
    matched,
    mismatched,
    nextCursor:
      loaded.length > batchSize && attempts.length > 0
        ? encodeReconciliationCursor({
            environment: input.environment,
            windowStart,
            windowEnd,
            lastCreatedAt: attempts.at(-1)!.createdAt,
            lastId: attempts.at(-1)!.id,
          })
        : null,
    processed: observations.length,
    runId,
  });
}

export async function reconcilePersistedSubscriptionProviderInvoices(
  input: Readonly<{
    batchSize?: number;
    correlationId: string;
    cursor?: string | null;
    environment: ReconciliationEnvironment;
    now: Date;
  }>,
  database: DatabaseClient,
): Promise<PaymentReconciliationSummary> {
  const batchSize = input.batchSize ?? 100;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500 ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError("Payment reconciliation bounds are invalid.");
  }
  const startedAt = new Date(input.now);
  const cursor = decodeSubscriptionInvoiceCursor(
    input.cursor ?? null,
    input.environment,
    startedAt,
  );
  const windowStart =
    cursor === null
      ? new Date(startedAt.getTime() - RECONCILIATION_WINDOW_MS)
      : new Date(cursor.ws);
  const windowEnd = cursor === null ? startedAt : new Date(cursor.we);
  const loaded = await database.subscriptionProviderInvoice.findMany({
    where: {
      environment: input.environment,
      provider: "STRIPE",
      createdAt: { gte: windowStart, lte: windowEnd },
      ...(cursor === null
        ? {}
        : {
            OR: [
              { createdAt: { gt: new Date(cursor.lc) } },
              { createdAt: new Date(cursor.lc), id: { gt: cursor.li } },
            ],
          }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: batchSize + 1,
    include: {
      order: {
        select: {
          id: true,
          companyId: true,
          paymentEvents: {
            where: { kind: { in: ["RENEWAL_PAID", "RENEWAL_FAILED"] } },
            select: { kind: true, payload: true },
          },
        },
      },
      subscription: {
        select: {
          companyId: true,
          currentPeriodEnd: true,
          currentPeriodStart: true,
          currencySnapshot: true,
          providerRecurringAmountRappenSnapshot: true,
          status: true,
          dunningCases: {
            select: { idempotencyKey: true, status: true },
          },
        },
      },
    },
  });
  const providerInvoices = loaded.slice(0, batchSize);
  const observations = providerInvoices.map((providerInvoice) =>
    observeSubscriptionProviderInvoice(providerInvoice, startedAt),
  );
  const matched = observations.filter(
    (item) => item.status === "MATCHED",
  ).length;
  const mismatched = observations.length - matched;
  const runId = randomUUID();
  const manifestDigest = digest({
    environment: input.environment,
    observations: observations.map((item) => ({
      evidenceDigest: item.evidenceDigest,
      mismatchKind: item.mismatchKind,
      providerReference: item.providerReference,
      status: item.status,
    })),
    policyVersion: "phase33-subscription-provider-invoice-v1",
    windowEnd: windowEnd.toISOString(),
    windowStart: windowStart.toISOString(),
  });

  await database.$transaction(async (transaction) => {
    await transaction.reconciliationRun.create({
      data: {
        id: runId,
        provider: "STRIPE",
        environment: input.environment,
        status: "RUNNING",
        providerWindowStart: windowStart,
        providerWindowEnd: windowEnd,
        cursorReference: input.cursor ?? null,
        correlationId: input.correlationId,
        startedAt,
        createdAt: startedAt,
      },
    });
    if (observations.length > 0) {
      await transaction.reconciliationItem.createMany({
        data: observations.map((observation) => ({
          reconciliationRunId: runId,
          paymentAttemptId: observation.paymentAttemptId,
          orderId: observation.orderId,
          companyId: observation.companyId,
          providerReference: observation.providerReference,
          status: observation.status,
          mismatchKind: observation.mismatchKind,
          expectedAmountRappen: observation.expectedAmountRappen,
          observedAmountRappen: observation.observedAmountRappen,
          expectedCurrency: observation.expectedCurrency,
          observedCurrency: observation.observedCurrency,
          evidenceDigest: observation.evidenceDigest,
          reasonCode: observation.reasonCode,
          createdAt: startedAt,
        })),
      });
    }
    await transaction.reconciliationRun.update({
      where: { id: runId },
      data: {
        status: "COMPLETED",
        matchedCount: matched,
        mismatchCount: mismatched,
        processedCount: observations.length,
        manifestDigest,
        completedAt: startedAt,
      },
    });
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "RECONCILIATION_COMPLETED",
      actorKind: "SYSTEM",
      capability: "PAYMENT_RECONCILIATION_RUN",
      correlationId: input.correlationId,
      reasonCode: mismatched === 0 ? "ALL_ITEMS_MATCHED" : "MISMATCHES_OPENED",
      result: "SUCCEEDED",
      retainUntil: new Date(startedAt.getTime() + FINANCE_RETENTION_MS),
      targetId: runId,
      targetType: "RECONCILIATION_RUN",
    });
  });
  return Object.freeze({
    matched,
    mismatched,
    nextCursor:
      loaded.length > batchSize && providerInvoices.length > 0
        ? encodeSubscriptionInvoiceCursor({
            environment: input.environment,
            windowStart,
            windowEnd,
            lastCreatedAt: providerInvoices.at(-1)!.createdAt,
            lastId: providerInvoices.at(-1)!.id,
          })
        : null,
    processed: observations.length,
    runId,
  });
}

function encodeReconciliationCursor(
  input: Readonly<{
    environment: ReconciliationEnvironment;
    lastCreatedAt: Date;
    lastId: string;
    windowEnd: Date;
    windowStart: Date;
  }>,
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      e: input.environment,
      ws: input.windowStart.toISOString(),
      we: input.windowEnd.toISOString(),
      lc: input.lastCreatedAt.toISOString(),
      li: input.lastId,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeReconciliationCursor(
  value: string | null,
  expectedEnvironment: ReconciliationEnvironment,
  now: Date,
) {
  if (value === null) return null;
  if (
    value.length < 32 ||
    value.length > 255 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new TypeError("Payment reconciliation cursor is invalid.");
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value)
      throw new Error("NON_CANONICAL");
    const cursor = reconciliationCursorSchema.parse(
      JSON.parse(decoded.toString("utf8")),
    );
    const windowStart = new Date(cursor.ws);
    const windowEnd = new Date(cursor.we);
    const lastCreatedAt = new Date(cursor.lc);
    if (
      cursor.e !== expectedEnvironment ||
      windowEnd.getTime() - windowStart.getTime() !==
        RECONCILIATION_WINDOW_MS ||
      windowEnd.getTime() > now.getTime() ||
      lastCreatedAt < windowStart ||
      lastCreatedAt > windowEnd
    ) {
      throw new Error("CURSOR_SCOPE_MISMATCH");
    }
    return cursor;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Payment reconciliation cursor is invalid.", {
      cause: error,
    });
  }
}

function encodeSubscriptionInvoiceCursor(
  input: Readonly<{
    environment: ReconciliationEnvironment;
    lastCreatedAt: Date;
    lastId: string;
    windowEnd: Date;
    windowStart: Date;
  }>,
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      k: "subscription_invoice",
      e: input.environment,
      ws: input.windowStart.toISOString(),
      we: input.windowEnd.toISOString(),
      lc: input.lastCreatedAt.toISOString(),
      li: input.lastId,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeSubscriptionInvoiceCursor(
  value: string | null,
  expectedEnvironment: ReconciliationEnvironment,
  now: Date,
) {
  if (value === null) return null;
  if (
    value.length < 32 ||
    value.length > 255 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new TypeError("Payment reconciliation cursor is invalid.");
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) {
      throw new Error("NON_CANONICAL");
    }
    const cursor = subscriptionInvoiceCursorSchema.parse(
      JSON.parse(decoded.toString("utf8")),
    );
    const windowStart = new Date(cursor.ws);
    const windowEnd = new Date(cursor.we);
    const lastCreatedAt = new Date(cursor.lc);
    if (
      cursor.e !== expectedEnvironment ||
      windowEnd.getTime() - windowStart.getTime() !==
        RECONCILIATION_WINDOW_MS ||
      windowEnd.getTime() > now.getTime() ||
      lastCreatedAt < windowStart ||
      lastCreatedAt > windowEnd
    ) {
      throw new Error("CURSOR_SCOPE_MISMATCH");
    }
    return cursor;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Payment reconciliation cursor is invalid.", {
      cause: error,
    });
  }
}

function observeSubscriptionProviderInvoice(
  providerInvoice: Awaited<
    ReturnType<DatabaseClient["subscriptionProviderInvoice"]["findMany"]>
  >[number] & {
    order: {
      companyId: string;
      id: string;
      paymentEvents: Array<{ kind: string; payload: unknown }>;
    };
    subscription: {
      companyId: string;
      currentPeriodEnd: Date;
      currentPeriodStart: Date;
      currencySnapshot: string;
      dunningCases: Array<{ idempotencyKey: string; status: string }>;
      status: string;
      providerRecurringAmountRappenSnapshot: number | null;
    };
  },
  now: Date,
) {
  const paidEvents = providerInvoice.order.paymentEvents.filter(
    (event) =>
      event.kind === "RENEWAL_PAID" &&
      providerInvoiceReferenceFromPayload(event.payload) ===
        providerInvoice.providerInvoiceReference,
  );
  const failedEvents = providerInvoice.order.paymentEvents.filter(
    (event) =>
      event.kind === "RENEWAL_FAILED" &&
      providerInvoiceReferenceFromPayload(event.payload) ===
        providerInvoice.providerInvoiceReference,
  );
  const dunning = providerInvoice.subscription.dunningCases.find(
    ({ idempotencyKey }) =>
      idempotencyKey ===
      `dunning:invoice:${providerInvoice.providerInvoiceReference}`,
  );
  const dunningUnresolved =
    dunning !== undefined &&
    ["OPEN", "GRACE", "SUSPENDED"].includes(dunning.status);
  let mismatchKind: ReconciliationMismatchKind | null = null;
  if (
    providerInvoice.companyId !== providerInvoice.order.companyId ||
    providerInvoice.companyId !== providerInvoice.subscription.companyId
  ) {
    mismatchKind = "TENANT";
  } else if (providerInvoice.status === "CONFLICT") {
    mismatchKind = "PROVIDER_STATE";
  } else if (
    providerInvoice.status === "PAID" &&
    providerInvoice.amountRappen !==
      providerInvoice.subscription.providerRecurringAmountRappenSnapshot
  ) {
    mismatchKind = "AMOUNT";
  } else if (
    providerInvoice.status === "PAID" &&
    providerInvoice.currency !== providerInvoice.subscription.currencySnapshot
  ) {
    mismatchKind = "CURRENCY";
  } else if (
    providerInvoice.status === "PAID" &&
    (paidEvents.length !== 1 ||
      providerInvoice.amountRappen === null ||
      providerInvoice.subscription.providerRecurringAmountRappenSnapshot ===
        null ||
      providerInvoice.providerPaymentReference === null ||
      providerInvoice.periodStart === null ||
      providerInvoice.periodEnd === null ||
      providerInvoice.subscription.currentPeriodStart.getTime() <
        providerInvoice.periodStart.getTime() ||
      providerInvoice.subscription.currentPeriodEnd.getTime() <
        providerInvoice.periodEnd.getTime() ||
      dunningUnresolved)
  ) {
    mismatchKind = "LEDGER";
  } else if (
    providerInvoice.status === "FAILED" &&
    (failedEvents.length !== 1 ||
      (["ACTIVE", "CANCELLING", "SUSPENDED"].includes(
        providerInvoice.subscription.status,
      ) &&
        providerInvoice.subscription.currentPeriodEnd.getTime() >
          now.getTime() &&
        !dunningUnresolved))
  ) {
    mismatchKind = "PROVIDER_STATE";
  }
  const status: ReconciliationItemStatus =
    mismatchKind === null ? "MATCHED" : "OPEN";
  const evidenceDigest = digest({
    dunningStatus: dunning?.status ?? null,
    failedEventCount: failedEvents.length,
    paidEventCount: paidEvents.length,
    policyVersion: "phase33-subscription-provider-invoice-v1",
    providerInvoiceId: providerInvoice.id,
    providerInvoiceReference: providerInvoice.providerInvoiceReference,
    status: providerInvoice.status,
    subscriptionId: providerInvoice.subscriptionId,
  });
  return Object.freeze({
    companyId: providerInvoice.companyId,
    evidenceDigest,
    expectedAmountRappen:
      providerInvoice.subscription.providerRecurringAmountRappenSnapshot,
    expectedCurrency: providerInvoice.subscription.currencySnapshot,
    mismatchKind,
    observedAmountRappen: providerInvoice.amountRappen,
    observedCurrency: providerInvoice.currency,
    orderId: providerInvoice.orderId,
    paymentAttemptId: providerInvoice.paymentAttemptId,
    providerReference: providerInvoice.providerInvoiceReference,
    reasonCode: mismatchKind === null ? null : `RECONCILIATION_${mismatchKind}`,
    status,
  });
}

function providerInvoiceReferenceFromPayload(payload: unknown) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const value = (payload as Record<string, unknown>).providerInvoiceReference;
  return typeof value === "string" ? value : null;
}

function observeAttempt(
  attempt: Awaited<
    ReturnType<DatabaseClient["paymentAttempt"]["findMany"]>
  >[number] & {
    order: {
      id: string;
      companyId: string;
      currency: string;
      totalRappen: number;
      status: string;
      invoice: { id: string; status: string } | null;
      subscription: { id: string } | null;
      lines: Array<{
        planVersionId: string | null;
        productVersionId: string | null;
        creditLedgerEntries: Array<{ id: string }>;
      }>;
      paymentEvents: Array<{ id: string }>;
    };
    providerEvents: Array<{ id: string; status: string }>;
  },
) {
  const expectedAmountRappen = attempt.amountRappen;
  const observedAmountRappen = attempt.order.totalRappen;
  const expectedCurrency = attempt.currency;
  const observedCurrency = attempt.order.currency;
  let mismatchKind: ReconciliationMismatchKind | null = null;
  if (attempt.order.companyId !== attempt.companyId) {
    mismatchKind = "TENANT";
  } else if (expectedAmountRappen !== observedAmountRappen) {
    mismatchKind = "AMOUNT";
  } else if (expectedCurrency !== observedCurrency) {
    mismatchKind = "CURRENCY";
  } else if (
    attempt.status === "SUCCEEDED" &&
    (attempt.order.status !== "PAID" ||
      attempt.order.paymentEvents.length !== 1 ||
      attempt.providerPaymentReference === null ||
      attempt.providerEvents.length === 0)
  ) {
    mismatchKind = "PROVIDER_STATE";
  } else if (
    attempt.status === "SUCCEEDED" &&
    attempt.order.invoice?.status !== "PAID"
  ) {
    mismatchKind = "INVOICE";
  } else if (
    attempt.status === "SUCCEEDED" &&
    (attempt.order.lines.length !== 1 ||
      (attempt.order.lines[0]?.planVersionId !== null
        ? attempt.order.subscription === null
        : attempt.order.lines[0]?.productVersionId !== null &&
          attempt.order.lines[0].creditLedgerEntries.length !== 1))
  ) {
    mismatchKind = "LEDGER";
  } else if (
    attempt.status === "HELD" ||
    attempt.failureCode === "CHECKOUT_CALL_UNCERTAIN"
  ) {
    mismatchKind = "PROVIDER_STATE";
  } else if (
    attempt.status !== "SUCCEEDED" &&
    attempt.providerEvents.length > 0
  ) {
    mismatchKind = "PROVIDER_STATE";
  } else if (
    attempt.status !== "SUCCEEDED" &&
    attempt.order.status === "PAID"
  ) {
    mismatchKind = "PROVIDER_STATE";
  }
  const status: ReconciliationItemStatus =
    mismatchKind === null ? "MATCHED" : "OPEN";
  const evidenceDigest = digest({
    attemptId: attempt.id,
    attemptStatus: attempt.status,
    currency: {
      expected: expectedCurrency,
      observed: observedCurrency,
    },
    money: {
      expected: expectedAmountRappen,
      observed: observedAmountRappen,
    },
    orderId: attempt.order.id,
    orderStatus: attempt.order.status,
    policyVersion: "phase24-v1",
  });
  return Object.freeze({
    paymentAttemptId: attempt.id,
    orderId: attempt.order.id,
    companyId: attempt.companyId,
    providerReference:
      attempt.providerPaymentReference ??
      attempt.providerSessionReference ??
      attempt.id,
    status,
    mismatchKind,
    expectedAmountRappen,
    observedAmountRappen,
    expectedCurrency,
    observedCurrency,
    evidenceDigest,
    reasonCode: mismatchKind === null ? null : `RECONCILIATION_${mismatchKind}`,
  });
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}
