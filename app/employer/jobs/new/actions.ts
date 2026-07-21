"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getEmployerContext } from "@/lib/auth/employer-context";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { getDatabase } from "@/lib/db/client";
import {
  createEmployerJobDraft,
  jobWizardStepOneSchema,
  type EmployerJobActor,
  type EmployerJobFormState,
} from "@/lib/employer/jobs";

export async function createEmployerJobDraftAction(
  _previousState: EmployerJobFormState,
  formData: FormData,
): Promise<EmployerJobFormState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return errorState("Die Anfrage konnte nicht sicher ausgeführt werden.");
  const draft = jobWizardStepOneSchema.safeParse({
    title: formData.get("title"),
    categoryId: formData.get("categoryId"),
    jobType: formData.get("jobType"),
    workloadMin: formData.get("workloadMin"),
    workloadMax: formData.get("workloadMax"),
    cantonId: optionalValue(formData.get("cantonId")),
    cityId: optionalValue(formData.get("cityId")),
    locationLabel: optionalValue(formData.get("locationLabel")),
    remoteType: formData.get("remoteType"),
    remoteCountryCode: optionalValue(formData.get("remoteCountryCode")),
    languages: parseLanguages(formData.get("languages")),
    validThrough: optionalValue(formData.get("validThrough")),
    startDate: optionalValue(formData.get("startDate")),
    startByArrangement: formData.get("startByArrangement") === "true",
  });
  if (!draft.success) {
    return jobErrorState("INVALID_INPUT", draft.error.issues.map((issue) => issue.path.join(".")).filter(Boolean));
  }
  const result = await createEmployerJobDraft({
    ...draft.data,
    idempotencyKey: stringValue(formData.get("idempotencyKey")) ?? randomUUID(),
  }, dependencies);
  if (!result.ok) return jobErrorState(result.code, result.issues);
  revalidatePath("/employer/jobs");
  revalidatePath("/employer/dashboard");
  redirect(`/employer/jobs/${result.value.jobId}?step=2&created=1`);
}

async function actionDependencies() {
  const [context, request] = await Promise.all([getEmployerContext(), getAuthRequestContext()]);
  if (context?.current === null || context?.current === undefined || !isValidAuthMutationOrigin(request)) return null;
  const actor: EmployerJobActor = {
    userId: context.user.id,
    email: context.user.email,
    membershipId: context.current.membershipId,
    membershipRole: context.current.membershipRole,
    companyId: context.current.companyId,
  };
  return Object.freeze({ actor, correlationId: request.correlationId, database: getDatabase(), now: new Date() });
}

function parseLanguages(value: FormDataEntryValue | null) {
  const text = stringValue(value) ?? "";
  return text.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [code = "", minLevel = ""] = line.split(":", 2);
    return { code: code.trim(), minLevel: minLevel.trim() };
  });
}

function optionalValue(value: FormDataEntryValue | null) {
  const text = stringValue(value)?.trim();
  return text ? text : null;
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : null;
}

function jobErrorState(code: string, issues?: readonly string[]): EmployerJobFormState {
  const messages: Readonly<Record<string, string>> = {
    INVALID_INPUT: "Bitte prüfe Titel, Pensum, Ort, Start, Laufzeit und Sprachen.",
    NOT_FOUND: "Der Firmenkontext ist nicht mehr verfügbar.",
    FORBIDDEN: "Mit dieser Rolle darf kein Inserat erstellt werden.",
    WRITE_FAILED: "Der Entwurf konnte nicht gespeichert werden.",
  };
  const suffix = issues === undefined || issues.length === 0 ? "" : ` Betroffen: ${issues.join(", ")}.`;
  return errorState(`${messages[code] ?? "Der Entwurf konnte nicht erstellt werden."}${suffix}`);
}

function errorState(message: string): EmployerJobFormState {
  return Object.freeze({ status: "error", message, nextIdempotencyKey: randomUUID() });
}
