import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminSuccess,
  requireCapability,
  type AdminDependencies,
} from "@/lib/admin/common";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { writeRequiredAudit } from "@/lib/audit/log";
import {
  allocateCreditConsumptionV1,
  allocateCreditExpiriesV1,
  type AvailableCreditGrantV1,
} from "@/lib/billing/credit-policy";
import {
  billingIdempotencyKeySchema,
  normalizeBillingNow,
} from "@/lib/billing/contracts";
import type { CreditFundingSource, CreditType } from "@/lib/billing/entitlements";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";

const BILLING_AUDIT_RETENTION_MS = 10 * 365 * 86_400_000;
const MAX_SERIALIZABLE_ATTEMPTS = 4;
const CREDIT_CONSUME_KEY_NAMESPACE = "credit-consume-v1";
const CREDIT_EXPIRY_KEY_NAMESPACE = "credit-expire-v1";

const creditTypeSchema = z.enum([
  "TALENT_CONTACT",
  "JOB_BOOST",
  "NEWSLETTER",
  "SOCIAL_PUSH",
]);
const reasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u);
const capabilitySchema = z.string().regex(/^[A-Z][A-Z0-9_:.-]{0,127}$/u);
const consumeCreditsSchema = z.strictObject({
  companyId: z.uuid(),
  creditType: creditTypeSchema,
  amount: z.coerce.number().int().min(1).max(10_000),
  idempotencyKey: billingIdempotencyKeySchema,
  reasonCode: reasonCodeSchema,
});
const consumeActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("USER"), userId: z.uuid() }),
  z.strictObject({ kind: z.literal("SYSTEM") }),
]);
const projectDueCreditExpiriesSchema = z.strictObject({});

export type CreditConsumeActor = z.infer<typeof consumeActorSchema>;

export type CreditConsumeDependencies = Readonly<{
  actor: CreditConsumeActor;
  capability: string;
  correlationId: string;
  database: DatabaseClient;
  now?: Date;
}>;

export type CreditConsumeAllocation = Readonly<{
  accountId: string;
  amount: number;
  consumedGrantEntryId: string;
  entryId: string;
  fundingSource: CreditFundingSource;
  validFrom: Date;
  validTo: Date;
}>;

export type CreditConsumeValue = Readonly<{
  allocations: readonly CreditConsumeAllocation[];
  companyId: string;
  consumedAmount: number;
  creditType: CreditType;
}>;

export type CreditConsumeErrorCode =
  | "COMPANY_INACTIVE"
  | "CONFLICT"
  | "FORBIDDEN"
  | "IDEMPOTENCY_MISMATCH"
  | "INSUFFICIENT_CREDITS"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "WRITE_FAILED";

export type CreditConsumeResult = Readonly<
  | { ok: true; value: CreditConsumeValue; replay?: true }
  | { ok: false; code: CreditConsumeErrorCode }
>;

export type CreditExpiryProjectionResult = Readonly<{
  expiredCreditAmount: number;
  projectedGrantCount: number;
}>;

export type LockedSingleCreditConsumptionResult =
  | Readonly<{
      ok: true;
      entryId: string;
      fundingSource: CreditFundingSource;
      replay: boolean;
    }>
  | Readonly<{ ok: false; code: "INSUFFICIENT_CREDITS" | "IDEMPOTENCY_MISMATCH" }>;

/**
 * Admin-triggerable mock worker boundary. Expiry remains a SYSTEM-derived
 * ledger transition; the Admin merely starts the deterministic projection.
 */
export async function projectDueCreditExpiries(
  raw: unknown,
  dependencies: AdminDependencies,
) {
  if (!projectDueCreditExpiriesSchema.safeParse(raw).success) {
    return adminFailure("INVALID_INPUT");
  }
  if (!requireCapability(dependencies, "ADMIN_BILLING_MUTATE")) {
    return adminFailure("FORBIDDEN");
  }
  try {
    return adminSuccess(
      await projectCreditExpiries({
        correlationId: dependencies.correlationId,
        database: dependencies.database,
        now: adminNow(dependencies.now),
      }),
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function projectCreditExpiries(
  dependencies: Readonly<{
    correlationId: string;
    database: DatabaseClient;
    now: Date;
  }>,
): Promise<CreditExpiryProjectionResult> {
  const parsed = z.strictObject({ correlationId: z.uuid(), now: z.date() }).safeParse({
    correlationId: dependencies.correlationId,
    now: dependencies.now,
  });
  if (!parsed.success || !Number.isFinite(parsed.data.now.getTime())) {
    throw new TypeError("Credit expiry projection requires a valid clock and correlation.");
  }
  const now = new Date(parsed.data.now.getTime());
  const accounts = await dependencies.database.creditAccount.findMany({
    where: {
      entries: { some: { kind: "GRANT", validTo: { lte: now } } },
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });

  let expiredCreditAmount = 0;
  let projectedGrantCount = 0;
  for (const account of accounts) {
    const projected = await projectCreditAccountExpiries(
      dependencies,
      account.id,
      now,
    );
    expiredCreditAmount += projected.expiredCreditAmount;
    projectedGrantCount += projected.projectedGrantCount;
    if (!Number.isSafeInteger(expiredCreditAmount)) {
      throw new Error("Projected Credit expiry total exceeded the safe range.");
    }
  }
  return Object.freeze({ expiredCreditAmount, projectedGrantCount });
}

async function projectCreditAccountExpiries(
  dependencies: Readonly<{
    correlationId: string;
    database: DatabaseClient;
  }>,
  accountId: string,
  now: Date,
): Promise<CreditExpiryProjectionResult> {
  return dependencies.database.$transaction(async (transaction) => {
    const lockedAccount = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CreditAccount"
      WHERE "id" = ${accountId}::uuid
      FOR UPDATE
    `;
    if (lockedAccount.length !== 1) {
      return Object.freeze({ expiredCreditAmount: 0, projectedGrantCount: 0 });
    }
    const account = await transaction.creditAccount.findUnique({
      where: { id: accountId },
      select: { companyId: true, creditType: true },
    });
    if (account === null) {
      return Object.freeze({ expiredCreditAmount: 0, projectedGrantCount: 0 });
    }
    const lockedGrants = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CreditLedgerEntry"
      WHERE "accountId" = ${accountId}::uuid
        AND "kind" = 'GRANT'
        AND "validTo" <= ${now}
      ORDER BY "validTo", "createdAt", "id"
      FOR UPDATE
    `;
    if (lockedGrants.length === 0) {
      return Object.freeze({ expiredCreditAmount: 0, projectedGrantCount: 0 });
    }
    const rows = await transaction.creditLedgerEntry.findMany({
      where: { id: { in: lockedGrants.map(({ id }) => id) }, kind: "GRANT" },
      orderBy: [{ validTo: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        accountId: true,
        amount: true,
        fundingSource: true,
        validFrom: true,
        validTo: true,
        createdAt: true,
        grantConsumptions: {
          where: { kind: { in: ["CONSUME", "EXPIRE"] } },
          select: {
            amount: true,
            reversedByEntry: { select: { amount: true } },
          },
        },
      },
    });
    const grants: AvailableCreditGrantV1[] = rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      fundingSource: row.fundingSource,
      creditType: account.creditType,
      remaining: row.grantConsumptions.reduce(
        (remaining, entry) =>
          remaining + entry.amount + (entry.reversedByEntry?.amount ?? 0),
        row.amount,
      ),
      validFrom: row.validFrom,
      validTo: row.validTo,
      createdAt: row.createdAt,
    }));
    const expiryPlan = allocateCreditExpiriesV1({
      grants,
      creditType: account.creditType,
      at: now,
    });
    if (!expiryPlan.ok) {
      throw new Error(`Credit expiry policy rejected persisted history: ${expiryPlan.error.code}`);
    }
    for (const allocation of expiryPlan.value.allocations) {
      const entry = await transaction.creditLedgerEntry.create({
        data: {
          id: randomUUID(),
          accountId: allocation.accountId,
          fundingSource: allocation.fundingSource,
          kind: "EXPIRE",
          amount: allocation.ledgerAmount,
          consumedGrantEntryId: allocation.sourceGrantEntryId,
          validFrom: grants.find(({ id }) => id === allocation.sourceGrantEntryId)!.validFrom,
          validTo: allocation.boundary,
          idempotencyKey: `${CREDIT_EXPIRY_KEY_NAMESPACE}:${allocation.sourceGrantEntryId}`,
          reasonCode: "PERIOD_ENDED",
          actorUserId: null,
          createdAt: now,
        },
        select: { id: true },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "CREDITS_EXPIRED",
        actorKind: "SYSTEM",
        capability: "BILLING_CREDIT_EXPIRY_PROJECT",
        companyId: account.companyId,
        correlationId: dependencies.correlationId,
        reasonCode: "PERIOD_ENDED",
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + BILLING_AUDIT_RETENTION_MS),
        targetId: entry.id,
        targetType: "CREDIT_LEDGER_ENTRY",
      });
    }
    return Object.freeze({
      expiredCreditAmount: expiryPlan.value.totalExpired,
      projectedGrantCount: expiryPlan.value.allocations.length,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/**
 * Billing-owned primitive for a domain transaction that must append one
 * concrete consumption and its audit atomically with the owning projection.
 * The caller must already hold its domain/company locks and keep this exact
 * Prisma transaction open until its projection and required evidence commit.
 */
export async function consumeOneCompanyCreditInLockedTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    actorUserId: string;
    capability: string;
    companyId: string;
    correlationId: string;
    creditType: CreditType;
    idempotencyKey: string;
    now: Date;
    reasonCode: string;
  }>,
): Promise<LockedSingleCreditConsumptionResult> {
  const parsed = z
    .strictObject({
      actorUserId: z.uuid(),
      capability: capabilitySchema,
      companyId: z.uuid(),
      correlationId: z.uuid(),
      creditType: creditTypeSchema,
      idempotencyKey: billingIdempotencyKeySchema,
      now: z.date(),
      reasonCode: reasonCodeSchema,
    })
    .safeParse(input);
  if (!parsed.success || !Number.isFinite(parsed.data.now.getTime())) {
    throw new TypeError("Locked Credit consumption input is invalid.");
  }
  const command = parsed.data;
  const ledgerKey = `talent-contact:${createHash("sha256")
    .update(command.idempotencyKey, "utf8")
    .digest("hex")}`;
  const replay = await transaction.creditLedgerEntry.findFirst({
    where: {
      idempotencyKey: ledgerKey,
      account: {
        companyId: command.companyId,
        creditType: command.creditType,
      },
    },
    select: {
      id: true,
      actorUserId: true,
      fundingSource: true,
      kind: true,
      amount: true,
      account: { select: { companyId: true, creditType: true } },
    },
  });
  if (replay !== null) {
    return replay.actorUserId === command.actorUserId &&
      replay.kind === "CONSUME" &&
      replay.amount === -1 &&
      replay.account.companyId === command.companyId &&
      replay.account.creditType === command.creditType
      ? Object.freeze({
          ok: true as const,
          entryId: replay.id,
          fundingSource: replay.fundingSource,
          replay: true,
        })
      : Object.freeze({
          ok: false as const,
          code: "IDEMPOTENCY_MISMATCH" as const,
        });
  }

  const grants = await loadLockedAvailableGrants(
    transaction,
    command.companyId,
    command.creditType,
    command.now,
  );
  const allocation = allocateCreditConsumptionV1({
    grants,
    creditType: command.creditType,
    amount: 1,
    at: command.now,
  });
  if (!allocation.ok || allocation.value.allocations.length !== 1) {
    return Object.freeze({
      ok: false as const,
      code: "INSUFFICIENT_CREDITS" as const,
    });
  }
  const source = allocation.value.allocations[0]!;
  const entry = await transaction.creditLedgerEntry.create({
    data: {
      id: randomUUID(),
      accountId: source.accountId,
      fundingSource: source.fundingSource,
      kind: "CONSUME",
      amount: -1,
      consumedGrantEntryId: source.sourceGrantEntryId,
      validFrom: source.validFrom,
      validTo: source.validTo,
      idempotencyKey: ledgerKey,
      reasonCode: command.reasonCode,
      actorUserId: command.actorUserId,
      createdAt: command.now,
    },
    select: { id: true, fundingSource: true },
  });
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: "CREDITS_CONSUMED",
    actorKind: "USER",
    actorUserId: command.actorUserId,
    capability: command.capability,
    companyId: command.companyId,
    correlationId: command.correlationId,
    reasonCode: command.reasonCode,
    result: "SUCCEEDED",
    retainUntil: new Date(command.now.getTime() + BILLING_AUDIT_RETENTION_MS),
    targetId: entry.id,
    targetType: "CREDIT_LEDGER_ENTRY",
  });
  return Object.freeze({
    ok: true as const,
    entryId: entry.id,
    fundingSource: entry.fundingSource,
    replay: false,
  });
}

/**
 * Appends only company-scoped, negative CONSUME ledger rows and their required
 * audits. Business projections such as ContactRequest or JobBoost deliberately
 * remain the responsibility of their owning domain command.
 */
export async function consumeCompanyCredits(
  raw: unknown,
  dependencies: CreditConsumeDependencies,
): Promise<CreditConsumeResult> {
  const parsed = consumeCreditsSchema.safeParse(raw);
  const dependencyContract = z
    .strictObject({
      actor: consumeActorSchema,
      capability: capabilitySchema,
      correlationId: z.uuid(),
      now: z.date().optional(),
    })
    .safeParse({
      actor: dependencies.actor,
      capability: dependencies.capability,
      correlationId: dependencies.correlationId,
      now: dependencies.now,
    });
  if (!parsed.success || !dependencyContract.success) {
    return creditFailure("INVALID_INPUT");
  }

  let now: Date;
  try {
    now = normalizeBillingNow(dependencyContract.data.now);
  } catch {
    return creditFailure("INVALID_INPUT");
  }
  const input = parsed.data;
  const operationPrefix = creditConsumeOperationPrefix(input.idempotencyKey);

  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await dependencies.database.$transaction(
        async (transaction) => {
          const companyRows = await transaction.$queryRaw<
            Array<{ id: string; status: string }>
          >`
            SELECT "id", "status"::text AS "status"
            FROM "Company"
            WHERE "id" = ${input.companyId}::uuid
            FOR UPDATE
          `;
          const company = companyRows[0];
          if (company === undefined) return creditFailure("NOT_FOUND");
          if (company.status !== "ACTIVE") {
            return creditFailure("COMPANY_INACTIVE");
          }

          if (dependencyContract.data.actor.kind === "USER") {
            const membership = await transaction.companyMembership.findFirst({
              where: {
                companyId: input.companyId,
                userId: dependencyContract.data.actor.userId,
                status: "ACTIVE",
                user: { status: "ACTIVE" },
              },
              select: { id: true },
            });
            if (membership === null) return creditFailure("FORBIDDEN");
          }

          const replay = await loadReplay(
            transaction,
            input.companyId,
            operationPrefix,
          );
          if (replay.length > 0) {
            return replayResult({
              actor: dependencyContract.data.actor,
              amount: input.amount,
              companyId: input.companyId,
              creditType: input.creditType,
              operationPrefix,
              reasonCode: input.reasonCode,
              rows: replay,
            });
          }

          const grants = await loadLockedAvailableGrants(
            transaction,
            input.companyId,
            input.creditType,
            now,
          );
          const plan = allocateCreditConsumptionV1({
            grants,
            creditType: input.creditType,
            amount: input.amount,
            at: now,
          });
          if (!plan.ok) {
            return plan.error.code === "INSUFFICIENT_CREDITS"
              ? creditFailure("INSUFFICIENT_CREDITS")
              : creditFailure("CONFLICT");
          }

          const allocations: CreditConsumeAllocation[] = [];
          for (const [index, allocation] of plan.value.allocations.entries()) {
            const entry = await transaction.creditLedgerEntry.create({
              data: {
                id: randomUUID(),
                accountId: allocation.accountId,
                fundingSource: allocation.fundingSource,
                kind: "CONSUME",
                amount: allocation.ledgerAmount,
                consumedGrantEntryId: allocation.sourceGrantEntryId,
                validFrom: allocation.validFrom,
                validTo: allocation.validTo,
                idempotencyKey: creditConsumeAllocationKey(operationPrefix, index),
                reasonCode: input.reasonCode,
                actorUserId:
                  dependencyContract.data.actor.kind === "USER"
                    ? dependencyContract.data.actor.userId
                    : null,
                createdAt: now,
              },
              select: {
                id: true,
                accountId: true,
                amount: true,
                consumedGrantEntryId: true,
                fundingSource: true,
                validFrom: true,
                validTo: true,
              },
            });
            if (entry.consumedGrantEntryId === null) {
              throw new Error("Persisted Credit consume lost its Grant lineage.");
            }
            await writeRequiredAudit(
              createPrismaTransactionAuditPort(transaction),
              {
                action: "CREDITS_CONSUMED",
                actorKind: dependencyContract.data.actor.kind,
                ...(dependencyContract.data.actor.kind === "USER"
                  ? { actorUserId: dependencyContract.data.actor.userId }
                  : {}),
                capability: dependencyContract.data.capability,
                companyId: input.companyId,
                correlationId: dependencyContract.data.correlationId,
                reasonCode: input.reasonCode,
                result: "SUCCEEDED",
                retainUntil: new Date(
                  now.getTime() + BILLING_AUDIT_RETENTION_MS,
                ),
                targetId: entry.id,
                targetType: "CREDIT_LEDGER_ENTRY",
              },
            );
            allocations.push(
              Object.freeze({
                accountId: entry.accountId,
                amount: -entry.amount,
                consumedGrantEntryId: entry.consumedGrantEntryId,
                entryId: entry.id,
                fundingSource: entry.fundingSource,
                validFrom: entry.validFrom,
                validTo: entry.validTo,
              }),
            );
          }
          return creditSuccess(
            {
              allocations: Object.freeze(allocations),
              companyId: input.companyId,
              consumedAmount: input.amount,
              creditType: input.creditType,
            },
            false,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) {
        return creditFailure("WRITE_FAILED");
      }
    }
  }
  return creditFailure("WRITE_FAILED");
}

type ReplayRow = Readonly<{
  accountId: string;
  actorUserId: string | null;
  amount: number;
  consumedGrantEntryId: string | null;
  fundingSource: CreditFundingSource;
  id: string;
  idempotencyKey: string;
  kind: "GRANT" | "CONSUME" | "EXPIRE" | "REVERSAL";
  reasonCode: string | null;
  validFrom: Date;
  validTo: Date;
  account: Readonly<{ companyId: string; creditType: CreditType }>;
}>;

async function loadReplay(
  transaction: Prisma.TransactionClient,
  companyId: string,
  operationPrefix: string,
): Promise<ReplayRow[]> {
  return transaction.creditLedgerEntry.findMany({
    where: {
      idempotencyKey: { startsWith: operationPrefix },
      account: { companyId },
    },
    orderBy: [{ idempotencyKey: "asc" }, { id: "asc" }],
    select: {
      id: true,
      accountId: true,
      actorUserId: true,
      amount: true,
      consumedGrantEntryId: true,
      fundingSource: true,
      idempotencyKey: true,
      kind: true,
      reasonCode: true,
      validFrom: true,
      validTo: true,
      account: { select: { companyId: true, creditType: true } },
    },
  });
}

function replayResult(input: Readonly<{
  actor: CreditConsumeActor;
  amount: number;
  companyId: string;
  creditType: CreditType;
  operationPrefix: string;
  reasonCode: string;
  rows: readonly ReplayRow[];
}>): CreditConsumeResult {
  const expectedActorUserId = input.actor.kind === "USER" ? input.actor.userId : null;
  let consumedAmount = 0;
  const allocations: CreditConsumeAllocation[] = [];
  for (const [index, row] of input.rows.entries()) {
    if (
      row.idempotencyKey !== creditConsumeAllocationKey(input.operationPrefix, index) ||
      row.kind !== "CONSUME" ||
      row.amount >= 0 ||
      row.consumedGrantEntryId === null ||
      row.account.companyId !== input.companyId ||
      row.account.creditType !== input.creditType ||
      row.reasonCode !== input.reasonCode ||
      row.actorUserId !== expectedActorUserId
    ) {
      return creditFailure("IDEMPOTENCY_MISMATCH");
    }
    consumedAmount += -row.amount;
    if (!Number.isSafeInteger(consumedAmount)) {
      return creditFailure("IDEMPOTENCY_MISMATCH");
    }
    allocations.push(
      Object.freeze({
        accountId: row.accountId,
        amount: -row.amount,
        consumedGrantEntryId: row.consumedGrantEntryId,
        entryId: row.id,
        fundingSource: row.fundingSource,
        validFrom: row.validFrom,
        validTo: row.validTo,
      }),
    );
  }
  if (consumedAmount !== input.amount) {
    return creditFailure("IDEMPOTENCY_MISMATCH");
  }
  return creditSuccess(
    {
      allocations: Object.freeze(allocations),
      companyId: input.companyId,
      consumedAmount,
      creditType: input.creditType,
    },
    true,
  );
}

async function loadLockedAvailableGrants(
  transaction: Prisma.TransactionClient,
  companyId: string,
  creditType: CreditType,
  now: Date,
): Promise<AvailableCreditGrantV1[]> {
  const lockedRows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT grant_entry."id"
    FROM "CreditLedgerEntry" grant_entry
    JOIN "CreditAccount" account ON account."id" = grant_entry."accountId"
    WHERE account."companyId" = ${companyId}::uuid
      AND account."creditType" = ${creditType}::"CreditType"
      AND account."fundingSource" = grant_entry."fundingSource"
      AND account."periodStart" <= ${now}
      AND account."periodEnd" > ${now}
      AND grant_entry."kind" = 'GRANT'
      AND grant_entry."validFrom" <= ${now}
      AND grant_entry."validTo" > ${now}
    ORDER BY
      CASE grant_entry."fundingSource"
        WHEN 'PLAN_ALLOWANCE' THEN 0
        WHEN 'PURCHASED_PACK' THEN 1
        WHEN 'ADMIN_GRANT' THEN 2
        ELSE 3
      END,
      grant_entry."validTo",
      grant_entry."createdAt",
      grant_entry."id"
    FOR UPDATE OF account, grant_entry
  `;
  if (lockedRows.length === 0) return [];

  const rows = await transaction.creditLedgerEntry.findMany({
    where: {
      id: { in: lockedRows.map((row) => row.id) },
      kind: "GRANT",
      account: { companyId, creditType },
    },
    select: {
      id: true,
      accountId: true,
      amount: true,
      fundingSource: true,
      validFrom: true,
      validTo: true,
      createdAt: true,
      account: {
        select: { companyId: true, creditType: true, fundingSource: true },
      },
      grantConsumptions: {
        where: { kind: { in: ["CONSUME", "EXPIRE"] } },
        select: {
          amount: true,
          reversedByEntry: { select: { amount: true } },
        },
      },
    },
  });

  return rows.map((row) => {
    let remaining = row.amount;
    for (const allocation of row.grantConsumptions) {
      remaining += allocation.amount + (allocation.reversedByEntry?.amount ?? 0);
    }
    return Object.freeze({
      id: row.id,
      accountId: row.accountId,
      fundingSource: row.fundingSource,
      creditType: row.account.creditType,
      remaining,
      validFrom: row.validFrom,
      validTo: row.validTo,
      createdAt: row.createdAt,
    });
  });
}

function creditConsumeOperationPrefix(idempotencyKey: string) {
  const digest = createHash("sha256")
    .update(`${CREDIT_CONSUME_KEY_NAMESPACE}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  return `${CREDIT_CONSUME_KEY_NAMESPACE}:${digest}:`;
}

function creditConsumeAllocationKey(operationPrefix: string, index: number) {
  return `${operationPrefix}${String(index).padStart(4, "0")}`;
}

function isRetryableTransactionError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2002" ||
      error.code === "P2034" ||
      error.code === "40001" ||
      error.code === "40P01")
  );
}

function creditSuccess(
  value: CreditConsumeValue,
  replay: boolean,
): CreditConsumeResult {
  return Object.freeze({
    ok: true,
    value: Object.freeze(value),
    ...(replay ? { replay: true as const } : {}),
  });
}

function creditFailure(code: CreditConsumeErrorCode): CreditConsumeResult {
  return Object.freeze({ ok: false, code });
}
