import type { DatabaseClient } from "@/lib/db/factory";
import {
  activeSessionTokenHashWhere,
  type SessionRecord,
  type SessionStore,
} from "@/lib/auth/session";

const SESSION_SELECT = {
  id: true,
  userId: true,
  tokenHash: true,
  pendingTokenHash: true,
  pendingTokenExpiresAt: true,
  previousTokenHash: true,
  previousTokenExpiresAt: true,
  expiresAt: true,
  absoluteExpiresAt: true,
  createdAt: true,
  rotatedAt: true,
  revokedAt: true,
  userAgent: true,
  ipHash: true,
  activePortal: true,
  activeCompanyId: true,
  contextVersion: true,
  contextChangedAt: true,
} as const;

export function createPrismaSessionStore(
  database: DatabaseClient,
): SessionStore {
  const store: SessionStore = {
    async create(input): Promise<SessionRecord> {
      return database.session.create({ data: input, select: SESSION_SELECT });
    },
    async findByTokenHash(tokenHash, now): Promise<SessionRecord | null> {
      return database.session.findFirst({
        where: {
          ...activeSessionTokenHashWhere(tokenHash, now),
        },
        select: SESSION_SELECT,
      });
    },
    async touch(id, expiresAt): Promise<void> {
      await database.session.updateMany({
        where: {
          id,
          revokedAt: null,
          expiresAt: { lt: expiresAt },
        },
        data: { expiresAt },
      });
    },
    async stageRotation(
      id,
      currentTokenHash,
      pendingTokenHash,
      stagedAt,
      pendingTokenExpiresAt,
      expiresAt,
    ): Promise<SessionRecord | null> {
      return database.$transaction(async (transaction) => {
        const result = await transaction.session.updateMany({
          where: {
            id,
            tokenHash: currentTokenHash,
            revokedAt: null,
            expiresAt: { gt: stagedAt },
            absoluteExpiresAt: { gt: stagedAt },
            OR: [
              { pendingTokenHash: null },
              { pendingTokenExpiresAt: { lte: stagedAt } },
              {
                pendingTokenHash,
                pendingTokenExpiresAt: { gt: stagedAt },
              },
            ],
          },
          data: { pendingTokenHash, pendingTokenExpiresAt, expiresAt },
        });
        if (result.count !== 1) {
          return transaction.session.findFirst({
            where: {
              id,
              tokenHash: currentTokenHash,
              pendingTokenHash,
              pendingTokenExpiresAt: { gt: stagedAt },
              revokedAt: null,
              expiresAt: { gt: stagedAt },
              absoluteExpiresAt: { gt: stagedAt },
            },
            select: SESSION_SELECT,
          });
        }
        return transaction.session.findUnique({
          where: { id },
          select: SESSION_SELECT,
        });
      });
    },
    async promotePendingToken(
      id,
      pendingTokenHash,
      promotedAt,
      previousTokenExpiresAt,
      expiresAt,
    ): Promise<SessionRecord | null> {
      return database.$transaction(async (transaction) => {
        const current = await transaction.session.findFirst({
          where: {
            id,
            pendingTokenHash,
            pendingTokenExpiresAt: { gt: promotedAt },
            revokedAt: null,
            expiresAt: { gt: promotedAt },
            absoluteExpiresAt: { gt: promotedAt },
          },
          select: { tokenHash: true },
        });
        if (current === null) return null;
        const promoted = await transaction.session.updateMany({
          where: {
            id,
            tokenHash: current.tokenHash,
            pendingTokenHash,
            pendingTokenExpiresAt: { gt: promotedAt },
            revokedAt: null,
            expiresAt: { gt: promotedAt },
            absoluteExpiresAt: { gt: promotedAt },
          },
          data: {
            tokenHash: pendingTokenHash,
            pendingTokenHash: null,
            pendingTokenExpiresAt: null,
            previousTokenHash: current.tokenHash,
            previousTokenExpiresAt,
            rotatedAt: promotedAt,
            expiresAt,
          },
        });
        if (promoted.count !== 1) return null;
        return transaction.session.findUnique({
          where: { id },
          select: SESSION_SELECT,
        });
      });
    },
    async revokeByTokenHash(tokenHash, revokedAt): Promise<void> {
      await database.session.updateMany({
        where: {
          revokedAt: null,
          OR: [
            { tokenHash },
            { pendingTokenHash: tokenHash },
            { previousTokenHash: tokenHash },
          ],
        },
        data: { revokedAt },
      });
    },
    async revokeAllForUser(userId, revokedAt): Promise<void> {
      await database.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt },
      });
    },
  };
  return Object.freeze(store);
}
