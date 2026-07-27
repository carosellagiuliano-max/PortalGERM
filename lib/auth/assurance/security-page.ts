import "server-only";

import { getMfaOverview } from "@/lib/auth/assurance/mfa-service";
import type { AuthenticatedPageUser } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export async function getSecurityPageModel(
  user: AuthenticatedPageUser,
  correlationId: string,
) {
  const environment = getServerEnvironment();
  const result = await getMfaOverview({
    actor: {
      userId: user.id,
      sessionId: user.sessionId,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    },
    correlationId,
    database: getDatabase(),
    environment,
    now: new Date(),
  });
  if (!result.ok) return null;
  return Object.freeze({
    authenticators: result.value.authenticators.map((factor) => ({
      ...factor,
      verifiedAt: factor.verifiedAt?.toISOString() ?? null,
      lastUsedAt: factor.lastUsedAt?.toISOString() ?? null,
      revokedAt: factor.revokedAt?.toISOString() ?? null,
    })),
    assurance:
      result.value.assurance === null
        ? null
        : {
            ...result.value.assurance,
            verifiedAt: result.value.assurance.verifiedAt.toISOString(),
            expiresAt: result.value.assurance.expiresAt.toISOString(),
          },
    remainingRecoveryCodes: result.value.remainingRecoveryCodes,
    adminMfaRequired: environment.ADMIN_MFA_REQUIRED,
  });
}
