"use server";

import { revalidatePath } from "next/cache";

import type { SupportActionState } from "@/app/support/action-state";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { getDatabase } from "@/lib/db/client";
import { createSupportCase, replyToSupportCase } from "@/lib/admin/support";

export async function supportCaseAction(_previous: SupportActionState, formData: FormData): Promise<SupportActionState> {
  const [user, request] = await Promise.all([getCurrentUser(), getAuthRequestContext()]);
  if (user === null || !isValidAuthMutationOrigin(request)) return Object.freeze({ status: "error", message: "Bitte melde dich erneut an." });
  const operation = value(formData, "operation");
  const input = Object.fromEntries([...formData.entries()].filter(([key]) => !key.startsWith("$ACTION_") && key !== "operation").map(([key, entry]) => [key, typeof entry === "string" && entry.trim() === "" ? null : entry]));
  const result = operation === "create" ? await createSupportCase(input, { userId: user.id, status: user.status }, getDatabase()) : operation === "reply" ? await replyToSupportCase(input, { userId: user.id, status: user.status }, getDatabase()) : null;
  if (result === null || !result.ok) return Object.freeze({ status: "error", message: result === null ? "Unbekannte Aktion." : result.code === "CONFLICT" ? "Der Fall hat inzwischen einen anderen Status." : "Bitte prüfe deine Angaben." });
  revalidatePath("/support");
  if ("caseId" in result.value) revalidatePath(`/support/${result.value.caseId}`);
  revalidatePath("/admin/support");
  return Object.freeze({ status: "success", message: result.replay ? "Diese Antwort war bereits gespeichert." : operation === "create" ? "Support-Anfrage wurde erfasst." : "Antwort wurde gesendet." });
}
function value(formData: FormData, key: string) { const values = formData.getAll(key); return values.length === 1 && typeof values[0] === "string" ? values[0].trim() : null; }
