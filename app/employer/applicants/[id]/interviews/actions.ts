"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getEmployerContext } from "@/lib/auth/employer-context";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { EmployerActionState } from "@/lib/employer/action-state";
import {
  cancelInterview,
  proposeInterview,
  respondToInterview,
} from "@/lib/recruiting/interviews";
import { resolveLocalDateTime } from "@/lib/recruiting/time-zones";

const GENERIC_ERROR =
  "Die Interviewplanung konnte nicht sicher aktualisiert werden.";

export async function proposeEmployerInterviewAction(
  _state: EmployerActionState,
  formData: FormData,
): Promise<EmployerActionState> {
  const dependencies = await employerDependencies();
  if (dependencies === null) return fail();
  const slots = resolveSlots(formData);
  if (slots === null) {
    return fail(
      "Mindestens ein vollständiger, eindeutiger und zukünftiger Terminvorschlag ist erforderlich.",
    );
  }
  const result = await proposeInterview(
    dependencies.access,
    {
      applicationId: formData.get("applicationId"),
      timeZone: formData.get("timeZone"),
      subject: formData.get("subject"),
      location: optional(formData.get("location")),
      slots,
      idempotencyKey: formData.get("idempotencyKey"),
    },
    dependencies,
  );
  if (!result.ok) return resultFailure(result.code);
  revalidateInterviews(String(formData.get("applicationId") ?? ""), result.interviewId);
  return success(
    result.replay
      ? "Dieser Vorschlag war bereits sicher gespeichert."
      : "Terminvorschläge gesendet. Noch ist kein Termin bestätigt.",
  );
}

export async function respondToEmployerInterviewAction(
  _state: EmployerActionState,
  formData: FormData,
): Promise<EmployerActionState> {
  const dependencies = await employerDependencies();
  if (dependencies === null) return fail();
  const kind = formData.get("kind");
  const requested =
    kind === "RESCHEDULE"
      ? resolveSingleSlot(formData)
      : { startsAt: undefined, endsAt: undefined, timeZone: undefined };
  if (requested === null) {
    return fail("Der neue Terminvorschlag ist zeitlich nicht eindeutig.");
  }
  const result = await respondToInterview(
    {
      actorUserId: dependencies.access.userId,
      interviewId: formData.get("interviewId"),
      kind,
      proposalId:
        kind === "RESCHEDULE" ? undefined : formData.get("proposalId"),
      requestedStartsAt: requested.startsAt,
      requestedEndsAt: requested.endsAt,
      requestedTimeZone: requested.timeZone,
      expectedVersion: Number(formData.get("expectedVersion")),
      idempotencyKey: formData.get("idempotencyKey"),
    },
    dependencies,
  );
  if (!result.ok) return resultFailure(result.code);
  revalidateInterviews(
    String(formData.get("applicationId") ?? ""),
    result.interviewId,
  );
  return success(
    result.replay
      ? "Diese Antwort war bereits sicher gespeichert."
      : kind === "ACCEPT"
        ? "Termin bestätigt."
        : kind === "DECLINE"
          ? "Vorschlag abgelehnt."
          : "Neuer Termin vorgeschlagen.",
  );
}

export async function cancelEmployerInterviewAction(
  _state: EmployerActionState,
  formData: FormData,
): Promise<EmployerActionState> {
  const dependencies = await employerDependencies();
  if (dependencies === null) return fail();
  const result = await cancelInterview(
    {
      actorUserId: dependencies.access.userId,
      interviewId: formData.get("interviewId"),
      expectedVersion: Number(formData.get("expectedVersion")),
      idempotencyKey: formData.get("idempotencyKey"),
    },
    dependencies,
  );
  if (!result.ok) return resultFailure(result.code);
  revalidateInterviews(
    String(formData.get("applicationId") ?? ""),
    result.interviewId,
  );
  return success(
    result.replay
      ? "Die Absage war bereits sicher gespeichert."
      : "Interview abgesagt; aktive Erinnerungen und Kalendereinladungen wurden beendet.",
  );
}

async function employerDependencies() {
  const [context, request] = await Promise.all([
    getEmployerContext(),
    getAuthRequestContext(),
  ]);
  const current = context?.current;
  if (
    context === null ||
    current === null ||
    current === undefined ||
    current.membershipRole === "VIEWER" ||
    !isValidAuthMutationOrigin(request)
  ) {
    return null;
  }
  return Object.freeze({
    access: {
      companyId: current.companyId,
      membershipId: current.membershipId,
      userId: context.user.id,
      membershipRole: current.membershipRole,
    },
    request,
    environment: getServerEnvironment(),
    database: getDatabase(),
    now: new Date(),
  });
}

function resolveSlots(formData: FormData) {
  const timeZone = String(formData.get("timeZone") ?? "");
  const starts = formData.getAll("slotStartsAtLocal").map(String);
  const ends = formData.getAll("slotEndsAtLocal").map(String);
  if (starts.length !== ends.length) return null;
  const slots = starts.flatMap((start, index) => {
    const end = ends[index] ?? "";
    if (start.trim() === "" && end.trim() === "") return [];
    const resolvedStart = resolveLocalDateTime(start, timeZone);
    const resolvedEnd = resolveLocalDateTime(end, timeZone);
    return resolvedStart.ok &&
      resolvedEnd.ok &&
      resolvedEnd.instant > resolvedStart.instant
      ? [{ startsAt: resolvedStart.instant, endsAt: resolvedEnd.instant }]
      : [null];
  });
  return slots.length > 0 && slots.every((slot) => slot !== null)
    ? slots
    : null;
}

function resolveSingleSlot(formData: FormData) {
  const timeZone = String(formData.get("timeZone") ?? "");
  const startsAt = resolveLocalDateTime(
    String(formData.get("startsAtLocal") ?? ""),
    timeZone,
  );
  const endsAt = resolveLocalDateTime(
    String(formData.get("endsAtLocal") ?? ""),
    timeZone,
  );
  return startsAt.ok && endsAt.ok && endsAt.instant > startsAt.instant
    ? Object.freeze({
        startsAt: startsAt.instant,
        endsAt: endsAt.instant,
        timeZone,
      })
    : null;
}

function optional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text === "" ? undefined : text;
}

function resultFailure(code: string): EmployerActionState {
  if (code === "CONFLICT" || code === "EXPIRED") {
    return fail(
      "Der Termin wurde inzwischen geändert oder ist abgelaufen. Bitte lade die Seite neu.",
    );
  }
  if (code === "FEATURE_UNAVAILABLE") {
    return fail(
      "Neue Interviewaktionen sind vorübergehend deaktiviert. Bestehende Termine können weiterhin abgesagt werden.",
    );
  }
  return fail();
}

function revalidateInterviews(applicationId: string, interviewId: string) {
  revalidatePath(`/employer/applicants/${applicationId}`);
  revalidatePath(`/employer/applicants/${applicationId}/interviews`);
  revalidatePath(
    `/employer/applicants/${applicationId}/interviews/${interviewId}`,
  );
  revalidatePath("/candidate/interviews");
  revalidatePath(`/candidate/interviews/${interviewId}`);
}

function fail(message = GENERIC_ERROR): EmployerActionState {
  return Object.freeze({ status: "error", message });
}

function success(message: string): EmployerActionState {
  return Object.freeze({
    status: "success",
    message,
    nextIdempotencyKey: randomUUID(),
  });
}
