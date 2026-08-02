"use server";

import { revalidatePath } from "next/cache";

import type { SupportActionState } from "@/app/support/action-state";
import { getServerEnvironment } from "@/lib/config/env";
import { getCurrentUser } from "@/lib/auth/current-user";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { getDatabase } from "@/lib/db/client";
import { createSupportCase, getRequesterSupportCase, replyToSupportCase } from "@/lib/admin/support";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";

export async function supportCaseAction(_previous: SupportActionState, formData: FormData): Promise<SupportActionState> {
  const [user, request] = await Promise.all([getCurrentUser(), getAuthRequestContext()]);
  if (user === null || !isValidAuthMutationOrigin(request)) return Object.freeze({ status: "error", message: "Bitte melde dich erneut an." });
  const operation = value(formData, "operation");
  const input = Object.fromEntries([...formData.entries()].filter(([key]) => !key.startsWith("$ACTION_") && key !== "operation").map(([key, entry]) => [key, typeof entry === "string" && entry.trim() === "" ? null : entry]));
  if (operation !== "create" && operation !== "reply") {
    return Object.freeze({ status: "error", message: "Unbekannte Aktion." });
  }
  const database = getDatabase();
  const environment = getServerEnvironment();
  const now = new Date();
  const caseId = operation === "reply" ? value(formData, "caseId") : null;
  if (
    operation === "reply" &&
    (caseId === null ||
      (await getRequesterSupportCase(
        database,
        { userId: user.id, status: user.status },
        caseId,
      )) === null)
  ) {
    return Object.freeze({ status: "error", message: "Bitte prüfe deine Angaben." });
  }
  const rate = await consumeRequestRateLimit(
    operation === "create" ? "SUPPORT_CASE_CREATE" : "SUPPORT_CASE_REPLY",
    {
      actorId: user.id,
      userId: user.id,
      ...(caseId === null ? {} : { targetId: caseId }),
    },
    request,
    now,
    { environment, database },
  );
  if (!rate.allowed) {
    await recordRateLimitDenial(
      rate.audit,
      {
        actorKind: "USER",
        actorUserId: user.id,
        capability: operation === "create" ? "SUPPORT_CASE_CREATE" : "SUPPORT_CASE_REPLY",
        targetId: caseId ?? user.id,
        targetType: operation === "create" ? "USER" : "SUPPORT_CASE",
      },
      { database, environment, request, now },
    );
    return Object.freeze({ status: "error", message: "Zu viele Anfragen in kurzer Zeit. Bitte versuche es später erneut." });
  }
  const result = operation === "create" ? await createSupportCase(input, { userId: user.id, status: user.status }, database, now) : await replyToSupportCase(input, { userId: user.id, status: user.status }, database, now);
  if (result === null || !result.ok) return Object.freeze({ status: "error", message: result === null ? "Unbekannte Aktion." : result.code === "CONFLICT" ? "Der Fall hat inzwischen einen anderen Status." : "Bitte prüfe deine Angaben." });
  revalidatePath("/support");
  if ("caseId" in result.value) revalidatePath(`/support/${result.value.caseId}`);
  revalidatePath("/admin/support");
  return Object.freeze({ status: "success", message: result.replay ? "Diese Antwort war bereits gespeichert." : operation === "create" ? "Support-Anfrage wurde erfasst." : "Antwort wurde gesendet." });
}
function value(formData: FormData, key: string) { const values = formData.getAll(key); return values.length === 1 && typeof values[0] === "string" ? values[0].trim() : null; }
