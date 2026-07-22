import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AdminDomainError,
  adminErrorResult,
  adminFailure,
  adminNow,
  adminReasonCodeSchema,
  adminSuccess,
  adminUuidSchema,
  requireCapability,
  writeAdminAudit,
  type AdminCommandResult,
  type AdminDependencies,
} from "@/lib/admin/common";
import { deriveAdminMockRenewalPeriodV1 } from "@/lib/billing/admin-renewal-policy";
import { decodePlanEntitlementsV1 } from "@/lib/billing/entitlements";
import { Prisma } from "@/lib/generated/prisma/client";

const COMPANY_BILLING_LOCK_NAMESPACE = 1212;
const RENEWAL_IDEMPOTENCY_LOCK_NAMESPACE = 1214;
const OPERATION_PREFIX = "admin-mock-renewal";

const renewalSchema = z.strictObject({
  subscriptionId: adminUuidSchema,
  expectedPeriodEnd: z.coerce.date(),
  reasonCode: adminReasonCodeSchema,
  idempotencyKey: adminUuidSchema,
});

type RenewalInput = z.infer<typeof renewalSchema>;

export type AdminMockRenewalResult = Readonly<{
  companyId: string;
  sourceSubscriptionId: string;
  subscriptionId: string;
  planVersionId: string;
  periodStart: Date;
  periodEnd: Date;
  grantedTalentContacts: number;
  grantedJobBoosts: number;
}>;

/**
 * Explicit P0 mock renewal from ADR-004. This projects one already-due paid
 * term without creating an Order, PaymentEvent or Invoice. The supplied UUID
 * is also the successor Subscription id, which makes the outcome durable and
 * lets retries verify the complete request fingerprint.
 */
export async function adminMockRenewSubscription(
  raw: unknown,
  dependencies: AdminDependencies,
): Promise<AdminCommandResult<AdminMockRenewalResult>> {
  const parsed = renewalSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_BILLING_MUTATE")) {
    return adminFailure("FORBIDDEN");
  }

  let now: Date;
  try {
    now = adminNow(dependencies.now);
  } catch {
    return adminFailure("INVALID_INPUT");
  }

  return runSerializableRenewal(async () => {
    try {
      return await dependencies.database.$transaction(
        async (transaction) => {
          await lockRenewalIdempotencyKey(
            transaction,
            parsed.data.idempotencyKey,
          );

          const replay = await loadRenewalReplay(transaction, parsed.data);
          if (replay.kind === "MATCH") {
            return adminSuccess(replay.value, true);
          }
          if (replay.kind === "CONFLICT") return adminFailure("CONFLICT");

          const identity = await transaction.employerSubscription.findUnique({
            where: { id: parsed.data.subscriptionId },
            select: { companyId: true },
          });
          if (identity === null) return adminFailure("NOT_FOUND");

          await lockCompanyBillingScope(transaction, identity.companyId);
          await transaction.$queryRaw`
            SELECT "id" FROM "EmployerSubscription"
            WHERE "id" = ${parsed.data.subscriptionId}::uuid
            FOR UPDATE
          `;

          const source = await transaction.employerSubscription.findUnique({
            where: { id: parsed.data.subscriptionId },
            select: {
              id: true,
              companyId: true,
              planVersionId: true,
              status: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              billingIntervalSnapshot: true,
              termMonthsSnapshot: true,
              recurringNetRappenSnapshot: true,
              monthlyEquivalentRappenSnapshot: true,
              currencySnapshot: true,
              activatedAt: true,
              endedAt: true,
              company: { select: { status: true } },
              currentChangeSchedules: {
                where: { status: "PENDING" },
                select: { id: true },
                take: 1,
              },
              planVersion: {
                select: {
                  plan: { select: { isDefaultFree: true } },
                  entitlements: {
                    select: {
                      key: true,
                      valueType: true,
                      booleanValue: true,
                      integerValue: true,
                      analyticsLevelValue: true,
                    },
                  },
                },
              },
            },
          });
          if (source === null) return adminFailure("NOT_FOUND");

          const period = deriveAdminMockRenewalPeriodV1({
            currentPeriodEnd: source.currentPeriodEnd,
            termMonthsSnapshot: source.termMonthsSnapshot,
            now,
          });
          const naturallyExpired =
            source.status === "EXPIRED" &&
            source.endedAt?.getTime() === source.currentPeriodEnd.getTime();
          const dueActive = source.status === "ACTIVE" && source.endedAt === null;
          if (
            !period.ok ||
            source.companyId !== identity.companyId ||
            source.company.status !== "ACTIVE" ||
            source.currentPeriodEnd.getTime() !==
              parsed.data.expectedPeriodEnd.getTime() ||
            (!dueActive && !naturallyExpired) ||
            source.activatedAt === null ||
            source.planVersion.plan.isDefaultFree ||
            source.recurringNetRappenSnapshot <= 0 ||
            source.currentChangeSchedules.length !== 0
          ) {
            return adminFailure("CONFLICT");
          }

          const rights = decodePlanEntitlementsV1(
            source.planVersion.entitlements,
          );
          if (!rights.ok) return adminFailure("CONFLICT");

          const successorOrOverlap = await transaction.employerSubscription.findFirst({
            where: {
              companyId: source.companyId,
              id: { not: source.id },
              currentPeriodEnd: { gt: period.value.periodStart },
            },
            select: { id: true },
          });
          if (successorOrOverlap !== null) return adminFailure("CONFLICT");

          if (dueActive) {
            const expired = await transaction.employerSubscription.updateMany({
              where: {
                id: source.id,
                companyId: source.companyId,
                status: "ACTIVE",
                currentPeriodEnd: source.currentPeriodEnd,
                endedAt: null,
              },
              data: { status: "EXPIRED", endedAt: source.currentPeriodEnd },
            });
            if (expired.count !== 1) throw new AdminDomainError("CONFLICT");
          }

          const successor = await transaction.employerSubscription.create({
            data: {
              id: parsed.data.idempotencyKey,
              companyId: source.companyId,
              planVersionId: source.planVersionId,
              sourceOrderId: null,
              status: "ACTIVE",
              currentPeriodStart: period.value.periodStart,
              currentPeriodEnd: period.value.periodEnd,
              billingIntervalSnapshot: source.billingIntervalSnapshot,
              termMonthsSnapshot: source.termMonthsSnapshot,
              recurringNetRappenSnapshot: source.recurringNetRappenSnapshot,
              monthlyEquivalentRappenSnapshot:
                source.monthlyEquivalentRappenSnapshot,
              currencySnapshot: source.currencySnapshot,
              activatedAt: period.value.periodStart,
              endedAt: null,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });

          if (dueActive) {
            await transaction.subscriptionEvent.create({
              data: {
                id: randomUUID(),
                subscriptionId: source.id,
                kind: "EXPIRED",
                actorUserId: dependencies.actor.userId,
                reasonCode: parsed.data.reasonCode,
                idempotencyKey: renewalEventKey(
                  parsed.data.idempotencyKey,
                  "expired",
                ),
                correlationId: parsed.data.idempotencyKey,
                createdAt: now,
              },
            });
          }
          await transaction.subscriptionEvent.createMany({
            data: [
              {
                id: randomUUID(),
                subscriptionId: source.id,
                kind: "CHANGED",
                actorUserId: dependencies.actor.userId,
                reasonCode: parsed.data.reasonCode,
                idempotencyKey: renewalEventKey(
                  parsed.data.idempotencyKey,
                  "source",
                ),
                correlationId: parsed.data.idempotencyKey,
                createdAt: now,
              },
              {
                id: randomUUID(),
                subscriptionId: successor.id,
                kind: "ACTIVATED",
                actorUserId: dependencies.actor.userId,
                reasonCode: parsed.data.reasonCode,
                idempotencyKey: renewalEventKey(
                  parsed.data.idempotencyKey,
                  "activated",
                ),
                correlationId: parsed.data.idempotencyKey,
                createdAt: now,
              },
            ],
          });

          const auditDependencies = Object.freeze({
            ...dependencies,
            correlationId: parsed.data.idempotencyKey,
          });
          await writeAdminAudit(transaction, auditDependencies, now, {
            action: "SUBSCRIPTION_CHANGED",
            capability: "ADMIN_BILLING_MUTATE",
            targetType: "SUBSCRIPTION",
            targetId: source.id,
            companyId: source.companyId,
            reasonCode: parsed.data.reasonCode,
          });
          if (dueActive) {
            await writeAdminAudit(transaction, auditDependencies, now, {
              action: "SUBSCRIPTION_EXPIRED",
              capability: "ADMIN_BILLING_MUTATE",
              targetType: "SUBSCRIPTION",
              targetId: source.id,
              companyId: source.companyId,
              reasonCode: parsed.data.reasonCode,
            });
          }
          await writeAdminAudit(transaction, auditDependencies, now, {
            action: "SUBSCRIPTION_ACTIVATED",
            capability: "ADMIN_BILLING_MUTATE",
            targetType: "SUBSCRIPTION",
            targetId: successor.id,
            companyId: source.companyId,
            reasonCode: parsed.data.reasonCode,
          });

          await grantRenewalAllowances(transaction, {
            actorUserId: dependencies.actor.userId,
            auditDependencies,
            companyId: source.companyId,
            jobBoostAmount: rights.value.JOB_BOOST_ALLOWANCE,
            now,
            planVersionId: source.planVersionId,
            subscriptionId: successor.id,
            talentContactAmount: rights.value.TALENT_CONTACT_ALLOWANCE,
            validFrom: period.value.periodStart,
            validTo: period.value.periodEnd,
          });

          return adminSuccess({
            companyId: source.companyId,
            sourceSubscriptionId: source.id,
            subscriptionId: successor.id,
            planVersionId: source.planVersionId,
            periodStart: period.value.periodStart,
            periodEnd: period.value.periodEnd,
            grantedTalentContacts: rights.value.TALENT_CONTACT_ALLOWANCE,
            grantedJobBoosts: rights.value.JOB_BOOST_ALLOWANCE,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isRetryableTransactionError(error)) throw error;
      return adminErrorResult(error);
    }
  });
}

type ReplayDecision = Readonly<
  | { kind: "NONE" }
  | { kind: "CONFLICT" }
  | { kind: "MATCH"; value: AdminMockRenewalResult }
>;

async function loadRenewalReplay(
  transaction: Prisma.TransactionClient,
  input: RenewalInput,
): Promise<ReplayDecision> {
  const [successor, sourceEvent, activationEvent] = await Promise.all([
    transaction.employerSubscription.findUnique({
      where: { id: input.idempotencyKey },
      select: {
        id: true,
        companyId: true,
        planVersionId: true,
        sourceOrderId: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        billingIntervalSnapshot: true,
        termMonthsSnapshot: true,
        recurringNetRappenSnapshot: true,
        monthlyEquivalentRappenSnapshot: true,
        currencySnapshot: true,
        planVersion: {
          select: {
            entitlements: {
              select: {
                key: true,
                valueType: true,
                booleanValue: true,
                integerValue: true,
                analyticsLevelValue: true,
              },
            },
          },
        },
        planAllowanceEntries: {
          orderBy: [{ account: { creditType: "asc" } }, { id: "asc" }],
          select: {
            id: true,
            kind: true,
            amount: true,
            fundingSource: true,
            sourcePlanVersionId: true,
            idempotencyKey: true,
            reasonCode: true,
            validFrom: true,
            validTo: true,
            account: {
              select: {
                companyId: true,
                creditType: true,
                fundingSource: true,
                periodStart: true,
                periodEnd: true,
              },
            },
          },
        },
      },
    }),
    transaction.subscriptionEvent.findUnique({
      where: { idempotencyKey: renewalEventKey(input.idempotencyKey, "source") },
      select: {
        subscriptionId: true,
        kind: true,
        reasonCode: true,
        correlationId: true,
      },
    }),
    transaction.subscriptionEvent.findUnique({
      where: {
        idempotencyKey: renewalEventKey(input.idempotencyKey, "activated"),
      },
      select: {
        subscriptionId: true,
        kind: true,
        reasonCode: true,
        correlationId: true,
      },
    }),
  ]);
  if (successor === null && sourceEvent === null && activationEvent === null) {
    return Object.freeze({ kind: "NONE" });
  }
  if (successor === null || sourceEvent === null || activationEvent === null) {
    return Object.freeze({ kind: "CONFLICT" });
  }

  const rights = decodePlanEntitlementsV1(successor.planVersion.entitlements);
  const expectedEnd = deriveAdminMockRenewalPeriodV1({
    currentPeriodEnd: input.expectedPeriodEnd,
    termMonthsSnapshot: successor.termMonthsSnapshot,
    now: input.expectedPeriodEnd,
  });
  if (
    !rights.ok ||
    !expectedEnd.ok ||
    successor.sourceOrderId !== null ||
    successor.currentPeriodStart.getTime() !== input.expectedPeriodEnd.getTime() ||
    successor.currentPeriodEnd.getTime() !== expectedEnd.value.periodEnd.getTime() ||
    sourceEvent.subscriptionId !== input.subscriptionId ||
    sourceEvent.kind !== "CHANGED" ||
    sourceEvent.reasonCode !== input.reasonCode ||
    sourceEvent.correlationId !== input.idempotencyKey ||
    activationEvent.subscriptionId !== successor.id ||
    activationEvent.kind !== "ACTIVATED" ||
    activationEvent.reasonCode !== input.reasonCode ||
    activationEvent.correlationId !== input.idempotencyKey ||
    !allowanceReplayMatches(successor, rights.value)
  ) {
    return Object.freeze({ kind: "CONFLICT" });
  }

  const audits = await transaction.auditLog.findMany({
    where: {
      correlationId: input.idempotencyKey,
      capability: "ADMIN_BILLING_MUTATE",
      result: "SUCCEEDED",
      OR: [
        {
          action: "SUBSCRIPTION_CHANGED",
          targetType: "SUBSCRIPTION",
          targetId: input.subscriptionId,
          reasonCode: input.reasonCode,
        },
        {
          action: "SUBSCRIPTION_ACTIVATED",
          targetType: "SUBSCRIPTION",
          targetId: successor.id,
          reasonCode: input.reasonCode,
        },
      ],
    },
    select: { action: true, targetId: true },
  });
  if (
    audits.filter(
      (audit) =>
        audit.action === "SUBSCRIPTION_CHANGED" &&
        audit.targetId === input.subscriptionId,
    ).length !== 1 ||
    audits.filter(
      (audit) =>
        audit.action === "SUBSCRIPTION_ACTIVATED" &&
        audit.targetId === successor.id,
    ).length !== 1
  ) {
    return Object.freeze({ kind: "CONFLICT" });
  }

  return Object.freeze({
    kind: "MATCH",
    value: Object.freeze({
      companyId: successor.companyId,
      sourceSubscriptionId: input.subscriptionId,
      subscriptionId: successor.id,
      planVersionId: successor.planVersionId,
      periodStart: successor.currentPeriodStart,
      periodEnd: successor.currentPeriodEnd,
      grantedTalentContacts: rights.value.TALENT_CONTACT_ALLOWANCE,
      grantedJobBoosts: rights.value.JOB_BOOST_ALLOWANCE,
    }),
  });
}

function allowanceReplayMatches(
  successor: Readonly<{
    id: string;
    companyId: string;
    planVersionId: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    planAllowanceEntries: readonly Readonly<{
      kind: string;
      amount: number;
      fundingSource: string;
      sourcePlanVersionId: string | null;
      idempotencyKey: string;
      reasonCode: string | null;
      validFrom: Date;
      validTo: Date;
      account: Readonly<{
        companyId: string;
        creditType: string;
        fundingSource: string;
        periodStart: Date;
        periodEnd: Date;
      }>;
    }>[];
  }>,
  rights: Readonly<{
    TALENT_CONTACT_ALLOWANCE: number;
    JOB_BOOST_ALLOWANCE: number;
  }>,
) {
  const expected = [
    ["TALENT_CONTACT", rights.TALENT_CONTACT_ALLOWANCE],
    ["JOB_BOOST", rights.JOB_BOOST_ALLOWANCE],
  ] as const;
  const nonZero = expected.filter(([, amount]) => amount > 0);
  if (successor.planAllowanceEntries.length !== nonZero.length) return false;
  return nonZero.every(([creditType, amount]) =>
    successor.planAllowanceEntries.some(
      (entry) =>
        entry.account.creditType === creditType &&
        entry.account.companyId === successor.companyId &&
        entry.account.fundingSource === "PLAN_ALLOWANCE" &&
        entry.account.periodStart.getTime() ===
          successor.currentPeriodStart.getTime() &&
        entry.account.periodEnd.getTime() === successor.currentPeriodEnd.getTime() &&
        entry.kind === "GRANT" &&
        entry.amount === amount &&
        entry.fundingSource === "PLAN_ALLOWANCE" &&
        entry.sourcePlanVersionId === successor.planVersionId &&
        entry.idempotencyKey ===
          `plan-allowance:${successor.id}:${creditType}` &&
        entry.reasonCode === "SUBSCRIPTION_ALLOWANCE" &&
        entry.validFrom.getTime() === successor.currentPeriodStart.getTime() &&
        entry.validTo.getTime() === successor.currentPeriodEnd.getTime(),
    ),
  );
}

async function grantRenewalAllowances(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    actorUserId: string;
    auditDependencies: AdminDependencies;
    companyId: string;
    jobBoostAmount: number;
    now: Date;
    planVersionId: string;
    subscriptionId: string;
    talentContactAmount: number;
    validFrom: Date;
    validTo: Date;
  }>,
) {
  const amounts = {
    TALENT_CONTACT: input.talentContactAmount,
    JOB_BOOST: input.jobBoostAmount,
  } as const;
  for (const creditType of ["TALENT_CONTACT", "JOB_BOOST"] as const) {
    const amount = amounts[creditType];
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new AdminDomainError("CONFLICT");
    }
    if (amount === 0) continue;
    const account = await transaction.creditAccount.upsert({
      where: {
        companyId_creditType_fundingSource_periodStart: {
          companyId: input.companyId,
          creditType,
          fundingSource: "PLAN_ALLOWANCE",
          periodStart: input.validFrom,
        },
      },
      create: {
        id: randomUUID(),
        companyId: input.companyId,
        creditType,
        fundingSource: "PLAN_ALLOWANCE",
        periodStart: input.validFrom,
        periodEnd: input.validTo,
        createdAt: input.now,
      },
      update: {},
      select: {
        id: true,
        companyId: true,
        creditType: true,
        fundingSource: true,
        periodStart: true,
        periodEnd: true,
      },
    });
    if (
      account.companyId !== input.companyId ||
      account.creditType !== creditType ||
      account.fundingSource !== "PLAN_ALLOWANCE" ||
      account.periodStart.getTime() !== input.validFrom.getTime() ||
      account.periodEnd.getTime() !== input.validTo.getTime()
    ) {
      throw new AdminDomainError("CONFLICT");
    }
    const entry = await transaction.creditLedgerEntry.create({
      data: {
        id: randomUUID(),
        accountId: account.id,
        fundingSource: "PLAN_ALLOWANCE",
        kind: "GRANT",
        amount,
        sourcePlanVersionId: input.planVersionId,
        sourceSubscriptionId: input.subscriptionId,
        sourceOrderLineId: null,
        validFrom: input.validFrom,
        validTo: input.validTo,
        idempotencyKey: `plan-allowance:${input.subscriptionId}:${creditType}`,
        reasonCode: "SUBSCRIPTION_ALLOWANCE",
        actorUserId: input.actorUserId,
        createdAt: input.now,
      },
      select: { id: true },
    });
    await writeAdminAudit(
      transaction,
      input.auditDependencies,
      input.now,
      {
        action: "CREDITS_GRANTED",
        capability: "ADMIN_BILLING_MUTATE",
        targetType: "CREDIT_LEDGER_ENTRY",
        targetId: entry.id,
        companyId: input.companyId,
        reasonCode: "ADMIN_MOCK_RENEWAL_ALLOWANCE",
      },
    );
  }
}

async function lockRenewalIdempotencyKey(
  transaction: Prisma.TransactionClient,
  idempotencyKey: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${RENEWAL_IDEMPOTENCY_LOCK_NAMESPACE}::integer,
      hashtext(${idempotencyKey})::integer
    ) IS NULL AS "locked"
  `;
}

async function lockCompanyBillingScope(
  transaction: Prisma.TransactionClient,
  companyId: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${COMPANY_BILLING_LOCK_NAMESPACE}::integer,
      hashtext(${companyId})::integer
    ) IS NULL AS "locked"
  `;
  await transaction.$queryRaw`
    SELECT "id" FROM "Company" WHERE "id" = ${companyId}::uuid FOR UPDATE
  `;
}

function renewalEventKey(
  idempotencyKey: string,
  suffix: "source" | "expired" | "activated",
) {
  return `${OPERATION_PREFIX}:${idempotencyKey}:${suffix}`;
}

async function runSerializableRenewal<T>(
  operation: () => Promise<AdminCommandResult<T>>,
): Promise<AdminCommandResult<T>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) {
        return adminErrorResult(error);
      }
    }
  }
  return adminFailure("WRITE_FAILED");
}

function isRetryableTransactionError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  const metadata =
    "meta" in error && typeof error.meta === "object" && error.meta !== null
      ? error.meta
      : null;
  const messages = [
    "message" in error && typeof error.message === "string"
      ? error.message
      : "",
    metadata !== null &&
    "message" in metadata &&
    typeof metadata.message === "string"
      ? metadata.message
      : "",
    metadata !== null && "code" in metadata ? String(metadata.code) : "",
  ].join("\n");
  return /40001|40P01|could not serialize access|deadlock detected|write conflict/iu.test(
    messages,
  );
}
