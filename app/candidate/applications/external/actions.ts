"use server";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ApplicationActionState } from "@/lib/applications/action-state";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  EXTERNAL_APPLICATION_RESUME_POLICY_V1,
  verifyExternalApplicationResumeIntent,
} from "@/lib/recruiting/external-application-intent";
import {
  createExternalApplicationTracker,
  setExternalApplicationReminder,
  transitionExternalApplicationTracker,
} from "@/lib/recruiting/external-tracker";
import { resolveLocalDateTime } from "@/lib/recruiting/time-zones";

const GENERIC_ERROR =
  "Der externe Bewerbungsverlauf konnte nicht sicher aktualisiert werden.";

export async function createExternalTrackerAction(
  _state: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const dependencies = await candidateDependencies();
  if (dependencies === null) return error(GENERIC_ERROR);
  const cookieStore = await cookies();
  const intent = verifyExternalApplicationResumeIntent(
    cookieStore.get(EXTERNAL_APPLICATION_RESUME_POLICY_V1.cookieName)?.value,
    dependencies.now,
    dependencies.environment.secrets.session,
  );
  if (intent === null) {
    return error(
      "Der Wiederaufnahme-Link ist abgelaufen. Öffne die externe Stelle erneut.",
    );
  }
  const result = await createExternalApplicationTracker(
    {
      candidateUserId: dependencies.user.id,
      jobId: intent.jobId,
      jobRevisionId: intent.jobRevisionId,
      idempotencyKey: formData.get("idempotencyKey"),
    },
    dependencies,
  );
  if (!result.ok) {
    return error(
      result.code === "FEATURE_UNAVAILABLE"
        ? "Die freiwillige externe Verlaufserfassung ist derzeit nicht verfügbar."
        : GENERIC_ERROR,
    );
  }
  cookieStore.delete(EXTERNAL_APPLICATION_RESUME_POLICY_V1.cookieName);
  revalidatePath("/candidate/applications/external");
  redirect(`/candidate/applications/external/${result.trackerId}?created=1`);
}

export async function transitionExternalTrackerAction(
  _state: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const dependencies = await candidateDependencies();
  if (dependencies === null) return error(GENERIC_ERROR);
  const result = await transitionExternalApplicationTracker(
    {
      candidateUserId: dependencies.user.id,
      trackerId: formData.get("trackerId"),
      nextStatus: formData.get("nextStatus"),
      expectedVersion: Number(formData.get("expectedVersion")),
      idempotencyKey: formData.get("idempotencyKey"),
    },
    dependencies,
  );
  if (!result.ok) {
    return error(
      result.code === "CONFLICT"
        ? "Der Verlauf wurde inzwischen geändert. Bitte lade die Seite neu."
        : result.code === "INVALID_TRANSITION"
          ? "Dieser Statuswechsel ist nicht erlaubt."
          : GENERIC_ERROR,
    );
  }
  revalidateExternal(result.trackerId);
  return success(
    result.replay
      ? "Diese Änderung war bereits sicher gespeichert."
      : "Status als eigene Angabe gespeichert.",
    result.version,
  );
}

export async function setExternalTrackerReminderAction(
  _state: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const dependencies = await candidateDependencies();
  if (dependencies === null) return error(GENERIC_ERROR);
  const remove = formData.get("removeReminder") === "true";
  const localValue = String(formData.get("reminderAtLocal") ?? "");
  const timeZone = String(formData.get("timeZone") ?? "");
  let reminderAt: Date | null = null;
  if (!remove) {
    const resolved = resolveLocalDateTime(localValue, timeZone);
    if (!resolved.ok) {
      return error(
        "Bitte wähle eine eindeutige, zukünftige Zeit. Wechselstunden der Sommerzeit werden aus Sicherheitsgründen nicht geraten.",
      );
    }
    reminderAt = resolved.instant;
  }
  const result = await setExternalApplicationReminder(
    {
      candidateUserId: dependencies.user.id,
      trackerId: formData.get("trackerId"),
      reminderAt,
      expectedVersion: Number(formData.get("expectedVersion")),
      idempotencyKey: formData.get("idempotencyKey"),
    },
    dependencies,
  );
  if (!result.ok) {
    return error(
      result.code === "CONFLICT"
        ? "Der Verlauf wurde inzwischen geändert. Bitte lade die Seite neu."
        : GENERIC_ERROR,
    );
  }
  revalidateExternal(result.trackerId);
  return success(
    remove ? "Erinnerung entfernt." : "Freiwillige Erinnerung gespeichert.",
    result.version,
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

function revalidateExternal(trackerId: string) {
  revalidatePath("/candidate/applications/external");
  revalidatePath(`/candidate/applications/external/${trackerId}`);
}

function error(message: string): ApplicationActionState {
  return Object.freeze({ status: "error", message });
}

function success(message: string, version?: number): ApplicationActionState {
  return Object.freeze({
    status: "success",
    message,
    nextIdempotencyKey: randomUUID(),
    ...(version === undefined ? {} : { values: { version: String(version) } }),
  } as ApplicationActionState);
}
