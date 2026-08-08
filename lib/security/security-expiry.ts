import "server-only";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";

export async function projectExpiredSecurityState(
  database: DatabaseClient,
  input: Readonly<{ correlationId: string; now: Date }>,
): Promise<
  Readonly<{
    approvals: number;
    breakGlass: number;
    challenges: number;
    sessionsRevoked: number;
  }>
> {
  if (!Number.isFinite(input.now.getTime())) {
    throw new TypeError("Security expiry requires a valid clock.");
  }
  return database.$transaction(
    async (transaction) => {
      const expiredGrants = await transaction.breakGlassGrant.findMany({
        where: {
          status: "ACTIVE",
          revokedAt: null,
          validTo: { lte: input.now },
        },
        orderBy: { id: "asc" },
        select: { id: true, userId: true },
      });
      const approvals = await transaction.privilegedApproval.updateMany({
        where: { status: "PENDING", expiresAt: { lte: input.now } },
        data: { status: "EXPIRED", decidedAt: input.now },
      });
      const authenticatorChallenges =
        await transaction.authenticatorChallenge.updateMany({
          where: { status: "PENDING", expiresAt: { lte: input.now } },
          data: { status: "EXPIRED", cancelledAt: input.now },
        });
      const stepUpChallenges = await transaction.stepUpChallenge.updateMany({
        where: { status: "PENDING", expiresAt: { lte: input.now } },
        data: { status: "EXPIRED", cancelledAt: input.now },
      });

      let sessionsRevoked = 0;
      for (const grant of expiredGrants) {
        const changed = await transaction.breakGlassGrant.updateMany({
          where: {
            id: grant.id,
            status: "ACTIVE",
            revokedAt: null,
            validTo: { lte: input.now },
          },
          data: {
            status: "EXPIRED",
            revokedAt: input.now,
            reasonCode: "BREAK_GLASS_TTL_EXPIRED",
          },
        });
        if (changed.count !== 1) continue;
        const sessions = await transaction.session.updateMany({
          where: { userId: grant.userId, revokedAt: null },
          data: { revokedAt: input.now },
        });
        sessionsRevoked += sessions.count;
        await transaction.sessionAssurance.updateMany({
          where: { userId: grant.userId, revokedAt: null },
          data: { revokedAt: input.now },
        });
        await transaction.authAssuranceEvidence.updateMany({
          where: { userId: grant.userId, revokedAt: null, usedAt: null },
          data: { revokedAt: input.now },
        });
        await transaction.stepUpChallenge.updateMany({
          where: { userId: grant.userId, status: "PENDING" },
          data: { status: "REVOKED", cancelledAt: input.now },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "BREAK_GLASS_REVOKED",
            actorKind: "SYSTEM",
            capability: "ADMIN_BREAK_GLASS_MANAGE",
            correlationId: input.correlationId,
            reasonCode: "BREAK_GLASS_TTL_EXPIRED",
            result: "SUCCEEDED",
            retainUntil: new Date(input.now.getTime() + 10 * 365 * 86_400_000),
            targetId: grant.id,
            targetType: "BREAK_GLASS_GRANT",
          },
        );
      }
      return Object.freeze({
        approvals: approvals.count,
        breakGlass: expiredGrants.length,
        challenges:
          authenticatorChallenges.count + stepUpChallenges.count,
        sessionsRevoked,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
