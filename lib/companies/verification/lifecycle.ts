import "server-only";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { COMPANY_TRUST_POLICY_V2 } from "@/lib/companies/verification/policy-v2";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import {
  buildNotificationPersistenceRecord,
  writeNotificationExactlyOnce,
} from "@/lib/notifications/writer";
import { applyCompanyRadarEligibilityLoss } from "@/lib/talentradar/eligibility-loss-effects";

const DAY = 86_400_000;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

export type CompanyTrustLifecycleSummary = Readonly<{
  inspected: number;
  expired: number;
  markedExpiring: number;
  remindersCreated: number;
  radarRequestsCancelled: number;
}>;

/**
 * Projects lifecycle state for operations and notifications. Public, Job and
 * Radar reads still compare `expiresAt` to their own clock, so a delayed worker
 * can never extend trust.
 */
export async function projectCompanyTrustLifecycle(input: Readonly<{
  database: DatabaseClient;
  correlationId: string;
  now?: Date;
  batchSize?: number;
}>): Promise<CompanyTrustLifecycleSummary> {
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new TypeError("Invalid company-trust lifecycle input.");
  }

  const due = await input.database.companyTrustProjection.findMany({
    where: {
      scope: "COMPANY_IDENTITY",
      level: "STRONG",
      policyVersion: COMPANY_TRUST_POLICY_V2.version,
      status: { in: ["ACTIVE", "EXPIRING"] },
      expiresAt: { not: null, lte: new Date(now.getTime() + 30 * DAY) },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: {
      id: true,
      companyId: true,
      verificationRequestId: true,
      status: true,
      expiresAt: true,
      version: true,
    },
  });

  let expired = 0;
  let markedExpiring = 0;
  let remindersCreated = 0;
  let radarRequestsCancelled = 0;
  for (const projection of due) {
    const outcome = await input.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "CompanyTrustProjection"
          WHERE "id" = ${projection.id}::uuid
          FOR UPDATE
        `;
        const current = await transaction.companyTrustProjection.findUnique({
          where: { id: projection.id },
          select: {
            id: true,
            companyId: true,
            verificationRequestId: true,
            status: true,
            expiresAt: true,
            version: true,
          },
        });
        if (
          current === null ||
          current.expiresAt === null ||
          !["ACTIVE", "EXPIRING"].includes(current.status)
        ) {
          return Object.freeze({
            expired: 0,
            markedExpiring: 0,
            remindersCreated: 0,
            radarRequestsCancelled: 0,
          });
        }

        if (current.expiresAt.getTime() <= now.getTime()) {
          const changed = await transaction.companyTrustProjection.updateMany({
            where: {
              id: current.id,
              version: current.version,
              status: { in: ["ACTIVE", "EXPIRING"] },
              expiresAt: { lte: now },
            },
            data: {
              status: "EXPIRED",
              reasonCode: "EVIDENCE_VALIDITY_EXPIRED",
              changedAt: now,
              updatedAt: now,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) return zeroOutcome();
          await transaction.companyVerificationEvidence.updateMany({
            where: {
              verificationRequestId: current.verificationRequestId,
              status: "VALID",
              validTo: { lte: now },
              revokedAt: null,
            },
            data: {
              status: "EXPIRED",
              reasonCode: "VALIDITY_EXPIRED",
            },
          });
          const radar = await applyCompanyRadarEligibilityLoss(transaction, {
            companyId: current.companyId,
            reason: "COMPANY_VERIFICATION_LOST",
            actor: { kind: "SYSTEM" },
            correlationId: input.correlationId,
            now,
          });
          await Promise.all([
            writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
              action: "COMPANY_TRUST_EXPIRED_V2",
              actorKind: "SYSTEM",
              actorUserId: null,
              capability: "COMPANY_TRUST_EXPIRY_PROJECT",
              companyId: current.companyId,
              correlationId: input.correlationId,
              reasonCode: "EVIDENCE_VALIDITY_EXPIRED",
              result: "SUCCEEDED",
              retainUntil: new Date(now.getTime() + 400 * DAY),
              targetId: current.id,
              targetType: "COMPANY_TRUST_PROJECTION",
            }),
            notifyCompanyManagers(transaction, {
              companyId: current.companyId,
              verificationRequestId: current.verificationRequestId,
              status: "EXPIRED",
              reasonCode: "EXPIRED",
              dedupeKey: `company-trust-expired:${current.id}:${current.expiresAt.toISOString()}`,
            }),
          ]);
          return Object.freeze({
            expired: 1,
            markedExpiring: 0,
            remindersCreated: 1,
            radarRequestsCancelled: radar.cancelledRequests,
          });
        }

        const marked =
          current.status === "ACTIVE"
            ? await transaction.companyTrustProjection.updateMany({
                where: {
                  id: current.id,
                  version: current.version,
                  status: "ACTIVE",
                },
                data: {
                  status: "EXPIRING",
                  reasonCode: "REVIEW_DUE",
                  changedAt: now,
                  updatedAt: now,
                  version: { increment: 1 },
                },
              })
            : { count: 0 };
        let created = 0;
        for (const offsetDays of COMPANY_TRUST_POLICY_V2.expiryReminderOffsetsDays) {
          const reminderAt = new Date(
            current.expiresAt.getTime() - offsetDays * DAY,
          );
          if (reminderAt.getTime() > now.getTime()) continue;
          created += await notifyCompanyManagers(transaction, {
            companyId: current.companyId,
            verificationRequestId: current.verificationRequestId,
            status: "VERIFIED",
            reasonCode: "REVIEW_DUE",
            dedupeKey: `company-trust-reminder:${current.id}:${offsetDays}:${current.expiresAt.toISOString()}`,
          });
        }
        return Object.freeze({
          expired: 0,
          markedExpiring: marked.count,
          remindersCreated: created,
          radarRequestsCancelled: 0,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expired += outcome.expired;
    markedExpiring += outcome.markedExpiring;
    remindersCreated += outcome.remindersCreated;
    radarRequestsCancelled += outcome.radarRequestsCancelled;
  }

  return Object.freeze({
    inspected: due.length,
    expired,
    markedExpiring,
    remindersCreated,
    radarRequestsCancelled,
  });
}

async function notifyCompanyManagers(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    companyId: string;
    verificationRequestId: string;
    status: "VERIFIED" | "EXPIRED";
    reasonCode: "REVIEW_DUE" | "EXPIRED";
    dedupeKey: string;
  }>,
) {
  const managers = await transaction.companyMembership.findMany({
    where: {
      companyId: input.companyId,
      status: "ACTIVE",
      removedAt: null,
      role: { in: ["OWNER", "ADMIN"] },
      user: { status: "ACTIVE" },
    },
    orderBy: { id: "asc" },
    take: 100,
    select: { userId: true },
  });
  let created = 0;
  for (const manager of managers) {
    const notificationInput = {
      recipientUserId: manager.userId,
      kind: "COMPANY_VERIFICATION_CHANGED" as const,
      dedupeKey: `${input.dedupeKey}:${manager.userId}`,
      payload: {
        verificationRequestId: input.verificationRequestId,
        status: input.status,
        reasonCode: input.reasonCode,
      },
    };
    const record = buildNotificationPersistenceRecord(notificationInput);
    const existing = await transaction.notification.findUnique({
      where: {
        recipientUserId_kind_dedupeKey: {
          recipientUserId: record.recipientUserId,
          kind: record.kind,
          dedupeKey: record.dedupeKey,
        },
      },
      select: { id: true },
    });
    await writeNotificationExactlyOnce(
      createPrismaNotificationPort(transaction),
      notificationInput,
    );
    if (existing === null) created += 1;
  }
  return created;
}

function zeroOutcome() {
  return Object.freeze({
    expired: 0,
    markedExpiring: 0,
    remindersCreated: 0,
    radarRequestsCancelled: 0,
  });
}
