import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import type {
  ReconciliationItemStatus,
  ReconciliationMismatchKind,
} from "@/lib/generated/prisma/client";

const FINANCE_RETENTION_MS = 10 * 365 * 86_400_000;

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
    environment: "local" | "ci" | "staging";
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
  const windowStart = new Date(startedAt.getTime() - 24 * 60 * 60_000);
  const attempts = await database.paymentAttempt.findMany({
    where: {
      environment: input.environment,
      provider: "STRIPE",
      ...(input.cursor == null ? {} : { id: { gt: input.cursor } }),
    },
    orderBy: { id: "asc" },
    take: batchSize,
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
    windowEnd: startedAt.toISOString(),
  });

  await database.$transaction(async (transaction) => {
    await transaction.reconciliationRun.create({
      data: {
        id: runId,
        provider: "STRIPE",
        environment: input.environment,
        status: "RUNNING",
        providerWindowStart: windowStart,
        providerWindowEnd: startedAt,
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
      attempts.length === batchSize ? (attempts.at(-1)?.id ?? null) : null,
    processed: observations.length,
    runId,
  });
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
