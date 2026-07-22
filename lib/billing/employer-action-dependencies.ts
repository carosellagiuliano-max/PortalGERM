import "server-only";

import { getEmployerContext } from "@/lib/auth/employer-context";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import type { BillingDependencies } from "@/lib/billing/contracts";
import { getDatabase } from "@/lib/db/client";
import { emailProvider } from "@/lib/providers/email";
import { paymentProvider } from "@/lib/providers/payments";

export async function getEmployerBillingActionDependencies(
  ownerOnly = false,
): Promise<BillingDependencies | null> {
  const [context, request] = await Promise.all([
    getEmployerContext(),
    getAuthRequestContext(),
  ]);
  const current = context?.current ?? null;
  if (
    context === null ||
    current === null ||
    !isValidAuthMutationOrigin(request) ||
    (ownerOnly
      ? current.membershipRole !== "OWNER"
      : current.membershipRole !== "OWNER" && current.membershipRole !== "ADMIN")
  ) {
    return null;
  }
  return Object.freeze({
    actor: Object.freeze({
      userId: context.user.id,
      email: context.user.email,
      companyId: current.companyId,
      membershipId: current.membershipId,
      membershipRole: current.membershipRole,
    }),
    correlationId: request.correlationId,
    database: getDatabase(),
    paymentProvider,
    emailProvider,
    now: new Date(),
  });
}

export function hasOnlyFormFields(
  formData: FormData,
  allowed: ReadonlySet<string>,
) {
  return [...formData.keys()].every(
    (field) => field.startsWith("$ACTION_") || allowed.has(field),
  );
}

export function readSingleFormString(formData: FormData, field: string) {
  const values = formData.getAll(field);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0].trim()
    : null;
}
