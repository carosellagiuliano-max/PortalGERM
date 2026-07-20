// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MOCK_PAYMENT_POLICY_V1,
  MockPaymentInputError,
  MockPaymentProvider,
  paymentProvider,
  type CreatePaymentOperationInput,
} from "@/lib/providers/payments";
import {
  StripePaymentProvider,
  StripePaymentProviderUnavailableError,
} from "@/lib/providers/payments/stripe-payment-provider";

const checkoutInput: CreatePaymentOperationInput = {
  orderId: "order/phase-12-001",
  idempotencyKey: "checkout-operation-001",
  successUrl: "/billing/success",
  cancelUrl: "/billing/cancel",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MockPaymentProvider", () => {
  it("is selected explicitly and returns the deterministic local checkout route", async () => {
    expect(paymentProvider).toBeInstanceOf(MockPaymentProvider);

    const provider = new MockPaymentProvider();
    const first = await provider.createCheckout(checkoutInput);
    const second = await provider.createCheckout({ ...checkoutInput });

    expect(first).toEqual({
      orderId: checkoutInput.orderId,
      checkoutUrl: "/mock/checkout/order%2Fphase-12-001",
      provider: "MOCK",
    });
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(MOCK_PAYMENT_POLICY_V1).toMatchObject({
      acceptsAuthoritativeAmount: false,
      writesDatabaseState: false,
      ownsFulfillment: false,
    });
  });

  it("returns an idempotent confirmation reference bound to order and key", async () => {
    const provider = new MockPaymentProvider();
    const operation = {
      orderId: "order-001",
      idempotencyKey: "confirmation-001",
    };

    const first = await provider.confirmPayment(operation);
    const replay = await provider.confirmPayment({ ...operation });
    const otherKey = await provider.confirmPayment({
      ...operation,
      idempotencyKey: "confirmation-002",
    });
    const otherOrder = await provider.confirmPayment({
      ...operation,
      orderId: "order-002",
    });

    expect(first).toEqual(replay);
    expect(first.providerReference).toMatch(/^mock_payment_[a-f0-9]{64}$/);
    expect(otherKey).not.toEqual(first);
    expect(otherOrder).not.toEqual(first);
  });

  it("cancels as a repeatable no-op without manufacturing state", async () => {
    const provider = new MockPaymentProvider();
    const operation = {
      orderId: "order-001",
      idempotencyKey: "cancel-operation-001",
    };

    await expect(provider.cancel(operation)).resolves.toBeUndefined();
    await expect(provider.cancel({ ...operation })).resolves.toBeUndefined();
  });

  it.each(["amount", "amountRappen", "price", "currency"])(
    "rejects unsupported authoritative billing field %s",
    async (field) => {
      const provider = new MockPaymentProvider();
      const unsafeInput = {
        ...checkoutInput,
        [field]: field === "currency" ? "CHF" : 14_900,
      } as unknown as CreatePaymentOperationInput;

      await expect(provider.createCheckout(unsafeInput)).rejects.toMatchObject({
        name: "MockPaymentInputError",
        code: "INVALID_INPUT",
      });
    },
  );

  it("rejects malformed operation identities and return URLs without echoing values", async () => {
    const provider = new MockPaymentProvider();

    await expect(
      provider.createCheckout({ ...checkoutInput, orderId: " ../order " }),
    ).rejects.toBeInstanceOf(MockPaymentInputError);
    await expect(
      provider.createCheckout({ ...checkoutInput, successUrl: "\n/success" }),
    ).rejects.toMatchObject({ code: "INVALID_RETURN_URL" });
  });

  it.each([
    "javascript:alert(document.domain)",
    "data:text/html,unsafe",
    "//evil.example/checkout",
    "/\\evil.example/checkout",
    "https://user:secret@example.ch/success",
    "https://example.ch/success#fragment",
    "https://example.ch/success#",
    "/billing/success#fragment",
  ])("rejects unsafe return URL %s", async (unsafeUrl) => {
    const provider = new MockPaymentProvider();
    await expect(
      provider.createCheckout({ ...checkoutInput, successUrl: unsafeUrl }),
    ).rejects.toMatchObject({ code: "INVALID_RETURN_URL" });
  });

  it.each([
    "/billing/success?operation=checkout-001",
    "https://jobs.example.ch/billing/success?operation=checkout-001",
    "http://localhost:3000/billing/success",
  ])("accepts safe local or credential-free HTTP(S) return URL %s", async (safeUrl) => {
    const provider = new MockPaymentProvider();
    await expect(
      provider.createCheckout({ ...checkoutInput, successUrl: safeUrl }),
    ).resolves.toMatchObject({ provider: "MOCK" });
  });
});

describe("StripePaymentProvider placeholder", () => {
  it("fails closed for every operation and performs no external request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new StripePaymentProvider();

    await expect(provider.createCheckout(checkoutInput)).rejects.toBeInstanceOf(
      StripePaymentProviderUnavailableError,
    );
    await expect(
      provider.confirmPayment({
        orderId: "order-001",
        idempotencyKey: "confirmation-001",
      }),
    ).rejects.toMatchObject({ code: "STRIPE_PROVIDER_NOT_IMPLEMENTED" });
    await expect(
      provider.cancel({
        orderId: "order-001",
        idempotencyKey: "cancel-operation-001",
      }),
    ).rejects.toBeInstanceOf(StripePaymentProviderUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
