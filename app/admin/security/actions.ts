"use server";

import { revalidatePath } from "next/cache";

import type { AdminSecurityActionState } from "@/app/admin/security/action-state";
import {
  approveAdminCapabilityGrant,
  approveAdminRoleAssignment,
  approveAuthenticatorReset,
  approveBreakGlassGrant,
  projectExpiredSecurityGrants,
  requestAdminCapabilityGrant,
  requestAdminRoleAssignment,
  requestAuthenticatorReset,
  requestBreakGlassGrant,
  revokeAdminCapabilityGrant,
  revokeAdminRoleAssignment,
  revokeBreakGlassGrant,
  type AdminSecurityDependencies,
} from "@/lib/admin/security-governance";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export async function adminSecurityAction(
  _state: AdminSecurityActionState,
  formData: FormData,
): Promise<AdminSecurityActionState> {
  const [user, request] = await Promise.all([
    requireAdminPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return failure(
      "Die Sicherheitsanfrage konnte nicht bestätigt werden.",
      "FORBIDDEN",
    );
  }
  const operation = single(formData, "operation");
  if (operation === null) {
    return failure("Das Sicherheitsformular ist unvollständig.", "INVALID_INPUT");
  }
  const dependencies: AdminSecurityDependencies = Object.freeze({
    actor: {
      userId: user.id,
      sessionId: user.sessionId,
      email: user.email,
      role: user.role,
      status: user.status,
      capabilities: user.capabilities,
    },
    correlationId: request.correlationId,
    database: getDatabase(),
    environment: getServerEnvironment(),
    now: new Date(),
  });
  const input = buildInput(operation, formData, dependencies.now ?? new Date());
  if (input === null) {
    return failure("Bitte prüfe die Sicherheitsangaben.", "INVALID_INPUT");
  }

  const result =
    operation === "role-request"
      ? await requestAdminRoleAssignment(input, dependencies)
      : operation === "role-approve"
        ? await approveAdminRoleAssignment(input, dependencies)
        : operation === "role-revoke"
          ? await revokeAdminRoleAssignment(input, dependencies)
          : operation === "capability-request"
            ? await requestAdminCapabilityGrant(input, dependencies)
            : operation === "capability-approve"
              ? await approveAdminCapabilityGrant(input, dependencies)
              : operation === "capability-revoke"
                ? await revokeAdminCapabilityGrant(input, dependencies)
                : operation === "authenticator-reset-request"
                  ? await requestAuthenticatorReset(input, dependencies)
                  : operation === "authenticator-reset-approve"
                    ? await approveAuthenticatorReset(input, dependencies)
                    : operation === "break-glass-request"
                      ? await requestBreakGlassGrant(input, dependencies)
                      : operation === "break-glass-approve"
                        ? await approveBreakGlassGrant(input, dependencies)
                        : operation === "break-glass-revoke"
                          ? await revokeBreakGlassGrant(input, dependencies)
                          : operation === "security-expiry-project"
                            ? await projectExpiredSecurityGrants(dependencies)
                            : null;
  if (result === null) {
    return failure("Unbekannte Sicherheitsaktion.", "INVALID_INPUT");
  }
  if (!result.ok) return failure(messageForCode(result.code), result.code);
  revalidateSecurity();
  return Object.freeze({
    status: "success",
    message:
      operation.endsWith("-request")
        ? "Die Anfrage wartet auf eine unabhängige Freigabe."
        : operation === "security-expiry-project"
          ? "Abgelaufene Freigaben wurden sicher projiziert."
          : "Die Sicherheitsänderung wurde vollständig angewendet.",
  });
}

function buildInput(
  operation: string,
  formData: FormData,
  now: Date,
): Record<string, unknown> | null {
  const reasonCode = single(formData, "reasonCode");
  if (operation === "security-expiry-project") return {};
  if (reasonCode === null) return null;
  if (
    operation === "role-approve" ||
    operation === "capability-approve" ||
    operation === "authenticator-reset-approve" ||
    operation === "break-glass-approve"
  ) {
    const approvalId = single(formData, "approvalId");
    return approvalId === null ? null : { approvalId, reasonCode };
  }
  if (
    operation === "role-revoke" ||
    operation === "capability-revoke" ||
    operation === "break-glass-revoke"
  ) {
    const id = single(formData, "id");
    return id === null ? null : { id, reasonCode };
  }
  const userId = single(formData, "userId");
  if (userId === null) return null;
  if (operation === "authenticator-reset-request") {
    return { userId, reasonCode };
  }
  if (operation === "role-request") {
    const roleCode = single(formData, "roleCode");
    const durationDays = boundedNumber(
      single(formData, "durationDays"),
      1,
      366,
    );
    return roleCode === null || durationDays === null
      ? null
      : {
          userId,
          roleCode,
          validTo: new Date(
            now.getTime() + durationDays * 86_400_000,
          ).toISOString(),
          reasonCode,
        };
  }
  if (operation === "capability-request") {
    const capability = single(formData, "capability");
    const duty = single(formData, "duty");
    const durationDays = boundedNumber(
      single(formData, "durationDays"),
      1,
      30,
    );
    return capability === null || duty === null || durationDays === null
      ? null
      : {
          userId,
          capability,
          duty,
          validTo: new Date(
            now.getTime() + durationDays * 86_400_000,
          ).toISOString(),
          reasonCode,
        };
  }
  if (operation === "break-glass-request") {
    const incidentReference = single(formData, "incidentReference");
    const durationMinutes = boundedNumber(
      single(formData, "durationMinutes"),
      5,
      60,
    );
    const capabilities = formData
      .getAll("capabilities")
      .filter((value): value is string => typeof value === "string");
    return incidentReference === null ||
      durationMinutes === null ||
      capabilities.length === 0
      ? null
      : {
          userId,
          incidentReference,
          capabilities,
          validTo: new Date(
            now.getTime() + durationMinutes * 60_000,
          ).toISOString(),
          reasonCode,
        };
  }
  return null;
}

function single(formData: FormData, key: string): string | null {
  const values = formData.getAll(key);
  return values.length === 1 &&
    typeof values[0] === "string" &&
    values[0].trim() !== ""
    ? values[0].trim()
    : null;
}

function boundedNumber(
  value: string | null,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed >= minimum &&
    parsed <= maximum
    ? parsed
    : null;
}

function failure(message: string, code: string): AdminSecurityActionState {
  return Object.freeze({ status: "error", message, code });
}

function messageForCode(code: string): string {
  const messages: Record<string, string> = {
    INVALID_INPUT: "Bitte prüfe die Sicherheitsangaben.",
    FORBIDDEN:
      "Diese Aktion benötigt die passende Capability und eine frische AAL2-Bestätigung.",
    NOT_FOUND: "Die Freigabe ist nicht mehr verfügbar.",
    CONFLICT:
      "Die Freigabe ist abgelaufen, wurde bereits entschieden oder verletzt die Aufgabentrennung.",
    WRITE_FAILED:
      "Die Sicherheitsänderung konnte nicht vollständig gespeichert werden.",
  };
  return messages[code] ?? "Die Sicherheitsänderung ist fehlgeschlagen.";
}

function revalidateSecurity(): void {
  for (const path of [
    "/admin/security/roles",
    "/admin/security/grants",
    "/admin/security/authenticators",
    "/admin/security/break-glass",
    "/admin/audit",
  ]) {
    revalidatePath(path);
  }
}
