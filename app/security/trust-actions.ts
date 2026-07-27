"use server";

import { revalidatePath } from "next/cache";

import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireAuthenticatedPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { submitTrustSafetyAppeal } from "@/lib/trust-safety/case-service";

export type TrustAppealActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
}>;

export async function submitTrustSafetyAppealAction(
  _state: TrustAppealActionState,
  formData: FormData,
): Promise<TrustAppealActionState> {
  const [user, request] = await Promise.all([
    requireAuthenticatedPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) return failed();
  const result = await submitTrustSafetyAppeal(
    {
      caseId: field(formData, "caseId"),
      safeStatement: field(formData, "safeStatement"),
    },
    {
      database: getDatabase(),
      actorUserId: user.id,
      correlationId: request.correlationId,
      now: new Date(),
    },
  );
  if (!result.ok) return failed(result.code);
  revalidatePath("/candidate/settings/security");
  revalidatePath("/employer/settings/security");
  revalidatePath(`/admin/trust-safety/${result.value.caseId}`);
  return Object.freeze({
    status: "success",
    message:
      "Dein Widerspruch wurde sicher erfasst und wird von einer anderen berechtigten Person geprüft.",
  });
}

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function failed(code?: string): TrustAppealActionState {
  return Object.freeze({
    status: "error",
    message:
      code === "CONFLICT"
        ? "Für diese Entscheidversion besteht bereits ein Widerspruch."
        : "Der Widerspruch konnte nicht sicher erfasst werden.",
  });
}
