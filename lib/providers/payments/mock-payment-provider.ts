import { createHash } from "node:crypto";

import type {
  CheckoutSession,
  CreatePaymentOperationInput,
  PaymentProvider,
} from "@/lib/providers/payments/payment-provider";
import { isSafeAbsoluteHttpUrl } from "@/lib/validation/common";

const CREATE_CHECKOUT_KEYS = [
  "orderId",
  "idempotencyKey",
  "successUrl",
  "cancelUrl",
] as const;
const PAYMENT_OPERATION_KEYS = ["orderId", "idempotencyKey"] as const;

export const MOCK_PAYMENT_POLICY_V1 = Object.freeze({
  provider: "MOCK" as const,
  checkoutPathPrefix: "/mock/checkout/" as const,
  confirmationReferenceVersion: "v1" as const,
  acceptsAuthoritativeAmount: false,
  writesDatabaseState: false,
  ownsFulfillment: false,
});

export class MockPaymentInputError extends TypeError {
  readonly code:
    | "INVALID_INPUT"
    | "INVALID_OPERATION_IDENTITY"
    | "INVALID_RETURN_URL";

  constructor(code: MockPaymentInputError["code"], message: string) {
    super(message);
    this.name = "MockPaymentInputError";
    this.code = code;
  }
}

/**
 * Pure local payment boundary. Billing remains the sole owner of Order,
 * PaymentEvent, Invoice and fulfillment writes.
 */
export class MockPaymentProvider implements PaymentProvider {
  async createCheckout(
    input: CreatePaymentOperationInput,
  ): Promise<CheckoutSession> {
    assertExactObject(input, CREATE_CHECKOUT_KEYS);
    const orderId = assertOperationIdentity(input.orderId, "orderId");
    assertOperationIdentity(input.idempotencyKey, "idempotencyKey");
    assertReturnUrl(input.successUrl, "successUrl");
    assertReturnUrl(input.cancelUrl, "cancelUrl");

    return Object.freeze({
      orderId,
      checkoutUrl: `${MOCK_PAYMENT_POLICY_V1.checkoutPathPrefix}${encodeURIComponent(orderId)}`,
      provider: MOCK_PAYMENT_POLICY_V1.provider,
    });
  }

  async confirmPayment(input: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ providerReference: string }> {
    assertExactObject(input, PAYMENT_OPERATION_KEYS);
    const orderId = assertOperationIdentity(input.orderId, "orderId");
    const idempotencyKey = assertOperationIdentity(
      input.idempotencyKey,
      "idempotencyKey",
    );

    return Object.freeze({
      providerReference: createConfirmationReference(orderId, idempotencyKey),
    });
  }

  async cancel(input: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<void> {
    assertExactObject(input, PAYMENT_OPERATION_KEYS);
    assertOperationIdentity(input.orderId, "orderId");
    assertOperationIdentity(input.idempotencyKey, "idempotencyKey");
  }
}

function createConfirmationReference(
  orderId: string,
  idempotencyKey: string,
): string {
  const digest = createHash("sha256")
    .update(MOCK_PAYMENT_POLICY_V1.confirmationReferenceVersion, "utf8")
    .update("\0", "utf8")
    .update(orderId, "utf8")
    .update("\0", "utf8")
    .update(idempotencyKey, "utf8")
    .digest("hex");
  return `mock_payment_${digest}`;
}

function assertOperationIdentity(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new MockPaymentInputError(
      "INVALID_OPERATION_IDENTITY",
      `Mock payment ${field} must be a bounded opaque identifier.`,
    );
  }
  return value;
}

function assertReturnUrl(value: unknown, field: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !isAllowedPaymentReturnUrl(value)
  ) {
    throw new MockPaymentInputError(
      "INVALID_RETURN_URL",
      `Mock payment ${field} is invalid.`,
    );
  }
}

function isAllowedPaymentReturnUrl(value: string): boolean {
  if (value.includes("#")) return false;

  if (value.startsWith("/") && !value.startsWith("//")) {
    try {
      const base = new URL("https://mock-checkout.invalid");
      const parsed = new URL(value, base);
      return (
        parsed.origin === base.origin &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.hash === ""
      );
    } catch {
      return false;
    }
  }

  if (!isSafeAbsoluteHttpUrl(value)) return false;
  try {
    return new URL(value).hash === "";
  } catch {
    return false;
  }
}

function assertExactObject<const TKey extends string>(
  input: unknown,
  expectedKeys: readonly TKey[],
): asserts input is Record<TKey, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new MockPaymentInputError(
      "INVALID_INPUT",
      "Mock payment input must be a plain operation object.",
    );
  }

  const expected = new Set<string>(expectedKeys);
  const actualKeys = Reflect.ownKeys(input);
  const hasOnlyExpectedKeys = actualKeys.every(
    (key) => typeof key === "string" && expected.has(key),
  );
  const hasEveryExpectedKey = expectedKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(input, key),
  );

  if (
    !hasOnlyExpectedKeys ||
    !hasEveryExpectedKey ||
    actualKeys.length !== expectedKeys.length
  ) {
    throw new MockPaymentInputError(
      "INVALID_INPUT",
      "Mock payment input contains unsupported fields. Authoritative price data belongs to Billing.",
    );
  }
}
