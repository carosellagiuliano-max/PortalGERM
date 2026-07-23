"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  abuseReportContentSchema,
  createResolvedAbuseReport,
} from "@/lib/abuse/public-report";
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
  resolveCandidateMessageReportTarget,
  sendCandidateMessage,
} from "@/lib/candidate/messages";
import { emailProvider } from "@/lib/providers/email";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";

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
  const environment = getServerEnvironment();
  const now = new Date();
  const rate = await consumeRequestRateLimit(
    "MESSAGE_SEND",
    { userId: user.id },
    request,
    now,
    { database, environment },
  );
  if (!rate.allowed) {
    await recordRateLimitDenial(
      rate.audit,
      {
        actorKind: "USER",
        actorUserId: user.id,
        capability: "CANDIDATE_MESSAGE_SEND",
        targetId: parsed.data.conversationId,
        targetType: "CONVERSATION",
      },
      { database, environment, request, now },
    );
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
      : result.code === "TRUST_BLOCKED"
        ? "Neue Nachrichten sind gesperrt, weil die Firma nicht aktiv und aktuell verifiziert ist. Bitte lade neu."
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

export async function reportCandidateMessageAction(
  _previousState: CandidateMessageActionState,
  formData: FormData,
): Promise<CandidateMessageActionState> {
  const [user, request] = await Promise.all([
    requireCandidatePage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return errorState("Die Meldung konnte nicht sicher bestätigt werden.");
  }
  const messageId = z.uuid().safeParse(formData.get("messageId"));
  const content = abuseReportContentSchema.safeParse({
    reasonCode: formData.get("reasonCode"),
    description: formData.get("description"),
  });
  if (!messageId.success || !content.success) {
    return errorState(
      "Bitte wähle einen Grund und beschreibe den Verdacht mit mindestens 20 Zeichen.",
    );
  }
  const database = getDatabase();
  const target = await resolveCandidateMessageReportTarget(
    database,
    user.id,
    messageId.data,
  );
  if (target === null) {
    return errorState("Die Meldung konnte nicht sicher erfasst werden.");
  }
  const result = await createResolvedAbuseReport(
    content.data,
    {
      id: target.id,
      targetType: "MESSAGE",
      companyId: target.companyId,
    },
    {
      database,
      environment: getServerEnvironment(),
      request,
      currentUser: user,
      emailProvider,
    },
  );
  if (!result.ok) {
    return errorState(
      result.code === "RATE_LIMITED"
        ? "Zu viele Meldungen in kurzer Zeit. Bitte versuche es später erneut."
        : "Die Meldung konnte nicht sicher erfasst werden.",
    );
  }
  revalidatePath(`/candidate/messages/${target.conversationId}`);
  revalidatePath("/admin/reports");
  return Object.freeze({
    status: "success",
    message: "Danke. Die Nachricht wurde sicher zur Prüfung gemeldet.",
    nextIdempotencyKey: randomUUID(),
  });
}

function errorState(message: string): CandidateMessageActionState {
  return Object.freeze({ status: "error", message });
}
