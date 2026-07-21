"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getEmployerContext } from "@/lib/auth/employer-context";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { EmployerActionState } from "@/lib/employer/action-state";
import { addEmployerApplicationNote, draftEmployerApplicationText, sendEmployerApplicationMessage, transitionEmployerApplication } from "@/lib/employer/applications";
import { aiProvider } from "@/lib/providers/ai";
import { emailProvider } from "@/lib/providers/email";

export async function transitionApplicationAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return fail();
  const result = await transitionEmployerApplication(deps.access, { applicationId: formData.get("applicationId"), nextStatus: formData.get("nextStatus"), rejectionReason: emptyUndefined(formData.get("rejectionReason")), idempotencyKey: formData.get("idempotencyKey") }, deps);
  if (!result.ok) return fail(result.code === "CONFLICT" || result.code === "INVALID_TRANSITION" ? "Dieser Statuswechsel ist nicht mehr erlaubt. Bitte lade die Seite neu." : undefined);
  revalidate(result.duplicate ? "Status war bereits sicher verarbeitet." : "Status aktualisiert; Kandidat:in wurde einmalig informiert.", String(formData.get("applicationId") ?? ""));
  return success(result.duplicate ? "Status war bereits sicher verarbeitet." : "Status aktualisiert; Kandidat:in wurde einmalig informiert.");
}

export async function addEmployerNoteAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return fail();
  const result = await addEmployerApplicationNote(deps.access, { applicationId: formData.get("applicationId"), body: formData.get("body"), idempotencyKey: formData.get("idempotencyKey") }, deps);
  if (!result.ok) return fail();
  revalidatePath(`/employer/applicants/${String(formData.get("applicationId") ?? "")}`);
  return success("Private Arbeitgebernotiz gespeichert. Sie wird Kandidat:innen nie angezeigt.");
}

export async function sendEmployerMessageAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return fail();
  const result = await sendEmployerApplicationMessage(deps.access, { applicationId: formData.get("applicationId"), body: formData.get("body"), idempotencyKey: formData.get("idempotencyKey") }, deps);
  if (!result.ok) return fail();
  revalidatePath(`/employer/applicants/${String(formData.get("applicationId") ?? "")}`);
  return success(result.duplicate ? "Nachricht war bereits sicher gesendet." : "Nachricht gesendet.");
}

export async function draftApplicantTextAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return fail();
  const kind = formData.get("kind") === "INTERVIEW" ? "INTERVIEW" : "REJECTION";
  const text = await draftEmployerApplicationText(String(formData.get("applicationId") ?? ""), kind, deps.access, deps);
  return text === null ? fail() : { status: "success", message: `Editierbarer Mock-Vorschlag:\n\n${text}`, nextIdempotencyKey: randomUUID() };
}

async function dependencies() {
  const [context, request] = await Promise.all([getEmployerContext(), getAuthRequestContext()]);
  const current = context?.current;
  if (context === null || current === null || current === undefined || !isValidAuthMutationOrigin(request) || current.membershipRole === "VIEWER") return null;
  return { access: { companyId: current.companyId, membershipId: current.membershipId, userId: context.user.id, membershipRole: current.membershipRole }, database: getDatabase(), request, environment: getServerEnvironment(), emailProvider, aiProvider } as const;
}
function emptyUndefined(value: FormDataEntryValue | null) { const text = String(value ?? "").trim(); return text === "" ? undefined : text; }
function fail(message = "Die Bewerbungsaktion konnte nicht sicher ausgeführt werden."): EmployerActionState { return { status: "error", message }; }
function success(message: string): EmployerActionState { return { status: "success", message, nextIdempotencyKey: randomUUID() }; }
function revalidate(_message: string, id: string) { revalidatePath("/employer/applicants"); revalidatePath(`/employer/applicants/${id}`); revalidatePath("/employer/dashboard"); }
