import "server-only";

import {
  resolvePaidCheckoutActivation,
  type PaidCheckoutActivationDecision,
} from "@/lib/billing/paid-activation-policy";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { resolveProviderActivation } from "@/lib/ops/provider-activation-policy";

export type PaidCheckoutAvailability = Readonly<{
  activation: PaidCheckoutActivationDecision;
  packageCode: "STARTER" | "PRO";
  providerConfigured: boolean;
  providerLedgerPresent: boolean;
  selfServiceFlag: boolean;
  stepUpReady: false;
  wtpDecisionPresent: boolean;
}>;

export async function getPaidCheckoutAvailability(
  database: DatabaseClient,
  environment: ServerEnvironment,
  packageCode: "STARTER" | "PRO",
  now: Date,
): Promise<PaidCheckoutAvailability> {
  const [scopeDecision, providerActivation] = await Promise.all([
    database.paidScopeDecision.findFirst({
      where: {
        scopeCode: "LC5_PAID_SELF_SERVICE",
        packageCode,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    database.providerActivation.findFirst({
      where: {
        environment: environment.APP_ENV,
        useCase: "payments.hosted-checkout",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const provider = resolveProviderActivation({
    activation: providerActivation,
    adapterKey: "stripe_sandbox",
    adapterVersion: "v1",
    environment: environment.APP_ENV,
    now,
    useCase: "payments.hosted-checkout",
  });
  const activation = resolvePaidCheckoutActivation({
    environment: environment.APP_ENV,
    now,
    packageCode,
    paidSelfServiceEnabled: environment.PAID_SELF_SERVICE,
    provider,
    sandboxCohort: environment.PAYMENT_SANDBOX_COHORT,
    scopeDecision,
  });
  return Object.freeze({
    activation,
    packageCode,
    providerConfigured: environment.PAYMENT_PROVIDER_MODE === "stripe_sandbox",
    providerLedgerPresent: providerActivation !== null,
    selfServiceFlag: environment.PAID_SELF_SERVICE,
    stepUpReady: false as const,
    wtpDecisionPresent: scopeDecision !== null,
  });
}
