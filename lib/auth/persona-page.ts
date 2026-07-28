import "server-only";

import { getCurrentAuthContext } from "@/lib/auth/current-user";
import { getPersonaContextOverview } from "@/lib/auth/persona-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export async function getCurrentPersonaContextOverview() {
  const environment = getServerEnvironment();
  if (
    !environment.PERSONA_PORTAL_SWITCH ||
    environment.IDENTITY_PERSONA_V2 === "disabled" ||
    environment.IDENTITY_PERSONA_V2 === "dual_read"
  ) {
    return null;
  }
  const context = await getCurrentAuthContext();
  if (context === null) return null;
  return getPersonaContextOverview(
    {
      userId: context.user.id,
      identityRole: context.user.identityRole ?? context.user.role,
      sessionId: context.session.id,
      currentPortal: context.session.activePortal,
      activeCompanyId: context.session.activeCompanyId,
      contextVersion: context.session.contextVersion,
    },
    getDatabase(),
  );
}
