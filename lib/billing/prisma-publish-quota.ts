import "server-only";

import {
  getEffectiveEntitlements,
  type EntitlementRepository,
  type FundableCreditRecord,
} from "@/lib/billing/entitlements";
import type {
  PublishQuotaCommitInput,
  PublishQuotaPort,
  PublishQuotaTransaction,
} from "@/lib/billing/usage";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";

export type PrismaPublicationCommit<TPublication> = (
  transaction: Prisma.TransactionClient,
  input: PublishQuotaCommitInput,
) => Promise<TPublication>;

/**
 * PostgreSQL implementation of the publication-quota transaction boundary.
 *
 * The injected commit owns the domain-specific Job projection, JobStatusEvent,
 * and required AuditLog writes. It receives the exact interactive Prisma
 * TransactionClient that acquired the Company lock and performed every read,
 * so any thrown commit/audit error rolls the complete operation back.
 */
export function createPrismaPublishQuotaPort<TPublication>(
  database: DatabaseClient,
  commitPublication: PrismaPublicationCommit<TPublication>,
): PublishQuotaPort<TPublication> {
  return Object.freeze({
    async transaction<TResult>(
      callback: (
        transaction: PublishQuotaTransaction<TPublication>,
      ) => Promise<TResult>,
    ): Promise<TResult> {
      return database.$transaction(
        async (transaction) => {
          const entitlementRepository =
            createPrismaEntitlementRepository(transaction);
          const quotaTransaction: PublishQuotaTransaction<TPublication> =
            Object.freeze({
              async acquireCompanyQuotaAdvisoryLock(namespace, companyId) {
                await transaction.$queryRaw`
                  SELECT pg_advisory_xact_lock(
                    ${namespace}::integer,
                    hashtext(${companyId})::integer
                  ) IS NULL AS "locked"
                `;
              },
              async countQuotaConsumingJobs(companyId, now) {
                return transaction.job.count({
                  where: {
                    companyId,
                    status: "PUBLISHED",
                    publishedAt: { lte: now },
                    expiresAt: { gt: now },
                  },
                });
              },
              async resolveEffectiveEntitlements(companyId, now) {
                return getEffectiveEntitlements(
                  companyId,
                  now,
                  entitlementRepository,
                );
              },
              async findCurrentAdditionalJobPermit(companyId, jobId, now) {
                return transaction.additionalJobPermit.findFirst({
                  where: {
                    companyId,
                    targetJobId: jobId,
                    status: "ACTIVE",
                    revokedAt: null,
                    validFrom: { lte: now },
                    validTo: { gt: now },
                  },
                  select: {
                    companyId: true,
                    targetJobId: true,
                    status: true,
                    validFrom: true,
                    validTo: true,
                    revokedAt: true,
                  },
                });
              },
              async commitPublication(input) {
                return commitPublication(transaction, input);
              },
            });

          return callback(quotaTransaction);
        },
        { isolationLevel: "ReadCommitted" },
      );
    },
  });
}

export function createPrismaEntitlementRepository(
  transaction: Prisma.TransactionClient | DatabaseClient,
): EntitlementRepository {
  return Object.freeze({
    async listDefaultFreePlanVersions(at) {
      const versions = await transaction.planVersion.findMany({
        where: {
          status: "ACTIVE",
          validFrom: { lte: at },
          OR: [{ validTo: null }, { validTo: { gt: at } }],
          plan: { is: { isDefaultFree: true } },
        },
        select: {
          id: true,
          status: true,
          validFrom: true,
          validTo: true,
          plan: {
            select: { code: true, isDefaultFree: true },
          },
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
      });

      return versions.map((version) => ({
        id: version.id,
        planSlug: version.plan.code,
        isDefaultFree: version.plan.isDefaultFree,
        status: version.status,
        validFrom: version.validFrom,
        validTo: version.validTo,
        entitlements: version.entitlements,
      }));
    },
    async listCompanySubscriptions(companyId, at) {
      const subscriptions = await transaction.employerSubscription.findMany({
        where: {
          companyId,
          status: { in: ["ACTIVE", "CANCELLING"] },
          currentPeriodStart: { lte: at },
          currentPeriodEnd: { gt: at },
        },
        select: {
          id: true,
          companyId: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          planVersion: {
            select: {
              id: true,
              status: true,
              validFrom: true,
              validTo: true,
              plan: {
                select: { code: true, isDefaultFree: true },
              },
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

      return subscriptions.map((subscription) => ({
        id: subscription.id,
        companyId: subscription.companyId,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        planVersion: {
          id: subscription.planVersion.id,
          planSlug: subscription.planVersion.plan.code,
          isDefaultFree: subscription.planVersion.plan.isDefaultFree,
          status: subscription.planVersion.status,
          validFrom: subscription.planVersion.validFrom,
          validTo: subscription.planVersion.validTo,
          entitlements: subscription.planVersion.entitlements,
        },
      }));
    },
    async listCompanyEntitlementGrants(companyId, at) {
      return transaction.entitlementGrant.findMany({
        where: {
          companyId,
          revokedAt: null,
          validFrom: { lte: at },
          validTo: { gt: at },
        },
        select: {
          id: true,
          companyId: true,
          key: true,
          valueType: true,
          booleanValue: true,
          integerValue: true,
          analyticsLevelValue: true,
          integerMode: true,
          validFrom: true,
          validTo: true,
          revokedAt: true,
          createdAt: true,
        },
      });
    },
    async listFundableCredits(companyId, at) {
      const accounts = await transaction.creditAccount.findMany({
        where: {
          companyId,
          periodStart: { lte: at },
          periodEnd: { gt: at },
        },
        select: {
          creditType: true,
          fundingSource: true,
          entries: {
            where: {
              validFrom: { lte: at },
              validTo: { gt: at },
            },
            select: { amount: true, fundingSource: true },
          },
        },
      });

      return accounts.map(toFundableCreditRecord);
    },
  });
}

export function getPrismaEffectiveEntitlements(
  companyId: string,
  now: Date,
  database: DatabaseClient,
) {
  return getEffectiveEntitlements(
    companyId,
    now,
    createPrismaEntitlementRepository(database),
  );
}

function toFundableCreditRecord(
  account: Readonly<{
    creditType: string;
    fundingSource: string;
    entries: readonly Readonly<{
      amount: number;
      fundingSource: string;
    }>[];
  }>,
): FundableCreditRecord {
  let available = 0;
  for (const entry of account.entries) {
    if (entry.fundingSource !== account.fundingSource) {
      return {
        creditType: account.creditType,
        fundingSource: "INVALID_ACCOUNT_FUNDING_SCOPE",
        available: -1,
      };
    }
    available += entry.amount;
    if (!Number.isSafeInteger(available)) {
      return {
        creditType: account.creditType,
        fundingSource: account.fundingSource,
        available: Number.NaN,
      };
    }
  }
  return {
    creditType: account.creditType,
    fundingSource: account.fundingSource,
    available,
  };
}
