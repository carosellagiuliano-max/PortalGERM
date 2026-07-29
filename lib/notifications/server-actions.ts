"use server";

import type { AuthActionState } from "@/lib/auth/action-state";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasVerifiedEmailIdentity } from "@/lib/auth/email-verification-policy";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { NotificationPurpose } from "@/lib/generated/prisma/client";
import { setNotificationPreference } from "@/lib/notifications/preferences";

const MUTABLE_PURPOSES = [
  "JOB_ALERT",
  "EXTERNAL_APPLICATION_REMINDER",
  "COMMERCIAL_OPTIONAL",
] as const satisfies readonly NotificationPurpose[];

export async function setNotificationPreferenceAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const purposeValue = stringField(formData, "purpose");
  const purpose = MUTABLE_PURPOSES.find((item) => item === purposeValue);
  const expectedVersion = Number(stringField(formData, "expectedVersion"));
  if (
    purpose === undefined ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    return Object.freeze({
      status: "error",
      message: "Die Einstellung ist ungültig. Bitte lade die Seite neu.",
    });
  }
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({
      status: "error",
      message:
        "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.",
    });
  }
  const user = await getCurrentUser();
  if (user === null) {
    return Object.freeze({
      status: "error",
      message: "Bitte melde dich erneut an.",
    });
  }
  const environment = getServerEnvironment();
  if (
    environment.IDENTITY_VERIFICATION_ENFORCEMENT &&
    !hasVerifiedEmailIdentity({
      assurance: user.identityAssurance,
      emailVerifiedAt: user.emailVerifiedAt,
    })
  ) {
    return Object.freeze({
      status: "error",
      message:
        "Bitte bestätige zuerst deine E-Mail-Adresse, bevor du optionale Einstellungen änderst.",
    });
  }
  const result = await setNotificationPreference(
    {
      userId: user.id,
      actorUserId: user.id,
      purpose,
      enabled: checkboxField(formData, "enabled"),
      expectedVersion,
      reasonCode: "USER_SETTINGS",
    },
    {
      database: getDatabase(),
      environment,
      request,
    },
  );
  if (!result.ok) {
    return Object.freeze({
      status: "error",
      message:
        result.code === "VERSION_CONFLICT"
          ? "Die Einstellung wurde inzwischen geändert. Bitte lade die Seite neu."
          : "Die Einstellung konnte nicht gespeichert werden.",
    });
  }
  return Object.freeze({
    status: "success",
    message: result.preference.enabled
      ? "Optionale E-Mails für diesen Zweck sind vorgemerkt."
      : "Optionale E-Mails für diesen Zweck sind ausgeschaltet.",
    values: {
      version: String(result.preference.version),
      enabled: result.preference.enabled,
    },
  });
}

function stringField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function checkboxField(formData: FormData, name: string) {
  const value = formData.get(name);
  return value === "true" || value === "on" || value === "1";
}
