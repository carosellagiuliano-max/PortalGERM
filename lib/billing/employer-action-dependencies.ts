import "server-only";

import { getEmployerContext } from "@/lib/auth/employer-context";
import { getCurrentAuthContext } from "@/lib/auth/current-user";
import { getServerEnvironment } from "@/lib/config/env";
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
  const [context, request, authContext] = await Promise.all([
    getEmployerContext(),
    getAuthRequestContext(),
    getCurrentAuthContext(),
  ]);
  const current = context?.current ?? null;
  if (
    context === null ||
    current === null ||
    authContext === null ||
    authContext.user.id !== context?.user.id ||
    (authContext.user.role !== "EMPLOYER" &&
      authContext.user.role !== "RECRUITER") ||
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
    stepUp: {
      mode: getServerEnvironment().PRIVILEGED_STEP_UP_MODE,
      sessionId: authContext.session.id,
      globalRole: authContext.user.role,
    },
    trustRiskMode: getServerEnvironment().TRUST_RISK_MODE,
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
