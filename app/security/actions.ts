"use server";

import { revalidatePath } from "next/cache";

import {
  beginTotpEnrollment,
  beginWebAuthnAuthentication,
  beginWebAuthnEnrollment,
  completeTotpAuthentication,
  completeTotpEnrollment,
  completeWebAuthnAuthentication,
  completeWebAuthnEnrollment,
  consumeRecoveryCode,
  revokeAuthenticator,
  type MfaDependencies,
  type MfaResult,
} from "@/lib/auth/assurance/mfa-service";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireAuthenticatedPage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export type SecurityActionResult<T = Record<string, never>> =
  | Readonly<{ ok: true; value: Readonly<T> }>
  | Readonly<{ ok: false; code: string; message: string }>;

export async function beginTotpEnrollmentAction(
  label: string,
): Promise<
  SecurityActionResult<{
    authenticatorId: string;
    challengeId: string;
    secret: string;
    uri: string;
    expiresAt: string;
  }>
> {
  const dependencies = await securityDependencies();
  if (dependencies === null) return unsafeRequest();
  return serializeMfaResult(
    await beginTotpEnrollment({ label }, dependencies),
  );
}

export async function completeTotpEnrollmentAction(input: {
  authenticatorId: string;
  challengeId: string;
  code: string;
}): Promise<
  SecurityActionResult<{
    recoveryCodes: readonly string[];
    expiresAt: string;
  }>
> {
  const dependencies = await securityDependencies();
  if (dependencies === null) return unsafeRequest();
  const result = serializeMfaResult(
    await completeTotpEnrollment(input, dependencies),
  );
  if (result.ok) revalidateSecurityPages();
  return result;
}

export async function beginWebAuthnEnrollmentAction(
  label: string,
): Promise<
  SecurityActionResult<{
    authenticatorId: string;
    challengeId: string;
    options: Awaited<
      ReturnType<typeof beginWebAuthnEnrollment>
    > extends MfaResult<infer T>
      ? T extends { options: infer O }
        ? O
        : never
      : never;
    expiresAt: string;
  }>
> {
  const dependencies = await securityDependencies();
  if (dependencies === null) return unsafeRequest();
  return serializeMfaResult(
    await beginWebAuthnEnrollment({ label }, dependencies),
  ) as Awaited<ReturnType<typeof beginWebAuthnEnrollmentAction>>;
}

export async function completeWebAuthnEnrollmentAction(input: {
  authenticatorId: string;
  challengeId: string;
  response: unknown;
}): Promise<
  SecurityActionResult<{
    recoveryCodes: readonly string[];
    expiresAt: string;
  }>
> {
  const dependencies = await securityDependencies();
  if (dependencies === null) return unsafeRequest();
  const result = serializeMfaResult(
    await completeWebAuthnEnrollment(input, dependencies),
  );
  if (result.ok) revalidateSecurityPages();
  return result;
}

export async function beginWebAuthnAuthenticationAction(): Promise<
  SecurityActionResult<{
    challengeId: string;
    options: Awaited<
      ReturnType<typeof beginWebAuthnAuthentication>
    > extends MfaResult<infer T>
      ? T extends { options: infer O }
        ? O
        : never
      : never;
    expiresAt: string;
  }>
> {
  const dependencies = await securityDependencies();
  if (dependencies === null) return unsafeRequest();
  return serializeMfaResult(
    await beginWebAuthnAuthentication(dependencies),
  ) as Awaited<ReturnType<typeof beginWebAuthnAuthenticationAction>>;
}

export async function completeWebAuthnAuthenticationAction(input: {
  challengeId: string;
  response: unknown;
}): Promise<SecurityActionResult<{ expiresAt: string }>> {
  const dependencies = await securityDependencies();
  if (dependencies === null) return unsafeRequest();
  const result = serializeMfaResult(
    await completeWebAuthnAuthentication(input, dependencies),
  );
  if (result.ok) revalidateSecurityPages();
  return result;
}

export async function authenticateTotpAction(input: {
  authenticatorId: string;
  code: string;
}): Promise<SecurityActionResult<{ expiresAt: string }>> {
  const dependencies = await securityDependencies();
  if (dependencies === null) return unsafeRequest();
  const result = serializeMfaResult(
    await completeTotpAuthentication(input, dependencies),
  );
  if (result.ok) revalidateSecurityPages();
  return result;
}

export async function consumeRecoveryCodeAction(
  code: string,
): Promise<SecurityActionResult<{ expiresAt: string }>> {
  const dependencies = await securityDependencies();
  if (dependencies === null) return unsafeRequest();
  const result = serializeMfaResult(
    await consumeRecoveryCode({ code }, dependencies),
  );
  if (result.ok) revalidateSecurityPages();
  return result;
}

export async function revokeAuthenticatorAction(input: {
  authenticatorId: string;
  reasonCode: string;
}): Promise<SecurityActionResult<{ authenticatorId: string }>> {
  const dependencies = await securityDependencies();
  if (dependencies === null) return unsafeRequest();
  const result = serializeMfaResult(
    await revokeAuthenticator(input, dependencies),
  );
  if (result.ok) revalidateSecurityPages();
  return result;
}

async function securityDependencies(): Promise<MfaDependencies | null> {
  const [user, request] = await Promise.all([
    requireAuthenticatedPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) return null;
  return Object.freeze({
    actor: {
      userId: user.id,
      sessionId: user.sessionId,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    },
    correlationId: request.correlationId,
    database: getDatabase(),
    environment: getServerEnvironment(),
    now: new Date(),
  });
}

function serializeMfaResult<T>(
  result: MfaResult<T>,
): SecurityActionResult<SerializeDates<T>> {
  if (!result.ok) {
    return Object.freeze({
      ok: false,
      code: result.code,
      message: messageForCode(result.code),
    });
  }
  return Object.freeze({
    ok: true,
    value: serializeDates(result.value) as SerializeDates<T>,
  });
}

type SerializeDates<T> = T extends Date
  ? string
  : T extends readonly (infer I)[]
    ? readonly SerializeDates<I>[]
    : T extends object
      ? { readonly [K in keyof T]: SerializeDates<T[K]> }
      : T;

function serializeDates(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeDates);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeDates(item)]),
    );
  }
  return value;
}

function unsafeRequest(): SecurityActionResult<never> {
  return Object.freeze({
    ok: false,
    code: "FORBIDDEN",
    message: "Die Sicherheitsanfrage konnte nicht bestätigt werden.",
  });
}

function messageForCode(code: string): string {
  const messages: Record<string, string> = {
    FORBIDDEN: "Diese Sicherheitsaktion ist nicht verfügbar.",
    INVALID_INPUT: "Bitte prüfe die Sicherheitsangaben.",
    INVALID_CHALLENGE:
      "Die Sicherheitsanforderung ist abgelaufen oder wurde bereits verwendet.",
    INVALID_FACTOR: "Der Sicherheitsnachweis war nicht gültig.",
    CONFLICT:
      "Der Sicherheitszustand hat sich geändert. Bitte starte erneut.",
    LAST_FACTOR:
      "Der letzte aktive Faktor kann nicht entfernt werden. Registriere zuerst einen zweiten Faktor.",
    WRITE_FAILED:
      "Die Sicherheitsänderung konnte nicht vollständig gespeichert werden.",
  };
  return messages[code] ?? "Die Sicherheitsaktion ist fehlgeschlagen.";
}

function revalidateSecurityPages(): void {
  for (const path of [
    "/admin/security/authenticators",
    "/candidate/settings/security",
    "/employer/settings/security",
  ]) {
    revalidatePath(path);
  }
}
