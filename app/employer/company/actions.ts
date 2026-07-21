"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireEmployerPage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  completeEmployerCompanyOnboarding,
  EmployerCompanyDomainError,
  employerCompanyProfileSchema,
  saveEmployerCompanyProfile,
  type EmployerCompanyActionState,
} from "@/lib/employer/company";
import { requireEmployerCompanyContext } from "@/lib/employer/context";

const PROFILE_FIELDS = new Set([
  "expectedUpdatedAt",
  "name",
  "uid",
  "industry",
  "size",
  "website",
  "logoStorageKey",
  "coverStorageKey",
  "linkedinUrl",
  "facebookUrl",
  "instagramUrl",
  "about",
  "values",
  "benefits",
  "locationCount",
  "primaryLocationIndex",
]);
const LOCATION_FIELD_PATTERN =
  /^location_(\d+)_(id|cantonId|cityId|address|postalCode)$/u;
const FIELD_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  name: "Der Firmenname benötigt 2 bis 200 Zeichen.",
  uid: "Bitte verwende das Format CHE-123.456.789.",
  industry: "Bitte prüfe die Branche.",
  size: "Bitte prüfe die Unternehmensgrösse.",
  website: "Bitte verwende eine vollständige HTTP- oder HTTPS-Adresse.",
  logoStorageKey: "Der Logo-Speicherschlüssel ist nicht sicher.",
  coverStorageKey: "Der Cover-Speicherschlüssel ist nicht sicher.",
  linkedinUrl: "Bitte verwende eine vollständige HTTPS-Adresse.",
  facebookUrl: "Bitte verwende eine vollständige HTTPS-Adresse.",
  instagramUrl: "Bitte verwende eine vollständige HTTPS-Adresse.",
  about: "Die öffentliche Beschreibung benötigt 20 bis 5'000 Zeichen.",
  values: "Bitte verwende höchstens 12 eindeutige Werte.",
  benefits: "Bitte verwende höchstens 20 eindeutige Benefits.",
  locations: "Bitte prüfe Orte, Kantone, Postleitzahlen und den Hauptstandort.",
});

export async function saveEmployerCompanyProfileAction(
  _previous: EmployerCompanyActionState,
  formData: FormData,
): Promise<EmployerCompanyActionState> {
  const security = await secureCompanyMutation();
  if (!security.ok) return security.state;
  const raw = readCompanyProfileForm(formData);
  if (raw === null) return invalidFormState();
  const expected = z.iso.datetime({ offset: true }).safeParse(
    raw.expectedUpdatedAt,
  );
  const parsed = employerCompanyProfileSchema.safeParse(raw.profile);
  if (!expected.success || !parsed.success) {
    return Object.freeze({
      status: "error",
      message: "Bitte prüfe die markierten Firmenangaben.",
      fieldErrors: parsed.success
        ? undefined
        : companyFieldErrors(parsed.error.issues),
    });
  }
  try {
    const result = await saveEmployerCompanyProfile(
      security.database,
      security.scope,
      parsed.data,
      new Date(expected.data),
    );
    revalidateCompanyPaths(result.slug);
    return Object.freeze({
      status: "success",
      message: "Firmenprofil sicher gespeichert.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Object.freeze({
        status: "error",
        message: "Bitte prüfe die markierten Firmenangaben.",
        fieldErrors: companyFieldErrors(error.issues),
      });
    }
    return companyFailureState(error);
  }
}

export async function completeEmployerCompanyOnboardingAction(
  _previous: EmployerCompanyActionState,
  formData: FormData,
): Promise<EmployerCompanyActionState> {
  const security = await secureCompanyMutation();
  if (!security.ok) return security.state;
  const value = strictSingleFormValue(formData, "expectedUpdatedAt");
  if (value === null || hasUnexpectedFields(formData, new Set(["expectedUpdatedAt"]))) {
    return invalidFormState();
  }
  const expected = z.iso.datetime({ offset: true }).safeParse(value);
  if (!expected.success) return invalidFormState();
  try {
    const result = await completeEmployerCompanyOnboarding(
      security.database,
      security.scope,
      new Date(expected.data),
    );
    if (result.outcome === "INCOMPLETE") {
      return Object.freeze({
        status: "error",
        code: "INCOMPLETE",
        message:
          "Das Firmenprofil ist noch nicht vollständig. Ergänze die aufgeführten Pflichtbereiche und speichere zuerst.",
        missingRequirements: result.missing,
      });
    }
    revalidateCompanyPaths(result.slug);
    return Object.freeze({
      status: "success",
      message:
        result.outcome === "ALREADY_ACTIVE"
          ? "Das Firmenprofil ist bereits aktiv."
          : "Firmen-Onboarding abgeschlossen. Die Verifizierung bleibt ein separater Prüfschritt.",
    });
  } catch (error) {
    return companyFailureState(error);
  }
}

async function secureCompanyMutation() {
  const [user, company, request] = await Promise.all([
    requireEmployerPage(),
    requireEmployerCompanyContext(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({
      ok: false as const,
      state: errorState(
        "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.",
      ),
    });
  }
  const environment = getServerEnvironment();
  return Object.freeze({
    ok: true as const,
    database: getDatabase(),
    scope: Object.freeze({
      companyId: company.companyId,
      membershipId: company.membershipId,
      actorUserId: user.id,
      correlationId: request.correlationId,
      now: new Date(),
      auditIpContext: Object.freeze({
        sourceIp: request.sourceIp,
        keyring: environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
      }),
    }),
  });
}

function readCompanyProfileForm(formData: FormData) {
  if (
    [...formData.keys()].some(
      (field) =>
        !field.startsWith("$ACTION_") &&
        !PROFILE_FIELDS.has(field) &&
        !LOCATION_FIELD_PATTERN.test(field),
    )
  ) {
    return null;
  }
  const countText = strictSingleFormValue(formData, "locationCount");
  const primaryText = strictSingleFormValue(formData, "primaryLocationIndex");
  const count = Number(countText);
  const primaryIndex = primaryText === "" ? -1 : Number(primaryText);
  if (
    countText === null ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > 10 ||
    primaryText === null ||
    !Number.isInteger(primaryIndex) ||
    primaryIndex < -1 ||
    primaryIndex >= count
  ) {
    return null;
  }
  const locations: Array<Record<string, unknown>> = [];
  for (let index = 0; index < count; index += 1) {
    const values = Object.fromEntries(
      ["id", "cantonId", "cityId", "address", "postalCode"].map((field) => [
        field,
        strictSingleFormValue(formData, `location_${index}_${field}`),
      ]),
    ) as Record<string, string | null>;
    if (Object.values(values).some((value) => value === null)) return null;
    const isBlank = Object.values(values).every((value) => value === "");
    if (isBlank) continue;
    locations.push({
      id: nullable(values.id),
      cantonId: values.cantonId,
      cityId: values.cityId,
      address: nullable(values.address),
      postalCode: nullable(values.postalCode),
      isPrimary: primaryIndex === index,
    });
  }
  const singles = Object.fromEntries(
    [
      "expectedUpdatedAt",
      "name",
      "uid",
      "industry",
      "size",
      "website",
      "logoStorageKey",
      "coverStorageKey",
      "linkedinUrl",
      "facebookUrl",
      "instagramUrl",
      "about",
      "values",
      "benefits",
    ].map((field) => [field, strictSingleFormValue(formData, field)]),
  ) as Record<string, string | null>;
  if (Object.values(singles).some((value) => value === null)) return null;
  return Object.freeze({
    expectedUpdatedAt: singles.expectedUpdatedAt as string,
    profile: {
      name: singles.name,
      uid: nullable(singles.uid),
      industry: nullable(singles.industry),
      size: nullable(singles.size),
      website: nullable(singles.website),
      logoStorageKey: nullable(singles.logoStorageKey),
      coverStorageKey: nullable(singles.coverStorageKey),
      linkedinUrl: nullable(singles.linkedinUrl),
      facebookUrl: nullable(singles.facebookUrl),
      instagramUrl: nullable(singles.instagramUrl),
      about: nullable(singles.about),
      values: splitLines(singles.values),
      benefits: splitLines(singles.benefits),
      locations,
    },
  });
}

function strictSingleFormValue(formData: FormData, field: string) {
  const values = formData.getAll(field);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  return values[0].trim();
}

function hasUnexpectedFields(formData: FormData, allowed: ReadonlySet<string>) {
  return [...formData.keys()].some(
    (field) => !field.startsWith("$ACTION_") && !allowed.has(field),
  );
}

function nullable(value: string | null | undefined) {
  return value === undefined || value === null || value.trim().length === 0
    ? null
    : value.trim();
}

function splitLines(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function companyFieldErrors(
  issues: readonly Readonly<{ path: PropertyKey[] }>[],
) {
  const errors: Record<string, readonly string[]> = {};
  for (const issue of issues) {
    const root = issue.path[0];
    const field = root === "locations" || typeof root === "number"
      ? "locations"
      : root;
    if (typeof field === "string" && FIELD_MESSAGES[field] !== undefined) {
      errors[field] = [FIELD_MESSAGES[field]];
    }
  }
  return Object.freeze(errors);
}

function companyFailureState(error: unknown): EmployerCompanyActionState {
  if (error instanceof EmployerCompanyDomainError) {
    if (error.code === "FORBIDDEN" || error.code === "NOT_FOUND") {
      return Object.freeze({
        status: "error",
        code: "FORBIDDEN",
        message: "Dieser Firmenbereich ist für deine aktuelle Rolle schreibgeschützt.",
      });
    }
    if (error.code === "CONFLICT") {
      return Object.freeze({
        status: "error",
        code: "CONFLICT",
        message:
          "Das Firmenprofil wurde inzwischen geändert. Lade den aktuellen Stand neu, damit keine neuere Änderung überschrieben wird.",
      });
    }
    if (error.code === "INVALID_REFERENCE") {
      return Object.freeze({
        status: "error",
        message: "Ein ausgewählter Ort gehört nicht zum gewählten Kanton.",
        fieldErrors: Object.freeze({
          locations: [
            FIELD_MESSAGES.locations ??
              "Bitte prüfe Orte, Kantone, Postleitzahlen und den Hauptstandort.",
          ],
        }),
      });
    }
  }
  return errorState(
    "Die Firmenänderung konnte nicht gespeichert werden. Bitte versuche es erneut.",
  );
}

function invalidFormState(): EmployerCompanyActionState {
  return errorState(
    "Das Formular konnte nicht eindeutig gelesen werden. Bitte lade die Seite neu.",
  );
}

function errorState(message: string): EmployerCompanyActionState {
  return Object.freeze({ status: "error", message });
}

function revalidateCompanyPaths(slug: string) {
  revalidatePath("/employer/company");
  revalidatePath("/employer/dashboard");
  revalidatePath(`/companies/${slug}`);
}
