import "server-only";

import { cookies } from "next/headers";

import { writeBestEffortAudit } from "@/lib/audit/log";
import { createPrismaAuditPort } from "@/lib/audit/prisma-port";
import { COMPANY_CONTEXT_COOKIE_POLICY_V1 } from "@/lib/auth/company-context-cookie";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import {
  clearSessionCookie,
  hashSessionToken,
  readSessionCookie,
} from "@/lib/auth/session";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

const AUDIT_RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

export async function logoutCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    throw new Error("AUTH_ORIGIN_DENIED");
  }
  const token = readSessionCookie(cookieStore);

  try {
    if (token !== undefined && token.length >= 32) {
      const database = getDatabase();
      const tokenHash = hashSessionToken(token);
      const now = new Date();
      const session = await database.$transaction(async (transaction) => {
        const current = await transaction.session.findFirst({
          where: {
            OR: [
              { tokenHash },
              { pendingTokenHash: tokenHash },
              { previousTokenHash: tokenHash },
            ],
          },
          select: { id: true, userId: true },
        });
        if (current === null) return null;
        const revoked = await transaction.session.updateMany({
          where: { id: current.id, revokedAt: null },
          data: { revokedAt: now },
        });
        return revoked.count === 1 ? current : null;
      });
      if (session !== null) {
        // Session invalidation is the security boundary. Audit is deliberately
        // attempted afterwards so an unavailable audit sink can never roll the
        // revocation back and leave a copied bearer token usable. Revocation,
        // rather than deletion, also preserves MFA and assurance evidence that
        // references the stable session lineage through restrictive FKs.
        try {
          const environment = getServerEnvironment();
          await writeBestEffortAudit(
            createPrismaAuditPort(database),
            {
              action: "USER_LOGOUT",
              actorKind: "USER",
              actorUserId: session.userId,
              capability: "AUTH_LOGOUT",
              correlationId: request.correlationId,
              result: "SUCCEEDED",
              retainUntil: new Date(
                now.getTime() + AUDIT_RETENTION_MILLISECONDS,
              ),
              targetId: session.id,
              targetType: "SESSION",
            },
            undefined,
            {
              sourceIp: request.sourceIp,
              keyring: environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
            },
          );
        } catch {
          // Revocation is already durable. Audit/configuration failure must
          // never resurrect the bearer or turn logout into a false success.
        }
      }
    }
  } finally {
    clearSessionCookie(cookieStore);
    cookieStore.delete(COMPANY_CONTEXT_COOKIE_POLICY_V1.cookieName);
  }
}
