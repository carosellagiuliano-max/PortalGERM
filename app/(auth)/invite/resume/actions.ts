"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { setEmployerCompanyContext } from "@/lib/auth/employer-context";
import {
  clearInviteResumeCookie,
  INVITE_RESUME_COOKIE_POLICY_V1,
  readInviteResumeToken,
} from "@/lib/auth/invite-resume";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
  shouldUseSecureAuthCookies,
} from "@/lib/auth/request-context";
import { writeSessionCookie } from "@/lib/auth/session";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { EmployerActionState } from "@/lib/employer/action-state";
import {
  acceptCompanyInvitation,
  registerAndAcceptCompanyInvitation,
} from "@/lib/employer/team";

export async function acceptInvitationAction(
  _state: EmployerActionState,
  _formData: FormData,
): Promise<EmployerActionState> {
  const [user, request, cookieStore] = await Promise.all([
    getCurrentUser(),
    getAuthRequestContext(),
    cookies(),
  ]);
  const environment = getServerEnvironment();
  if (user === null || !isValidAuthMutationOrigin(request)) return failure();
  const token = readInviteResumeToken(
    cookieStore.get(INVITE_RESUME_COOKIE_POLICY_V1.cookieName)?.value,
    new Date(),
    environment.secrets.session,
  );
  if (token === null) {
    clearInviteResumeCookie(cookieStore, request.production);
    return failure();
  }
  const result = await acceptCompanyInvitation(token, user, {
    database: getDatabase(),
    request,
    environment,
  });
  if (!result.ok) return failure(invitationMessage(result.code));
  clearInviteResumeCookie(cookieStore, request.production);
  if (!(await setEmployerCompanyContext(result.companyId))) return failure();
  redirect("/employer/dashboard?invitation=accepted");
}

export async function registerInvitationAccountAction(
  _state: EmployerActionState,
  formData: FormData,
): Promise<EmployerActionState> {
  const [request, cookieStore] = await Promise.all([
    getAuthRequestContext(),
    cookies(),
  ]);
  const environment = getServerEnvironment();
  if (!isValidAuthMutationOrigin(request)) return failure();
  const token = readInviteResumeToken(
    cookieStore.get(INVITE_RESUME_COOKIE_POLICY_V1.cookieName)?.value,
    new Date(),
    environment.secrets.session,
  );
  if (token === null) {
    clearInviteResumeCookie(cookieStore, request.production);
    return failure();
  }
  const result = await registerAndAcceptCompanyInvitation(
    token,
    {
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      acceptedTerms: formData.get("acceptedTerms") === "true",
      marketingConsent: formData.get("marketingConsent") === "true",
    },
    { database: getDatabase(), request, environment },
  );
  if (!result.ok) return failure(invitationMessage(result.code));
  writeSessionCookie(cookieStore, result.session);
  clearInviteResumeCookie(
    cookieStore,
    shouldUseSecureAuthCookies(environment.APP_ENV),
  );
  // A newly registered invitation account has exactly this one membership.
  // The employer context resolver selects it deterministically on the redirect;
  // avoiding a second auth lookup here prevents a committed accept from being
  // reported as failed merely because the new session cookie is not visible yet.
  redirect("/employer/dashboard?invitation=accepted");
}

function failure(
  message = "Die Einladung ist ungültig, abgelaufen oder nicht für dieses Konto bestimmt.",
): EmployerActionState {
  return { status: "error", message };
}

function invitationMessage(code: string) {
  if (code === "SEAT_LIMIT") {
    return "Das Unternehmen hat aktuell keinen freien Sitzplatz. Bitte kontaktiere die einladende Person.";
  }
  if (code === "ACCOUNT_EXISTS") {
    return "Für diese E-Mail besteht bereits ein Konto. Bitte melde dich damit an.";
  }
  if (code === "ACCOUNT_TYPE_UNSUPPORTED") {
    return "Bitte verwende ein separates Arbeitgeberkonto oder kontaktiere den Support.";
  }
  if (code === "INVALID_INPUT") {
    return "Bitte prüfe Name, E-Mail, Passwort und Zustimmung.";
  }
  return undefined;
}
