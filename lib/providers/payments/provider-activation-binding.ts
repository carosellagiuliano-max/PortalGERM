import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  getHostedPaymentRuntime,
  getStripeContractEndpoint,
} from "@/lib/providers/payments/payment-composition";
import { stripePaymentConfigurationDigest } from "@/lib/providers/payments/stripe-payment-provider";

export type PaymentProviderActivationBinding = Readonly<{
  adapterKey: "stripe_contract" | "stripe_sandbox" | "stripe_live";
  adapterVersion: "v1";
  expectedConfigurationDigest: string;
  expectedMode: "SANDBOX" | "ALLOWLIST" | "LIVE";
  expectedSecretVersionRef: string;
  region: string;
  useCase: "payments.hosted-checkout";
}>;

export function paymentProviderActivationBinding(
  environment: ServerEnvironment,
): PaymentProviderActivationBinding | null {
  const runtime = getHostedPaymentRuntime(environment);
  if (
    runtime === null ||
    environment.STRIPE_ACCOUNT_ID === undefined ||
    environment.STRIPE_SECRET_VERSION === undefined
  ) {
    return null;
  }
  return Object.freeze({
    adapterKey: runtime.adapterKey,
    adapterVersion: runtime.adapterVersion,
    expectedConfigurationDigest: stripePaymentConfigurationDigest({
      ...(runtime.adapterKey === "stripe_contract"
        ? { contractEndpoint: getStripeContractEndpoint(environment) }
        : {}),
      providerAccountReference: environment.STRIPE_ACCOUNT_ID,
      runtime,
    }),
    expectedMode: runtime.activationMode,
    expectedSecretVersionRef: environment.STRIPE_SECRET_VERSION,
    region: "ch-global",
    useCase: "payments.hosted-checkout",
  });
}
