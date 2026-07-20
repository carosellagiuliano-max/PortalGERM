"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { getServerEnvironment } from "@/lib/config/env";
import type { CandidateMessageActionState } from "@/lib/candidate/message-action-state";
import {
  candidateMessageInputSchema,
  markCandidateConversationRead,
  sendCandidateMessage,
} from "@/lib/candidate/messages";

export async function sendCandidateMessageAction(
  _previousState: CandidateMessageActionState,
  formData: FormData,
): Promise<CandidateMessageActionState> {
  const [user, request] = await Promise.all([
    requireCandidatePage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return errorState("Die Anfrage konnte nicht sicher bestätigt werden.");
  }
  const parsed = candidateMessageInputSchema.safeParse({
    conversationId: String(formData.get("conversationId") ?? ""),
    body: String(formData.get("body") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  });
  if (!parsed.success) {
    return errorState("Bitte gib eine Nachricht mit höchstens 5.000 Zeichen ein.");
  }
  const database = getDatabase();
  const rate = await consumeRequestRateLimit(
    "MESSAGE_SEND",
    { userId: user.id },
    request,
    new Date(),
    { database, environment: getServerEnvironment() },
  );
  if (!rate.allowed) {
    return errorState("Zu viele Nachrichten in kurzer Zeit. Bitte versuche es später erneut.");
  }
  const conversationId = parsed.data.conversationId;
  const result = await sendCandidateMessage(database, user.id, {
    conversationId,
    body: parsed.data.body,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  if (result.ok) {
    revalidatePath(`/candidate/messages/${conversationId}`);
    revalidatePath("/candidate/messages");
    revalidatePath("/candidate/dashboard");
    return Object.freeze({
      status: "success",
      message: result.duplicate
        ? "Diese Nachricht wurde bereits sicher gesendet."
        : "Nachricht gesendet.",
      nextIdempotencyKey: randomUUID(),
    });
  }
  return errorState(
    result.code === "NOT_FOUND"
      ? "Dieses Gespräch ist nicht mehr verfügbar."
      : result.code === "CONFLICT"
        ? "Die Anfrage steht im Konflikt mit einer früheren Übermittlung. Bitte lade neu."
        : "Die Nachricht konnte nicht gesendet werden.",
  );
}

export async function markCandidateConversationReadAction(formData: FormData) {
  const [user, request] = await Promise.all([
    requireCandidatePage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) return;
  const conversationId = String(formData.get("conversationId") ?? "");
  if (await markCandidateConversationRead(getDatabase(), user.id, conversationId)) {
    revalidatePath(`/candidate/messages/${conversationId}`);
    revalidatePath("/candidate/messages");
    revalidatePath("/candidate/dashboard");
  }
}

function errorState(message: string): CandidateMessageActionState {
  return Object.freeze({ status: "error", message });
}
