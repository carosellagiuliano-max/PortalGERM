import type { PaymentProvider } from "@/lib/providers/payments/payment-provider";
import { MockPaymentProvider } from "@/lib/providers/payments/mock-payment-provider";

export type {
  CheckoutSession,
  CreatePaymentOperationInput,
  PaymentProvider,
} from "@/lib/providers/payments/payment-provider";
export {
  MOCK_PAYMENT_POLICY_V1,
  MockPaymentInputError,
  MockPaymentProvider,
} from "@/lib/providers/payments/mock-payment-provider";

// The MVP composition root selects Mock explicitly. No env key can switch it.
export const paymentProvider: PaymentProvider = new MockPaymentProvider();
