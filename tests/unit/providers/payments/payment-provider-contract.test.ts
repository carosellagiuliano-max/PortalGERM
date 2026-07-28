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
        quoteDigest: "a".repeat(64),
        paymentAttemptId,
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
        mode: "payment",
        client_reference_id: orderId,
        metadata: expect.objectContaining({
          order_id: orderId,
          payment_attempt_id: paymentAttemptId,
          quote_digest: "a".repeat(64),
        }),
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              currency: "chf",
              unit_amount: 16_107,
            }),
          }),
        ],
      }),
      { idempotencyKey: `checkout:${orderId}` },
    );
  });

  it("verifies the exact raw body, timestamp and merchant account", () => {
    const { provider, stripe } = providerWithStripe();
    const signedAt = Math.floor(Date.now() / 1_000);
    const payload = JSON.stringify({
      id: "evt_phase24valid",
      object: "event",
      api_version: "2026-06-30.basil",
      account: ACCOUNT,
      created: signedAt,
      livemode: false,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_phase24",
          object: "checkout.session",
          amount_total: 16_107,
          currency: "chf",
          payment_intent: "pi_phase24payment",
          payment_status: "paid",
          client_reference_id: randomUUID(),
          metadata: {
            payment_attempt_id: randomUUID(),
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

  it("forbids live events and direct real-payment confirmation", async () => {
    const { provider, stripe } = providerWithStripe();
    const payload = JSON.stringify({
      id: "evt_phase24live",
      object: "event",
      account: ACCOUNT,
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
    ).toThrow(/Live Stripe events are forbidden/iu);
    await expect(
      provider.confirmPayment({
        orderId: randomUUID(),
        idempotencyKey: "phase24-direct-confirm",
      }),
    ).rejects.toThrow(/verified webhook/iu);
  });
});
