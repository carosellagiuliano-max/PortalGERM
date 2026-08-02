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
    /** Exact server-side checkout deadline mirrored into the hosted session. */
    expiresAt: Date;
    quoteDigest: string;
    paymentAttemptId: string;
    checkout:
      | Readonly<{ kind: "ONE_TIME" }>
      | Readonly<{
          kind: "SUBSCRIPTION";
          billingInterval: "MONTHLY";
          providerPriceReference: string;
        }>;
  }>;
}

export type PaymentRuntimeMode = "CONTRACT" | "SANDBOX" | "LIVE";
export type StripePaymentAdapterKey =
  "stripe_contract" | "stripe_sandbox" | "stripe_live";

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
  refundId: string | null;
  providerAccountReference: string;
  providerCancelAtPeriodEnd: boolean | null;
  providerEventId: string;
  providerObjectReference: string | null;
  providerPaymentReference: string | null;
  providerSessionReference: string | null;
  providerCustomerReference: string | null;
  providerInvoiceReference: string | null;
  providerPriceReference: string | null;
  providerSubscriptionReference: string | null;
  providerPeriodStart: Date | null;
  providerPeriodEnd: Date | null;
  providerStatus: string | null;
}>;

export type ProviderRefundResult = Readonly<{
  amountRappen: number;
  currency: "CHF";
  providerRefundReference: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
}>;

export type ProviderInvoicePaymentResolution = Readonly<{
  amountRappen: number;
  currency: "CHF";
  evidenceDigest: string;
  providerInvoicePaymentReference: string;
  providerInvoiceReference: string;
  providerPaymentReference: string;
  source: "STRIPE_INVOICE_PAYMENTS_LIST_V1";
}>;

export interface HostedPaymentProvider extends PaymentProvider {
  readonly kind: "STRIPE";
  readonly adapterKey: StripePaymentAdapterKey;
  readonly adapterVersion: "v1";
  readonly providerAccountReference: string;
  readonly providerMode: PaymentRuntimeMode;
  readonly expectedLiveMode: boolean;
  expireCheckoutSession(
    input: Readonly<{
      idempotencyKey: string;
      orderId: string;
      providerSessionReference: string;
    }>,
  ): Promise<void>;
  createRefund(
    input: Readonly<{
      amountRappen: number;
      idempotencyKey: string;
      orderId: string;
      paymentAttemptId: string;
      providerPaymentReference: string;
      reasonCode: string;
      refundId: string;
      sourceKind: "INITIAL_ORDER" | "SUBSCRIPTION_PROVIDER_INVOICE";
    }>,
  ): Promise<ProviderRefundResult>;
  resolveInvoicePayment(
    input: Readonly<{
      amountRappen: number;
      currency: "CHF";
      providerInvoiceReference: string;
    }>,
  ): Promise<ProviderInvoicePaymentResolution>;
  verifyWebhook(
    input: Readonly<{
      rawBody: string;
      signatureHeader: string;
      toleranceSeconds?: number;
    }>,
  ): NormalizedPaymentProviderEvent;
}
