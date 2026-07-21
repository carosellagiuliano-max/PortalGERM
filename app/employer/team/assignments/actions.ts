"use server";

import { revalidatePath } from "next/cache";

import { getEmployerContext } from "@/lib/auth/employer-context";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { EmployerActionState } from "@/lib/employer/action-state";
import { assignRecruiterToJob, revokeJobAssignment } from "@/lib/employer/team";

export async function assignRecruiterAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return fail();
  const expiresAt = String(formData.get("expiresAt") ?? "").trim();
  const result = await assignRecruiterToJob(deps.companyId, deps.actor, { jobId: formData.get("jobId"), membershipId: formData.get("membershipId"), role: formData.get("role"), ...(expiresAt === "" ? {} : { expiresAt }) }, deps);
  if (!result.ok) return { status: "error", message: result.code === "INVALID_INPUT" ? "Bitte prüfe Job, Recruiter, Rolle und Ablaufdatum." : "Die Zuweisung konnte nicht sicher gespeichert werden." };
  revalidatePath("/employer/team");
  return { status: "success", message: "Job-Zuweisung ist ab sofort wirksam." };
}

export async function revokeAssignmentAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return fail();
  const result = await revokeJobAssignment(deps.companyId, deps.actor, String(formData.get("assignmentId") ?? ""), deps);
  if (!result.ok) return fail();
  revalidatePath("/employer/team");
  return { status: "success", message: "Zuweisung widerrufen; der Zugriff endet beim nächsten Query." };
}

async function dependencies() {
  const [context, request] = await Promise.all([getEmployerContext(), getAuthRequestContext()]);
  const current = context?.current;
  if (context === null || current === null || current === undefined || !isValidAuthMutationOrigin(request) || (current.membershipRole !== "OWNER" && current.membershipRole !== "ADMIN")) return null;
  return { companyId: current.companyId, actor: { userId: context.user.id, membershipId: current.membershipId, role: current.membershipRole }, request, environment: getServerEnvironment(), database: getDatabase() } as const;
}
function fail(): EmployerActionState { return { status: "error", message: "Die Zuweisung konnte nicht sicher ausgeführt werden." }; }
