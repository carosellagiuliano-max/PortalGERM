"use server";

import { randomUUID } from "node:crypto";

import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { writeBestEffortAudit } from "@/lib/audit/log";
import { createPrismaAuditPort } from "@/lib/audit/prisma-port";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  SALES_LEAD_INTAKE_POLICY_V1,
  salesLeadRetainUntilV1,
} from "@/lib/sales/lead-policy";
import type {
  LeadActionField,
  LeadActionState,
} from "@/lib/sales/lead-action-state";
import { submitPublicEmployerLead } from "@/lib/sales/public-lead";
import { leadFormSchema } from "@/lib/validation/billing";

const FORM_FIELDS = [
  "companyName",
  "contactName",
  "email",
  "phone",
  "companySizeCode",
  "hiringNeedCode",
  "interestCode",
  "message",
  "callbackWindowCode",
  "acceptedContactPurpose",
  "idempotencyKey",
  "websiteConfirmation",
] as const;

const FIELD_MESSAGES: Readonly<Record<LeadActionField, string>> = Object.freeze({
  companyName: "Bitte gib einen Unternehmensnamen mit mindestens 2 Zeichen ein.",
  contactName: "Bitte gib eine Kontaktperson mit mindestens 2 Zeichen ein.",
  email: "Bitte prüfe die E-Mail-Adresse.",
  phone: "Bitte verwende bei einer Telefonnummer das internationale Format, zum Beispiel +41 79 123 45 67.",
  companySizeCode: "Bitte wähle eine Unternehmensgrösse.",
  hiringNeedCode: "Bitte wähle den ungefähren Einstellungsbedarf.",
  interestCode: "Bitte wähle ein Thema.",
  message: "Bitte beschreibe dein Anliegen mit 20 bis 2'000 Zeichen.",
  callbackWindowCode: "Bitte prüfe das gewünschte Rückruffenster.",
  acceptedContactPurpose: "Bitte bestätige den Kontaktzweck.",
});

export async function submitEmployerDemoLeadAction(
  _previous: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return errorState("Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.");
  }

  const raw = readStrictFormFields(formData);
  if (raw === null) {
    return errorState("Bitte lade das Formular neu und versuche es nochmals.");
  }
  const parsed = leadFormSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<LeadActionField, readonly string[]>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && field in FIELD_MESSAGES) {
        const typedField = field as LeadActionField;
        fieldErrors[typedField] = [FIELD_MESSAGES[typedField]];
      }
    }
    return Object.freeze({
      status: "error",
      message: "Bitte prüfe die markierten Angaben.",
      fieldErrors: Object.freeze(fieldErrors),
      values: safeFormValues(raw),
    });
  }

  const database = getDatabase();
  const environment = getServerEnvironment();
  const now = new Date();
  const rate = await consumeRequestRateLimit(
    "LEAD",
    {},
    request,
    now,
    { database, environment },
  );
  if (!rate.allowed) {
    const auditGate = await consumeRequestRateLimit(
      "LEAD_DENIAL_AUDIT",
      {},
      request,
      now,
      { database, environment },
    );
    if (auditGate.allowed) {
      await writeBestEffortAudit(
        createPrismaAuditPort(database),
        {
          action: "RATE_LIMITED",
          actorKind: "ANONYMOUS",
          capability: "PUBLIC_EMPLOYER_DEMO_SUBMIT",
          correlationId: request.correlationId,
          metadata: { preset: "LEAD", scope: rate.audit.scope },
          reasonCode: "RATE_LIMITED",
          result: "DENIED",
          retainUntil: salesLeadRetainUntilV1(now),
          targetId: randomUUID(),
          targetType: "SALES_LEAD",
        },
        undefined,
        {
          sourceIp: request.sourceIp,
          keyring: environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
        },
      );
    }
    return errorState("Zu viele Anfragen in kurzer Zeit. Bitte versuche es später erneut.", raw);
  }

  if (parsed.data.websiteConfirmation !== "") {
    return Object.freeze({
      status: "success",
      message: SALES_LEAD_INTAKE_POLICY_V1.successMessage,
    });
  }

  const result = await submitPublicEmployerLead(parsed.data, {
    database,
    environment,
    request,
    now,
  });
  if (result.ok) {
    return Object.freeze({
      status: "success",
      message: SALES_LEAD_INTAKE_POLICY_V1.successMessage,
    });
  }
  if (result.code === "NOTIFICATION_FAILED") {
    return errorState(
      "Deine Anfrage ist gespeichert, die interne Benachrichtigung aber noch nicht bestätigt. Bitte sende das Formular nochmals.",
      raw,
    );
  }
  if (result.code === "IDEMPOTENCY_CONFLICT") {
    return errorState("Bitte lade das Formular neu, bevor du eine weitere Anfrage sendest.", raw);
  }
  return errorState("Die Anfrage konnte nicht gespeichert werden. Bitte versuche es erneut.", raw);
}

function readStrictFormFields(formData: FormData) {
  const result: Record<(typeof FORM_FIELDS)[number], string> = {} as Record<
    (typeof FORM_FIELDS)[number],
    string
  >;
  for (const field of FORM_FIELDS) {
    const values = formData.getAll(field);
    if (values.length > 1 || (values[0] !== undefined && typeof values[0] !== "string")) {
      return null;
    }
    result[field] = (values[0] as string | undefined) ?? "";
  }
  return result;
}

function safeFormValues(raw: Record<string, string>) {
  return Object.freeze(Object.fromEntries(
    (Object.keys(FIELD_MESSAGES) as LeadActionField[])
      .filter((field) => field !== "acceptedContactPurpose")
      .map((field) => [field, raw[field] ?? ""]),
  )) as Partial<Record<LeadActionField, string>>;
}

function errorState(message: string, raw?: Record<string, string>): LeadActionState {
  return Object.freeze({
    status: "error",
    message,
    ...(raw === undefined ? {} : { values: safeFormValues(raw) }),
  });
}
