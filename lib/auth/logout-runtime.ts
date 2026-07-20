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
      const environment = getServerEnvironment();
      const session = await database.$transaction(async (transaction) => {
        const current = await transaction.session.findUnique({
          where: { tokenHash },
          select: { id: true, userId: true },
        });
        if (current === null) return null;
        await transaction.session.delete({
          where: { id: current.id },
          select: { id: true },
        });
        return current;
      });
      if (session !== null) {
        // Session invalidation is the security boundary. Audit is deliberately
        // attempted afterwards so an unavailable audit sink can never roll the
        // deletion back and leave a copied bearer token usable.
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
      }
    }
  } finally {
    clearSessionCookie(cookieStore);
    cookieStore.delete(COMPANY_CONTEXT_COOKIE_POLICY_V1.cookieName);
  }
}
