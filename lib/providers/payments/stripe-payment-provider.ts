import type {
  CheckoutSession,
  CreatePaymentOperationInput,
  PaymentProvider,
} from "@/lib/providers/payments/payment-provider";

export class StripePaymentProviderUnavailableError extends Error {
  readonly code = "STRIPE_PROVIDER_NOT_IMPLEMENTED" as const;

  constructor() {
    super(
      "StripePaymentProvider is an unwired post-MVP placeholder and cannot process payments.",
    );
    this.name = "StripePaymentProviderUnavailableError";
  }
}

/**
 * Deliberately unwired. Environment variables must never activate this
 * placeholder; a separately reviewed real-provider phase must replace it.
 */
export class StripePaymentProvider implements PaymentProvider {
  async createCheckout(
    _input: CreatePaymentOperationInput,
  ): Promise<CheckoutSession> {
    throw new StripePaymentProviderUnavailableError();
  }

  async confirmPayment(_input: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ providerReference: string }> {
    throw new StripePaymentProviderUnavailableError();
  }

  async cancel(_input: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<void> {
    throw new StripePaymentProviderUnavailableError();
  }
}
