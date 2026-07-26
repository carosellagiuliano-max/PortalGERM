"use server";

import { cookies } from "next/headers";

import type { AuthActionState } from "@/lib/auth/action-state";
import {
  consumeEmailVerification,
  requestEmailVerification,
} from "@/lib/auth/email-verification-service";
import {
  cancelLoginEmailChange,
  requestLoginEmailChange,
} from "@/lib/auth/email-change-service";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import {
  publicVerificationMessage,
} from "@/lib/auth/email-verification-policy";
import {
  SESSION_POLICY_V1,
  writeSessionCookie,
} from "@/lib/auth/session";
import { resolveSafeNext } from "@/lib/auth/safe-next";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { normalizedEmailSchema } from "@/lib/validation/common";

const ORIGIN_ERROR =
  "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.";

export async function consumeEmailVerificationAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const token = stringField(formData, "token");
  if (token.length < 32 || token.length > 256) {
    return Object.freeze({
      status: "error",
      message: publicVerificationMessage("invalid"),
    });
  }
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({ status: "error", message: ORIGIN_ERROR });
  }
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_POLICY_V1.cookieName)?.value;
  const environment = getServerEnvironment();
  const result = await consumeEmailVerification(token, sessionToken, {
    database: getDatabase(),
    environment,
    request,
  });
  if (!result.ok) {
    return Object.freeze({
      status: result.status === "RATE_LIMITED" ? "rate_limited" : "error",
      message: publicVerificationMessage(
        result.status === "RATE_LIMITED" ? "rate_limited" : "invalid",
      ),
    });
  }
  if (result.session !== undefined) {
    writeSessionCookie(cookieStore, result.session);
  }
  return Object.freeze({
    status: "success",
    message: publicVerificationMessage("verified"),
    values: {
      continuePath: resolveSafeNext(
        stringField(formData, "next"),
        result.role,
      ),
    },
  });
}

export async function resendEmailVerificationAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = normalizedEmailSchema.safeParse(stringField(formData, "email"));
  if (!parsed.success) {
    return Object.freeze({
      status: "error",
      message: "Bitte gib eine gültige E-Mail-Adresse ein.",
      fieldErrors: { email: ["Bitte gib eine gültige E-Mail-Adresse ein."] },
    });
  }
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({ status: "error", message: ORIGIN_ERROR });
  }
  const environment = getServerEnvironment();
  const result = await requestEmailVerification(parsed.data, {
    database: getDatabase(),
    environment,
    request,
  });
  return Object.freeze({
    status: result.rateLimited ? "rate_limited" : "success",
    message: result.rateLimited
      ? publicVerificationMessage("rate_limited")
      : publicVerificationMessage("requested"),
    values: { email: parsed.data },
  });
}

export async function requestLoginEmailChangeAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const targetEmail = stringField(formData, "targetEmail");
  const password = stringField(formData, "password");
  const parsed = normalizedEmailSchema.safeParse(targetEmail);
  if (!parsed.success || password.length < 12 || password.length > 128) {
    return Object.freeze({
      status: "error",
      message: "Bitte prüfe die neue Adresse und dein aktuelles Passwort.",
      values: { targetEmail },
    });
  }
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({ status: "error", message: ORIGIN_ERROR });
  }
  const [user, cookieStore] = await Promise.all([getCurrentUser(), cookies()]);
  const sessionToken = cookieStore.get(SESSION_POLICY_V1.cookieName)?.value;
  if (user === null || sessionToken === undefined) {
    return Object.freeze({
      status: "error",
      message: "Bitte melde dich erneut an.",
    });
  }
  const environment = getServerEnvironment();
  const result = await requestLoginEmailChange(
    {
      userId: user.id,
      sessionToken,
      targetEmail: parsed.data,
      password,
    },
    { database: getDatabase(), environment, request },
  );
  if (!result.ok) {
    const message =
      result.status === "LOCKED"
        ? "Die Änderung der Login-E-Mail ist für diese Umgebung noch nicht freigeschaltet."
        : result.status === "RATE_LIMITED"
          ? publicVerificationMessage("rate_limited")
          : result.status === "INVALID_CREDENTIALS"
            ? "Das aktuelle Passwort oder die Sitzung konnte nicht bestätigt werden."
            : "Die Adresse kann nicht verwendet werden oder eine Änderung ist bereits offen.";
    return Object.freeze({
      status: result.status === "RATE_LIMITED" ? "rate_limited" : "error",
      message,
      values: { targetEmail: parsed.data },
    });
  }
  return Object.freeze({
    status: "success",
    message:
      "Die neue Adresse ist vorgemerkt. Bis zur Bestätigung bleibt deine bisherige Login-Adresse gültig.",
  });
}

export async function cancelLoginEmailChangeAction(): Promise<AuthActionState> {
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({ status: "error", message: ORIGIN_ERROR });
  }
  const [user, cookieStore] = await Promise.all([getCurrentUser(), cookies()]);
  const sessionToken = cookieStore.get(SESSION_POLICY_V1.cookieName)?.value;
  if (user === null || sessionToken === undefined) {
    return Object.freeze({
      status: "error",
      message: "Bitte melde dich erneut an.",
    });
  }
  const result = await cancelLoginEmailChange(
    { userId: user.id, sessionToken },
    {
      database: getDatabase(),
      environment: getServerEnvironment(),
      request,
    },
  );
  return Object.freeze({
    status: result.ok ? "success" : "error",
    message: result.ok
      ? "Die offene E-Mail-Änderung wurde abgebrochen."
      : "Die offene Änderung konnte nicht abgebrochen werden.",
  });
}

function stringField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
