"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import {
  CandidateProfileConflictError,
  CandidateProfileReferenceError,
  CandidateProfileUnavailableError,
  completeOwnedCandidateOnboarding,
  saveOwnedCandidateProfile,
  setOwnedTalentRadarVisibility,
  type CandidateProfileActionState,
} from "@/lib/candidate/profile";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  CANDIDATE_LANGUAGE_CODES,
  swissJobPassSchema,
} from "@/lib/validation/candidate";

const FIELD_MESSAGES = Object.freeze({
  firstName: "Bitte prüfe den Vornamen.",
  lastName: "Bitte prüfe den Nachnamen.",
  publicDisplayName: "Der öffentliche Anzeigename benötigt 2 bis 160 Zeichen.",
  phone: "Bitte prüfe die optionale Telefonnummer.",
  cantonId: "Bitte wähle einen gültigen Kanton.",
  cityLabel: "Der Ort benötigt 2 bis 160 Zeichen.",
  summary: "Die Zusammenfassung darf höchstens 500 Zeichen enthalten.",
  desiredTitles: "Bitte verwende höchstens 12 eindeutige Wunschberufe.",
  skillIds: "Bitte wähle gültige, eindeutige Kompetenzen.",
  languages: "Bitte prüfe Sprachen und Niveaus.",
  categoryIds: "Bitte wähle gültige, eindeutige Kategorien.",
  workloadMin: "Bitte prüfe das minimale Pensum.",
  workloadMax: "Das maximale Pensum muss zum Minimum passen.",
  desiredSalaryMin: "Bitte prüfe den minimalen Wunschlohn.",
  desiredSalaryMax: "Der maximale Wunschlohn muss zum Minimum passen.",
  desiredSalaryPeriod: "Lohnminimum, -maximum und Periode gehören zusammen.",
  jobTypes: "Bitte prüfe die bevorzugten Anstellungsarten.",
  remotePreference: "Bitte wähle eine Remote-Präferenz.",
  mobilityRadiusKm: "Der Mobilitätsradius muss zwischen 0 und 300 km liegen.",
  availabilityDate: "Bitte prüfe das Verfügbarkeitsdatum.",
  workPermitType: "Bitte wähle einen gültigen Bewilligungstyp.",
  cv: "CV-Metadaten müssen zu PDF, PNG, JPEG oder WebP mit maximal 5 MB gehören.",
  removeCv: "Ein CV kann nicht gleichzeitig ersetzt und entfernt werden.",
} as const);

export async function saveCandidateProfileAction(
  _previous: CandidateProfileActionState,
  formData: FormData,
): Promise<CandidateProfileActionState> {
  const security = await secureCandidateProfileMutation();
  if (!security.ok) return security.state;

  const revision = profileRevisionSchema.safeParse(singleString(formData, "revision"));
  if (!revision.success) {
    return Object.freeze({
      status: "error" as const,
      code: "PROFILE_CONFLICT" as const,
      message:
        "Die Profilversion konnte nicht sicher bestätigt werden. Lade den SwissJobPass neu und versuche es nochmals.",
    });
  }

  const parsed = swissJobPassSchema.safeParse(readProfileForm(formData));
  if (!parsed.success) {
    return Object.freeze({
      status: "error" as const,
      message: "Bitte prüfe die markierten Profilangaben.",
      fieldErrors: zodFieldErrors(parsed.error.issues),
    });
  }

  try {
    const result = await saveOwnedCandidateProfile(security.database, {
      actorUserId: security.userId,
      correlationId: security.correlationId,
      expectedUpdatedAt: new Date(revision.data),
      now: security.now,
      profile: parsed.data,
    });
    revalidateCandidateProfilePaths();
    return Object.freeze({
      status: "success" as const,
      message: result.reopened
        ? "SwissJobPass gespeichert. Weil eine Pflichtangabe entfernt wurde, ist das Profil wieder ein Entwurf und im Talent Radar pausiert. Ergänze die Angaben und schliesse es erneut ab."
        : result.consentChanged
          ? "SwissJobPass und deine ausdrückliche Talent-Radar-Wahl wurden gespeichert."
          : "SwissJobPass gespeichert.",
    });
  } catch (error) {
    if (error instanceof CandidateProfileReferenceError) {
      return Object.freeze({
        status: "error" as const,
        message: "Eine ausgewählte Referenz ist nicht mehr verfügbar.",
        fieldErrors: Object.freeze({
          [error.field]: [FIELD_MESSAGES[error.field]],
        }),
      });
    }
    return profileFailureState(error);
  }
}

export async function completeCandidateOnboardingAction(
  _previous: CandidateProfileActionState,
  _formData: FormData,
): Promise<CandidateProfileActionState> {
  const security = await secureCandidateProfileMutation();
  if (!security.ok) return security.state;

  try {
    const result = await completeOwnedCandidateOnboarding(security.database, {
      actorUserId: security.userId,
      correlationId: security.correlationId,
      now: security.now,
    });
    if (result.outcome === "INCOMPLETE") {
      return Object.freeze({
        status: "error" as const,
        message:
          "Der SwissJobPass ist noch nicht vollständig. Ergänze die aufgeführten Pflichtbereiche und speichere zuerst.",
        missingRequirements: result.missing,
      });
    }
    revalidateCandidateProfilePaths();
    return Object.freeze({
      status: "success" as const,
      message:
        result.outcome === "ALREADY_COMPLETE"
          ? "Dein SwissJobPass ist bereits abgeschlossen."
          : result.radarState === "CURRENT"
            ? "SwissJobPass abgeschlossen. Deine zuvor erteilte Talent-Radar-Einwilligung ist nun aktiv."
            : "SwissJobPass abgeschlossen.",
    });
  } catch (error) {
    return profileFailureState(error);
  }
}

export async function setTalentRadarVisibilityAction(
  _previous: CandidateProfileActionState,
  formData: FormData,
): Promise<CandidateProfileActionState> {
  const security = await secureCandidateProfileMutation();
  if (!security.ok) return security.state;

  const raw = formData.getAll("granted");
  if (
    raw.length !== 1 ||
    typeof raw[0] !== "string" ||
    !["true", "false"].includes(raw[0])
  ) {
    return Object.freeze({
      status: "error" as const,
      message: "Die Sichtbarkeitswahl konnte nicht eindeutig gelesen werden.",
    });
  }

  try {
    const result = await setOwnedTalentRadarVisibility(security.database, {
      actorUserId: security.userId,
      correlationId: security.correlationId,
      granted: raw[0] === "true",
      now: security.now,
    });
    revalidateCandidateProfilePaths();
    if (result.outcome === "UNCHANGED") {
      return Object.freeze({
        status: "success" as const,
        message: "Diese Talent-Radar-Wahl ist bereits aktuell.",
      });
    }
    return Object.freeze({
      status: "success" as const,
      message: result.granted
        ? result.radarState === "CURRENT"
          ? "Talent Radar aktiviert. Dein sicherer anonymer Profilausschnitt ist sichtbar."
          : "Einwilligung vorgemerkt. Sichtbar wirst du erst nach dem vollständigen SwissJobPass-Abschluss."
        : "Talent Radar deaktiviert. Das anonyme Profil wurde sofort zurückgezogen.",
    });
  } catch (error) {
    return profileFailureState(error);
  }
}

async function secureCandidateProfileMutation() {
  const user = await requireCandidatePage();
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({ ok: false as const, state: unsafeRequestState() });
  }

  const database = getDatabase();
  const environment = getServerEnvironment();
  const now = new Date();
  const rate = await consumeRequestRateLimit(
    "CANDIDATE_PROFILE_MUTATION",
    { userId: user.id },
    request,
    now,
    { database, environment },
  );
  if (!rate.allowed) {
    return Object.freeze({
      ok: false as const,
      state: Object.freeze({
        status: "error" as const,
        message:
          "Zu viele Profiländerungen in kurzer Zeit. Bitte versuche es später erneut.",
      }),
    });
  }

  return Object.freeze({
    ok: true as const,
    userId: user.id,
    correlationId: request.correlationId,
    database,
    now,
  });
}

function readProfileForm(formData: FormData) {
  const desiredTitlesValue = optionalString(formData, "desiredTitles");
  const desiredTitles =
    desiredTitlesValue === null
      ? null
      : desiredTitlesValue
        ?.split(/[\n,]+/u)
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
  const languages: Array<{ code: unknown; level: unknown }> =
    CANDIDATE_LANGUAGE_CODES.flatMap((code) =>
    checked(formData, `languageEnabled_${code}`)
      ? [
          {
            code,
            level: optionalString(formData, `languageLevel_${code}`),
          },
        ]
      : [],
    );
  const otherLanguageCode = optionalString(formData, "otherLanguageCode");
  if (otherLanguageCode !== undefined) {
    languages.push({
      code: otherLanguageCode,
      level: optionalString(formData, "otherLanguageLevel"),
    });
  }

  const cvFileName = optionalString(formData, "cvFileName");
  const cvMimeType = optionalString(formData, "cvMimeType");
  const cvSizeBytes = optionalNumber(formData, "cvSizeBytes");
  const hasAnyCvPart =
    cvFileName !== undefined || cvMimeType !== undefined || cvSizeBytes !== undefined;

  return {
    firstName: optionalString(formData, "firstName"),
    lastName: optionalString(formData, "lastName"),
    publicDisplayName: optionalString(formData, "publicDisplayName"),
    phone: optionalString(formData, "phone"),
    cantonId: optionalString(formData, "cantonId"),
    cityLabel: optionalString(formData, "cityLabel"),
    summary: optionalString(formData, "summary"),
    desiredTitles,
    skillIds: stringArray(formData, "skillIds"),
    languages,
    categoryIds: stringArray(formData, "categoryIds"),
    acceptableCantonIds: [],
    workloadMin: optionalNumber(formData, "workloadMin"),
    workloadMax: optionalNumber(formData, "workloadMax"),
    desiredSalaryMin: optionalNumber(formData, "desiredSalaryMin"),
    desiredSalaryMax: optionalNumber(formData, "desiredSalaryMax"),
    desiredSalaryPeriod: optionalString(formData, "desiredSalaryPeriod"),
    jobTypes: stringArray(formData, "jobTypes"),
    remotePreference: optionalString(formData, "remotePreference"),
    mobilityRadiusKm: optionalNumber(formData, "mobilityRadiusKm"),
    availabilityDate: optionalString(formData, "availabilityDate"),
    workPermitType: optionalString(formData, "workPermitType"),
    radarVisible: checked(formData, "radarVisible"),
    cv: hasAnyCvPart
      ? {
          fileName: cvFileName,
          mimeType: cvMimeType,
          sizeBytes: cvSizeBytes,
        }
      : undefined,
    removeCv: checked(formData, "removeCv"),
  };
}

function optionalString(formData: FormData, field: string) {
  const values = formData.getAll(field);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const value = values[0].trim();
  return value.length === 0 ? undefined : value;
}

function singleString(formData: FormData, field: string) {
  const values = formData.getAll(field);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

function optionalNumber(formData: FormData, field: string) {
  const value = optionalString(formData, field);
  if (value === undefined) return undefined;
  return value === null ? null : Number(value);
}

function stringArray(formData: FormData, field: string) {
  return formData
    .getAll(field)
    .map((value) => (typeof value === "string" ? value.trim() : null))
    .filter((value) => typeof value !== "string" || value.length > 0);
}

function checked(formData: FormData, field: string) {
  const values = formData.getAll(field);
  return values.length === 1 && values[0] === "true";
}

function zodFieldErrors(issues: readonly Readonly<{ path: PropertyKey[] }>[]) {
  const errors: Record<string, readonly string[]> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in FIELD_MESSAGES) {
      errors[field] = [FIELD_MESSAGES[field as keyof typeof FIELD_MESSAGES]];
    }
  }
  return Object.freeze(errors);
}

function unsafeRequestState(): CandidateProfileActionState {
  return Object.freeze({
    status: "error",
    message: "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.",
  });
}

function profileFailureState(error: unknown): CandidateProfileActionState {
  if (error instanceof CandidateProfileConflictError) {
    return Object.freeze({
      status: "error",
      code: "PROFILE_CONFLICT",
      message:
        "Dein SwissJobPass wurde inzwischen in einem anderen Tab oder durch eine Sichtbarkeitsänderung aktualisiert. Deine veralteten Angaben wurden nicht gespeichert.",
    });
  }
  return Object.freeze({
    status: "error",
    message:
      error instanceof CandidateProfileUnavailableError
        ? "Dein Kandidatenprofil ist derzeit nicht verfügbar. Bitte melde dich neu an."
        : "Die Änderung konnte nicht gespeichert werden. Bitte versuche es nochmals.",
  });
}

const profileRevisionSchema = z.iso.datetime({ offset: true });

function revalidateCandidateProfilePaths() {
  revalidatePath("/candidate/jobpass");
  revalidatePath("/candidate/talent-radar");
  revalidatePath("/candidate/dashboard");
  revalidatePath("/candidate/privacy");
}
