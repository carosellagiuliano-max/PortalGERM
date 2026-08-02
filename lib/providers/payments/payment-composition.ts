import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { HostedPaymentProvider } from "@/lib/providers/payments/payment-provider";
import {
  resolveStripePaymentRuntime,
  StripePaymentProvider,
  type StripePaymentRuntime,
} from "@/lib/providers/payments/stripe-payment-provider";

export function getHostedPaymentRuntime(
  environment: ServerEnvironment,
): StripePaymentRuntime | null {
  return resolveStripePaymentRuntime(
    String(environment.PAYMENT_PROVIDER_MODE),
  );
}

export function getStripeContractEndpoint(
  environment: ServerEnvironment,
): string | undefined {
  return environment.STRIPE_CONTRACT_ENDPOINT;
}

export function createHostedPaymentProvider(
  environment: ServerEnvironment,
): HostedPaymentProvider {
  const runtime = getHostedPaymentRuntime(environment);
  if (
    runtime === null ||
    environment.STRIPE_ACCOUNT_ID === undefined ||
    environment.secrets.stripeSecretKey === undefined ||
    environment.secrets.stripeWebhookSecret === undefined
  ) {
    throw new Error("HOSTED_PAYMENT_PROVIDER_DISABLED");
  }
  return environment.secrets.stripeSecretKey.withValue((secretKey) =>
    environment.secrets.stripeWebhookSecret!.withValue(
      (webhookSecret) =>
        new StripePaymentProvider({
          accountId: environment.STRIPE_ACCOUNT_ID!,
          ...(runtime.adapterKey === "stripe_contract"
            ? { contractEndpoint: getStripeContractEndpoint(environment) }
            : {}),
          mode: runtime.adapterKey,
          secretKey,
          webhookSecret,
        }),
    ),
  );
}
