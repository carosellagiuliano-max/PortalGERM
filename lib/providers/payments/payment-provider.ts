export interface CreatePaymentOperationInput {
  orderId: string;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  orderId: string;
  checkoutUrl: string;
  provider: "MOCK" | "STRIPE";
}

export interface PaymentProvider {
  createCheckout(
    input: CreatePaymentOperationInput,
  ): Promise<CheckoutSession>;
  confirmPayment(input: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ providerReference: string }>;
  cancel(input: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<void>;
}
