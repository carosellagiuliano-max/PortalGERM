"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { releaseHeldSettlementForProjection } from "@/lib/billing/payment-inbox";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export async function releaseHeldSettlementAction(formData: FormData) {
  const [admin, request] = await Promise.all([
    requireAdminPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    redirectWithResult("FORBIDDEN");
  }
  const inboxId = one(formData, "inboxId");
  const reasonCode = one(formData, "reasonCode");
  const stepUpEvidenceId = one(formData, "stepUpEvidenceId");
  const stepUpGrantToken = one(formData, "stepUpGrantToken");
  if (
    inboxId === null ||
    reasonCode === null ||
    stepUpEvidenceId === null ||
    stepUpGrantToken === null
  ) {
    redirectWithResult("INVALID_INPUT");
  }
  const environment = getServerEnvironment();
  const result = await releaseHeldSettlementForProjection(
    {
      correlationId: request.correlationId,
      inboxId,
      reasonCode,
      stepUpEvidenceId,
      stepUpGrantToken,
    },
    {
      actor: {
        capabilities: admin.capabilities,
        role: admin.role,
        sessionId: admin.sessionId,
        status: admin.status,
        userId: admin.id,
      },
      database: getDatabase(),
      financeRepairActionsEnabled: environment.FINANCE_REPAIR_ACTIONS,
      now: new Date(),
    },
  );
  revalidatePath("/admin/finance/reconciliation");
  redirectWithResult(result.ok ? "RELEASED" : result.code);
}

function redirectWithResult(result: string): never {
  redirect(
    `/admin/finance/reconciliation?result=${encodeURIComponent(result)}`,
  );
}

function one(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}
