"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { ApplicationActionState } from "@/lib/applications/action-state";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  cancelInterview,
  respondToInterview,
} from "@/lib/recruiting/interviews";
import { resolveLocalDateTime } from "@/lib/recruiting/time-zones";

const GENERIC_ERROR =
  "Die Terminaktion konnte nicht sicher ausgeführt werden.";

export async function respondToCandidateInterviewAction(
  _state: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const dependencies = await candidateDependencies();
  if (dependencies === null) return fail();
  const kind = formData.get("kind");
  const times =
    kind === "RESCHEDULE"
      ? resolveRequestedTimes(formData)
      : { startsAt: undefined, endsAt: undefined, timeZone: undefined };
  if (times === null) {
    return fail(
      "Die gewünschte Zeit ist ungültig, mehrdeutig oder liegt in einer Sommerzeit-Lücke.",
    );
  }
  const result = await respondToInterview(
    {
      actorUserId: dependencies.user.id,
      interviewId: formData.get("interviewId"),
      kind,
      proposalId:
        kind === "RESCHEDULE" ? undefined : formData.get("proposalId"),
      requestedStartsAt: times.startsAt,
      requestedEndsAt: times.endsAt,
      requestedTimeZone: times.timeZone,
      expectedVersion: Number(formData.get("expectedVersion")),
      idempotencyKey: formData.get("idempotencyKey"),
    },
    dependencies,
  );
  if (!result.ok) return resultFailure(result.code);
  revalidateInterview(result.interviewId);
  return success(
    result.replay
      ? "Diese Antwort war bereits sicher gespeichert."
      : kind === "ACCEPT"
        ? "Termin bestätigt. Die Kalenderdatei ist jetzt verfügbar."
        : kind === "DECLINE"
          ? "Vorschlag abgelehnt."
          : "Neuer Termin vorgeschlagen.",
  );
}

export async function cancelCandidateInterviewAction(
  _state: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const dependencies = await candidateDependencies();
  if (dependencies === null) return fail();
  const result = await cancelInterview(
    {
      actorUserId: dependencies.user.id,
      interviewId: formData.get("interviewId"),
      expectedVersion: Number(formData.get("expectedVersion")),
      idempotencyKey: formData.get("idempotencyKey"),
    },
    dependencies,
  );
  if (!result.ok) return resultFailure(result.code);
  revalidateInterview(result.interviewId);
  return success(
    result.replay
      ? "Die Absage war bereits sicher gespeichert."
      : "Interview abgesagt; offene Erinnerungen wurden beendet.",
  );
}

async function candidateDependencies() {
  const [user, request] = await Promise.all([
    getCurrentUser(),
    getAuthRequestContext(),
  ]);
  if (user?.role !== "CANDIDATE" || !isValidAuthMutationOrigin(request)) {
    return null;
  }
  return Object.freeze({
    user,
    request,
    environment: getServerEnvironment(),
    database: getDatabase(),
    now: new Date(),
  });
}

function resolveRequestedTimes(formData: FormData) {
  const timeZone = String(formData.get("timeZone") ?? "");
  const startsAt = resolveLocalDateTime(
    String(formData.get("startsAtLocal") ?? ""),
    timeZone,
  );
  const endsAt = resolveLocalDateTime(
    String(formData.get("endsAtLocal") ?? ""),
    timeZone,
  );
  if (
    !startsAt.ok ||
    !endsAt.ok ||
    endsAt.instant <= startsAt.instant
  ) {
    return null;
  }
  return Object.freeze({
    startsAt: startsAt.instant,
    endsAt: endsAt.instant,
    timeZone,
  });
}

function resultFailure(code: string): ApplicationActionState {
  if (code === "CONFLICT" || code === "EXPIRED") {
    return fail(
      "Der Vorschlag wurde inzwischen geändert oder ist abgelaufen. Bitte lade die Seite neu.",
    );
  }
  if (code === "FEATURE_UNAVAILABLE") {
    return fail(
      "Neue Terminantworten sind vorübergehend deaktiviert. Eine bestehende Buchung kannst du weiterhin absagen.",
    );
  }
  return fail();
}

function revalidateInterview(interviewId: string) {
  revalidatePath("/candidate/interviews");
  revalidatePath(`/candidate/interviews/${interviewId}`);
}

function fail(message = GENERIC_ERROR): ApplicationActionState {
  return Object.freeze({ status: "error", message });
}

function success(message: string): ApplicationActionState {
  return Object.freeze({
    status: "success",
    message,
    nextIdempotencyKey: randomUUID(),
  });
}
