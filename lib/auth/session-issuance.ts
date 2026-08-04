import { randomBytes } from "node:crypto";

import type { AuthRequestContext } from "@/lib/auth/request-context";
import {
  getSessionCookieOptions,
  hashSessionToken,
  SESSION_POLICY_V1,
  type CreatedSession,
  type SessionRecord,
} from "@/lib/auth/session";
import type { KeyringEntry } from "@/lib/config/env-schema";
import { hashIpWithFirstKey } from "@/lib/utils/hash";
import {
  legacyPortalForRole,
  type LegacyIdentityRole,
  type PortalContextV2,
} from "@/lib/auth/persona-policy";

type SessionCreatePort = Readonly<{
  user: Readonly<{
    findUnique(
      input: Readonly<{
        where: Readonly<{ id: string }>;
        select: Readonly<{ role: true }>;
      }>,
    ): Promise<Readonly<{ role: LegacyIdentityRole }> | null>;
  }>;
  session: Readonly<{
    create(
      input: Readonly<{
        data: Readonly<{
          userId: string;
          tokenHash: string;
          expiresAt: Date;
          absoluteExpiresAt: Date;
          createdAt: Date;
          userAgent: string | null;
          ipHash: string | null;
          activePortal: PortalContextV2;
          activeCompanyId: string | null;
          contextVersion: number;
          contextChangedAt: Date;
        }>;
        select: typeof SESSION_SELECT;
      }>,
    ): Promise<SessionRecord>;
  }>;
}>;

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

export async function issueSession(
  port: SessionCreatePort,
  input: Readonly<{
    userId: string;
    now: Date;
    request: Pick<AuthRequestContext, "production" | "sourceIp" | "userAgent">;
    auditIpKeyring: readonly KeyringEntry<"AUDIT_IP_HASH_KEYS">[];
    activePortal?: PortalContextV2;
    activeCompanyId?: string | null;
  }>,
): Promise<CreatedSession> {
  const identity = await port.user.findUnique({
    where: { id: input.userId },
    select: { role: true },
  });
  if (identity === null) {
    throw new Error("Cannot issue a session for an unknown identity.");
  }
  const activePortal = input.activePortal ?? legacyPortalForRole(identity.role);
  const activeCompanyId =
    activePortal === "EMPLOYER" ? (input.activeCompanyId ?? null) : null;
  const token = randomBytes(SESSION_POLICY_V1.tokenBytes).toString("base64url");
  const absoluteExpiresAt = new Date(
    input.now.getTime() + SESSION_POLICY_V1.absoluteTtlMilliseconds,
  );
  const expiresAt = new Date(
    input.now.getTime() + SESSION_POLICY_V1.idleTtlMilliseconds,
  );
  const record = await port.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      absoluteExpiresAt,
      createdAt: new Date(input.now),
      userAgent: input.request.userAgent,
      ipHash: hashIpWithFirstKey(
        input.request.sourceIp,
        input.auditIpKeyring,
        "AUDIT_IP_HASH_KEYS",
      ),
      activePortal,
      activeCompanyId,
      contextVersion: 1,
      contextChangedAt: new Date(input.now),
    },
    select: SESSION_SELECT,
  });

  return Object.freeze({
    token,
    record,
    cookie: Object.freeze({
      name: SESSION_POLICY_V1.cookieName,
      value: token,
      options: getSessionCookieOptions(
        absoluteExpiresAt,
        input.request.production,
      ),
    }),
  });
}
