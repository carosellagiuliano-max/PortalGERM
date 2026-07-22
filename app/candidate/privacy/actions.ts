"use server";

import { revalidatePath } from "next/cache";

import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import { buildNotificationPersistenceRecord } from "@/lib/notifications/writer";
import { createPostgresPrivacyRequestRepository } from "@/lib/privacy/postgres-adapters";
import { createPostgresPrivacyCaseService } from "@/lib/privacy/privacy-case-service";
import {
  createPrivacyRequest,
  PRIVACY_REQUEST_POLICY_V1,
  privacyRequestInputSchema,
} from "@/lib/privacy/requests";

export type CandidatePrivacyActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
  supportPath?: string;
}>;

export const INITIAL_CANDIDATE_PRIVACY_ACTION_STATE: CandidatePrivacyActionState =
  Object.freeze({ status: "idle", message: "" });

export async function createCandidatePrivacyRequestAction(
  _previous: CandidatePrivacyActionState,
  formData: FormData,
): Promise<CandidatePrivacyActionState> {
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return errorState(
      "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.",
    );
  }
  const user = await requireCandidatePage();
  const parsed = privacyRequestInputSchema.safeParse(
    privacyRequestInputFromForm(formData),
  );
  if (!parsed.success) {
    return Object.freeze({
      status: "error" as const,
      message: "Bitte prüfe die Angaben deiner Datenschutzanfrage.",
      fieldErrors: privacyFieldErrors(parsed.error.issues),
    });
  }

  const database = getDatabase();
  const now = new Date();
  try {
    const existing = await database.privacyRequest.findFirst({
      where: {
        requesterUserId: user.id,
        OR: [
          { idempotencyKey: parsed.data.idempotencyKey },
          {
            type: parsed.data.type,
            status: { in: ["PENDING", "IDENTITY_CHECK", "IN_PROGRESS"] },
          },
        ],
      },
      select: { id: true },
    });
    if (existing === null) {
      const rate = await consumeRequestRateLimit(
        "PRIVACY_REQUEST",
        { userId: user.id },
        request,
        now,
        { database, environment: getServerEnvironment() },
      );
      if (!rate.allowed) {
        return errorState(
          "Zu viele Datenschutzanfragen im Self-Service. Dein Anliegen kann weiterhin über den Support erfasst werden.",
          PRIVACY_REQUEST_POLICY_V1.supportPath,
        );
      }
    }

    const result = await createPrivacyRequest(
      { userId: user.id, userStatus: user.status },
      parsed.data,
      now,
      createPostgresPrivacyRequestRepository(database),
    );
    if (!result.ok) {
      return errorState(
        result.code === "RATE_LIMITED"
          ? "Das zulässige Anfragevolumen ist erreicht. Bitte prüfe deine bestehenden Datenschutzfälle oder kontaktiere den Support."
          : "Deine Sitzung ist für diese Datenschutzanfrage nicht mehr gültig. Bitte melde dich erneut an.",
        result.code === "RATE_LIMITED"
          ? PRIVACY_REQUEST_POLICY_V1.supportPath
          : undefined,
      );
    }

    const notification = buildNotificationPersistenceRecord({
      recipientUserId: user.id,
      kind: "PRIVACY_REQUEST_CHANGED",
      dedupeKey: `privacy-created:${result.requestId}`,
      payload: {
        requestId: result.requestId,
        type: result.type,
        status: result.status,
      },
    });
    await database.notification.upsert({
      where: {
        recipientUserId_kind_dedupeKey: {
          recipientUserId: notification.recipientUserId,
          kind: notification.kind,
          dedupeKey: notification.dedupeKey,
        },
      },
      update: {},
      create: {
        ...notification,
        payload: notification.payload as Prisma.InputJsonObject,
      },
    });
    revalidatePath("/candidate/privacy");
    revalidatePath("/candidate/dashboard");
    return Object.freeze({
      status: "success" as const,
      message: result.created
        ? "Deine Datenschutzanfrage wurde erfasst."
        : "Diese Anfrage ist bereits erfasst. Der bestehende Datenschutzfall wird angezeigt.",
    });
  } catch {
    return errorState(
      "Die Datenschutzanfrage konnte nicht vollständig bestätigt werden. Bitte prüfe deine Fälle und versuche es bei Bedarf erneut.",
    );
  }
}

export async function cancelCandidatePrivacyRequestAction(
  _previous: CandidatePrivacyActionState,
  formData: FormData,
): Promise<CandidatePrivacyActionState> {
  const [user, request] = await Promise.all([
    requireCandidatePage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return errorState(
      "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.",
    );
  }
  const requestId = singleString(formData, "requestId");
  const idempotencyKey = singleString(formData, "idempotencyKey");
  const versionRaw = singleString(formData, "version");
  const version = versionRaw === undefined || !/^\d+$/u.test(versionRaw)
    ? null
    : Number(versionRaw);
  if (
    requestId === undefined ||
    idempotencyKey === undefined ||
    version === null ||
    !Number.isSafeInteger(version)
  ) {
    return errorState("Die Abbruch-Anfrage ist unvollständig.");
  }
  try {
    const result = await createPostgresPrivacyCaseService(
      getDatabase(),
    ).cancelOwnedRequest(
      { userId: user.id },
      { requestId, version, idempotencyKey },
      new Date(),
    );
    if (!result.ok) {
      return errorState(
        result.code === "STALE_VERSION"
          ? "Der Fall wurde inzwischen geändert. Bitte lade die Seite neu."
          : result.code === "NOT_FOUND"
            ? "Dieser Datenschutzfall ist nicht verfügbar."
            : "Der Fall kann in seinem aktuellen Zustand nicht abgebrochen werden.",
      );
    }
    revalidatePath("/candidate/privacy");
    revalidatePath(`/candidate/privacy/requests/${requestId}`);
    revalidatePath("/admin/privacy-requests");
    return Object.freeze({
      status: "success",
      message: result.idempotent
        ? "Der Fall war bereits abgebrochen."
        : "Der Datenschutzfall wurde abgebrochen.",
    });
  } catch {
    return errorState("Der Datenschutzfall konnte nicht abgebrochen werden.");
  }
}

function privacyRequestInputFromForm(formData: FormData) {
  const type = singleString(formData, "type");
  const base = {
    type,
    idempotencyKey: singleString(formData, "idempotencyKey"),
    noticeVersion: PRIVACY_REQUEST_POLICY_V1.noticeVersion,
  };
  if (type === "DELETE") {
    return {
      ...base,
      deleteConfirmation: singleString(formData, "deleteConfirmation"),
    };
  }
  if (type === "CORRECT") {
    return {
      ...base,
      correctionFieldCodes: formData.getAll("correctionFieldCodes"),
      correctionText: singleString(formData, "correctionText"),
    };
  }
  return base;
}

function singleString(formData: FormData, field: string) {
  const values = formData.getAll(field);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : undefined;
}

function privacyFieldErrors(issues: readonly Readonly<{ path: PropertyKey[] }>[]) {
  const errors: Record<string, readonly string[]> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || field in errors) continue;
    const message = PRIVACY_FIELD_MESSAGES[field];
    if (message !== undefined) errors[field] = Object.freeze([message]);
  }
  return Object.freeze(errors);
}

function errorState(
  message: string,
  supportPath?: string,
): CandidatePrivacyActionState {
  return Object.freeze({
    status: "error",
    message,
    ...(supportPath === undefined ? {} : { supportPath }),
  });
}

const PRIVACY_FIELD_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  type: "Die Art der Datenschutzanfrage ist ungültig. Bitte lade die Seite neu.",
  idempotencyKey: "Die Anfragekennung ist ungültig. Bitte lade die Seite neu.",
  deleteConfirmation: `Bitte gib exakt „${PRIVACY_REQUEST_POLICY_V1.deleteConfirmationPhrase}“ ein.`,
  correctionFieldCodes: "Wähle 1 bis 5 unterschiedliche Datenbereiche aus.",
  correctionText: "Beschreibe die Korrektur mit 20 bis 1000 Zeichen als reinen Text.",
});
