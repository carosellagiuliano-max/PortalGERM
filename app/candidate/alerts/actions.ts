"use server";

import { revalidatePath } from "next/cache";

import type { JobAlertActionState } from "@/app/candidate/alerts/action-state";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import {
  JobAlertActionError,
  createJobAlert,
  deleteJobAlert,
  grantJobAlertDeliveryConsent,
  pauseJobAlert,
  resumeJobAlert,
  revokeJobAlertDeliveryConsentGlobally,
  runJobAlertDigestMock,
  updateJobAlert,
} from "@/lib/candidate/job-alerts";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";

export async function createJobAlertAction(
  _previous: JobAlertActionState,
  formData: FormData,
): Promise<JobAlertActionState> {
  const security = await secureCandidateMutation();
  if (!security.ok) return security.state;
  const command = readAlertForm(formData);
  if (command === null) return invalidFormState();
  try {
    await createJobAlert(command, {
      actorUserId: security.userId,
      correlationId: security.correlationId,
      now: new Date(),
    });
    revalidateAlertPaths();
    return successState(
      command.active
        ? "Jobabo erstellt und ausdrücklich aktiviert."
        : "Jobabo als pausierter Entwurf erstellt.",
    );
  } catch (error) {
    return domainErrorState(error);
  }
}

export async function updateJobAlertAction(
  jobAlertId: string,
  _previous: JobAlertActionState,
  formData: FormData,
): Promise<JobAlertActionState> {
  const security = await secureCandidateMutation();
  if (!security.ok) return security.state;
  const command = readAlertForm(formData);
  if (command === null) return invalidFormState();
  try {
    await updateJobAlert(jobAlertId, command, {
      actorUserId: security.userId,
      correlationId: security.correlationId,
      now: new Date(),
    });
    revalidateAlertPaths();
    return successState("Jobabo gespeichert.");
  } catch (error) {
    return domainErrorState(error);
  }
}

export async function pauseJobAlertAction(
  jobAlertId: string,
  _previous: JobAlertActionState,
  formData: FormData,
): Promise<JobAlertActionState> {
  return lifecycleAction(jobAlertId, "pause", formData);
}

export async function resumeJobAlertAction(
  jobAlertId: string,
  _previous: JobAlertActionState,
  formData: FormData,
): Promise<JobAlertActionState> {
  return lifecycleAction(jobAlertId, "resume", formData);
}

export async function deleteJobAlertAction(
  jobAlertId: string,
  _previous: JobAlertActionState,
  formData: FormData,
): Promise<JobAlertActionState> {
  const security = await secureCandidateMutation();
  if (!security.ok) return security.state;
  if (!isEmptyForm(formData)) return invalidFormState();
  try {
    await deleteJobAlert(jobAlertId, {
      actorUserId: security.userId,
      correlationId: security.correlationId,
      now: new Date(),
    });
    revalidateAlertPaths();
    return successState("Jobabo gelöscht.");
  } catch (error) {
    return domainErrorState(error);
  }
}

export async function grantJobAlertDeliveryAction(
  _previous: JobAlertActionState,
  formData: FormData,
): Promise<JobAlertActionState> {
  const security = await secureCandidateMutation();
  if (!security.ok) return security.state;
  if (!isEmptyForm(formData)) return invalidFormState();
  try {
    await grantJobAlertDeliveryConsent({
      actorUserId: security.userId,
      correlationId: security.correlationId,
      now: new Date(),
    });
    revalidateAlertPaths();
    return successState(
      "Service-Zustellung freigegeben. Pausierte Jobabos bleiben pausiert, bis du sie einzeln aktivierst.",
    );
  } catch (error) {
    return domainErrorState(error);
  }
}

export async function revokeJobAlertDeliveryAction(
  _previous: JobAlertActionState,
  formData: FormData,
): Promise<JobAlertActionState> {
  const security = await secureCandidateMutation();
  if (!security.ok) return security.state;
  if (!isEmptyForm(formData)) return invalidFormState();
  try {
    const result = await revokeJobAlertDeliveryConsentGlobally({
      actorUserId: security.userId,
      correlationId: security.correlationId,
      now: new Date(),
    });
    revalidateAlertPaths();
    return successState(
      `Service-Zustellung widerrufen. ${result.pausedAlertCount} aktive Jobabos wurden pausiert.`,
    );
  } catch (error) {
    return domainErrorState(error);
  }
}

export async function runJobAlertDigestMockAction(
  jobAlertId: string,
  _previous: JobAlertActionState,
  formData: FormData,
): Promise<JobAlertActionState> {
  const security = await secureCandidateMutation();
  if (!security.ok) return security.state;
  if (!isEmptyForm(formData)) return invalidFormState();
  try {
    const result = await runJobAlertDigestMock({
      now: new Date(),
      alertId: jobAlertId,
      candidateUserId: security.userId,
    });
    revalidateAlertPaths();
    const digest = result.completed[0];
    return successState(
      digest === undefined
        ? "Dieses Jobabo ist noch nicht fällig, pausiert oder nicht für die Zustellung freigegeben. Es wurde kein Mock-Eintrag erzeugt."
        : `Mock-Digest mit ${digest.itemCount} neuen Stellen sicher erfasst.`,
    );
  } catch (error) {
    return domainErrorState(error);
  }
}

async function lifecycleAction(
  jobAlertId: string,
  command: "pause" | "resume",
  formData: FormData,
): Promise<JobAlertActionState> {
  const security = await secureCandidateMutation();
  if (!security.ok) return security.state;
  if (!isEmptyForm(formData)) return invalidFormState();
  try {
    if (command === "pause") {
      await pauseJobAlert(jobAlertId, {
        actorUserId: security.userId,
        correlationId: security.correlationId,
        now: new Date(),
      });
    } else {
      await resumeJobAlert(jobAlertId, {
        actorUserId: security.userId,
        correlationId: security.correlationId,
        now: new Date(),
      });
    }
    revalidateAlertPaths();
    return successState(
      command === "pause"
        ? "Jobabo pausiert."
        : "Jobabo ausdrücklich aktiviert.",
    );
  } catch (error) {
    return domainErrorState(error);
  }
}

async function secureCandidateMutation() {
  const [user, request] = await Promise.all([
    requireCandidatePage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({ ok: false as const, state: unsafeRequestState() });
  }
  const database = getDatabase();
  const environment = getServerEnvironment();
  const now = new Date();
  const rate = await consumeRequestRateLimit(
    "JOB_ALERT_MUTATION",
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
        capability: "CANDIDATE_JOB_ALERT_MUTATE",
        targetId: user.id,
        targetType: "USER",
      },
      { database, environment, request, now },
    );
    return Object.freeze({
      ok: false as const,
      state: errorState(
        "Zu viele Jobabo-Aktionen in kurzer Zeit. Bitte versuche es später erneut.",
      ),
    });
  }
  return Object.freeze({
    ok: true as const,
    userId: user.id,
    correlationId: request.correlationId,
  });
}

function readAlertForm(formData: FormData) {
  const fields = [
    "keyword",
    "cantonId",
    "cityId",
    "radiusKm",
    "categoryId",
    "workloadMin",
    "workloadMax",
    "salaryTransparentOnly",
    "remotePreference",
    "frequency",
    "active",
    "deliveryConsentAccepted",
  ] as const;
  const allowed = new Set<string>(fields);
  if (
    [...formData.keys()].some(
      (field) => !field.startsWith("$ACTION_") && !allowed.has(field),
    )
  )
    return null;
  const values = Object.fromEntries(
    fields.map((field) => [field, formData.getAll(field)]),
  ) as Record<(typeof fields)[number], FormDataEntryValue[]>;
  if (
    fields.some(
      (field) =>
        values[field].length > 1 ||
        values[field].some((value) => typeof value !== "string"),
    )
  ) {
    return null;
  }
  const text = (field: (typeof fields)[number]) =>
    String(values[field][0] ?? "").trim();
  const checked = (
    field: "salaryTransparentOnly" | "active" | "deliveryConsentAccepted",
  ) => values[field].length === 1 && values[field][0] === "true";
  if (
    ["salaryTransparentOnly", "active", "deliveryConsentAccepted"].some(
      (field) => {
        const entries = values[field as keyof typeof values];
        return entries.length === 1 && entries[0] !== "true";
      },
    )
  ) {
    return null;
  }
  return {
    active: checked("active"),
    deliveryConsentAccepted: checked("deliveryConsentAccepted"),
    frequency: text("frequency"),
    query: {
      keyword: text("keyword"),
      cantonId: text("cantonId") || null,
      cityId: text("cityId") || null,
      radiusKm: Number(text("radiusKm")),
      categoryId: text("categoryId") || null,
      workloadMin: Number(text("workloadMin")),
      workloadMax: Number(text("workloadMax")),
      salaryTransparentOnly: checked("salaryTransparentOnly"),
      remotePreference: text("remotePreference"),
    },
  };
}

function isEmptyForm(formData: FormData) {
  return [...formData.keys()].every((field) => field.startsWith("$ACTION_"));
}

function domainErrorState(error: unknown): JobAlertActionState {
  if (error instanceof JobAlertActionError) {
    switch (error.code) {
      case "CONSENT_REQUIRED":
        return errorState(
          "Aktiviere zuerst die separate Service-Zustellung. Die Marketing-Einstellung bleibt davon unberührt.",
        );
      case "REFERENCE_INVALID":
        return errorState(
          "Ein ausgewählter Ort oder eine Kategorie ist nicht mehr verfügbar.",
        );
      case "INVALID_INPUT":
        return invalidFormState();
      case "LIMIT_REACHED":
        return errorState(
          "Du kannst höchstens 50 aktive oder pausierte Jobabos verwalten.",
        );
      case "NOT_FOUND":
        return errorState("Dieses Jobabo ist nicht verfügbar.");
    }
  }
  return errorState(
    "Die Änderung konnte nicht gespeichert werden. Bitte versuche es nochmals.",
  );
}

function invalidFormState(): JobAlertActionState {
  return errorState(
    "Bitte prüfe die Filter, das Pensum und den Zustellrhythmus.",
  );
}

function unsafeRequestState(): JobAlertActionState {
  return errorState(
    "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.",
  );
}

function errorState(message: string): JobAlertActionState {
  return Object.freeze({ status: "error", message });
}

function successState(message: string): JobAlertActionState {
  return Object.freeze({ status: "success", message });
}

function revalidateAlertPaths() {
  revalidatePath("/candidate/alerts");
  revalidatePath("/candidate/dashboard");
}
