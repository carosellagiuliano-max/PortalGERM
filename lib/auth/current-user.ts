import "server-only";

import { cookies } from "next/headers";

import { getDatabase } from "@/lib/db/client";
import { createPrismaSessionStore } from "@/lib/auth/session-store";
import {
  hashSessionToken,
  readSession,
  SESSION_POLICY_V1,
} from "@/lib/auth/session";
import {
  effectiveLegacyRoleForContext,
  legacyPortalForRole,
  type LegacyIdentityRole,
  type PortalContextV2,
} from "@/lib/auth/persona-policy";
import { getServerEnvironment } from "@/lib/config/env";

export const CURRENT_USER_SELECT = Object.freeze({
  id: true,
  email: true,
  role: true,
  name: true,
  status: true,
  emailVerifiedAt: true,
  emailAddressEpoch: true,
  identityAssurance: true,
} as const);

export type CurrentUser = Readonly<{
  id: string;
  email: string;
  role: "CANDIDATE" | "EMPLOYER" | "RECRUITER" | "ADMIN";
  identityRole?: "CANDIDATE" | "EMPLOYER" | "RECRUITER" | "ADMIN";
  portalContext?: PortalContextV2;
  sessionContextVersion?: number;
  name: string | null;
  status: "ACTIVE";
  emailVerifiedAt: Date | null;
  emailAddressEpoch: number;
  identityAssurance: "LOW_ASSURANCE" | "VERIFIED_EMAIL" | "LEGACY_ASSURANCE";
}>;

export type CurrentAuthContext = Readonly<{
  user: CurrentUser;
  session: Readonly<{
    id: string;
    userId: string;
    presentedTokenState: "CURRENT" | "PREVIOUS";
    createdAt: Date;
    rotatedAt: Date | null;
    expiresAt: Date;
    absoluteExpiresAt: Date;
    activePortal: PortalContextV2;
    activeCompanyId: string | null;
    contextVersion: number;
    contextChangedAt: Date | null;
  }>;
}>;

export interface CurrentUserRepository {
  findBySessionTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<CurrentUser | null>;
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
  const context = await getCurrentAuthContext();
  return context?.user ?? null;
}

export async function getCurrentAuthContext(): Promise<CurrentAuthContext | null> {
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
  const identityRole = user.role as LegacyIdentityRole;
  const environment = getServerEnvironment();
  const activePortal =
    environment.IDENTITY_PERSONA_V2 === "disabled"
      ? legacyPortalForRole(identityRole)
      : (session.activePortal ?? legacyPortalForRole(identityRole));
  if (environment.IDENTITY_PERSONA_V2 !== "disabled") {
    const contextAuthorized =
      activePortal === "ADMIN"
        ? identityRole === "ADMIN"
        : (await database.personaAssignment.count({
            where: {
              userId: user.id,
              kind: activePortal,
              status: "ACTIVE",
            },
          })) === 1;
    if (!contextAuthorized) return null;
  }
  const membership =
    activePortal === "EMPLOYER" && session.activeCompanyId != null
      ? await database.companyMembership.findFirst({
          where: {
            companyId: session.activeCompanyId,
            userId: user.id,
            status: "ACTIVE",
          },
          select: { role: true },
        })
      : null;
  const effectiveRole =
    environment.IDENTITY_PERSONA_V2 === "disabled"
      ? identityRole
      : effectiveLegacyRoleForContext({
          identityRole,
          portal: activePortal,
          membershipRole: membership?.role ?? null,
        });
  const contextVersion = session.contextVersion ?? 1;
  return Object.freeze({
    user: Object.freeze({
      ...user,
      role: effectiveRole,
      identityRole,
      portalContext: activePortal,
      sessionContextVersion: contextVersion,
    }) as CurrentUser,
    session: Object.freeze({
      id: session.id,
      userId: session.userId,
      presentedTokenState:
        session.tokenHash === hashSessionToken(token) ? "CURRENT" : "PREVIOUS",
      createdAt: session.createdAt,
      rotatedAt: session.rotatedAt,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      activePortal,
      activeCompanyId: session.activeCompanyId ?? null,
      contextVersion,
      contextChangedAt: session.contextChangedAt ?? null,
    }),
  });
}
