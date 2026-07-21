"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireEmployerPage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  EmployerCompanyDomainError,
  employerVerificationCommandSchema,
  startNewCompanyVerificationCycle,
  submitCurrentCompanyVerification,
  type EmployerCompanyActionState,
} from "@/lib/employer/company";
import { requireEmployerCompanyContext } from "@/lib/employer/context";

const FORM_FIELDS = new Set([
  "expectedCurrentRequestId",
  "idempotencyKey",
  "evidenceSummary",
  "evidenceReference",
]);

export async function startNewCompanyVerificationCycleAction(
  _previous: EmployerCompanyActionState,
  formData: FormData,
): Promise<EmployerCompanyActionState> {
  return verificationAction("NEW_CYCLE", formData);
}

export async function submitCurrentCompanyVerificationAction(
  _previous: EmployerCompanyActionState,
  formData: FormData,
): Promise<EmployerCompanyActionState> {
  return verificationAction("CURRENT_CYCLE", formData);
}

async function verificationAction(
  mode: "NEW_CYCLE" | "CURRENT_CYCLE",
  formData: FormData,
): Promise<EmployerCompanyActionState> {
  const security = await secureVerificationMutation();
  if (!security.ok) return security.state;
  const raw = readVerificationForm(formData);
  const parsed = employerVerificationCommandSchema.safeParse(raw);
  if (!parsed.success) {
    return Object.freeze({
      status: "error",
      message:
        "Bitte beschreibe den Nachweis mit mindestens 20 Zeichen und gib eine nachvollziehbare Referenz an.",
      fieldErrors: Object.freeze({
        evidence: ["Bitte prüfe Beschreibung und Referenz."],
      }),
    });
  }
  try {
    const result = mode === "NEW_CYCLE"
      ? await startNewCompanyVerificationCycle(
          security.database,
          security.scope,
          parsed.data,
        )
      : await submitCurrentCompanyVerification(
          security.database,
          security.scope,
          parsed.data,
        );
    revalidatePath("/employer/company");
    revalidatePath("/employer/dashboard");
    return Object.freeze({
      status: "success",
      message: result.duplicate
        ? "Diese Verifizierungsanfrage wurde bereits sicher übermittelt."
        : mode === "NEW_CYCLE"
          ? "Neuer Prüfzyklus erstellt und zur Verifizierung eingereicht."
          : "Nachweise im bestehenden Prüfzyklus eingereicht.",
      nextIdempotencyKey: randomUUID(),
    });
  } catch (error) {
    if (error instanceof EmployerCompanyDomainError) {
      if (error.code === "CONFLICT") {
        return Object.freeze({
          status: "error",
          code: "CONFLICT",
          message:
            "Der Prüfstatus hat sich inzwischen geändert. Lade den aktuellen Verlauf neu; es wurde kein zweiter Prüfzyklus erzeugt.",
        });
      }
      if (error.code === "FORBIDDEN" || error.code === "NOT_FOUND") {
        return Object.freeze({
          status: "error",
          code: "FORBIDDEN",
          message: "Deine aktuelle Firmenrolle darf keine Nachweise einreichen.",
        });
      }
    }
    return Object.freeze({
      status: "error",
      message:
        "Die Verifizierungsanfrage konnte nicht gespeichert werden. Bitte versuche es erneut.",
    });
  }
}

async function secureVerificationMutation() {
  const [user, company, request] = await Promise.all([
    requireEmployerPage(),
    requireEmployerCompanyContext(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({
      ok: false as const,
      state: Object.freeze({
        status: "error" as const,
        message:
          "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.",
      }),
    });
  }
  const environment = getServerEnvironment();
  return Object.freeze({
    ok: true as const,
    database: getDatabase(),
    scope: Object.freeze({
      companyId: company.companyId,
      membershipId: company.membershipId,
      actorUserId: user.id,
      correlationId: request.correlationId,
      now: new Date(),
      auditIpContext: Object.freeze({
        sourceIp: request.sourceIp,
        keyring: environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
      }),
    }),
  });
}

function readVerificationForm(formData: FormData) {
  if (
    [...formData.keys()].some(
      (field) => !field.startsWith("$ACTION_") && !FORM_FIELDS.has(field),
    )
  ) {
    return null;
  }
  const values = Object.fromEntries(
    [...FORM_FIELDS].map((field) => [field, singleString(formData, field)]),
  ) as Record<string, string | null>;
  if (Object.values(values).some((value) => value === null)) return null;
  return {
    expectedCurrentRequestId:
      values.expectedCurrentRequestId === ""
        ? null
        : values.expectedCurrentRequestId,
    idempotencyKey: values.idempotencyKey,
    evidence: {
      summary: values.evidenceSummary,
      reference: values.evidenceReference,
    },
  };
}

function singleString(formData: FormData, field: string) {
  const values = formData.getAll(field);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0].trim()
    : null;
}
