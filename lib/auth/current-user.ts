import "server-only";

import { cookies } from "next/headers";

import { getDatabase } from "@/lib/db/client";
import { createPrismaSessionStore } from "@/lib/auth/session-store";
import { hashSessionToken, readSession, SESSION_POLICY_V1 } from "@/lib/auth/session";

export const CURRENT_USER_SELECT = Object.freeze({
  id: true,
  email: true,
  role: true,
  name: true,
  status: true,
  emailVerifiedAt: true,
} as const);

export type CurrentUser = Readonly<{
  id: string;
  email: string;
  role: "CANDIDATE" | "EMPLOYER" | "RECRUITER" | "ADMIN";
  name: string | null;
  status: "ACTIVE";
  emailVerifiedAt: Date | null;
}>;

export interface CurrentUserRepository {
  findBySessionTokenHash(tokenHash: string, now: Date): Promise<CurrentUser | null>;
}

export async function getCurrentUserFromToken(
  token: string | undefined,
  now: Date,
  repository: CurrentUserRepository,
): Promise<CurrentUser | null> {
  if (token === undefined || token.length < 32 || Number.isNaN(now.getTime())) {
    return null;
  }
  return repository.findBySessionTokenHash(hashSessionToken(token), now);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_POLICY_V1.cookieName)?.value;
  if (token === undefined) return null;
  const now = new Date();
  const database = getDatabase();
  const store = createPrismaSessionStore(database);
  const session = await readSession(token, { store, clock: { now } });
  if (session === null) return null;
  const user = await database.user.findUnique({
    where: { id: session.userId },
    select: CURRENT_USER_SELECT,
  });
  if (user?.status !== "ACTIVE") {
    await store.revokeByTokenHash(session.tokenHash, now);
    return null;
  }
  return user as CurrentUser;
}
