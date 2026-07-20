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

type SessionCreatePort = Readonly<{
  session: Readonly<{
    create(input: Readonly<{
      data: Readonly<{
        userId: string;
        tokenHash: string;
        expiresAt: Date;
        absoluteExpiresAt: Date;
        createdAt: Date;
        userAgent: string | null;
        ipHash: string | null;
      }>;
      select: typeof SESSION_SELECT;
    }>): Promise<SessionRecord>;
  }>;
}>;

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

export async function issueSession(
  port: SessionCreatePort,
  input: Readonly<{
    userId: string;
    now: Date;
    request: Pick<
      AuthRequestContext,
      "production" | "sourceIp" | "userAgent"
    >;
    auditIpKeyring: readonly KeyringEntry<"AUDIT_IP_HASH_KEYS">[];
  }>,
): Promise<CreatedSession> {
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
