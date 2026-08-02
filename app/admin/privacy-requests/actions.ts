"use server";

import { revalidatePath } from "next/cache";

import type { AdminPrivacyCaseActionState } from "@/app/admin/privacy-requests/action-state";
import {
  hasAdminCapability,
  PHASE_14_PRIVACY_ADMIN_CAPABILITIES,
} from "@/lib/admin/capabilities";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { getServerEnvironment } from "@/lib/config/env";
import type { PrivacyRequestRejectionCode } from "@/lib/generated/prisma/enums";
import { createPostgresPrivacyCaseService } from "@/lib/privacy/privacy-case-service";
import {
  approveAndEnqueuePrivacyExecution,
  requestPrivacyExecutionApproval,
} from "@/lib/privacy/execution-approval";

export async function adminPrivacyCaseAction(
  _previous: AdminPrivacyCaseActionState,
  formData: FormData,
): Promise<AdminPrivacyCaseActionState> {
  const [admin, request] = await Promise.all([
    requireAdminPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return failure(
      "Die Anfrage konnte nicht sicher bestätigt werden.",
      "FORBIDDEN",
    );
  }

  const operation = one(formData, "operation");
  const requestId = one(formData, "requestId");
  const idempotencyKey = one(formData, "idempotencyKey");
  const version = nonnegativeInteger(one(formData, "version"));
  if (
    operation === null ||
    requestId === null ||
    idempotencyKey === null ||
    version === null
  ) {
    return failure("Das Formular ist unvollständig.", "INVALID_COMMAND");
  }

  const database = getDatabase();
  const service = createPostgresPrivacyCaseService(database);
  const actor = Object.freeze({
    userId: admin.id,
    capabilities: PHASE_14_PRIVACY_ADMIN_CAPABILITIES.filter((capability) =>
      hasAdminCapability(
        {
          userId: admin.id,
          role: admin.role,
          status: admin.status,
          capabilities: admin.capabilities,
        },
        capability,
      ),
    ),
  });
  const now = new Date();

  try {
    if (operation === "privacy-request-execution-approval") {
      const environment = getServerEnvironment();
      const result = await requestPrivacyExecutionApproval(
        {
          requestId,
          requestVersion: version,
          idempotencyKey,
          stepUpEvidenceId: one(formData, "stepUpEvidenceId"),
          stepUpGrantToken: one(formData, "stepUpGrantToken"),
        },
        {
          actor: {
            userId: admin.id,
            sessionId: admin.sessionId,
            role: admin.role,
            status: admin.status,
            capabilities: admin.capabilities,
          },
          correlationId: request.correlationId,
          database,
          environment,
          now,
        },
      );
      if (!result.ok) {
        return failure(messageForApprovalCode(result.code), result.code);
      }
      revalidatePrivacyCasePaths(requestId);
      return success(
        result.replay
          ? "Diese Vollzugsfreigabe war bereits sicher beantragt."
          : "Vollzug beantragt. Eine zweite unabhängige Privacy-Person muss ihn mit eigener Sicherheitsbestätigung freigeben.",
      );
    }

    if (operation === "privacy-approve-execution") {
      const environment = getServerEnvironment();
      const approvalId = one(formData, "approvalId");
      const result = await approveAndEnqueuePrivacyExecution(
        {
          approvalId,
          requestId,
          idempotencyKey,
          stepUpEvidenceId: one(formData, "stepUpEvidenceId"),
          stepUpGrantToken: one(formData, "stepUpGrantToken"),
        },
        {
          actor: {
            userId: admin.id,
            sessionId: admin.sessionId,
            role: admin.role,
            status: admin.status,
            capabilities: admin.capabilities,
          },
          correlationId: request.correlationId,
          database,
          environment,
          now,
        },
      );
      if (!result.ok) {
        return failure(messageForApprovalCode(result.code), result.code);
      }
      revalidatePrivacyCasePaths(requestId);
      return success(
        result.replay
          ? "Diese Freigabe war bereits atomar in die Worker-Queue gestellt."
          : "Unabhängig freigegeben und genau einmal in die Privacy-Worker-Queue gestellt.",
      );
    }

    const common = { requestId, version, idempotencyKey } as const;
    const result =
      operation === "privacy-start-identity"
        ? await service.startIdentityCheck(actor, common, now)
        : operation === "privacy-verify-identity"
          ? await service.verifyIdentity(actor, common, now)
          : operation === "privacy-reject"
            ? await service.rejectRequest(
                actor,
                {
                  ...common,
                  reasonCode: one(
                    formData,
                    "reasonCode",
                  ) as PrivacyRequestRejectionCode,
                  ...optionalText(formData, "safeNote"),
                },
                now,
              )
            : operation === "privacy-add-note"
              ? await service.addInternalNote(
                  actor,
                  { ...common, note: one(formData, "note") ?? "" },
                  now,
                )
              : null;

    if (result === null) {
      return failure("Unbekannte Datenschutz-Aktion.", "INVALID_COMMAND");
    }
    if (!result.ok) return failure(messageForCode(result.code), result.code);

    revalidatePrivacyCasePaths(requestId);
    return success(
      result.idempotent
        ? "Diese Aktion war bereits sicher verarbeitet."
        : successMessage(operation),
    );
  } catch {
    return failure(
      "Die Datenschutz-Aktion konnte nicht vollständig ausgeführt werden.",
      "WRITE_FAILED",
    );
  }
}

function revalidatePrivacyCasePaths(requestId: string) {
  revalidatePath("/admin/privacy-requests");
  revalidatePath(`/admin/privacy-requests/${requestId}`);
  revalidatePath("/candidate/privacy");
  revalidatePath(`/candidate/privacy/requests/${requestId}`);
}

function success(message: string): AdminPrivacyCaseActionState {
  return Object.freeze({ status: "success", message });
}

function failure(message: string, code: string): AdminPrivacyCaseActionState {
  return Object.freeze({ status: "error", message, code });
}

function successMessage(operation: string) {
  return operation === "privacy-start-identity"
    ? "Identitätsprüfung gestartet."
    : operation === "privacy-verify-identity"
      ? "Identität bestätigt; der Fall ist nun in Bearbeitung."
      : operation === "privacy-reject"
            ? "Anfrage mit dokumentiertem Grund abgelehnt."
            : "Interne Notiz gespeichert.";
}

function messageForApprovalCode(code: string) {
  return code === "DISABLED"
    ? "Der autonome Privacy-Vollzug ist serverseitig deaktiviert oder seine Provider-/Outbox-Konfiguration ist unvollständig."
    : code === "STEP_UP_REQUIRED"
      ? "Für diesen exakten Fall fehlt eine frische, einmalige Sicherheitsbestätigung."
      : code === "FORBIDDEN"
        ? "Berechtigung oder Funktionstrennung erlauben diese Aktion nicht."
        : code === "STALE_VERSION" || code === "CONFIGURATION_CHANGED"
          ? "Fall oder Laufzeitkonfiguration haben sich geändert. Bitte lade die Seite neu und starte eine neue Freigabe."
          : code === "CONFLICT"
            ? "Für diesen Fall besteht bereits eine andere oder abgelaufene Freigabe."
            : "Die Privacy-Freigabe konnte nicht sicher gespeichert werden.";
}

function messageForCode(code: string) {
  return code === "FORBIDDEN"
    ? "Für diese Aktion fehlt die Berechtigung."
    : code === "NOT_FOUND"
      ? "Der Fall ist nicht verfügbar."
      : code === "STALE_VERSION"
        ? "Der Fall wurde inzwischen geändert. Bitte lade die Seite neu."
        : code === "CHALLENGE_UNAVAILABLE"
          ? "Die Identitätsprüfung ist noch nicht erfolgreich abgeschlossen."
          : code === "WRONG_CASE_TYPE"
            ? "Diese Aktion passt nicht zum Anfragetyp."
            : "Die Aktion ist im aktuellen Zustand oder mit diesen Angaben nicht zulässig.";
}

function one(formData: FormData, name: string): string | null {
  const values = formData.getAll(name);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0].trim()
    : null;
}

function nonnegativeInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function optionalText(formData: FormData, name: string) {
  const value = one(formData, name);
  return value === null || value === "" ? {} : { [name]: value };
}
