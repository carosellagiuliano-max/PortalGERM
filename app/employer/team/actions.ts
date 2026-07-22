"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getEmployerContext } from "@/lib/auth/employer-context";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { buildCatalogUpgradePrompt } from "@/lib/billing/upgrade-prompt";
import type { EmployerActionState } from "@/lib/employer/action-state";
import {
  changeCompanyMemberRole,
  removeCompanyMember,
  resendCompanyInvitation,
  revokeCompanyInvitation,
  sendCompanyInvitation,
} from "@/lib/employer/team";
import { emailProvider } from "@/lib/providers/email";

export async function sendInvitationAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return error("Die Anfrage konnte nicht sicher bestätigt werden.");
  const result = await sendCompanyInvitation(deps.companyId, deps.actor, { email: formData.get("email"), role: formData.get("role") }, deps);
  if (!result.ok) return teamError(result.code, deps, result.suggestedPlanSlug);
  revalidate();
  return success(result.emailRecorded ? "Einladung sicher gespeichert und in der lokalen Mailbox erfasst." : "Einladung gespeichert; die E-Mail kann erneut gesendet werden.");
}

export async function resendInvitationAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return error("Die Anfrage konnte nicht sicher bestätigt werden.");
  const result = await resendCompanyInvitation(deps.companyId, deps.actor, String(formData.get("invitationId") ?? ""), deps);
  if (!result.ok) return error(teamMessage(result.code));
  revalidate();
  return success("Ein neuer Link wurde ausgestellt; der alte Link ist ungültig.");
}

export async function revokeInvitationAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return error("Die Anfrage konnte nicht sicher bestätigt werden.");
  const result = await revokeCompanyInvitation(deps.companyId, deps.actor, String(formData.get("invitationId") ?? ""), deps);
  if (!result.ok) return error(teamMessage(result.code));
  revalidate();
  return success("Einladung widerrufen.");
}

export async function changeMemberRoleAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return error("Die Anfrage konnte nicht sicher bestätigt werden.");
  const result = await changeCompanyMemberRole(deps.companyId, deps.actor, { membershipId: formData.get("membershipId"), role: formData.get("role") }, deps);
  if (!result.ok) return error(teamMessage(result.code));
  revalidate();
  return success("Rolle aktualisiert.");
}

export async function removeMemberAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const deps = await dependencies();
  if (deps === null) return error("Die Anfrage konnte nicht sicher bestätigt werden.");
  const result = await removeCompanyMember(deps.companyId, deps.actor, { membershipId: formData.get("membershipId"), reason: formData.get("reason") }, deps);
  if (!result.ok) return error(teamMessage(result.code));
  revalidate();
  return success("Mitglied entfernt; Zuweisungen sind ab sofort entzogen.");
}

async function dependencies() {
  const [context, request] = await Promise.all([getEmployerContext(), getAuthRequestContext()]);
  if (context?.current === null || context === null || !isValidAuthMutationOrigin(request) || (context.current.membershipRole !== "OWNER" && context.current.membershipRole !== "ADMIN")) return null;
  return {
    companyId: context.current.companyId,
    actor: { userId: context.user.id, membershipId: context.current.membershipId, role: context.current.membershipRole },
    request,
    environment: getServerEnvironment(),
    database: getDatabase(),
    now: new Date(),
    emailProvider,
  } as const;
}
function revalidate() { revalidatePath("/employer/team"); revalidatePath("/employer/team/invitations"); }
function error(message: string): EmployerActionState { return { status: "error", message }; }
function success(message: string): EmployerActionState { return { status: "success", message, nextIdempotencyKey: randomUUID() }; }
async function teamError(
  code: string,
  dependencies: Readonly<{
    actor: Readonly<{ role: "OWNER" | "ADMIN" }>;
    database: ReturnType<typeof getDatabase>;
    now: Date;
  }>,
  suggestedPlanSlug?: string,
): Promise<EmployerActionState> {
  return code === "SEAT_LIMIT"
    ? {
        status: "error",
        message: teamMessage(code),
        upgradePrompt: await buildCatalogUpgradePrompt(
          {
            reason: "SEAT_LIMIT_REACHED",
            suggestedPlanSlug,
            actorRole: dependencies.actor.role,
          },
          { database: dependencies.database, now: dependencies.now },
        ),
      }
    : error(teamMessage(code));
}
function teamMessage(code: string) {
  const messages: Record<string, string> = {
    INVALID_INPUT: "Bitte prüfe die Angaben.", DUPLICATE: "Für diese E-Mail besteht bereits eine aktive Einladung.", ALREADY_MEMBER: "Dieses Konto ist bereits aktives Teammitglied.", SEAT_LIMIT: "Das Sitzplatzlimit ist erreicht. Bestehende Mitglieder bleiben erhalten.", LAST_OWNER: "Der letzte aktive Inhaber kann nicht entfernt oder herabgestuft werden.", SELF_REMOVAL: "Du kannst dich nicht selbst entfernen.", OWNER_REQUIRED: "Nur ein Inhaber darf diese Inhaber-Rolle ändern.", COMPANY_INACTIVE: "Einladungen können erst für ein aktives Unternehmen angenommen werden.",
  };
  return messages[code] ?? "Die Teamaktion konnte nicht sicher ausgeführt werden.";
}
