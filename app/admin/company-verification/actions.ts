"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPage } from "@/lib/auth/route-guards";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import {
  approveIndependentCompanyVerificationDecision,
  assignCompanyVerification,
  decideCompanyVerification,
  decideCompanyVerificationAppeal,
  requestIndependentCompanyVerificationApproval,
} from "@/lib/companies/verification/admin-service";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export type CompanyVerificationAdminActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  code?: string;
  approvalId?: string;
}>;

export async function companyVerificationAdminAction(
  _previous: CompanyVerificationAdminActionState,
  formData: FormData,
): Promise<CompanyVerificationAdminActionState> {
  const [user, request] = await Promise.all([
    requireAdminPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return errorState("FORBIDDEN");
  }
  const raw = readSingleValueForm(formData);
  const operation = raw?.operation;
  if (raw === null || operation === undefined) return errorState("INVALID_INPUT");
  delete raw.operation;
  if (raw.expectedVersion !== undefined) {
    const version = Number(raw.expectedVersion);
    if (!Number.isSafeInteger(version)) return errorState("INVALID_INPUT");
    raw.expectedVersion = version;
  }
  const environment = getServerEnvironment();
  const dependencies = Object.freeze({
    actor: {
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      capabilities: user.capabilities,
      sessionId: user.sessionId,
    },
    correlationId: request.correlationId,
    database: getDatabase(),
    now: new Date(),
    stepUpMode: environment.PRIVILEGED_STEP_UP_MODE,
  });
  const result =
    operation === "assign"
      ? await assignCompanyVerification(raw, dependencies)
      : operation === "decide"
        ? await decideCompanyVerification(raw, dependencies)
        : operation === "request-independent-approval"
          ? await requestIndependentCompanyVerificationApproval(
              raw,
              dependencies,
            )
          : operation === "approve-independent"
            ? await approveIndependentCompanyVerificationDecision(
                raw,
                dependencies,
              )
            : operation === "decide-appeal"
              ? await decideCompanyVerificationAppeal(raw, dependencies)
              : null;
  if (result === null) return errorState("INVALID_INPUT");
  if (!result.ok) return errorState(result.code);
  revalidatePath("/admin/company-verification");
  if ("requestId" in result.value) {
    revalidatePath(`/admin/company-verification/${result.value.requestId}`);
  }
  revalidatePath("/admin/companies");
  revalidatePath("/companies");
  revalidatePath("/jobs");
  return Object.freeze({
    status: "success",
    message: result.replay
      ? "Diese Aktion war bereits sicher verarbeitet."
      : "Die Trust-Aktion wurde vollständig gespeichert.",
    ...("approvalId" in result.value
      ? { approvalId: result.value.approvalId }
      : {}),
  });
}

function readSingleValueForm(formData: FormData) {
  const output: Record<string, unknown> = {};
  for (const key of new Set(
    [...formData.keys()].filter((field) => !field.startsWith("$ACTION_")),
  )) {
    const values = formData.getAll(key);
    if (values.length !== 1 || typeof values[0] !== "string") return null;
    const value = values[0].trim();
    if (value !== "") output[key] = value;
  }
  return output;
}

function errorState(code: string): CompanyVerificationAdminActionState {
  const message = {
    INVALID_INPUT: "Bitte prüfe die Eingaben.",
    FORBIDDEN: "Für diese Trust-Aktion fehlt die aktuelle Berechtigung oder Sicherheitsbestätigung.",
    NOT_FOUND: "Der Prüfdatensatz ist nicht mehr erreichbar.",
    CONFLICT: "Der Datensatz wurde parallel geändert. Bitte neu laden.",
    RESTRICTED: "Diese Entscheidung benötigt eine unabhängige zweite Freigabe.",
    INCOMPLETE: "Register- oder Domainnachweis ist nicht vollständig und aktuell.",
    WRITE_FAILED: "Die Trust-Aktion konnte nicht vollständig gespeichert werden.",
  }[code] ?? "Die Trust-Aktion wurde fail-closed abgelehnt.";
  return Object.freeze({ status: "error", code, message });
}
