import "server-only";

import { z } from "zod";
import { applyCandidateRadarEligibilityLoss } from "@/lib/talentradar/eligibility-loss-effects";
import type { Prisma } from "@/lib/generated/prisma/client";

import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminSuccess,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";

export async function listAdminUsers(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_USER_MODERATE")) return null;
  const now = adminNow(dependencies.now);
  return dependencies.database.user.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 250,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      companyMemberships: {
        where: { status: "ACTIVE", removedAt: null },
        select: {
          role: true,
          company: {
            select: {
              id: true,
              name: true,
              subscriptions: {
                where: { status: { in: ["ACTIVE", "CANCELLING"] }, currentPeriodStart: { lte: now }, currentPeriodEnd: { gt: now } },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });
}

export async function getAdminUserDetail(dependencies: AdminDependencies, userId: string) {
  if (!requireCapability(dependencies, "ADMIN_USER_MODERATE") || !z.uuid().safeParse(userId).success) return null;
  return dependencies.database.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      companyMemberships: { select: { id: true, role: true, status: true, company: { select: { id: true, name: true, slug: true } } } },
      sessions: { select: { id: true, createdAt: true, expiresAt: true, revokedAt: true } },
      notifications: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10, select: { kind: true, createdAt: true, readAt: true } },
      auditLogs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, action: true, targetType: true, result: true, reasonCode: true, createdAt: true } },
    },
  });
}

const userCommandSchema = z.strictObject({
  userId: z.uuid(),
  expectedStatus: z.enum(["ACTIVE", "SUSPENDED"]),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  idempotencyKey: z.uuid(),
});

export async function suspendUser(raw: unknown, dependencies: AdminDependencies) {
  const parsed = userCommandSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_USER_MODERATE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const auditCorrelation = parsed.data.idempotencyKey;
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${parsed.data.userId}::uuid FOR UPDATE`;
      const existingAudit = await transaction.auditLog.findFirst({ where: { action: "USER_SUSPENDED", targetId: parsed.data.userId, correlationId: auditCorrelation }, select: { id: true } });
      const user = await transaction.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, role: true, status: true, candidateProfile: { select: { id: true, radarProfile: { select: { id: true } } } } } });
      if (user === null) return adminFailure("NOT_FOUND");
      if (existingAudit !== null && user.status === "SUSPENDED") {
        const sessionAudits = await transaction.auditLog.findMany({
          where: {
            action: "SESSION_REVOKED",
            correlationId: auditCorrelation,
          },
          select: { targetId: true },
        });
        const ownedTargets = await transaction.session.count({
          where: {
            userId: user.id,
            id: { in: sessionAudits.map(({ targetId }) => targetId) },
            revokedAt: { not: null },
          },
        });
        if (ownedTargets !== sessionAudits.length) {
          return adminFailure("CONFLICT");
        }
        return adminSuccess(
          {
            userId: user.id,
            status: "SUSPENDED" as const,
            sessionsRevoked: sessionAudits.length,
          },
          true,
        );
      }
      if (user.status !== parsed.data.expectedStatus || user.status !== "ACTIVE") return adminFailure("CONFLICT");
      if (user.id === dependencies.actor.userId) return adminFailure("CONFLICT");
      if (user.role === "ADMIN") {
        const activeAdmins = await transaction.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
        if (activeAdmins <= 1) return adminFailure("CONFLICT");
      }
      const changed = await transaction.user.updateMany({ where: { id: user.id, status: "ACTIVE" }, data: { status: "SUSPENDED", updatedAt: now } });
      if (changed.count !== 1) return adminFailure("CONFLICT");
      const revokedSessionIds = await revokeActiveSessions(
        transaction,
        user.id,
        now,
      );
      if (user.candidateProfile !== null) {
        await applyCandidateRadarEligibilityLoss(transaction, {
          candidateProfileId: user.candidateProfile.id,
          candidateUserId: user.id,
          reason: "CANDIDATE_USER_UNAVAILABLE",
          actor: { kind: "USER", userId: dependencies.actor.userId },
          correlationId: auditCorrelation,
          now,
        });
      }
      const auditDependencies = { ...dependencies, correlationId: auditCorrelation };
      await writeAdminAudit(transaction, auditDependencies, now, { action: "USER_SUSPENDED", capability: "ADMIN_USER_MODERATE", targetType: "USER", targetId: user.id, reasonCode: parsed.data.reasonCode });
      for (const sessionId of revokedSessionIds) {
        await writeAdminAudit(transaction, auditDependencies, now, {
          action: "SESSION_REVOKED",
          capability: "ADMIN_USER_MODERATE",
          targetType: "SESSION",
          targetId: sessionId,
          reasonCode: "USER_SUSPENDED",
        });
      }
      return adminSuccess({ userId: user.id, status: "SUSPENDED" as const, sessionsRevoked: revokedSessionIds.length });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function reactivateUser(raw: unknown, dependencies: AdminDependencies) {
  const parsed = userCommandSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_USER_MODERATE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const auditCorrelation = parsed.data.idempotencyKey;
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${parsed.data.userId}::uuid FOR UPDATE`;
      const existingAudit = await transaction.auditLog.findFirst({ where: { action: "USER_REACTIVATED", targetId: parsed.data.userId, correlationId: auditCorrelation }, select: { id: true } });
      const user = await transaction.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, status: true } });
      if (user === null) return adminFailure("NOT_FOUND");
      if (existingAudit !== null && user.status === "ACTIVE") return adminSuccess({ userId: user.id, status: "ACTIVE" as const }, true);
      if (user.status !== parsed.data.expectedStatus || user.status !== "SUSPENDED") return adminFailure("CONFLICT");
      const activeRestriction = await transaction.moderationRestriction.count({ where: { targetType: "SUSPEND_USER", targetId: user.id, status: "ACTIVE", startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } });
      if (activeRestriction > 0) return adminFailure("RESTRICTED");
      const changed = await transaction.user.updateMany({ where: { id: user.id, status: "SUSPENDED" }, data: { status: "ACTIVE", updatedAt: now } });
      if (changed.count !== 1) return adminFailure("CONFLICT");
      await writeAdminAudit(transaction, { ...dependencies, correlationId: auditCorrelation }, now, { action: "USER_REACTIVATED", capability: "ADMIN_USER_MODERATE", targetType: "USER", targetId: user.id, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ userId: user.id, status: "ACTIVE" as const });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const logoutSchema = z.strictObject({
  userId: z.uuid(),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  idempotencyKey: z.uuid(),
});

export async function forceLogoutUser(raw: unknown, dependencies: AdminDependencies) {
  const parsed = logoutSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_USER_MODERATE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const auditCorrelation = parsed.data.idempotencyKey;
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${parsed.data.userId}::uuid FOR UPDATE`;
      const user = await transaction.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true } });
      if (user === null) return adminFailure("NOT_FOUND");
      const replay = await transaction.auditLog.findMany({
        where: {
          action: "SESSION_REVOKED",
          correlationId: auditCorrelation,
        },
        select: { targetId: true, reasonCode: true },
      });
      if (replay.length > 0) {
        if (replay.some(({ reasonCode }) => reasonCode !== parsed.data.reasonCode)) {
          return adminFailure("CONFLICT");
        }
        const ownedTargets = await transaction.session.count({
          where: {
            userId: user.id,
            id: { in: replay.map(({ targetId }) => targetId) },
            revokedAt: { not: null },
          },
        });
        if (ownedTargets !== replay.length) return adminFailure("CONFLICT");
        return adminSuccess(
          { userId: user.id, sessionsRevoked: replay.length },
          true,
        );
      }
      const revokedSessionIds = await revokeActiveSessions(
        transaction,
        user.id,
        now,
      );
      const auditDependencies = {
        ...dependencies,
        correlationId: auditCorrelation,
      };
      for (const sessionId of revokedSessionIds) {
        await writeAdminAudit(transaction, auditDependencies, now, {
          action: "SESSION_REVOKED",
          capability: "ADMIN_USER_MODERATE",
          targetType: "SESSION",
          targetId: sessionId,
          reasonCode: parsed.data.reasonCode,
        });
      }
      return adminSuccess({ userId: user.id, sessionsRevoked: revokedSessionIds.length });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

/** Phase 11 intentionally exports no global Role mutation command. */
export const ADMIN_GLOBAL_ROLE_MUTATION_AVAILABLE = false as const;

async function revokeActiveSessions(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<readonly string[]> {
  const sessions = await transaction.session.findMany({
    where: { userId, revokedAt: null },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (sessions.length === 0) return Object.freeze([]);

  const sessionIds = sessions.map(({ id }) => id);
  const revoked = await transaction.session.updateMany({
    where: {
      userId,
      id: { in: sessionIds },
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  if (revoked.count !== sessionIds.length) {
    throw new Error("SESSION_REVOCATION_CONFLICT");
  }
  return Object.freeze(sessionIds);
}
