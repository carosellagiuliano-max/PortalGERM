import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { Prisma } from "@/lib/generated/prisma/client";

const FINANCE_RETENTION_MS = 10 * 365 * 86_400_000;

export const PAYMENT_RISK_POLICY_V1 = Object.freeze({
  version: "phase24-v1" as const,
  attemptVelocityWindowMilliseconds: 10 * 60_000,
  failureWindowMilliseconds: 24 * 60 * 60_000,
  refundWindowMilliseconds: 90 * 24 * 60 * 60_000,
  attemptReviewThreshold: 3,
  attemptHoldThreshold: 5,
  failureReviewThreshold: 2,
  failureHoldThreshold: 3,
  refundReviewThreshold: 2,
  refundHoldThreshold: 3,
  highAmountReviewRappen: 500_000,
  decisionTtlMilliseconds: 24 * 60 * 60_000,
});

export type PaymentRiskPolicyInput = Readonly<{
  activeCompanyHold: boolean;
  amountRappen: number;
  attemptsInVelocityWindow: number;
  failedAttemptsInWindow: number;
  identifierConflict: boolean;
  openChargebacks: number;
  refundsInWindow: number;
  tenantMismatch: boolean;
}>;

export type PaymentRiskPolicyDecision = Readonly<{
  kind: "ALLOW" | "HOLD" | "DENY" | "REVIEW";
  riskBasisPoints: number;
  signalCodes: readonly string[];
}>;

export function evaluatePaymentRiskPolicyV1(
  input: PaymentRiskPolicyInput,
): PaymentRiskPolicyDecision {
  assertBoundedRiskInput(input);
  const signals: string[] = [];
  let score = 0;

  if (input.tenantMismatch) {
    signals.push("TENANT_MISMATCH");
    score = 10_000;
  }
  if (input.identifierConflict) {
    signals.push("IDENTIFIER_CONFLICT");
    score = 10_000;
  }
  if (input.activeCompanyHold) {
    signals.push("ACTIVE_COMPANY_HOLD");
    score = Math.max(score, 9_000);
  }
  if (input.openChargebacks > 0) {
    signals.push("OPEN_CHARGEBACK");
    score = Math.max(score, 8_500);
  }
  if (
    input.attemptsInVelocityWindow >=
    PAYMENT_RISK_POLICY_V1.attemptHoldThreshold
  ) {
    signals.push("CHECKOUT_VELOCITY_HIGH");
    score = Math.max(score, 8_000);
  } else if (
    input.attemptsInVelocityWindow >=
    PAYMENT_RISK_POLICY_V1.attemptReviewThreshold
  ) {
    signals.push("CHECKOUT_VELOCITY_REVIEW");
    score = Math.max(score, 5_000);
  }
  if (
    input.failedAttemptsInWindow >= PAYMENT_RISK_POLICY_V1.failureHoldThreshold
  ) {
    signals.push("PAYMENT_FAILURE_VELOCITY_HIGH");
    score = Math.max(score, 8_000);
  } else if (
    input.failedAttemptsInWindow >=
    PAYMENT_RISK_POLICY_V1.failureReviewThreshold
  ) {
    signals.push("PAYMENT_FAILURE_VELOCITY_REVIEW");
    score = Math.max(score, 5_500);
  }
  if (input.refundsInWindow >= PAYMENT_RISK_POLICY_V1.refundHoldThreshold) {
    signals.push("REFUND_VELOCITY_HIGH");
    score = Math.max(score, 8_500);
  } else if (
    input.refundsInWindow >= PAYMENT_RISK_POLICY_V1.refundReviewThreshold
  ) {
    signals.push("REFUND_VELOCITY_REVIEW");
    score = Math.max(score, 5_500);
  }
  if (input.amountRappen >= PAYMENT_RISK_POLICY_V1.highAmountReviewRappen) {
    signals.push("HIGH_AMOUNT");
    score = Math.max(score, 5_000);
  }

  const kind =
    input.tenantMismatch || input.identifierConflict
      ? "DENY"
      : score >= 8_000
        ? "HOLD"
        : score >= 5_000
          ? "REVIEW"
          : "ALLOW";
  if (signals.length === 0) signals.push("BASELINE_ALLOW");
  return Object.freeze({
    kind,
    riskBasisPoints: score,
    signalCodes: Object.freeze(signals.sort()),
  });
}

export async function assessPaymentAttemptRiskInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    amountRappen: number;
    companyId: string;
    correlationId: string;
    now: Date;
    paymentAttemptId: string;
  }>,
): Promise<PaymentRiskPolicyDecision> {
  const velocitySince = new Date(
    input.now.getTime() -
      PAYMENT_RISK_POLICY_V1.attemptVelocityWindowMilliseconds,
  );
  const failureSince = new Date(
    input.now.getTime() - PAYMENT_RISK_POLICY_V1.failureWindowMilliseconds,
  );
  const refundSince = new Date(
    input.now.getTime() - PAYMENT_RISK_POLICY_V1.refundWindowMilliseconds,
  );
  const [
    attemptsInVelocityWindow,
    failedAttemptsInWindow,
    refundsInWindow,
    openChargebacks,
    activeCompanyHold,
  ] = await Promise.all([
    transaction.paymentAttempt.count({
      where: {
        companyId: input.companyId,
        createdAt: { gte: velocitySince, lte: input.now },
      },
    }),
    transaction.paymentAttempt.count({
      where: {
        companyId: input.companyId,
        createdAt: { gte: failureSince, lte: input.now },
        status: { in: ["FAILED", "CANCELLED", "EXPIRED"] },
      },
    }),
    transaction.refund.count({
      where: {
        companyId: input.companyId,
        requestedAt: { gte: refundSince, lte: input.now },
        status: { in: ["REQUESTED", "PENDING", "SUCCEEDED"] },
      },
    }),
    transaction.chargeback.count({
      where: { companyId: input.companyId, status: "OPEN" },
    }),
    transaction.paymentRiskDecision.count({
      where: {
        companyId: input.companyId,
        kind: { in: ["HOLD", "DENY", "REVIEW"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
      },
    }),
  ]);
  const decision = evaluatePaymentRiskPolicyV1({
    activeCompanyHold: activeCompanyHold > 0,
    amountRappen: input.amountRappen,
    attemptsInVelocityWindow,
    failedAttemptsInWindow,
    identifierConflict: false,
    openChargebacks,
    refundsInWindow,
    tenantMismatch: false,
  });
  const decisionId = randomUUID();
  await transaction.paymentRiskDecision.create({
    data: {
      id: decisionId,
      paymentAttemptId: input.paymentAttemptId,
      companyId: input.companyId,
      kind: decision.kind,
      riskBasisPoints: decision.riskBasisPoints,
      signalCodes: [...decision.signalCodes],
      evidenceDigest: riskEvidenceDigest({
        ...decision,
        amountRappen: input.amountRappen,
        companyId: input.companyId,
        paymentAttemptId: input.paymentAttemptId,
        policyVersion: PAYMENT_RISK_POLICY_V1.version,
      }),
      caseReference:
        decision.kind === "ALLOW" ? null : `PAY-RISK-${input.paymentAttemptId}`,
      decidedByUserId: null,
      decisionAt: input.now,
      expiresAt:
        decision.kind === "ALLOW"
          ? null
          : new Date(
              input.now.getTime() +
                PAYMENT_RISK_POLICY_V1.decisionTtlMilliseconds,
            ),
      idempotencyKey: `payment-risk:${input.paymentAttemptId}:initial`,
      createdAt: input.now,
    },
  });
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: "PAYMENT_RISK_DECIDED",
    actorKind: "SYSTEM",
    capability: "PAYMENT_RISK_EVALUATE",
    companyId: input.companyId,
    correlationId: input.correlationId,
    reasonCode: `PAYMENT_RISK_${decision.kind}`,
    result: "SUCCEEDED",
    retainUntil: new Date(input.now.getTime() + FINANCE_RETENTION_MS),
    targetId: decisionId,
    targetType: "PAYMENT_RISK_DECISION",
  });
  return decision;
}

function assertBoundedRiskInput(input: PaymentRiskPolicyInput) {
  for (const [field, value] of Object.entries({
    amountRappen: input.amountRappen,
    attemptsInVelocityWindow: input.attemptsInVelocityWindow,
    failedAttemptsInWindow: input.failedAttemptsInWindow,
    openChargebacks: input.openChargebacks,
    refundsInWindow: input.refundsInWindow,
  })) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) {
      throw new TypeError(`Payment risk field ${field} is invalid.`);
    }
  }
}

function riskEvidenceDigest(value: object) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
