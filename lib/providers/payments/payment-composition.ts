import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { HostedPaymentProvider } from "@/lib/providers/payments/payment-provider";
import { StripePaymentProvider } from "@/lib/providers/payments/stripe-payment-provider";

export function createHostedPaymentProvider(
  environment: ServerEnvironment,
): HostedPaymentProvider {
  if (
    environment.PAYMENT_PROVIDER_MODE !== "stripe_sandbox" ||
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
          secretKey,
          webhookSecret,
        }),
    ),
  );
}
