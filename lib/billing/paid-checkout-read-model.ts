import "server-only";

import {
  resolvePaidCheckoutActivation,
  type PaidCheckoutActivationDecision,
} from "@/lib/billing/paid-activation-policy";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { resolveProviderActivation } from "@/lib/ops/provider-activation-policy";
import {
  getHostedPaymentRuntime,
  getStripeContractEndpoint,
} from "@/lib/providers/payments/payment-composition";
import { stripePaymentConfigurationDigest } from "@/lib/providers/payments";

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
  const runtime = getHostedPaymentRuntime(environment);
  const contractEndpoint = getStripeContractEndpoint(environment);
  const providerConfigurationReady =
    runtime !== null &&
    environment.STRIPE_ACCOUNT_ID !== undefined &&
    environment.STRIPE_SECRET_VERSION !== undefined &&
    (runtime.adapterKey !== "stripe_contract" ||
      contractEndpoint !== undefined);
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
    adapterKey: runtime?.adapterKey ?? "payment_disabled",
    adapterVersion: runtime?.adapterVersion ?? "v1",
    environment: environment.APP_ENV,
    expectedConfigurationDigest: providerConfigurationReady
      ? stripePaymentConfigurationDigest({
          ...(runtime!.adapterKey === "stripe_contract"
            ? { contractEndpoint }
            : {}),
          providerAccountReference: environment.STRIPE_ACCOUNT_ID!,
          runtime: runtime!,
        })
      : "PAYMENT_CONFIGURATION_MISSING",
    ...(runtime === null ? {} : { expectedMode: runtime.activationMode }),
    expectedSecretVersionRef:
      environment.STRIPE_SECRET_VERSION ?? "PAYMENT_SECRET_VERSION_MISSING",
    now,
    useCase: "payments.hosted-checkout",
  });
  const activation = resolvePaidCheckoutActivation({
    environment: environment.APP_ENV,
    now,
    packageCode,
    paidSelfServiceEnabled: environment.PAID_SELF_SERVICE,
    provider,
    providerMode: runtime?.providerMode ?? "SANDBOX",
    sandboxCohort: environment.PAYMENT_SANDBOX_COHORT,
    scopeDecision,
  });
  return Object.freeze({
    activation,
    packageCode,
    providerConfigured: providerConfigurationReady,
    providerLedgerPresent: providerActivation !== null,
    selfServiceFlag: environment.PAID_SELF_SERVICE,
    stepUpReady: false as const,
    wtpDecisionPresent: scopeDecision !== null,
  });
}
