import type { DatabaseClient } from "@/lib/db/factory";
import type { SessionRecord, SessionStore } from "@/lib/auth/session";

const SESSION_SELECT = {
  id: true,
  userId: true,
  tokenHash: true,
  expiresAt: true,
  absoluteExpiresAt: true,
  createdAt: true,
  rotatedAt: true,
  revokedAt: true,
  userAgent: true,
  ipHash: true,
} as const;

export function createPrismaSessionStore(database: DatabaseClient): SessionStore {
  const store: SessionStore = {
    async create(input): Promise<SessionRecord> {
      return database.session.create({ data: input, select: SESSION_SELECT });
    },
    async findByTokenHash(tokenHash): Promise<SessionRecord | null> {
      return database.session.findUnique({ where: { tokenHash }, select: SESSION_SELECT });
    },
    async touch(id, expiresAt): Promise<void> {
      await database.session.updateMany({
        where: { id, revokedAt: null, expiresAt: { lt: expiresAt } },
        data: { expiresAt },
      });
    },
    async rotate(id, oldTokenHash, newTokenHash, rotatedAt, expiresAt): Promise<boolean> {
      const result = await database.session.updateMany({
        where: { id, tokenHash: oldTokenHash, revokedAt: null },
        data: { tokenHash: newTokenHash, rotatedAt, expiresAt },
      });
      return result.count === 1;
    },
    async revokeByTokenHash(tokenHash, revokedAt): Promise<void> {
      await database.session.updateMany({
        where: { tokenHash, revokedAt: null },
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
