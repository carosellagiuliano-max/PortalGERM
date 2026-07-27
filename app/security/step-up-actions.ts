"use server";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
  type StepUpDependencies,
} from "@/lib/auth/assurance/step-up-service";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireAuthenticatedPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export type StepUpActionResult =
  | Readonly<{
      ok: true;
      value: Readonly<{
        evidenceId: string;
        grantToken: string;
        expiresAt: string;
      }>;
    }>
  | Readonly<{ ok: false; code: string; message: string }>;

export async function issueBoundStepUpGrantAction(input: {
  purpose: string;
  action: string;
  tenantId?: string | null;
  resourceId?: string | null;
}): Promise<StepUpActionResult> {
  const [user, request] = await Promise.all([
    requireAuthenticatedPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return failed("FORBIDDEN");
  }
  const dependencies: StepUpDependencies = Object.freeze({
    actor: {
      userId: user.id,
      sessionId: user.sessionId,
      role: user.role,
      status: user.status,
    },
    correlationId: request.correlationId,
    database: getDatabase(),
    now: new Date(),
  });
  const started = await beginStepUpChallenge(input, dependencies);
  if (!started.ok) return failed(started.code);
  const completed = await completeStepUpChallenge(
    {
      challengeId: started.value.challengeId,
      challengeToken: started.value.challengeToken,
    },
    dependencies,
  );
  if (!completed.ok) return failed(completed.code);
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      evidenceId: completed.value.evidenceId,
      grantToken: completed.value.grantToken,
      expiresAt: completed.value.expiresAt.toISOString(),
    }),
  });
}

function failed(code: string): StepUpActionResult {
  const messages: Record<string, string> = {
    INVALID_INPUT: "Die Aktionsbindung ist ungültig.",
    FORBIDDEN:
      "Diese Sicherheitsbestätigung passt nicht zu Rolle, Tenant oder Ressource.",
    AAL2_REQUIRED:
      "Bestätige diese Sitzung zuerst unter Sicherheit mit Passkey oder TOTP.",
    INVALID_CHALLENGE:
      "Die Sicherheitsanforderung ist abgelaufen oder wurde bereits verwendet.",
    CONFLICT:
      "Der Sicherheitszustand hat sich geändert. Bitte starte erneut.",
    WRITE_FAILED:
      "Die aktionsgebundene Bestätigung konnte nicht gespeichert werden.",
  };
  return Object.freeze({
    ok: false,
    code,
    message: messages[code] ?? "Die Sicherheitsbestätigung ist fehlgeschlagen.",
  });
}
