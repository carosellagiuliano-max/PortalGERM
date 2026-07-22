import "server-only";

import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { writeRequiredAudit } from "@/lib/audit/log";
import {
  COMMERCIAL_LIFECYCLE_POLICY_V1,
  normalizeCommercialSignalInstant,
  reachesUsageThreshold,
  zurichCalendarDayDistance,
  zurichDateKeyV1,
} from "@/lib/analytics/commercial-signals-policy";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type { EmailProvider } from "@/lib/providers/email";
import { renderEmailTemplate } from "@/lib/providers/email/templates";

export type CommercialSignalReason =
  | "SUBSCRIPTION_END_30D"
  | "SUBSCRIPTION_END_14D"
  | "SUBSCRIPTION_END_7D"
  | "SUBSCRIPTION_CANCELLING"
  | "CREDIT_EXPIRY_14D"
  | "CREDIT_EXPIRY_7D"
  | "PAID_COMPANY_INACTIVE_30D"
  | "ACTIVE_JOB_LIMIT_80"
  | "SEAT_LIMIT_80";

type CommercialSignalCandidate = Readonly<{
  boundaryKey: string;
  companyId: string;
  companyName: string;
  dueAt: Date;
  evidenceReference: string;
  evidenceWindowEnd: Date;
  evidenceWindowStart: Date;
  kind: "RENEWAL_REVIEW" | "RETENTION_RISK" | "CREDIT_EXPIRY" | "USAGE_DIAGNOSTIC";
  reasonCode: CommercialSignalReason;
  thresholdCode: string;
}>;

export type CommercialSignalRunResult = Readonly<{
  candidates: number;
  created: number;
  emailsRecorded: number;
  existing: number;
}>;

export type CommercialSignalDependencies = Readonly<{
  correlationId: string;
  database: DatabaseClient;
  emailProvider: EmailProvider;
  includeDemo?: boolean;
  now: Date;
}>;

export async function runCommercialLifecycleSignals(
  dependencies: CommercialSignalDependencies,
): Promise<CommercialSignalRunResult> {
  const now = normalizeCommercialSignalInstant(dependencies.now);
  const includeDemo =
    dependencies.includeDemo ?? process.env.NODE_ENV !== "production";
  const [operator, subscriptions, expiringCredits, activeCompanies] = await Promise.all([
    dependencies.database.user.findFirst({
      where: { role: "ADMIN", status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, emailNormalized: true },
    }),
    dependencies.database.employerSubscription.findMany({
      where: {
        status: { in: ["ACTIVE", "CANCELLING"] },
        currentPeriodStart: { lte: now },
        currentPeriodEnd: { gt: now },
        planVersion: { plan: { isDefaultFree: false } },
        company: {
          status: "ACTIVE",
          ...(includeDemo ? {} : { dataProvenance: "LIVE" }),
        },
      },
      orderBy: [{ companyId: "asc" }, { currentPeriodEnd: "asc" }],
      select: {
        id: true,
        companyId: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        company: { select: { name: true } },
      },
    }),
    loadExpiringCreditGrants(dependencies.database, now, includeDemo),
    dependencies.database.company.findMany({
      where: {
        status: "ACTIVE",
        ...(includeDemo ? {} : { dataProvenance: "LIVE" }),
      },
      orderBy: { id: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  if (operator === null) {
    throw new Error("Commercial lifecycle signals require an active operator.");
  }

  const candidates: CommercialSignalCandidate[] = [];
  for (const subscription of subscriptions) {
    const days = zurichCalendarDayDistance(now, subscription.currentPeriodEnd);
    if (days === 30 || days === 14 || days === 7) {
      candidates.push({
        boundaryKey: zurichDateKeyV1(subscription.currentPeriodEnd),
        companyId: subscription.companyId,
        companyName: subscription.company.name,
        dueAt: subscription.currentPeriodEnd,
        evidenceReference: `subscription:${subscription.id}`,
        evidenceWindowStart: subscription.currentPeriodStart,
        evidenceWindowEnd: subscription.currentPeriodEnd,
        kind: "RENEWAL_REVIEW",
        reasonCode: `SUBSCRIPTION_END_${days}D`,
        thresholdCode: `${days}D`,
      });
    }
    if (subscription.status === "CANCELLING") {
      candidates.push({
        boundaryKey: zurichDateKeyV1(subscription.currentPeriodEnd),
        companyId: subscription.companyId,
        companyName: subscription.company.name,
        dueAt: subscription.currentPeriodEnd,
        evidenceReference: `subscription:${subscription.id}`,
        evidenceWindowStart: now,
        evidenceWindowEnd: subscription.currentPeriodEnd,
        kind: "RETENTION_RISK",
        reasonCode: "SUBSCRIPTION_CANCELLING",
        thresholdCode: "CANCELLING",
      });
    }
  }

  const creditExpiryGroups = new Map<
    string,
    {
      boundaryKey: string;
      companyId: string;
      companyName: string;
      creditTypes: Set<string>;
      dueAt: Date;
      evidenceWindowEnd: Date;
      grantCount: number;
      reasonCode: "CREDIT_EXPIRY_14D" | "CREDIT_EXPIRY_7D";
      thresholdCode: "14D" | "7D";
    }
  >();
  for (const credit of expiringCredits) {
    const days = zurichCalendarDayDistance(now, credit.validTo);
    if (days !== 14 && days !== 7) continue;
    const boundaryKey = zurichDateKeyV1(credit.validTo);
    const reasonCode = `CREDIT_EXPIRY_${days}D` as const;
    const groupKey = `${credit.companyId}\0${reasonCode}\0${boundaryKey}`;
    const existing = creditExpiryGroups.get(groupKey);
    if (existing !== undefined) {
      existing.creditTypes.add(credit.creditType);
      existing.grantCount += 1;
      if (credit.validTo.getTime() < existing.dueAt.getTime()) {
        existing.dueAt = credit.validTo;
      }
      if (credit.validTo.getTime() > existing.evidenceWindowEnd.getTime()) {
        existing.evidenceWindowEnd = credit.validTo;
      }
      continue;
    }
    creditExpiryGroups.set(groupKey, {
      boundaryKey,
      companyId: credit.companyId,
      companyName: credit.companyName,
      creditTypes: new Set([credit.creditType]),
      dueAt: credit.validTo,
      evidenceWindowEnd: credit.validTo,
      grantCount: 1,
      reasonCode,
      thresholdCode: `${days}D` as "14D" | "7D",
    });
  }
  for (const credit of creditExpiryGroups.values()) {
    candidates.push({
      boundaryKey: credit.boundaryKey,
      companyId: credit.companyId,
      companyName: credit.companyName,
      dueAt: credit.dueAt,
      evidenceReference: `credit-expiry:${credit.boundaryKey}:${[...credit.creditTypes].sort().join("+")}:${credit.grantCount}-grants`,
      evidenceWindowStart: now,
      evidenceWindowEnd: credit.evidenceWindowEnd,
      kind: "CREDIT_EXPIRY",
      reasonCode: credit.reasonCode,
      thresholdCode: credit.thresholdCode,
    });
  }

  for (const subscription of subscriptions) {
    const activity = await loadCompanyCommercialActivity(
      dependencies.database,
      subscription.companyId,
      subscription.currentPeriodStart,
    );
    if (
      zurichCalendarDayDistance(activity, now) >=
      COMMERCIAL_LIFECYCLE_POLICY_V1.inactivityDays
    ) {
      candidates.push({
        boundaryKey: zurichDateKeyV1(activity),
        companyId: subscription.companyId,
        companyName: subscription.company.name,
        dueAt: now,
        evidenceReference: `company:${subscription.companyId}`,
        evidenceWindowStart: activity,
        evidenceWindowEnd: now,
        kind: "RETENTION_RISK",
        reasonCode: "PAID_COMPANY_INACTIVE_30D",
        thresholdCode: "30D",
      });
    }
  }

  const subscriptionsByCompany = new Map(
    subscriptions.map((subscription) => [subscription.companyId, subscription]),
  );
  for (const company of activeCompanies) {
    const entitlements = await getPrismaEffectiveEntitlements(
      company.id,
      now,
      dependencies.database,
    );
    if (!entitlements.ok) continue;
    const [activeJobs, activeMembers, pendingInvitations] = await Promise.all([
      dependencies.database.job.count({
        where: {
          companyId: company.id,
          status: "PUBLISHED",
          publishedAt: { lte: now },
          expiresAt: { gt: now },
        },
      }),
      dependencies.database.companyMembership.count({
        where: { companyId: company.id, status: "ACTIVE" },
      }),
      dependencies.database.companyInvitation.count({
        where: {
          companyId: company.id,
          status: "PENDING",
          expiresAt: { gt: now },
        },
      }),
    ]);
    const subscription = subscriptionsByCompany.get(company.id);
    const usageWindow = subscription === undefined
      ? {
          boundaryKey: `plan-version:${entitlements.value.source.planVersionId}`,
          end: now,
          reference: `plan-version:${entitlements.value.source.planVersionId}`,
          start: new Date(now.getTime() - 30 * 86_400_000),
        }
      : {
          boundaryKey: zurichDateKeyV1(subscription.currentPeriodEnd),
          end: subscription.currentPeriodEnd,
          reference: `subscription:${subscription.id}`,
          start: subscription.currentPeriodStart,
        };
    if (
      reachesUsageThreshold(
        activeJobs,
        entitlements.value.rights.ACTIVE_JOB_LIMIT,
      )
    ) {
      candidates.push(buildUsageCandidate({
        companyId: company.id,
        companyName: company.name,
        evidenceReference: `${usageWindow.reference}:jobs:${activeJobs}/${entitlements.value.rights.ACTIVE_JOB_LIMIT}`,
        evidenceWindowStart: usageWindow.start,
        evidenceWindowEnd: usageWindow.end,
        now,
        periodKey: usageWindow.boundaryKey,
        reasonCode: "ACTIVE_JOB_LIMIT_80",
      }));
    }
    const seatUsage = activeMembers + pendingInvitations;
    if (
      reachesUsageThreshold(seatUsage, entitlements.value.rights.SEAT_LIMIT)
    ) {
      candidates.push(buildUsageCandidate({
        companyId: company.id,
        companyName: company.name,
        evidenceReference: `${usageWindow.reference}:seats:${seatUsage}/${entitlements.value.rights.SEAT_LIMIT}`,
        evidenceWindowStart: usageWindow.start,
        evidenceWindowEnd: usageWindow.end,
        now,
        periodKey: usageWindow.boundaryKey,
        reasonCode: "SEAT_LIMIT_80",
      }));
    }
  }

  let created = 0;
  let existing = 0;
  let emailsRecorded = 0;
  for (const candidate of dedupeCandidates(candidates)) {
    const idempotencyKey = commercialTaskKey(candidate);
    const task = await createSignalTask(
      dependencies,
      candidate,
      operator.id,
      idempotencyKey,
      now,
    );
    if (!task.created) {
      existing += 1;
    } else {
      created += 1;
    }
    if (!task.shouldNotify) continue;
    const data = {
      companyName: candidate.companyName,
      signalLabel: signalLabel(candidate.reasonCode),
      dueDate: formatZurichDate(candidate.dueAt),
      idempotencyKey,
    };
    const rendered = renderEmailTemplate("commercial_lifecycle_signal", data);
    try {
      const delivery = await dependencies.emailProvider.send({
        to: operator.emailNormalized,
        templateKey: "commercial_lifecycle_signal",
        subject: rendered.subject,
        data,
      });
      if (delivery.created ?? task.created) {
        emailsRecorded += 1;
      }
    } catch {
      // The committed task/notification remains authoritative and retryable.
    }
  }

  return Object.freeze({
    candidates: dedupeCandidates(candidates).length,
    created,
    emailsRecorded,
    existing,
  });
}

async function createSignalTask(
  dependencies: CommercialSignalDependencies,
  candidate: CommercialSignalCandidate,
  operatorUserId: string,
  idempotencyKey: string,
  now: Date,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await dependencies.database.$transaction(
        async (transaction) => {
          const existing = await transaction.systemTask.findUnique({
            where: { idempotencyKey },
            select: { id: true, status: true },
          });
          if (existing !== null) {
            return Object.freeze({
              created: false,
              shouldNotify: isActiveTaskStatus(existing.status),
            });
          }
          const task = await transaction.systemTask.create({
            data: {
              companyId: candidate.companyId,
              kind: candidate.kind,
              reasonCode: candidate.reasonCode,
              policyVersion: COMMERCIAL_LIFECYCLE_POLICY_V1.version,
              thresholdCode: candidate.thresholdCode,
              evidenceWindowStart: candidate.evidenceWindowStart,
              evidenceWindowEnd: candidate.evidenceWindowEnd,
              evidenceReference: candidate.evidenceReference,
              ownerUserId: operatorUserId,
              dueAt: candidate.dueAt,
              status: "ASSIGNED",
              idempotencyKey,
            },
            select: { id: true },
          });
          await transaction.notification.upsert({
            where: {
              recipientUserId_kind_dedupeKey: {
                recipientUserId: operatorUserId,
                kind: "SYSTEM_TASK_ASSIGNED",
                dedupeKey: idempotencyKey,
              },
            },
            update: {},
            create: {
              recipientUserId: operatorUserId,
              kind: "SYSTEM_TASK_ASSIGNED",
              schemaVersion: "1",
              payload: { taskId: task.id, status: "ASSIGNED" },
              dedupeKey: idempotencyKey,
            },
          });
          await writeRequiredAudit(
            createPrismaTransactionAuditPort(transaction),
            {
              action: "SYSTEM_TASK_ASSIGNED",
              actorKind: "SYSTEM",
              capability: "COMMERCIAL_SIGNAL_PROJECT",
              companyId: candidate.companyId,
              correlationId: dependencies.correlationId,
              reasonCode: candidate.reasonCode,
              result: "SUCCEEDED",
              retainUntil: new Date(now.getTime() + 3 * 365 * 86_400_000),
              targetId: task.id,
              targetType: "SYSTEM_TASK",
            },
          );
          return Object.freeze({ created: true, shouldNotify: true });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await dependencies.database.systemTask.findUnique({
          where: { idempotencyKey },
          select: { status: true },
        });
        return Object.freeze({
          created: false,
          shouldNotify:
            existing !== null && isActiveTaskStatus(existing.status),
        });
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 3
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Commercial signal transaction retry budget exhausted.");
}

function isActiveTaskStatus(status: string) {
  return status === "OPEN" || status === "ASSIGNED" || status === "IN_PROGRESS";
}

async function loadCompanyCommercialActivity(
  database: DatabaseClient,
  companyId: string,
  fallback: Date,
) {
  const [members, job, application] = await Promise.all([
    database.companyMembership.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { user: { select: { lastLoginAt: true } } },
    }),
    database.job.findFirst({
      where: { companyId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { updatedAt: true },
    }),
    database.application.findFirst({
      where: { job: { companyId } },
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      select: { submittedAt: true },
    }),
  ]);
  const instants = [
    fallback,
    job?.updatedAt,
    application?.submittedAt,
    ...members.map((row) => row.user.lastLoginAt),
  ].filter((value): value is Date => value instanceof Date);
  return new Date(Math.max(...instants.map((value) => value.getTime())));
}

async function loadExpiringCreditGrants(
  database: DatabaseClient,
  now: Date,
  includeDemo: boolean,
) {
  const rows = await database.$queryRaw<
    Array<{
      companyId: string;
      companyName: string;
      creditType: string;
      id: string;
      remaining: bigint;
      validTo: Date;
    }>
  >(Prisma.sql`
    SELECT
      grant_entry."id",
      account."companyId",
      company."name" AS "companyName",
      account."creditType"::text AS "creditType",
      grant_entry."validTo",
      (grant_entry."amount" + COALESCE(sum(consume."amount"), 0) +
        COALESCE(sum(reversal."amount"), 0))::bigint AS "remaining"
    FROM "CreditLedgerEntry" grant_entry
    JOIN "CreditAccount" account ON account."id" = grant_entry."accountId"
    JOIN "Company" company ON company."id" = account."companyId"
    LEFT JOIN "CreditLedgerEntry" consume
      ON consume."consumedGrantEntryId" = grant_entry."id"
      AND consume."kind" = 'CONSUME'
    LEFT JOIN "CreditLedgerEntry" reversal
      ON reversal."reversalOfEntryId" = consume."id"
      AND reversal."kind" = 'REVERSAL'
    WHERE grant_entry."kind" = 'GRANT'
      AND grant_entry."fundingSource" IN ('PLAN_ALLOWANCE', 'PURCHASED_PACK')
      AND grant_entry."validFrom" <= ${now}
      AND grant_entry."validTo" > ${now}
      AND company."status" = 'ACTIVE'
      AND (${includeDemo}::boolean OR company."dataProvenance" = 'LIVE')
    GROUP BY grant_entry."id", account."companyId", company."name", account."creditType"
    HAVING grant_entry."amount" + COALESCE(sum(consume."amount"), 0) +
      COALESCE(sum(reversal."amount"), 0) > 0
    ORDER BY grant_entry."validTo", grant_entry."id"
  `);
  return rows.map((row) => ({ ...row, remaining: Number(row.remaining) }));
}

function buildUsageCandidate(input: Readonly<{
  companyId: string;
  companyName: string;
  evidenceReference: string;
  evidenceWindowEnd: Date;
  evidenceWindowStart: Date;
  now: Date;
  periodKey: string;
  reasonCode: "ACTIVE_JOB_LIMIT_80" | "SEAT_LIMIT_80";
}>): CommercialSignalCandidate {
  return {
    boundaryKey: input.periodKey,
    companyId: input.companyId,
    companyName: input.companyName,
    dueAt: new Date(input.now.getTime() + 7 * 86_400_000),
    evidenceReference: input.evidenceReference,
    evidenceWindowStart: input.evidenceWindowStart,
    evidenceWindowEnd: input.evidenceWindowEnd,
    kind: "USAGE_DIAGNOSTIC",
    reasonCode: input.reasonCode,
    thresholdCode: "80_PERCENT",
  };
}

function commercialTaskKey(candidate: CommercialSignalCandidate) {
  return `commercial-v1:${candidate.reasonCode}:${candidate.companyId}:${candidate.boundaryKey}`;
}

function dedupeCandidates(candidates: readonly CommercialSignalCandidate[]) {
  return [
    ...new Map(candidates.map((candidate) => [commercialTaskKey(candidate), candidate])).values(),
  ].sort((left, right) => commercialTaskKey(left).localeCompare(commercialTaskKey(right)));
}

function signalLabel(reason: CommercialSignalReason) {
  const labels: Readonly<Record<CommercialSignalReason, string>> = {
    SUBSCRIPTION_END_30D: "Abo-Ende in 30 Tagen prüfen",
    SUBSCRIPTION_END_14D: "Abo-Ende in 14 Tagen prüfen",
    SUBSCRIPTION_END_7D: "Abo-Ende in 7 Tagen prüfen",
    SUBSCRIPTION_CANCELLING: "Kündigendes Abo prüfen",
    CREDIT_EXPIRY_14D: "Credit-Ablauf in 14 Tagen prüfen",
    CREDIT_EXPIRY_7D: "Credit-Ablauf in 7 Tagen prüfen",
    PAID_COMPANY_INACTIVE_30D: "30 Tage ohne Arbeitgeberaktivität",
    ACTIVE_JOB_LIMIT_80: "Aktivstellen-Limit mindestens 80 %",
    SEAT_LIMIT_80: "Seat-Limit mindestens 80 %",
  };
  return labels[reason];
}

function formatZurichDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: COMMERCIAL_LIFECYCLE_POLICY_V1.timeZone,
    dateStyle: "medium",
  }).format(value);
}
