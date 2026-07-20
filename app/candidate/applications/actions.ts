"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  createPublicReport,
  publicReportInputSchema,
} from "@/lib/abuse/public-report";
import type { ApplicationActionState } from "@/lib/applications/action-state";
import {
  updateCandidateApplicationNote,
  withdrawCandidateApplication,
} from "@/lib/applications/candidate-commands";
import {
  candidateApplicationNoteSchema,
  candidateWithdrawApplicationSchema,
} from "@/lib/applications/contracts";
import { applyToJob } from "@/lib/applications/service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { emailProvider } from "@/lib/providers/email";

const GENERIC_ERROR = "Die Aktion konnte nicht sicher ausgeführt werden.";
const RATE_LIMIT_ERROR =
  "Zu viele Bewerbungsaktionen in kurzer Zeit. Bitte versuche es später erneut.";

export async function applyToJobAction(
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const [currentUser, request] = await Promise.all([
    getCurrentUser(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) return errorState(GENERIC_ERROR);
  const environment = getServerEnvironment();
  const result = await applyToJob(
    {
      signedIntent: formData.get("signedIntent"),
      coverLetter: formData.get("coverLetter"),
      selectedDocumentIds: formData
        .getAll("selectedDocumentIds")
        .filter((value): value is string => typeof value === "string"),
      confirmationVersion: formData.get("confirmationVersion"),
      confirmationSnapshotHash: formData.get("confirmationSnapshotHash"),
      confirmed: formData.get("confirmed") === "true",
      idempotencyKey: formData.get("idempotencyKey"),
    },
    {
      currentUser,
      request,
      environment,
      database: getDatabase(),
      emailProvider,
    },
  );
  if (result.ok) {
    revalidatePath("/candidate/applications");
    revalidatePath(`/candidate/applications/${result.applicationId}`);
    redirect(`/candidate/applications/${result.applicationId}?submitted=1`);
  }
  if (result.code === "ALREADY_APPLIED" && result.applicationId !== undefined) {
    redirect(`/candidate/applications/${result.applicationId}?duplicate=1`);
  }
  return errorState(applicationErrorMessage(result.code));
}

export async function updateCandidateApplicationNoteAction(
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const dependencies = await commandDependencies();
  if (dependencies === null) return errorState(GENERIC_ERROR);
  const parsed = candidateApplicationNoteSchema.safeParse({
    applicationId: formData.get("applicationId"),
    body: formData.get("body"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) {
    return errorState("Bitte gib eine private Notiz mit höchstens 1'000 Zeichen ein.");
  }
  const rate = await consumeRequestRateLimit(
    "APPLICATION_CANDIDATE_MUTATION",
    { userId: dependencies.currentUser.id },
    dependencies.request,
    new Date(),
    { database: dependencies.database, environment: dependencies.environment },
  );
  if (!rate.allowed) return errorState(RATE_LIMIT_ERROR);
  const result = await updateCandidateApplicationNote(parsed.data, dependencies);
  if (!result.ok) {
    return errorState(
      result.code === "INVALID_INPUT"
        ? "Bitte gib eine private Notiz mit höchstens 1'000 Zeichen ein."
        : GENERIC_ERROR,
    );
  }
  revalidatePath(`/candidate/applications/${result.applicationId}`);
  revalidatePath("/candidate/applications");
  return successState("Deine private Notiz wurde gespeichert.");
}

export async function withdrawCandidateApplicationAction(
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const dependencies = await commandDependencies();
  if (dependencies === null) return errorState(GENERIC_ERROR);
  const parsed = candidateWithdrawApplicationSchema.safeParse({
    applicationId: formData.get("applicationId"),
    confirmed: formData.get("confirmed") === "true",
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) return errorState(GENERIC_ERROR);
  const rate = await consumeRequestRateLimit(
    "APPLICATION_CANDIDATE_MUTATION",
    { userId: dependencies.currentUser.id },
    dependencies.request,
    new Date(),
    { database: dependencies.database, environment: dependencies.environment },
  );
  if (!rate.allowed) return errorState(RATE_LIMIT_ERROR);
  const result = await withdrawCandidateApplication(parsed.data, dependencies);
  if (!result.ok) {
    return errorState(
      result.code === "CONFLICT"
        ? "Diese Bewerbung kann in ihrem aktuellen Status nicht zurückgezogen werden."
        : GENERIC_ERROR,
    );
  }
  revalidatePath(`/candidate/applications/${result.applicationId}`);
  revalidatePath("/candidate/applications");
  return successState("Die Bewerbung wurde zurückgezogen.");
}

export async function reportApplicationEmployerAction(
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const dependencies = await commandDependencies();
  if (dependencies === null) return errorState(GENERIC_ERROR);
  const applicationId = z.uuid().safeParse(formData.get("applicationId"));
  if (!applicationId.success) return errorState(GENERIC_ERROR);
  const database = getDatabase();
  const application = await database.application.findFirst({
    where: {
      id: applicationId.data,
      candidateProfile: { userId: dependencies.currentUser!.id },
    },
    select: {
      job: {
        select: {
          company: { select: { id: true, slug: true } },
        },
      },
    },
  });
  if (application === null) return errorState(GENERIC_ERROR);
  const parsed = publicReportInputSchema.safeParse({
    targetType: "COMPANY",
    slug: application.job.company.slug,
    reasonCode: formData.get("reasonCode"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return errorState(
      "Bitte wähle einen Grund und beschreibe den Verdacht mit mindestens 20 Zeichen.",
    );
  }
  const now = new Date();
  const precheck = await consumeRequestRateLimit(
    "ABUSE_INTAKE_PRECHECK",
    { actorId: dependencies.currentUser!.id },
    dependencies.request,
    now,
    { database, environment: dependencies.environment },
  );
  if (!precheck.allowed) {
    return errorState("Zu viele Meldungen in kurzer Zeit. Bitte versuche es später erneut.");
  }
  const result = await createPublicReport(
    parsed.data,
    {
      id: application.job.company.id,
      targetType: "COMPANY",
      companyId: application.job.company.id,
    },
    { ...dependencies, now },
  );
  return result.ok
    ? successState("Danke. Deine Meldung wurde erfasst und wird geprüft.")
    : errorState(
        result.code === "RATE_LIMITED"
          ? "Zu viele Meldungen in kurzer Zeit. Bitte versuche es später erneut."
          : GENERIC_ERROR,
      );
}

async function commandDependencies() {
  const [currentUser, request] = await Promise.all([
    getCurrentUser(),
    getAuthRequestContext(),
  ]);
  if (
    currentUser?.role !== "CANDIDATE" ||
    !isValidAuthMutationOrigin(request)
  ) return null;
  return Object.freeze({
    currentUser,
    request,
    environment: getServerEnvironment(),
    database: getDatabase(),
  });
}

function applicationErrorMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    INVALID_INPUT: "Bitte prüfe deine Angaben und versuche es erneut.",
    INVALID_INTENT: "Der Bewerbungslink ist abgelaufen. Bitte starte erneut von der Stellenseite.",
    RATE_LIMITED: "Zu viele Bewerbungsversuche. Bitte versuche es später erneut.",
    NOT_ELIGIBLE: "Diese Stelle ist nicht mehr für Bewerbungen verfügbar.",
    PROFILE_IDENTITY_REQUIRED:
      "Bitte ergänze zuerst Vor- und Nachname im SwissJobPass.",
    CONFIRMATION_CHANGED:
      "Die Empfänger- oder Stellendaten haben sich geändert. Bitte lade die Seite neu und bestätige erneut.",
    DOCUMENT_REQUIRED: "Bitte wähle genau einen aktiven Lebenslauf aus.",
    COVER_LETTER_REQUIRED: "Für diese Stelle ist ein Motivationsschreiben erforderlich.",
    UNSUPPORTED_REQUIREMENTS:
      "Die Unterlagenanforderungen dieser Stelle werden intern noch nicht unterstützt.",
    EXTERNAL_APPLICATION: "Diese Bewerbung wird sicher auf der Arbeitgeberseite fortgesetzt.",
    IDEMPOTENCY_CONFLICT: "Die Anfrage konnte nicht eindeutig zugeordnet werden. Bitte lade die Seite neu.",
  };
  return messages[code] ?? GENERIC_ERROR;
}

function errorState(message: string): ApplicationActionState {
  return Object.freeze({ status: "error", message });
}

function successState(message: string): ApplicationActionState {
  return Object.freeze({
    status: "success",
    message,
    nextIdempotencyKey: randomUUID(),
  });
}
