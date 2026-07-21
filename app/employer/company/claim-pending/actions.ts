"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { getAuthRequestContext, isValidAuthMutationOrigin } from "@/lib/auth/request-context";
import { requireEmployerPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import type { EmployerActionState } from "@/lib/employer/action-state";
import type { Prisma } from "@/lib/generated/prisma/client";

export async function addClaimEvidenceAction(_state: EmployerActionState, formData: FormData): Promise<EmployerActionState> {
  const [user, request] = await Promise.all([requireEmployerPage(), getAuthRequestContext()]);
  const evidence = String(formData.get("evidence") ?? "").trim();
  if (!isValidAuthMutationOrigin(request) || evidence.length < 20 || evidence.length > 1000) return { status: "error", message: "Bitte beschreibe den Nachweis mit 20 bis 1.000 Zeichen." };
  const database = getDatabase(); const now = new Date();
  try {
    const updated = await database.$transaction(async (tx) => {
      const claim = await lockOpenClaim(tx, user.id);
      if (claim === null) return false;
      const write = await tx.companyClaimRequest.updateMany({
        where: { id: claim.id, requesterEmployerUserId: user.id, status: { in: ["PENDING", "NEEDS_EVIDENCE"] } },
        data: { evidenceSummary: evidence, updatedAt: now },
      });
      if (write.count !== 1) return false;
      await tx.companyClaimEvent.create({ data: { claimRequestId: claim.id, kind: "EVIDENCE_ADDED", actorUserId: user.id, evidenceRef: "claim-evidence-summary-v1", correlationId: request.correlationId, createdAt: now } });
      await writeRequiredAudit(createPrismaTransactionAuditPort(tx), { action: "COMPANY_CLAIM_EVIDENCE_ADDED", actorKind: "USER", actorUserId: user.id, capability: "COMPANY_CLAIM_EVIDENCE", companyId: claim.candidateCompanyId, correlationId: request.correlationId, result: "SUCCEEDED", retainUntil: new Date(now.getTime() + 365 * 86_400_000), targetId: claim.id, targetType: "CLAIM_REQUEST" });
      return true;
    }, { isolationLevel: "Serializable" });
    if (!updated) return { status: "error", message: "Der Anspruch ist nicht mehr offen." };
    revalidatePath("/employer/company/claim-pending");
    return { status: "success", message: "Nachweis sicher ergänzt." };
  } catch { return { status: "error", message: "Der Nachweis konnte nicht gespeichert werden." }; }
}

export async function cancelClaimAction(_state: EmployerActionState, _formData: FormData): Promise<EmployerActionState> {
  const [user, request] = await Promise.all([requireEmployerPage(), getAuthRequestContext()]);
  if (!isValidAuthMutationOrigin(request)) return { status: "error", message: "Die Anfrage konnte nicht sicher bestätigt werden." };
  const database = getDatabase(); const now = new Date();
  let cancelled: boolean;
  try {
    cancelled = await database.$transaction(async (tx) => {
      const claim = await lockOpenClaim(tx, user.id);
      if (claim === null) return false;
      const write = await tx.companyClaimRequest.updateMany({
        where: { id: claim.id, requesterEmployerUserId: user.id, status: { in: ["PENDING", "NEEDS_EVIDENCE"] } },
        data: { status: "CANCELLED", updatedAt: now },
      });
      if (write.count !== 1) return false;
      await tx.companyClaimEvent.create({ data: { claimRequestId: claim.id, kind: "CANCELLED", actorUserId: user.id, reasonCode: "REQUESTER_CANCELLED", correlationId: request.correlationId, createdAt: now } });
      await writeRequiredAudit(createPrismaTransactionAuditPort(tx), { action: "COMPANY_CLAIM_CANCELLED", actorKind: "USER", actorUserId: user.id, capability: "COMPANY_CLAIM_CANCEL", companyId: claim.candidateCompanyId, correlationId: request.correlationId, reasonCode: "REQUESTER_CANCELLED", result: "SUCCEEDED", retainUntil: new Date(now.getTime() + 365 * 86_400_000), targetId: claim.id, targetType: "CLAIM_REQUEST" });
      return true;
    }, { isolationLevel: "Serializable" });
  } catch {
    return { status: "error", message: "Der Anspruch konnte nicht zurückgezogen werden." };
  }
  if (!cancelled) return { status: "error", message: "Der Anspruch ist nicht mehr offen." };
  redirect("/employer/dashboard?claim=cancelled");
}

async function lockOpenClaim(transaction: Prisma.TransactionClient, requesterUserId: string) {
  const rows = await transaction.$queryRaw<Array<{ id: string; candidateCompanyId: string | null }>>`
    SELECT "id", "candidateCompanyId"
    FROM "CompanyClaimRequest"
    WHERE "requesterEmployerUserId" = ${requesterUserId}::uuid
      AND "status" IN ('PENDING', 'NEEDS_EVIDENCE')
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
}
