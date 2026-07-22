"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getEmployerContext } from "@/lib/auth/employer-context";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import {
  buildCatalogUpgradePrompt,
  buildUpgradePrompt,
} from "@/lib/billing/upgrade-prompt";
import { getDatabase } from "@/lib/db/client";
import {
  closeEmployerJob,
  createEmployerJobRevisionFromPaused,
  createEmployerJobRevisionFromRejected,
  duplicateEmployerJob,
  employerJobAiSuggestionSchema,
  getEmployerJobAiSuggestion,
  pauseAndCreateEmployerJobRevision,
  pauseEmployerJob,
  reactivateEmployerJob,
  runEmployerJobReportingCheck,
  saveEmployerJobStep,
  submitEmployerJobForReview,
  type EmployerJobActor,
  type EmployerJobCommandCode,
  type EmployerJobCommandDependencies,
  type EmployerJobFormState,
  type EmployerJobQuotaReason,
} from "@/lib/employer/jobs";
import { aiProvider } from "@/lib/providers/ai";
import { jobroomProvider } from "@/lib/providers/jobroom";

export async function saveEmployerJobStepAction(
  _previousState: EmployerJobFormState,
  formData: FormData,
): Promise<EmployerJobFormState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return genericError();
  const step = Number(formData.get("step"));
  if (step !== 1 && step !== 2 && step !== 3) return errorState("Dieser Wizard-Schritt ist ungültig.");
  const data = step === 1 ? parseStepOne(formData) : step === 2 ? parseStepTwo(formData) : parseStepThree(formData);
  const result = await saveEmployerJobStep({ ...commandEnvelope(formData), step, data } as Parameters<typeof saveEmployerJobStep>[0], dependencies);
  if (!result.ok) {
    return commandError(
      result.code,
      result.issues,
      result.quotaReason,
      dependencies,
      result.suggestedPlanSlug,
    );
  }
  revalidateJob(result.value.jobId);
  redirect(`/employer/jobs/${result.value.jobId}?step=${step + 1}&saved=1`);
}

export async function runEmployerJobReportingCheckAction(
  _previousState: EmployerJobFormState,
  formData: FormData,
): Promise<EmployerJobFormState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return genericError();
  const result = await runEmployerJobReportingCheck({
    ...commandEnvelope(formData),
    occupationCodeId: formData.get("occupationCodeId"),
  } as Parameters<typeof runEmployerJobReportingCheck>[0], dependencies);
  if (!result.ok) return commandError(result.code, result.issues);
  revalidateJob(result.value.jobId);
  redirect(`/employer/jobs/${result.value.jobId}?step=5&checked=1`);
}

export async function employerJobAiSuggestionAction(
  _previousState: EmployerJobFormState,
  formData: FormData,
): Promise<EmployerJobFormState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return genericError();
  const input = employerJobAiSuggestionSchema.safeParse({
    jobId: stringValue(formData.get("jobId")) ?? "",
    operation: stringValue(formData.get("operation")) ?? "",
    text: stringValue(formData.get("text")) ?? "",
  });
  if (!input.success) return commandError("INVALID_INPUT", input.error.issues.map((issue) => issue.path.join(".") || "input"));
  const result = await getEmployerJobAiSuggestion(input.data, dependencies);
  if (!result.ok) return commandError(result.code, result.issues);
  return Object.freeze({
    status: "success",
    message: "Der lokale Mock-Assistent hat einen editierbaren Vorschlag erstellt. Es wurde nichts automatisch gespeichert.",
    suggestion: result.value.suggestion,
    nextIdempotencyKey: randomUUID(),
  });
}

export async function submitEmployerJobForReviewAction(
  _previousState: EmployerJobFormState,
  formData: FormData,
): Promise<EmployerJobFormState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return genericError();
  const result = await submitEmployerJobForReview(commandEnvelope(formData), dependencies);
  if (!result.ok) return commandError(result.code, result.issues);
  revalidateJob(result.value.jobId);
  redirect(`/employer/jobs/${result.value.jobId}?submitted=1`);
}

export async function pauseEmployerJobAction(
  previousState: EmployerJobFormState,
  formData: FormData,
) {
  return lifecycleAction(previousState, formData, pauseEmployerJob, "Das Inserat wurde pausiert.");
}

export async function pauseAndCreateEmployerJobRevisionAction(
  previousState: EmployerJobFormState,
  formData: FormData,
) {
  return lifecycleAction(previousState, formData, pauseAndCreateEmployerJobRevision, "Das öffentliche Inserat wurde pausiert und eine neue Revision angelegt.", 2);
}

export async function createEmployerJobRevisionFromPausedAction(
  previousState: EmployerJobFormState,
  formData: FormData,
) {
  return lifecycleAction(previousState, formData, createEmployerJobRevisionFromPaused, "Aus dem pausierten Inserat wurde eine neue Revision angelegt.", 2);
}

export async function createEmployerJobRevisionFromRejectedAction(
  previousState: EmployerJobFormState,
  formData: FormData,
) {
  return lifecycleAction(previousState, formData, createEmployerJobRevisionFromRejected, "Die abgelehnte Revision bleibt erhalten; ein neuer Entwurf wurde angelegt.", 2);
}

export async function reactivateEmployerJobAction(
  previousState: EmployerJobFormState,
  formData: FormData,
) {
  return lifecycleAction(previousState, formData, reactivateEmployerJob, "Das unveränderte, weiterhin gültige Inserat wurde reaktiviert.");
}

export async function closeEmployerJobAction(
  previousState: EmployerJobFormState,
  formData: FormData,
) {
  return lifecycleAction(previousState, formData, closeEmployerJob, "Das Inserat wurde geschlossen.");
}

export async function duplicateEmployerJobAction(
  _previousState: EmployerJobFormState,
  formData: FormData,
): Promise<EmployerJobFormState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return genericError();
  const result = await duplicateEmployerJob(commandEnvelope(formData), dependencies);
  if (!result.ok) return commandError(result.code, result.issues);
  revalidateJob(stringValue(formData.get("jobId")) ?? result.value.jobId);
  revalidateJob(result.value.jobId);
  redirect(`/employer/jobs/${result.value.jobId}?step=1&duplicated=1`);
}

async function lifecycleAction(
  _previousState: EmployerJobFormState,
  formData: FormData,
  command: (
    input: ReturnType<typeof commandEnvelope>,
    dependencies: EmployerJobCommandDependencies,
  ) => Promise<Awaited<ReturnType<typeof closeEmployerJob>>>,
  message: string,
  redirectStep?: number,
): Promise<EmployerJobFormState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return genericError();
  const result = await command(commandEnvelope(formData), dependencies);
  if (!result.ok) {
    return commandError(
      result.code,
      result.issues,
      result.quotaReason,
      dependencies,
      result.suggestedPlanSlug,
    );
  }
  revalidateJob(result.value.jobId);
  if (redirectStep !== undefined) redirect(`/employer/jobs/${result.value.jobId}?step=${redirectStep}&revisionCreated=1`);
  return Object.freeze({ status: "success", message, nextIdempotencyKey: randomUUID() });
}

async function actionDependencies(): Promise<EmployerJobCommandDependencies | null> {
  const [context, request] = await Promise.all([getEmployerContext(), getAuthRequestContext()]);
  if (context?.current === null || context?.current === undefined || !isValidAuthMutationOrigin(request)) return null;
  const actor: EmployerJobActor = {
    userId: context.user.id,
    email: context.user.email,
    membershipId: context.current.membershipId,
    membershipRole: context.current.membershipRole,
    companyId: context.current.companyId,
  };
  return Object.freeze({ actor, correlationId: request.correlationId, database: getDatabase(), now: new Date(), aiProvider, jobroomProvider });
}

function commandEnvelope(formData: FormData) {
  return {
    jobId: formData.get("jobId"),
    expectedJobVersion: formData.get("expectedJobVersion"),
    expectedRevisionVersion: formData.get("expectedRevisionVersion"),
    idempotencyKey: stringValue(formData.get("idempotencyKey")) ?? randomUUID(),
  } as unknown as {
    jobId: string;
    expectedJobVersion: number;
    expectedRevisionVersion: number;
    idempotencyKey: string;
  };
}

function parseStepOne(formData: FormData) {
  return {
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
  };
}

function parseStepTwo(formData: FormData) {
  return {
    companyIntro: formData.get("companyIntro"),
    tasks: parseLines(formData.get("tasks")),
    requirements: parseLines(formData.get("requirements")),
    niceToHave: parseLines(formData.get("niceToHave")),
    offer: formData.get("offer"),
    skillIds: formData.getAll("skillIds").flatMap((value) => typeof value === "string" ? [value] : []),
    benefits: parseBenefits(formData.get("benefits")),
  };
}

function parseStepThree(formData: FormData) {
  return {
    salaryPeriod: optionalValue(formData.get("salaryPeriod")),
    salaryMin: optionalValue(formData.get("salaryMin")),
    salaryMax: optionalValue(formData.get("salaryMax")),
    responseTargetDays: formData.get("responseTargetDays"),
    applicationProcessSteps: parseLines(formData.get("applicationProcessSteps")),
    applicationEffort: formData.get("applicationEffort"),
    requiredDocumentKinds: formData.getAll("requiredDocumentKinds").flatMap((value) => typeof value === "string" ? [value] : []),
    inclusionStatement: optionalValue(formData.get("inclusionStatement")),
    applicationContactKind: formData.get("applicationContactKind"),
    applicationContactValue: formData.get("applicationContactValue"),
  };
}

function parseLanguages(value: FormDataEntryValue | null) {
  return parseLines(value).map((line) => {
    const [code = "", minLevel = ""] = line.split(":", 2);
    return { code: code.trim(), minLevel: minLevel.trim() };
  });
}

function parseBenefits(value: FormDataEntryValue | null) {
  return parseLines(value).map((line) => {
    const [benefitCode = "", ...description] = line.split("|");
    return { benefitCode: benefitCode.trim(), description: description.join("|").trim() };
  });
}

function parseLines(value: FormDataEntryValue | null) {
  return (stringValue(value) ?? "").split(/\r?\n/gu).map((line) => line.replace(/^[\s*•\-–—]+/u, "").trim()).filter(Boolean);
}

function optionalValue(value: FormDataEntryValue | null) {
  const text = stringValue(value)?.trim();
  return text ? text : null;
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : null;
}

function revalidateJob(jobId: string) {
  revalidatePath("/employer/jobs");
  revalidatePath(`/employer/jobs/${jobId}`);
  revalidatePath("/employer/dashboard");
}

async function commandError(
  code: EmployerJobCommandCode,
  issues?: readonly string[],
  quotaReason?: EmployerJobQuotaReason,
  dependencies?: EmployerJobCommandDependencies,
  suggestedPlanSlug?: string,
): Promise<EmployerJobFormState> {
  const messages: Readonly<Record<EmployerJobCommandCode, string>> = {
    INVALID_INPUT: "Bitte prüfe die Eingaben dieses Schritts.",
    NOT_FOUND: "Dieses Inserat ist in deinem aktuellen Firmen- oder Zuweisungskontext nicht verfügbar.",
    FORBIDDEN: "Diese Aktion ist mit deiner Rolle nicht erlaubt.",
    CONFLICT: "Der Inseratestand hat sich geändert. Bitte lade die Seite neu; es wurde nichts überschrieben.",
    INCOMPLETE: "Vor der Einreichung fehlen noch Pflichtangaben oder der Compliance-Check.",
    PROVIDER_MISMATCH: "Der Mock-Check passt nicht zum versionierten Datensatz und wurde nicht gespeichert.",
    QUOTA_EXCEEDED: "Das aktive Joblimit ist erreicht. Der Entwurf bleibt unverändert erhalten.",
    VERIFICATION_REQUIRED: "Die Firma benötigt eine aktuelle Verifizierung.",
    RESTRICTED: "Eine aktive Moderationseinschränkung verhindert die Reaktivierung.",
    WRITE_FAILED: "Die Aktion konnte nicht vollständig gespeichert werden.",
  };
  const suffix = issues === undefined || issues.length === 0 ? "" : ` Betroffen: ${issues.join(", ")}.`;
  const upgradePrompt = code === "QUOTA_EXCEEDED"
    ? dependencies === undefined
      ? buildUpgradePrompt({
          reason: quotaReason ?? "ACTIVE_JOB_LIMIT_REACHED",
        })
      : await buildCatalogUpgradePrompt(
          {
            reason: quotaReason ?? "ACTIVE_JOB_LIMIT_REACHED",
            actorRole: dependencies.actor.membershipRole,
            suggestedPlanSlug,
          },
          {
            database: dependencies.database,
            now: dependencies.now ?? new Date(),
          },
        )
    : undefined;
  return Object.freeze({
    status: code === "CONFLICT" ? "conflict" : "error",
    message: `${messages[code]}${suffix}`,
    nextIdempotencyKey: randomUUID(),
    ...(upgradePrompt === undefined ? {} : { upgradePrompt }),
  });
}

function genericError() {
  return errorState("Die Anfrage konnte nicht sicher ausgeführt werden.");
}

function errorState(message: string): EmployerJobFormState {
  return Object.freeze({ status: "error", message, nextIdempotencyKey: randomUUID() });
}
