import "server-only";

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
  BILLING_POLICY_V1,
  selectDefaultRetainedSeatsV1,
  type RetainedSeatMembershipV1,
} from "@/lib/billing/billing-policy-v1";
import { resolveRetainedSeatSelection } from "@/lib/billing/membership-access";
import {
  billingFailure,
  billingIdempotencyKeySchema,
  billingSuccess,
  canManagePlan,
  normalizeBillingNow,
  type BillingCommandResult,
  type BillingDependencies,
} from "@/lib/billing/contracts";
import { Prisma } from "@/lib/generated/prisma/client";

const AUDIT_RETENTION_MILLISECONDS = 10 * 365 * 24 * 60 * 60 * 1_000;
const cancellationInputSchema = z.strictObject({
  idempotencyKey: billingIdempotencyKeySchema,
  retainedMembershipIds: z.array(z.uuid()).max(100).optional(),
});
const projectDueSubscriptionBoundariesSchema = z.strictObject({});

type SubscriptionDependencies = Pick<
  BillingDependencies,
  "actor" | "correlationId" | "database" | "now"
>;

export type ScheduleCancellationInput = z.input<typeof cancellationInputSchema>;

export type ScheduledCancellationResult = Readonly<{
  effectiveAt: Date;
  scheduleId: string;
  subscriptionId: string;
}>;

export type SubscriptionBoundaryProjectionResult = Readonly<{
  appliedCancellationCount: number;
  appliedDowngradeCount: number;
  expiredSubscriptionCount: number;
}>;

/**
 * Capability-protected Admin command boundary for the subscription projector.
 * The command deliberately accepts no clock, company, schedule or subscription
 * identifier from the form. Authority, clock and correlation are injected by
 * the authenticated server action.
 */
export async function projectDueSubscriptionBoundaries(
  rawInput: unknown,
  dependencies: AdminDependencies,
) {
  if (!projectDueSubscriptionBoundariesSchema.safeParse(rawInput).success) {
    return adminFailure("INVALID_INPUT");
  }
  if (!requireCapability(dependencies, "ADMIN_BILLING_MUTATE")) {
    return adminFailure("FORBIDDEN");
  }

  try {
    const value = await projectSubscriptionBoundaries({
      actorUserId: dependencies.actor.userId,
      correlationId: dependencies.correlationId,
      database: dependencies.database,
      now: adminNow(dependencies.now),
    });
    return adminSuccess(value);
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function scheduleSubscriptionCancellation(
  rawInput: ScheduleCancellationInput,
  dependencies: SubscriptionDependencies,
): Promise<BillingCommandResult<ScheduledCancellationResult>> {
  const parsed = cancellationInputSchema.safeParse(rawInput);
  if (!parsed.success) return billingFailure("INVALID_INPUT");
  if (!canManagePlan(dependencies.actor.membershipRole)) {
    return billingFailure("FORBIDDEN");
  }

  let now: Date;
  try {
    now = normalizeBillingNow(dependencies.now);
  } catch {
    return billingFailure("INVALID_INPUT");
  }

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await lockCompanyBillingScope(transaction, dependencies.actor.companyId);

        const membership = await transaction.companyMembership.findFirst({
          where: {
            id: dependencies.actor.membershipId,
            companyId: dependencies.actor.companyId,
            userId: dependencies.actor.userId,
            role: "OWNER",
            status: "ACTIVE",
            company: { status: "ACTIVE" },
          },
          select: { id: true },
        });
        if (membership === null) return billingFailure("FORBIDDEN");

        const replay = await transaction.subscriptionChangeSchedule.findUnique({
          where: { idempotencyKey: parsed.data.idempotencyKey },
          select: {
            id: true,
            companyId: true,
            currentSubscriptionId: true,
            effectiveAt: true,
            kind: true,
            retainedMembershipIds: true,
          },
        });
        if (replay !== null) {
          if (
            replay.companyId !== dependencies.actor.companyId ||
            replay.kind !== "CANCEL" ||
            (parsed.data.retainedMembershipIds !== undefined &&
              !sameMembershipSelection(
                replay.retainedMembershipIds,
                parsed.data.retainedMembershipIds,
              ))
          ) {
            return billingFailure("IDEMPOTENCY_MISMATCH");
          }
          return billingSuccess(
            {
              effectiveAt: replay.effectiveAt,
              scheduleId: replay.id,
              subscriptionId: replay.currentSubscriptionId,
            },
            true,
          );
        }

        const subscription = await transaction.employerSubscription.findFirst({
          where: {
            companyId: dependencies.actor.companyId,
            status: { in: ["ACTIVE", "CANCELLING"] },
            currentPeriodStart: { lte: now },
            currentPeriodEnd: { gt: now },
          },
          orderBy: [{ currentPeriodStart: "desc" }, { id: "asc" }],
          select: {
            id: true,
            status: true,
            currentPeriodEnd: true,
            currentChangeSchedules: {
              where: { status: "PENDING" },
              select: { id: true },
              take: 1,
            },
          },
        });
        if (subscription === null) return billingFailure("NOT_FOUND");
        if (
          subscription.status === "CANCELLING" ||
          subscription.currentChangeSchedules.length > 0
        ) {
          return billingFailure("CHANGE_ALREADY_SCHEDULED");
        }

        const [memberships, freeSeatLimit] = await Promise.all([
          transaction.companyMembership.findMany({
            where: { companyId: dependencies.actor.companyId },
            select: {
              id: true,
              userId: true,
              role: true,
              status: true,
              joinedAt: true,
            },
          }),
          loadDefaultFreeSeatLimit(transaction, now),
        ]);
        if (freeSeatLimit === null) return billingFailure("CATALOG_UNAVAILABLE");

        const selected = selectRetainedMemberships(
          memberships.map((row) => ({
            id: row.id,
            userId: row.userId,
            role: row.role,
            status: row.status,
      joinedAt: row.joinedAt,
          })),
          freeSeatLimit,
          parsed.data.retainedMembershipIds,
        );
        if (selected === null) return billingFailure("INVALID_INPUT");

        const schedule = await transaction.subscriptionChangeSchedule.create({
          data: {
            companyId: dependencies.actor.companyId,
            currentSubscriptionId: subscription.id,
            successorSubscriptionId: null,
            kind: "CANCEL",
            status: "PENDING",
            effectiveAt: subscription.currentPeriodEnd,
            retainedMembershipIds: [...selected.retainedMembershipIds],
            retainedDefaultOwnerId: selected.defaultOwnerUserId,
            invitationRevocationScope: {
              policyVersion: BILLING_POLICY_V1.version,
              status: "PENDING",
            },
            actorUserId: dependencies.actor.userId,
            idempotencyKey: parsed.data.idempotencyKey,
          },
          select: {
            id: true,
            currentSubscriptionId: true,
            effectiveAt: true,
          },
        });
        await transaction.employerSubscription.update({
          where: { id: subscription.id },
          data: { status: "CANCELLING" },
        });
        await transaction.subscriptionEvent.create({
          data: {
            subscriptionId: subscription.id,
            kind: "CANCELLATION_SCHEDULED",
            actorUserId: dependencies.actor.userId,
            reasonCode: "OWNER_CANCELLED_AT_PERIOD_END",
            idempotencyKey: `${parsed.data.idempotencyKey}:event`,
            correlationId: dependencies.correlationId,
          },
        });
        await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
          action: "SUBSCRIPTION_CANCELLING",
          actorKind: "USER",
          actorUserId: dependencies.actor.userId,
          capability: "BILLING_SUBSCRIPTION_CANCEL",
          companyId: dependencies.actor.companyId,
          correlationId: dependencies.correlationId,
          reasonCode: "OWNER_CANCELLED_AT_PERIOD_END",
          result: "SUCCEEDED",
          retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
          targetId: subscription.id,
          targetType: "SUBSCRIPTION",
        });

        return billingSuccess({
          effectiveAt: schedule.effectiveAt,
          scheduleId: schedule.id,
          subscriptionId: schedule.currentSubscriptionId,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return replayCancellation(parsed.data.idempotencyKey, dependencies);
    }
    return billingFailure("WRITE_FAILED");
  }
}

export async function projectSubscriptionBoundaries(input: Readonly<{
  actorUserId?: string;
  correlationId: string;
  database: BillingDependencies["database"];
  now: Date;
}>): Promise<SubscriptionBoundaryProjectionResult> {
  const now = normalizeBillingNow(input.now);
  const dueSchedules = await input.database.subscriptionChangeSchedule.findMany({
    where: { status: "PENDING", effectiveAt: { lte: now } },
    orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  let appliedCancellationCount = 0;
  let appliedDowngradeCount = 0;
  for (const due of dueSchedules) {
    try {
      const applied = await projectOneSchedule({ ...input, now, scheduleId: due.id });
      if (applied === "CANCEL") appliedCancellationCount += 1;
      if (applied === "DOWNGRADE") appliedDowngradeCount += 1;
    } catch {
      // One invalid schedule must remain pending for operational review without
      // starving later Companies in the globally ordered projector batch.
    }
  }

  const candidates = await input.database.employerSubscription.findMany({
    where: { status: "ACTIVE", currentPeriodEnd: { lte: now } },
    orderBy: [{ currentPeriodEnd: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  let expiredSubscriptionCount = 0;
  for (const candidate of candidates) {
    try {
      if (await projectNaturalExpiry({ ...input, now, subscriptionId: candidate.id })) {
        expiredSubscriptionCount += 1;
      }
    } catch {
      // Keep processing independent Companies; the failed row remains due.
    }
  }

  return Object.freeze({
    appliedCancellationCount,
    appliedDowngradeCount,
    expiredSubscriptionCount,
  });
}

type ScheduleProjectionInput = Readonly<{
  actorUserId?: string;
  correlationId: string;
  database: BillingDependencies["database"];
  now: Date;
  scheduleId: string;
}>;

async function projectOneSchedule(
  input: ScheduleProjectionInput,
): Promise<"CANCEL" | "DOWNGRADE" | null> {
  return runProjectionTransactionRetry(() => projectOneScheduleOnce(input));
}

function projectOneScheduleOnce(input: ScheduleProjectionInput) {
  return input.database.$transaction(
    async (transaction) => {
      const locked = await transaction.$queryRaw<
        Array<{ companyId: string }>
      >(Prisma.sql`
        SELECT "companyId"
        FROM "SubscriptionChangeSchedule"
        WHERE "id" = ${input.scheduleId}::uuid
        FOR UPDATE
      `);
      const companyId = locked[0]?.companyId;
      if (companyId === undefined) return null;
      await lockCompanyBillingScope(transaction, companyId);

      const schedule = await transaction.subscriptionChangeSchedule.findUnique({
        where: { id: input.scheduleId },
        include: {
          currentSubscription: {
            select: { id: true, status: true, currentPeriodEnd: true },
          },
          successorSubscription: {
            select: {
              id: true,
              status: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              planVersionId: true,
              sourceOrder: {
                select: {
                  lines: {
                    where: { subscriptionSnapshot: { isNot: null } },
                    select: {
                      subscriptionSnapshot: {
                        select: {
                          seatLimitSnapshot: true,
                          talentContactAllowanceSnapshot: true,
                          jobBoostAllowanceSnapshot: true,
                        },
                      },
                    },
                    take: 2,
                  },
                },
              },
            },
          },
        },
      });
      if (
        schedule === null ||
        schedule.status !== "PENDING" ||
        schedule.effectiveAt.getTime() > input.now.getTime()
      ) {
        return null;
      }

      const successorSnapshot =
        schedule.kind === "DOWNGRADE"
          ? schedule.successorSubscription?.sourceOrder?.lines[0]
              ?.subscriptionSnapshot
          : null;
      if (
        schedule.kind === "DOWNGRADE" &&
        (successorSnapshot === null ||
          successorSnapshot === undefined ||
          (schedule.successorSubscription?.sourceOrder?.lines.length ?? 0) !== 1)
      ) {
        throw new Error("Scheduled subscription snapshot is missing.");
      }
      const seatLimit = schedule.kind === "CANCEL"
        ? await loadDefaultFreeSeatLimit(transaction, schedule.effectiveAt)
        : successorSnapshot?.seatLimitSnapshot ?? null;
      if (seatLimit === null) {
        throw new Error("Scheduled subscription Seat limit is missing.");
      }
      const retainedSelection = resolveRetainedSeatSelection(
        await loadBoundaryMemberships(transaction, schedule.companyId),
        seatLimit,
        schedule.retainedMembershipIds,
        schedule.retainedDefaultOwnerId,
      );
      if (retainedSelection === null) {
        throw new Error("Subscription boundary requires an active Owner.");
      }

      if (schedule.kind === "CANCEL") {
        if (schedule.successorSubscription !== null) return null;
        await transaction.employerSubscription.update({
          where: { id: schedule.currentSubscription.id },
          data: {
            status: "CANCELLED",
            endedAt: schedule.effectiveAt,
          },
        });
        await transaction.subscriptionEvent.upsert({
          where: { idempotencyKey: `boundary:${schedule.id}:cancelled` },
          update: {},
          create: {
            subscriptionId: schedule.currentSubscription.id,
            kind: "CANCELLED",
            actorUserId: input.actorUserId ?? null,
            reasonCode: "PERIOD_END_CANCELLATION",
            idempotencyKey: `boundary:${schedule.id}:cancelled`,
            correlationId: input.correlationId,
            createdAt: schedule.effectiveAt,
          },
        });
      } else {
        const successor = schedule.successorSubscription;
        if (
          successor === null ||
          successor.currentPeriodStart.getTime() !== schedule.effectiveAt.getTime()
        ) {
          return null;
        }
        await transaction.employerSubscription.update({
          where: { id: schedule.currentSubscription.id },
          data: { status: "EXPIRED", endedAt: schedule.effectiveAt },
        });
        await transaction.subscriptionEvent.upsert({
          where: { idempotencyKey: `boundary:${schedule.id}:expired` },
          update: {},
          create: {
            subscriptionId: schedule.currentSubscription.id,
            kind: "EXPIRED",
            actorUserId: input.actorUserId ?? null,
            reasonCode: "DOWNGRADE_BOUNDARY",
            idempotencyKey: `boundary:${schedule.id}:expired`,
            correlationId: input.correlationId,
            createdAt: schedule.effectiveAt,
          },
        });
        await transaction.employerSubscription.update({
          where: { id: successor.id },
          data: { status: "ACTIVE", activatedAt: schedule.effectiveAt },
        });
        await transaction.subscriptionEvent.upsert({
          where: { idempotencyKey: `boundary:${schedule.id}:activated` },
          update: {},
          create: {
            subscriptionId: successor.id,
            kind: "ACTIVATED",
            actorUserId: input.actorUserId ?? null,
            reasonCode: "DOWNGRADE_BOUNDARY",
            idempotencyKey: `boundary:${schedule.id}:activated`,
            correlationId: input.correlationId,
            createdAt: schedule.effectiveAt,
          },
        });
        const allowanceSnapshot = successorSnapshot;
        if (allowanceSnapshot === null || allowanceSnapshot === undefined) {
          throw new Error("Scheduled subscription allowance snapshot is missing.");
        }
        await grantBoundaryPlanAllowances(transaction, {
          actorUserId: input.actorUserId,
          companyId: schedule.companyId,
          correlationId: input.correlationId,
          jobBoostAmount: allowanceSnapshot.jobBoostAllowanceSnapshot,
          planVersionId: successor.planVersionId,
          subscriptionId: successor.id,
          talentContactAmount:
            allowanceSnapshot.talentContactAllowanceSnapshot,
          validFrom: successor.currentPeriodStart,
          validTo: successor.currentPeriodEnd,
        });
      }

      await projectSeatAndInvitationLimit(transaction, {
        actorUserId: input.actorUserId,
        companyId: schedule.companyId,
        correlationId: input.correlationId,
        effectiveAt: schedule.effectiveAt,
        retainedMembershipIds: retainedSelection.retainedMembershipIds,
      });
      await transaction.subscriptionChangeSchedule.update({
        where: { id: schedule.id },
        data: { status: "APPLIED", appliedAt: schedule.effectiveAt },
      });
      if (schedule.kind === "DOWNGRADE") {
        const successor = schedule.successorSubscription;
        if (successor === null) {
          throw new Error("Downgrade successor is missing.");
        }
        await writeSubscriptionBoundaryAuditOnce(transaction, {
          action: "SUBSCRIPTION_EXPIRED",
          actorUserId: input.actorUserId,
          companyId: schedule.companyId,
          correlationId: input.correlationId,
          now: input.now,
          reasonCode: "DOWNGRADE_BOUNDARY",
          targetId: schedule.currentSubscription.id,
        });
        await writeSubscriptionBoundaryAuditOnce(transaction, {
          action: "SUBSCRIPTION_ACTIVATED",
          actorUserId: input.actorUserId,
          companyId: schedule.companyId,
          correlationId: input.correlationId,
          now: input.now,
          reasonCode: "DOWNGRADE_BOUNDARY",
          targetId: successor.id,
        });
      } else {
        await writeSubscriptionBoundaryAuditOnce(transaction, {
          action: "SUBSCRIPTION_CHANGED",
          actorUserId: input.actorUserId,
          companyId: schedule.companyId,
          correlationId: input.correlationId,
          now: input.now,
          reasonCode: "PERIOD_END_CANCELLATION",
          targetId: schedule.currentSubscription.id,
        });
      }
      return schedule.kind;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function grantBoundaryPlanAllowances(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    actorUserId?: string;
    companyId: string;
    correlationId: string;
    jobBoostAmount: number;
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
      throw new TypeError("Scheduled allowance snapshot is invalid.");
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
        companyId: input.companyId,
        creditType,
        fundingSource: "PLAN_ALLOWANCE",
        periodStart: input.validFrom,
        periodEnd: input.validTo,
      },
      update: {},
    });
    const entry = await transaction.creditLedgerEntry.upsert({
      where: {
        accountId_idempotencyKey: {
          accountId: account.id,
          idempotencyKey: `plan-allowance:${input.subscriptionId}:${creditType}`,
        },
      },
      update: {},
      create: {
        accountId: account.id,
        fundingSource: "PLAN_ALLOWANCE",
        kind: "GRANT",
        amount,
        sourcePlanVersionId: input.planVersionId,
        sourceSubscriptionId: input.subscriptionId,
        validFrom: input.validFrom,
        validTo: input.validTo,
        idempotencyKey: `plan-allowance:${input.subscriptionId}:${creditType}`,
        reasonCode: "SUBSCRIPTION_ALLOWANCE",
        actorUserId: input.actorUserId ?? null,
      },
    });
    const priorAudit = await transaction.auditLog.findFirst({
      where: {
        action: "CREDITS_GRANTED",
        targetType: "CREDIT_LEDGER_ENTRY",
        targetId: entry.id,
        result: "SUCCEEDED",
      },
      select: { id: true },
    });
    if (priorAudit === null) {
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "CREDITS_GRANTED",
        actorKind: input.actorUserId === undefined ? "SYSTEM" : "USER",
        ...(input.actorUserId === undefined
          ? {}
          : { actorUserId: input.actorUserId }),
        capability: "BILLING_BOUNDARY_PROJECT",
        companyId: input.companyId,
        correlationId: input.correlationId,
        reasonCode: "SUBSCRIPTION_ALLOWANCE",
        result: "SUCCEEDED",
        retainUntil: new Date(input.validTo.getTime() + AUDIT_RETENTION_MILLISECONDS),
        targetId: entry.id,
        targetType: "CREDIT_LEDGER_ENTRY",
      });
    }
  }
}

type NaturalExpiryProjectionInput = Readonly<{
  actorUserId?: string;
  correlationId: string;
  database: BillingDependencies["database"];
  now: Date;
  subscriptionId: string;
}>;

async function projectNaturalExpiry(
  input: NaturalExpiryProjectionInput,
): Promise<boolean> {
  return runProjectionTransactionRetry(() => projectNaturalExpiryOnce(input));
}

function projectNaturalExpiryOnce(input: NaturalExpiryProjectionInput) {
  return input.database.$transaction(
    async (transaction) => {
      const locked = await transaction.$queryRaw<
        Array<{ id: string; companyId: string }>
      >(Prisma.sql`
        SELECT "id", "companyId"
        FROM "EmployerSubscription"
        WHERE "id" = ${input.subscriptionId}::uuid
        FOR UPDATE
      `);
      const row = locked[0];
      if (row === undefined) return false;
      const subscription = await transaction.employerSubscription.findUnique({
        where: { id: row.id },
        select: {
          id: true,
          companyId: true,
          status: true,
          currentPeriodEnd: true,
          currentChangeSchedules: {
            where: { status: "PENDING" },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (
        subscription === null ||
        subscription.status !== "ACTIVE" ||
        subscription.currentPeriodEnd.getTime() > input.now.getTime() ||
        subscription.currentChangeSchedules.length > 0
      ) {
        return false;
      }
      await lockCompanyBillingScope(transaction, subscription.companyId);
      const freeSeatLimit = await loadDefaultFreeSeatLimit(
        transaction,
        subscription.currentPeriodEnd,
      );
      if (freeSeatLimit === null) {
        throw new Error("Default Free Seat limit is unavailable.");
      }
      const retainedSelection = resolveRetainedSeatSelection(
        await loadBoundaryMemberships(transaction, subscription.companyId),
        freeSeatLimit,
      );
      if (retainedSelection === null) {
        throw new Error("Natural expiry requires an active Company Owner.");
      }
      await transaction.employerSubscription.update({
        where: { id: subscription.id },
        data: {
          status: "EXPIRED",
          endedAt: subscription.currentPeriodEnd,
        },
      });
      await transaction.subscriptionEvent.upsert({
        where: { idempotencyKey: `natural-expiry:${subscription.id}` },
        update: {},
        create: {
          subscriptionId: subscription.id,
          kind: "EXPIRED",
          actorUserId: input.actorUserId ?? null,
          reasonCode: "TERM_ENDED_WITHOUT_RENEWAL",
          idempotencyKey: `natural-expiry:${subscription.id}`,
          correlationId: input.correlationId,
          createdAt: subscription.currentPeriodEnd,
        },
      });
      await projectSeatAndInvitationLimit(transaction, {
        actorUserId: input.actorUserId,
        companyId: subscription.companyId,
        correlationId: input.correlationId,
        effectiveAt: subscription.currentPeriodEnd,
        retainedMembershipIds: retainedSelection.retainedMembershipIds,
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "SUBSCRIPTION_EXPIRED",
        actorKind: input.actorUserId === undefined ? "SYSTEM" : "USER",
        ...(input.actorUserId === undefined
          ? {}
          : { actorUserId: input.actorUserId }),
        capability: "BILLING_BOUNDARY_PROJECT",
        companyId: subscription.companyId,
        correlationId: input.correlationId,
        reasonCode: "TERM_ENDED_WITHOUT_RENEWAL",
        result: "SUCCEEDED",
        retainUntil: new Date(
          input.now.getTime() + AUDIT_RETENTION_MILLISECONDS,
        ),
        targetId: subscription.id,
        targetType: "SUBSCRIPTION",
      });
      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function loadBoundaryMemberships(
  transaction: Prisma.TransactionClient,
  companyId: string,
): Promise<readonly RetainedSeatMembershipV1[]> {
  const rows = await transaction.companyMembership.findMany({
    where: { companyId, status: "ACTIVE", removedAt: null },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      joinedAt: true,
    },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    role: row.role,
    status: row.status,
    joinedAt: row.joinedAt,
  }));
}

async function writeSubscriptionBoundaryAuditOnce(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    action:
      | "SUBSCRIPTION_ACTIVATED"
      | "SUBSCRIPTION_CHANGED"
      | "SUBSCRIPTION_EXPIRED";
    actorUserId?: string;
    companyId: string;
    correlationId: string;
    now: Date;
    reasonCode: string;
    targetId: string;
  }>,
) {
  const existing = await transaction.auditLog.findFirst({
    where: {
      action: input.action,
      capability: "BILLING_BOUNDARY_PROJECT",
      targetType: "SUBSCRIPTION",
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      result: "SUCCEEDED",
    },
    select: { id: true },
  });
  if (existing !== null) return;
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: input.action,
    actorKind: input.actorUserId === undefined ? "SYSTEM" : "USER",
    ...(input.actorUserId === undefined
      ? {}
      : { actorUserId: input.actorUserId }),
    capability: "BILLING_BOUNDARY_PROJECT",
    companyId: input.companyId,
    correlationId: input.correlationId,
    reasonCode: input.reasonCode,
    result: "SUCCEEDED",
    retainUntil: new Date(input.now.getTime() + AUDIT_RETENTION_MILLISECONDS),
    targetId: input.targetId,
    targetType: "SUBSCRIPTION",
  });
}

async function projectSeatAndInvitationLimit(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    actorUserId?: string;
    companyId: string;
    correlationId: string;
    effectiveAt: Date;
    retainedMembershipIds: readonly string[];
  }>,
) {
  const nonRetained = await transaction.companyMembership.findMany({
    where: {
      companyId: input.companyId,
      status: "ACTIVE",
      id: { notIn: [...input.retainedMembershipIds] },
    },
    select: { id: true, role: true },
    orderBy: { id: "asc" },
  });
  for (const membership of nonRetained) {
    await transaction.companyMembership.update({
      where: { id: membership.id },
      data: { status: "SUSPENDED" },
    });
    const eventExists = await transaction.companyMembershipEvent.findFirst({
      where: {
        membershipId: membership.id,
        kind: "PLAN_LIMIT_SUSPENDED",
        correlationId: input.correlationId,
      },
      select: { id: true },
    });
    if (eventExists === null) {
      await transaction.companyMembershipEvent.create({
        data: {
          membershipId: membership.id,
          kind: "PLAN_LIMIT_SUSPENDED",
          fromRole: membership.role,
          toRole: membership.role,
          actorUserId: input.actorUserId ?? null,
          reasonCode: "SUBSCRIPTION_BOUNDARY_SEAT_LIMIT",
          correlationId: input.correlationId,
          createdAt: input.effectiveAt,
        },
      });
    }
  }

  const invitations = await transaction.companyInvitation.findMany({
    where: { companyId: input.companyId, status: "PENDING" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const invitation of invitations) {
    await transaction.companyInvitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED", revokedAt: input.effectiveAt },
    });
    await transaction.companyInvitationEvent.create({
      data: {
        invitationId: invitation.id,
        kind: "REVOKED",
        actorUserId: input.actorUserId ?? null,
        reasonCode: "SUBSCRIPTION_BOUNDARY_SEAT_LIMIT",
        correlationId: input.correlationId,
        createdAt: input.effectiveAt,
      },
    });
  }
}

function selectRetainedMemberships(
  memberships: readonly RetainedSeatMembershipV1[],
  seatLimit: number,
  requestedIds: readonly string[] | undefined,
) {
  const fallback = selectDefaultRetainedSeatsV1({ memberships, seatLimit });
  if (!fallback.ok) return null;
  if (requestedIds === undefined) return fallback.value;
  if (
    requestedIds.length < 1 ||
    requestedIds.length > seatLimit ||
    new Set(requestedIds).size !== requestedIds.length
  ) {
    return null;
  }
  const byId = new Map(memberships.map((membership) => [membership.id, membership]));
  const retained = requestedIds.map((id) => byId.get(id));
  if (
    retained.some((membership) => membership?.status !== "ACTIVE") ||
    !retained.some((membership) => membership?.role === "OWNER")
  ) {
    return null;
  }
  const owner = retained
    .filter((membership): membership is RetainedSeatMembershipV1 =>
      membership !== undefined && membership.role === "OWNER",
    )
    .sort(
      (left, right) =>
        left.joinedAt.getTime() - right.joinedAt.getTime() ||
        left.id.localeCompare(right.id),
    )[0];
  if (owner === undefined) return null;
  const retainedSet = new Set(requestedIds);
  return Object.freeze({
    defaultOwnerMembershipId: owner.id,
    defaultOwnerUserId: owner.userId,
    retainedMembershipIds: Object.freeze([...requestedIds]),
    nonRetainedActiveMembershipIds: Object.freeze(
      memberships
        .filter(
          (membership) =>
            membership.status === "ACTIVE" && !retainedSet.has(membership.id),
        )
        .map((membership) => membership.id),
    ),
  });
}

function sameMembershipSelection(
  left: readonly string[],
  right: readonly string[],
) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return expected.size === right.length && right.every((id) => expected.has(id));
}

async function loadDefaultFreeSeatLimit(
  transaction: Prisma.TransactionClient,
  at: Date,
): Promise<number | null> {
  const rows = await transaction.planVersion.findMany({
    where: {
      plan: { isDefaultFree: true },
      status: "ACTIVE",
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    select: {
      entitlements: {
        where: { key: "SEAT_LIMIT", valueType: "INTEGER" },
        select: { integerValue: true },
      },
    },
    take: 2,
  });
  if (rows.length !== 1) return null;
  const value = rows[0]?.entitlements[0]?.integerValue;
  return Number.isSafeInteger(value) && (value ?? 0) >= 1 ? (value as number) : null;
}

async function replayCancellation(
  idempotencyKey: string,
  dependencies: SubscriptionDependencies,
): Promise<BillingCommandResult<ScheduledCancellationResult>> {
  const replay = await dependencies.database.subscriptionChangeSchedule.findUnique({
    where: { idempotencyKey },
    select: {
      id: true,
      companyId: true,
      currentSubscriptionId: true,
      effectiveAt: true,
      kind: true,
    },
  });
  if (
    replay === null ||
    replay.companyId !== dependencies.actor.companyId ||
    replay.kind !== "CANCEL"
  ) {
    return billingFailure("IDEMPOTENCY_MISMATCH");
  }
  return billingSuccess(
    {
      effectiveAt: replay.effectiveAt,
      scheduleId: replay.id,
      subscriptionId: replay.currentSubscriptionId,
    },
    true,
  );
}

async function lockCompanyBillingScope(
  transaction: Prisma.TransactionClient,
  companyId: string,
) {
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "Company"
    WHERE "id" = ${companyId}::uuid
    FOR UPDATE
  `);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function runProjectionTransactionRetry<TResult>(
  operation: () => Promise<TResult>,
): Promise<TResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableProjectionError(error) || attempt === 2) throw error;
    }
  }
  throw new Error("Subscription projection retry budget exhausted.");
}

function isRetryableProjectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const prismaCode = "code" in error ? error.code : undefined;
  const metadata = "meta" in error ? error.meta : undefined;
  const databaseCode =
    typeof metadata === "object" && metadata !== null && "code" in metadata
      ? metadata.code
      : undefined;
  const driverAdapterError =
    typeof metadata === "object" &&
    metadata !== null &&
    "driverAdapterError" in metadata
      ? metadata.driverAdapterError
      : undefined;
  const driverCause =
    typeof driverAdapterError === "object" &&
    driverAdapterError !== null &&
    "cause" in driverAdapterError
      ? driverAdapterError.cause
      : undefined;
  const originalCode =
    typeof driverCause === "object" &&
    driverCause !== null &&
    "originalCode" in driverCause
      ? driverCause.originalCode
      : undefined;
  return (
    prismaCode === "P2034" ||
    prismaCode === "40001" ||
    prismaCode === "40P01" ||
    databaseCode === "40001" ||
    databaseCode === "40P01" ||
    originalCode === "40001" ||
    originalCode === "40P01"
  );
}
