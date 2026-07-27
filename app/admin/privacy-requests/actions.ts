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
import { createPrivacyExportV2 } from "@/lib/privacy/export-v2";
import { runPrivacyExecutionV2 } from "@/lib/privacy/execution-v2";
import { emailProvider } from "@/lib/providers/email";
import { createDocumentObjectStore } from "@/lib/providers/storage/document-storage-composition";
import { createPrivacyExportObjectStore } from "@/lib/providers/storage/privacy-export-storage";

export async function adminPrivacyCaseAction(
  _previous: AdminPrivacyCaseActionState,
  formData: FormData,
): Promise<AdminPrivacyCaseActionState> {
  const [admin, request] = await Promise.all([
    requireAdminPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return failure("Die Anfrage konnte nicht sicher bestätigt werden.", "FORBIDDEN");
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
    if (operation === "privacy-complete-export") {
      const environment = getServerEnvironment();
      const result = await createPrivacyExportV2(
        {
          privacyRequestId: requestId,
          actorUserId: admin.id,
          approvalActorUserId: one(formData, "approvalActorUserId"),
          idempotencyKey,
          approvalEvidenceRef: one(formData, "approvalEvidenceRef"),
          stepUpEvidenceRef: one(formData, "stepUpEvidenceRef"),
        },
        {
          database,
          exportStore: createPrivacyExportObjectStore(environment),
          documentStore: createDocumentObjectStore(environment),
          exportKeyring:
            environment.secrets.keyrings.PRIVACY_EXPORT_KEYS,
          featureEnabled: environment.PRIVACY_EXPORT_V2,
          cohortAllowed: environment.PRIVACY_PROCESSING_COHORT === "test",
          processingMode: environment.PRIVACY_PROCESSING_MODE,
          now,
        },
      );
      if (!result.ok) {
        return failure(
          result.code === "FEATURE_DISABLED"
            ? "Export V2 ist serverseitig gesperrt. Es wird kein Mock-Abschluss erzeugt."
            : "Der reale Export konnte nicht sicher abgeschlossen werden.",
          result.code,
        );
      }
      revalidatePrivacyCasePaths(requestId);
      return success(
        result.replay
          ? "Das verschlüsselte Exportartefakt war bereits sicher erstellt."
          : "Verschlüsseltes Exportartefakt erstellt. Der Einmal-Download ist höchstens 15 Minuten verfügbar.",
      );
    }

    if (
      operation === "privacy-complete-delete" ||
      operation === "privacy-complete-correction"
    ) {
      const environment = getServerEnvironment();
      const result = await runPrivacyExecutionV2(
        {
          privacyRequestId: requestId,
          actorUserId: admin.id,
          approvalActorUserId: one(formData, "approvalActorUserId"),
          idempotencyKey,
          approvalEvidenceRef: one(formData, "approvalEvidenceRef"),
          stepUpEvidenceRef: one(formData, "stepUpEvidenceRef"),
        },
        {
          database,
          documentStore: createDocumentObjectStore(environment),
          correctionEnabled: environment.PRIVACY_CORRECTION_EXECUTION,
          erasureEnabled: environment.PRIVACY_ERASURE_EXECUTION,
          cohortAllowed: environment.PRIVACY_PROCESSING_COHORT === "test",
          processingMode: environment.PRIVACY_PROCESSING_MODE,
          now,
        },
      );
      if (!result.ok) {
        return failure(
          result.code === "FEATURE_DISABLED"
            ? "Der reale Privacy-Vollzug ist serverseitig gesperrt. Es wird kein Assessment als Löschung oder Korrektur ausgegeben."
            : result.code === "RETRY_REQUIRED"
              ? "Ein Processor ist vorübergehend ausgefallen. Der Fall bleibt sichtbar offen und kann sicher fortgesetzt werden."
              : "Die Privacy-Execution konnte nicht sicher abgeschlossen werden.",
          result.code,
        );
      }
      revalidatePrivacyCasePaths(requestId);
      return success(
        result.replay
          ? "Diese Privacy-Execution war bereits vollständig verarbeitet."
          : "Alle erforderlichen Processor-Outcomes sind terminal dokumentiert.",
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

    if (operation === "privacy-start-identity" && result.status === "IDENTITY_CHECK") {
      await sendPrivacyStatusEmail(requestId, "IDENTITY_CHECK", idempotencyKey);
    } else if (
      ["privacy-complete-delete", "privacy-complete-correction"].includes(operation) &&
      result.status === "COMPLETED"
    ) {
      await sendPrivacyStatusEmail(requestId, "COMPLETED", idempotencyKey);
    } else if (operation === "privacy-reject" && result.status === "REJECTED") {
      await sendPrivacyStatusEmail(requestId, "REJECTED", idempotencyKey);
    }
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

async function sendPrivacyStatusEmail(
  requestId: string,
  status: "IDENTITY_CHECK" | "COMPLETED" | "REJECTED",
  idempotencyKey: string,
) {
  const privacyCase = await getDatabase().privacyRequest.findUnique({
    where: { id: requestId },
    select: { requester: { select: { email: true } } },
  });
  if (privacyCase === null) return;
  try {
    await emailProvider.send({
      to: privacyCase.requester.email,
      templateKey: "privacy_request_changed",
      subject: "Status deiner Datenschutzanfrage wurde aktualisiert",
      data: {
        statusLabel:
          status === "IDENTITY_CHECK"
            ? "Identitätsprüfung erforderlich"
            : status === "COMPLETED"
              ? "Abgeschlossen"
              : "Abgelehnt",
        idempotencyKey,
      },
    });
  } catch {
    // The persisted case transition and notification remain authoritative.
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
      : operation === "privacy-complete-delete"
        ? "Löschungsprüfung abgeschlossen."
        : operation === "privacy-complete-correction"
          ? "Korrekturergebnis dokumentiert."
          : operation === "privacy-reject"
            ? "Anfrage mit dokumentiertem Grund abgelehnt."
            : "Interne Notiz gespeichert.";
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
