import type { PaymentProvider } from "@/lib/providers/payments/payment-provider";
import { MockPaymentProvider } from "@/lib/providers/payments/mock-payment-provider";

export type {
  CheckoutSession,
  CreatePaymentOperationInput,
  HostedPaymentProvider,
  NormalizedPaymentProviderEvent,
  PaymentRuntimeMode,
  PaymentProvider,
  ProviderRefundResult,
  ProviderInvoicePaymentResolution,
  StripePaymentAdapterKey,
} from "@/lib/providers/payments/payment-provider";
export {
  MOCK_PAYMENT_POLICY_V1,
  MockPaymentInputError,
  MockPaymentProvider,
} from "@/lib/providers/payments/mock-payment-provider";
export {
  STRIPE_PAYMENT_ADAPTER_V1,
  STRIPE_PAYMENT_ADAPTERS_V1,
  StripePaymentProvider,
  StripePaymentProviderError,
  readBoundedStripeWebhookBody,
  resolveStripePaymentRuntime,
  stripePaymentConfigurationDigest,
  type StripePaymentProviderConfiguration,
  type StripePaymentRuntime,
} from "@/lib/providers/payments/stripe-payment-provider";

// The MVP composition root selects Mock explicitly. No env key can switch it.
export const paymentProvider: PaymentProvider = new MockPaymentProvider();
