"use server";

import { revalidatePath } from "next/cache";

import type { TrustSafetyActionState } from "@/app/admin/trust-safety/action-state";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import {
  assignTrustSafetyCase,
  decideTrustSafetyAppeal,
  decideTrustSafetyCase,
  type TrustSafetyAdminDependencies,
} from "@/lib/trust-safety/case-service";

export async function assignTrustSafetyCaseAction(
  _state: TrustSafetyActionState,
  formData: FormData,
): Promise<TrustSafetyActionState> {
  const dependencies = await adminDependencies();
  if (dependencies === null) return failed("FORBIDDEN");
  const result = await assignTrustSafetyCase(
    {
      caseId: field(formData, "caseId"),
      assigneeUserId: field(formData, "assigneeUserId"),
      expectedVersion: integerField(formData, "expectedVersion"),
      reasonCode: field(formData, "reasonCode"),
    },
    dependencies,
  );
  if (!result.ok) return failed(result.code);
  refresh(result.value.caseId);
  return success("Der Fall ist einer berechtigten Review-Person zugewiesen.");
}

export async function decideTrustSafetyCaseAction(
  _state: TrustSafetyActionState,
  formData: FormData,
): Promise<TrustSafetyActionState> {
  const dependencies = await adminDependencies();
  if (dependencies === null) return failed("FORBIDDEN");
  const result = await decideTrustSafetyCase(
    {
      caseId: field(formData, "caseId"),
      expectedVersion: integerField(formData, "expectedVersion"),
      decision: field(formData, "decision"),
      reasonCode: field(formData, "reasonCode"),
      safeNote: field(formData, "safeNote"),
      stepUpEvidenceId: optionalField(formData, "stepUpEvidenceId"),
      stepUpGrantToken: optionalField(formData, "stepUpGrantToken"),
    },
    dependencies,
  );
  if (!result.ok) return failed(result.code);
  refresh(result.value.caseId);
  return success("Der Trust-&-Safety-Entscheid wurde atomar protokolliert.");
}

export async function decideTrustSafetyAppealAction(
  _state: TrustSafetyActionState,
  formData: FormData,
): Promise<TrustSafetyActionState> {
  const dependencies = await adminDependencies();
  if (dependencies === null) return failed("FORBIDDEN");
  const result = await decideTrustSafetyAppeal(
    {
      appealId: field(formData, "appealId"),
      decision: field(formData, "decision"),
      reasonCode: field(formData, "reasonCode"),
      expectedCaseVersion: integerField(formData, "expectedCaseVersion"),
      stepUpEvidenceId: optionalField(formData, "stepUpEvidenceId"),
      stepUpGrantToken: optionalField(formData, "stepUpGrantToken"),
    },
    dependencies,
  );
  if (!result.ok) return failed(result.code);
  refresh(result.value.caseId);
  return success(
    "Der Appeal wurde unabhängig entschieden; Restore-Voraussetzungen wurden serverseitig geprüft.",
  );
}

async function adminDependencies(): Promise<TrustSafetyAdminDependencies | null> {
  const [actor, request] = await Promise.all([
    requireAdminPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) return null;
  return Object.freeze({
    actor: {
      userId: actor.id,
      email: actor.email,
      role: actor.role,
      status: actor.status,
      sessionId: actor.sessionId,
      capabilities: actor.capabilities,
    },
    correlationId: request.correlationId,
    database: getDatabase(),
    now: new Date(),
  });
}

function refresh(caseId: string) {
  revalidatePath("/admin/trust-safety");
  revalidatePath(`/admin/trust-safety/${caseId}`);
  revalidatePath("/candidate/settings/security");
  revalidatePath("/employer/settings/security");
}

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalField(formData: FormData, name: string) {
  const value = field(formData, name);
  return value.length === 0 ? undefined : value;
}

function integerField(formData: FormData, name: string) {
  const value = field(formData, name);
  return /^\d+$/u.test(value) ? Number(value) : Number.NaN;
}

function success(message: string): TrustSafetyActionState {
  return Object.freeze({ status: "success", message });
}

function failed(code: string): TrustSafetyActionState {
  const copy: Record<string, string> = {
    INVALID_INPUT: "Die Angaben sind unvollständig oder unsicher.",
    FORBIDDEN:
      "Capability, frische Sicherheitsbestätigung oder Actor-Trennung fehlt.",
    NOT_FOUND: "Der Fall oder die berechtigte Review-Person fehlt.",
    CONFLICT:
      "Der Fall wurde inzwischen geändert oder dieselbe Person darf nicht final entscheiden.",
    VERIFICATION_REQUIRED:
      "Restore bleibt gesperrt, bis die fachliche Identität oder Firma erneut verifiziert ist.",
    WRITE_FAILED:
      "Der Entscheid konnte nicht vollständig und atomar gespeichert werden.",
  };
  return Object.freeze({
    status: code === "CONFLICT" ? "conflict" : "error",
    message: copy[code] ?? "Die Trust-&-Safety-Aktion wurde abgelehnt.",
  });
}
