"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { reconcileNotificationProviderOutcome } from "@/lib/notifications/outcome-reconciliation";

export async function reconcileNotificationProviderOutcomeAction(
  formData: FormData,
) {
  const [admin, request] = await Promise.all([
    requireAdminPage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) redirectWithResult("FORBIDDEN");

  const result = await reconcileNotificationProviderOutcome(
    {
      outboxId: one(formData, "outboxId"),
      resolution: one(formData, "resolution"),
      evidenceDigest: one(formData, "evidenceDigest"),
      evidenceReference: one(formData, "evidenceReference"),
      idempotencyKey: one(formData, "idempotencyKey"),
      providerReceipt: optional(formData, "providerReceipt"),
      reasonCode: one(formData, "reasonCode"),
      stepUpEvidenceId: one(formData, "stepUpEvidenceId"),
      stepUpGrantToken: one(formData, "stepUpGrantToken"),
    },
    {
      actor: {
        capabilities: admin.capabilities,
        email: admin.email,
        role: admin.role,
        sessionId: admin.sessionId,
        status: admin.status,
        userId: admin.id,
      },
      correlationId: request.correlationId,
      database: getDatabase(),
      environment: getServerEnvironment(),
      now: new Date(),
    },
  );
  revalidatePath("/admin/system");
  revalidatePath("/admin/system/notification-reconciliation");
  redirectWithResult(result.ok ? result.value.resolution : result.code);
}

function redirectWithResult(result: string): never {
  redirect(
    `/admin/system/notification-reconciliation?result=${encodeURIComponent(result)}`,
  );
}

function one(formData: FormData, name: string): string | null {
  const values = formData.getAll(name);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0].trim()
    : null;
}

function optional(formData: FormData, name: string): string | null {
  const value = one(formData, name);
  return value === "" ? null : value;
}
