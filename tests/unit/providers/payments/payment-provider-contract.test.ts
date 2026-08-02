import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
  StripePaymentProvider,
  StripePaymentProviderError,
} from "@/lib/providers/payments";

const SECRET = "whsec_phase24testsecret";
const ACCOUNT = "acct_phase24test";

function providerWithStripe() {
  const stripe = new Stripe("sk_test_phase24testsecret");
  const provider = new StripePaymentProvider({
    accountId: ACCOUNT,
    mode: "stripe_sandbox",
    secretKey: "sk_test_phase24testsecret",
    webhookSecret: SECRET,
    stripeClient: stripe,
  });
  return { provider, stripe };
}

describe("Phase-24 Stripe hosted provider contract", () => {
  it("creates a hosted test checkout from the authoritative snapshot only", async () => {
    const { provider, stripe } = providerWithStripe();
    const create = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({
        id: "cs_test_phase24session",
        url: "https://checkout.stripe.com/c/pay/cs_test_phase24session",
      } as unknown as Awaited<
        ReturnType<typeof stripe.checkout.sessions.create>
      >);
    const orderId = randomUUID();
    const paymentAttemptId = randomUUID();
    const expiresAt = new Date(Date.now() + 35 * 60_000);
    const result = await provider.createCheckout({
      orderId,
      idempotencyKey: `checkout:${orderId}`,
      successUrl: `https://example.ch/employer/billing/success?order=${orderId}`,
      cancelUrl: "https://example.ch/employer/billing/subscription",
      authoritative: {
        amountRappen: 16_107,
        currency: "CHF",
        customerEmail: "owner@example.ch",
        description: "Starter Monatsplan",
        expiresAt,
        quoteDigest: "a".repeat(64),
        paymentAttemptId,
        checkout: {
          kind: "SUBSCRIPTION",
          billingInterval: "MONTHLY",
          providerPriceReference: "price_phase33starter",
        },
      },
    });
    expect(result).toEqual({
      orderId,
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_phase24session",
      provider: "STRIPE",
      providerSessionReference: "cs_test_phase24session",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        expires_at: Math.floor(expiresAt.getTime() / 1_000),
        client_reference_id: orderId,
        metadata: expect.objectContaining({
          order_id: orderId,
          payment_attempt_id: paymentAttemptId,
          quote_digest: "a".repeat(64),
        }),
        line_items: [
          expect.objectContaining({
            price: "price_phase33starter",
          }),
        ],
      }),
      { idempotencyKey: `checkout:${orderId}` },
    );
  });

  it("verifies the exact raw body and timestamp for the bound merchant", () => {
    const { provider, stripe } = providerWithStripe();
    const signedAt = Math.floor(Date.now() / 1_000);
    const orderId = randomUUID();
    const paymentAttemptId = randomUUID();
    const payload = JSON.stringify({
      id: "evt_phase24valid",
      object: "event",
      api_version: "2026-06-30.basil",
      created: signedAt,
      livemode: false,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_phase24",
          object: "checkout.session",
          amount_total: 16_107,
          currency: "chf",
          payment_status: "paid",
          customer: "cus_phase33customer",
          subscription: "sub_phase33subscription",
          client_reference_id: orderId,
          metadata: {
            payment_attempt_id: paymentAttemptId,
            provider_price_reference: "price_phase33starter",
          },
        },
      },
    });
    const signatureHeader = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
      timestamp: signedAt,
    });
    expect(
      provider.verifyWebhook({
        rawBody: payload,
        signatureHeader,
        toleranceSeconds: 300,
      }),
    ).toEqual(
      expect.objectContaining({
        providerEventId: "evt_phase24valid",
        providerAccountReference: ACCOUNT,
        amountRappen: 16_107,
        currency: "CHF",
        providerStatus: "paid",
        providerPaymentReference: null,
        providerSubscriptionReference: "sub_phase33subscription",
        liveMode: false,
      }),
    );
    expect(() =>
      provider.verifyWebhook({
        rawBody: `${payload} `,
        signatureHeader,
      }),
    ).toThrow(StripePaymentProviderError);
  });

  it("normalizes the paid PaymentIntent from a current subscription invoice payload", () => {
    const { provider, stripe } = providerWithStripe();
    const signedAt = Math.floor(Date.now() / 1_000);
    const orderId = randomUUID();
    const paymentAttemptId = randomUUID();
    const payload = JSON.stringify({
      id: "evt_phase33invoicepaid",
      object: "event",
      api_version: "2026-06-30.basil",
      created: signedAt,
      livemode: false,
      type: "invoice.paid",
      data: {
        object: {
          id: "in_phase33initial",
          object: "invoice",
          amount_paid: 16_107,
          currency: "chf",
          customer: "cus_phase33customer",
          status: "paid",
          parent: {
            subscription_details: {
              subscription: "sub_phase33subscription",
              metadata: {
                order_id: orderId,
                payment_attempt_id: paymentAttemptId,
                provider_price_reference: "price_phase33starter",
              },
            },
          },
          lines: {
            data: [
              {
                period: { start: signedAt, end: signedAt + 2_592_000 },
                pricing: {
                  price_details: { price: "price_phase33starter" },
                },
              },
            ],
          },
          payments: {
            data: [
              {
                status: "paid",
                payment: {
                  type: "payment_intent",
                  payment_intent: "pi_phase33initial",
                },
              },
            ],
          },
        },
      },
    });
    const signatureHeader = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
      timestamp: signedAt,
    });

    expect(
      provider.verifyWebhook({ rawBody: payload, signatureHeader }),
    ).toEqual(
      expect.objectContaining({
        amountRappen: 16_107,
        currency: "CHF",
        orderId,
        paymentAttemptId,
        providerCustomerReference: "cus_phase33customer",
        providerInvoiceReference: "in_phase33initial",
        providerPaymentReference: "pi_phase33initial",
        providerPriceReference: "price_phase33starter",
        providerSubscriptionReference: "sub_phase33subscription",
        providerStatus: "paid",
      }),
    );
  });

  it("normalizes the immutable internal refund id and exact charge source", () => {
    const { provider, stripe } = providerWithStripe();
    const signedAt = Math.floor(Date.now() / 1_000);
    const orderId = randomUUID();
    const paymentAttemptId = randomUUID();
    const refundId = randomUUID();
    const payload = JSON.stringify({
      id: "evt_phase33refund",
      object: "event",
      api_version: "2026-06-30.basil",
      created: signedAt,
      livemode: false,
      type: "refund.updated",
      data: {
        object: {
          id: "re_phase33refund",
          object: "refund",
          amount: 5_000,
          currency: "chf",
          payment_intent: "pi_phase33refundsource",
          status: "succeeded",
          metadata: {
            order_id: orderId,
            payment_attempt_id: paymentAttemptId,
            refund_id: refundId,
            source_kind: "SUBSCRIPTION_PROVIDER_INVOICE",
          },
        },
      },
    });
    const signatureHeader = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
      timestamp: signedAt,
    });

    expect(
      provider.verifyWebhook({ rawBody: payload, signatureHeader }),
    ).toEqual(
      expect.objectContaining({
        amountRappen: 5_000,
        currency: "CHF",
        orderId,
        paymentAttemptId,
        providerObjectReference: "re_phase33refund",
        providerPaymentReference: "pi_phase33refundsource",
        providerStatus: "succeeded",
        refundId,
      }),
    );
  });

  it("expires a stale hosted session with a distinct idempotency key", async () => {
    const { provider, stripe } = providerWithStripe();
    const expire = vi
      .spyOn(stripe.checkout.sessions, "expire")
      .mockResolvedValue({ id: "cs_test_phase24session" } as unknown as Awaited<
        ReturnType<typeof stripe.checkout.sessions.expire>
      >);
    const orderId = randomUUID();

    await provider.expireCheckoutSession({
      idempotencyKey: `expire-checkout:${orderId}`,
      orderId,
      providerSessionReference: "cs_test_phase24session",
    });

    expect(expire).toHaveBeenCalledWith(
      "cs_test_phase24session",
      {},
      { idempotencyKey: `expire-checkout:${orderId}` },
    );
  });

  it("forbids live events and direct real-payment confirmation", async () => {
    const { provider, stripe } = providerWithStripe();
    const payload = JSON.stringify({
      id: "evt_phase24live",
      object: "event",
      created: Math.floor(Date.now() / 1_000),
      livemode: true,
      type: "checkout.session.completed",
      data: { object: { id: "cs_live_phase24", object: "checkout.session" } },
    });
    const signatureHeader = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
    });
    expect(() =>
      provider.verifyWebhook({ rawBody: payload, signatureHeader }),
    ).toThrow(/livemode/iu);
    await expect(
      provider.confirmPayment({
        orderId: randomUUID(),
        idempotencyKey: "phase24-direct-confirm",
      }),
    ).rejects.toThrow(/verified webhook/iu);
  });
});
