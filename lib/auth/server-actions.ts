"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";

import type { AuthActionState, AuthActionValue } from "@/lib/auth/action-state";
import {
  loginWithPassword,
  registerCandidate,
  registerEmployer,
  requestPasswordReset,
  resetPassword,
} from "@/lib/auth/auth-service";
import { verifyCompanyClaimIntent } from "@/lib/auth/company-claim-intent";
import { setEmployerCompanyContext } from "@/lib/auth/employer-context";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { resolveSafeNext } from "@/lib/auth/safe-next";
import { writeSessionCookie } from "@/lib/auth/session";
import { getServerEnvironment } from "@/lib/config/env";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import { getPublicCompanyCardBySlug } from "@/lib/companies/public-read-model";
import { getDatabase } from "@/lib/db/client";
import { getPublicCatalog } from "@/lib/jobs/public-read-model";
import { emailProvider } from "@/lib/providers/email";
import {
  candidateRegistrationSchema,
  employerRegistrationSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

const ORIGIN_ERROR =
  "Die Anfrage konnte nicht sicher bestätigt werden. Bitte laden Sie die Seite neu.";
const RATE_LIMIT_ERROR =
  "Zu viele Versuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.";
const INVALID_RESET_ERROR =
  "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.";
const INVALID_COMPANY_CLAIM_ERROR =
  "Der Link zur Firmenübernahme ist ungültig oder abgelaufen. Bitte öffnen Sie die Firmenseite erneut.";

export type EmployerRegistrationClaimDefaults = Readonly<{
  companyId: string;
  companySlug: string;
  companyName: string;
  cantonCode: string;
}>;

/**
 * Resolves navigation intent to public, canonical registration defaults only.
 * A successful result neither identifies the caller nor grants company access.
 */
export async function getEmployerRegistrationClaimDefaults(
  claim: unknown,
  intent: unknown,
): Promise<EmployerRegistrationClaimDefaults | null> {
  if (
    typeof claim !== "string" ||
    typeof intent !== "string" ||
    claim.length === 0 ||
    intent.length === 0
  ) {
    return null;
  }

  try {
    const environment = getServerEnvironment();
    const verified = verifyCompanyClaimIntent(
      intent,
      { companySlug: claim, now: new Date() },
      environment.secrets.session,
    );
    if (verified === null) return null;

    const [company, catalog] = await Promise.all([
      getPublicCompanyCardBySlug(verified.companySlug, 0),
      getPublicCatalog(),
    ]);
    if (company === null || company.canton === null) return null;

    const matchingCantons = catalog.cantons.filter(
      (canton) => canton.name === company.canton,
    );
    if (matchingCantons.length !== 1) return null;

    return Object.freeze({
      companyId: company.id,
      companySlug: company.slug,
      companyName: company.name,
      cantonCode: matchingCantons[0]!.code,
    });
  } catch {
    return null;
  }
}

export async function loginAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const values = publicValues(formData, ["email", "next"]);
  const parsed = loginSchema.safeParse({
    email: stringField(formData, "email"),
    password: stringField(formData, "password"),
  });
  if (!parsed.success) return validationState(parsed.error, values);

  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) return originError(values);
  const environment = getServerEnvironment();
  const result = await loginWithPassword(
    { ...parsed.data, next: nullableStringField(formData, "next") },
    { database: getDatabase(), environment, request },
  );
  if (!result.ok) {
    return Object.freeze({
      status: result.code === "RATE_LIMITED" ? "rate_limited" : "error",
      message:
        result.code === "RATE_LIMITED"
          ? RATE_LIMIT_ERROR
          : "E-Mail oder Passwort falsch.",
      values,
    });
  }
  const cookieStore = await cookies();
  writeSessionCookie(cookieStore, result.session);
  redirect(result.destination);
}

export async function registerCandidateAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const values = registrationValues(formData, ["name", "email"]);
  const parsed = candidateRegistrationSchema.safeParse({
    name: stringField(formData, "name"),
    email: stringField(formData, "email"),
    password: stringField(formData, "password"),
    passwordConfirmation: stringField(formData, "passwordConfirmation"),
    acceptedTerms: checkboxField(formData, "acceptedTerms"),
    marketingConsent: checkboxField(formData, "marketingConsent"),
  });
  if (!parsed.success) return validationState(parsed.error, values);

  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) return originError(values);
  const environment = getServerEnvironment();
  const result = await registerCandidate(parsed.data, {
    database: getDatabase(),
    environment,
    request,
  });
  if (!result.ok) return registrationFailure(result.code, values);
  const cookieStore = await cookies();
  writeSessionCookie(cookieStore, result.session);
  redirect(result.destination);
}

export async function registerEmployerAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const submittedValues = registrationValues(formData, [
    "name",
    "email",
    "companyName",
    "uid",
    "cantonCode",
    "companySize",
  ]);
  const claimFields = readCompanyClaimFields(formData);
  if (claimFields.kind === "invalid") {
    return companyClaimError(submittedValues);
  }

  let values = submittedValues;
  let companyName = stringField(formData, "companyName");
  let cantonCode = stringField(formData, "cantonCode");
  let request: Awaited<ReturnType<typeof getAuthRequestContext>> | undefined;
  let environment: ServerEnvironment | undefined;
  let claimedCompanyId: string | undefined;

  if (claimFields.kind === "present") {
    request = await getAuthRequestContext();
    if (!isValidAuthMutationOrigin(request)) return originError(values);
    const canonicalCompany = await getEmployerRegistrationClaimDefaults(
      claimFields.claim,
      claimFields.intent,
    );
    if (canonicalCompany === null) return companyClaimError(values);

    companyName = canonicalCompany.companyName;
    cantonCode = canonicalCompany.cantonCode;
    claimedCompanyId = canonicalCompany.companyId;
    values = Object.freeze({
      ...values,
      companyName,
      cantonCode,
    });
    environment = getServerEnvironment();
  }

  const parsed = employerRegistrationSchema.safeParse({
    name: stringField(formData, "name"),
    email: stringField(formData, "email"),
    password: stringField(formData, "password"),
    passwordConfirmation: stringField(formData, "passwordConfirmation"),
    companyName,
    uid: nullableStringField(formData, "uid") ?? undefined,
    cantonCode,
    companySize: stringField(formData, "companySize"),
    acceptedTerms: checkboxField(formData, "acceptedTerms"),
    marketingConsent: checkboxField(formData, "marketingConsent"),
  });
  if (!parsed.success) return validationState(parsed.error, values);

  request ??= await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) return originError(values);
  environment ??= getServerEnvironment();
  const result = await registerEmployer(parsed.data, {
    database: getDatabase(),
    environment,
    request,
    ...(claimedCompanyId === undefined ? {} : { claimedCompanyId }),
  });
  if (!result.ok) return registrationFailure(result.code, values);
  const cookieStore = await cookies();
  writeSessionCookie(cookieStore, result.session);
  redirect(result.destination);
}

export async function forgotPasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const values = publicValues(formData, ["email"]);
  const parsed = forgotPasswordSchema.safeParse({
    email: stringField(formData, "email"),
  });
  if (!parsed.success) return validationState(parsed.error, values);
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) return originError(values);
  const environment = getServerEnvironment();
  const result = await requestPasswordReset(parsed.data, {
    database: getDatabase(),
    emailProvider,
    environment,
    request,
  });
  return Object.freeze({
    status: result.rateLimited ? "rate_limited" : "success",
    message: result.rateLimited
      ? RATE_LIMIT_ERROR
      : "Falls ein passendes Konto existiert, wurde eine Nachricht zum Zurücksetzen vorbereitet.",
    values,
  });
}

export async function resetPasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: stringField(formData, "token"),
    password: stringField(formData, "password"),
    passwordConfirmation: stringField(formData, "passwordConfirmation"),
  });
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "token")) {
      return Object.freeze({ status: "error", message: INVALID_RESET_ERROR });
    }
    return validationState(parsed.error, {});
  }
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) return originError({});
  const environment = getServerEnvironment();
  const result = await resetPassword(parsed.data, {
    database: getDatabase(),
    environment,
    request,
  });
  if (!result.ok) {
    return Object.freeze({
      status: "error",
      message: INVALID_RESET_ERROR,
    });
  }
  redirect("/login?reset=success");
}

export async function switchCompanyContextAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) return originError({});
  const companyId = stringField(formData, "companyId");
  const selected = await setEmployerCompanyContext(companyId);
  if (!selected) {
    return Object.freeze({
      status: "error",
      message: "Der Firmenkontext konnte nicht gewechselt werden.",
    });
  }
  redirect(resolveSafeNext(nullableStringField(formData, "next"), "EMPLOYER"));
}

function validationState(
  error: ZodError,
  values: Readonly<Record<string, AuthActionValue>>,
): AuthActionState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return Object.freeze({
    status: "error",
    message: "Bitte prüfen Sie die markierten Eingaben.",
    fieldErrors,
    values,
  });
}

function registrationFailure(
  code: "REGISTRATION_FAILED" | "RATE_LIMITED",
  values: Readonly<Record<string, AuthActionValue>>,
): AuthActionState {
  return Object.freeze({
    status: code === "RATE_LIMITED" ? "rate_limited" : "error",
    message:
      code === "RATE_LIMITED"
        ? RATE_LIMIT_ERROR
        : "Die Registrierung konnte nicht abgeschlossen werden. Bitte prüfen Sie Ihre Angaben oder melden Sie sich an.",
    values,
  });
}

function originError(
  values: Readonly<Record<string, AuthActionValue>>,
): AuthActionState {
  return Object.freeze({ status: "error", message: ORIGIN_ERROR, values });
}

function companyClaimError(
  values: Readonly<Record<string, AuthActionValue>>,
): AuthActionState {
  return Object.freeze({
    status: "error",
    message: INVALID_COMPANY_CLAIM_ERROR,
    values,
  });
}

function readCompanyClaimFields(formData: FormData):
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "present"; claim: string; intent: string }> {
  const claims = formData.getAll("claim");
  const intents = formData.getAll("intent");
  if (claims.length === 0 && intents.length === 0) {
    return Object.freeze({ kind: "none" });
  }
  if (
    claims.length !== 1 ||
    intents.length !== 1 ||
    typeof claims[0] !== "string" ||
    typeof intents[0] !== "string" ||
    claims[0].length === 0 ||
    intents[0].length === 0
  ) {
    return Object.freeze({ kind: "invalid" });
  }
  return Object.freeze({
    kind: "present",
    claim: claims[0],
    intent: intents[0],
  });
}

function registrationValues(
  formData: FormData,
  stringNames: readonly string[],
) {
  return Object.freeze({
    ...publicValues(formData, stringNames),
    acceptedTerms: checkboxField(formData, "acceptedTerms"),
    marketingConsent: checkboxField(formData, "marketingConsent"),
  });
}

function publicValues(formData: FormData, names: readonly string[]) {
  return Object.freeze(
    Object.fromEntries(names.map((name) => [name, stringField(formData, name)])),
  );
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function nullableStringField(formData: FormData, name: string): string | null {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? null : value;
}

function checkboxField(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}
