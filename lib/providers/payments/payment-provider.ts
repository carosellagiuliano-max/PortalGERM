export interface CreatePaymentOperationInput {
  orderId: string;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
  authoritative?: Readonly<{
    amountRappen: number;
    currency: "CHF";
    customerEmail: string;
    description: string;
    quoteDigest: string;
    paymentAttemptId: string;
  }>;
}

export interface CheckoutSession {
  orderId: string;
  checkoutUrl: string;
  provider: "MOCK" | "STRIPE";
  providerSessionReference?: string;
}

export interface PaymentProvider {
  /** Legacy test doubles without a discriminator are treated as Mock only. */
  readonly kind?: "MOCK" | "STRIPE";
  createCheckout(input: CreatePaymentOperationInput): Promise<CheckoutSession>;
  confirmPayment(input: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ providerReference: string }>;
  cancel(input: { orderId: string; idempotencyKey: string }): Promise<void>;
}

export type NormalizedPaymentProviderEvent = Readonly<{
  apiVersion: string | null;
  amountRappen: number | null;
  currency: string | null;
  eventCreatedAt: Date;
  eventType: string;
  liveMode: boolean;
  orderId: string | null;
  paymentAttemptId: string | null;
  providerAccountReference: string;
  providerEventId: string;
  providerObjectReference: string | null;
  providerPaymentReference: string | null;
  providerSessionReference: string | null;
  providerStatus: string | null;
}>;

export type ProviderRefundResult = Readonly<{
  amountRappen: number;
  currency: "CHF";
  providerRefundReference: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
}>;

export interface HostedPaymentProvider extends PaymentProvider {
  readonly kind: "STRIPE";
  createRefund(
    input: Readonly<{
      amountRappen: number;
      idempotencyKey: string;
      orderId: string;
      paymentAttemptId: string;
      providerPaymentReference: string;
      reasonCode: string;
    }>,
  ): Promise<ProviderRefundResult>;
  verifyWebhook(
    input: Readonly<{
      rawBody: string;
      signatureHeader: string;
      toleranceSeconds?: number;
    }>,
  ): NormalizedPaymentProviderEvent;
}
