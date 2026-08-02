// @vitest-environment node

import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/webhooks/payments/[provider]/route";
import { parseEnvironment } from "@/lib/config/env-schema";
import { STRIPE_PAYMENT_ADAPTER_V1 } from "@/lib/providers/payments";
import { createValidEnvironment } from "@/tests/fixtures/environment";

const mocks = vi.hoisted(() => {
  const database = Object.freeze({ marker: "payment-webhook-database" });
  return {
    database,
    getDatabase: vi.fn(() => database),
    getServerEnvironment: vi.fn(),
    ingestVerifiedPaymentEvent: vi.fn(),
    resolvePersistedProviderActivation: vi.fn(),
  };
});

vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/ops/operations-ledger", () => ({
  resolvePersistedProviderActivation:
    mocks.resolvePersistedProviderActivation,
}));
vi.mock("@/lib/billing/payment-inbox", () => ({
  ingestVerifiedPaymentEvent: mocks.ingestVerifiedPaymentEvent,
}));

const ACCOUNT_ID = "acct_phase33merchant";
const WEBHOOK_SECRET = "whsec_phase33routewebhook";
const WRONG_WEBHOOK_SECRET = "whsec_phase33wrongwebhook";

describe("POST /api/webhooks/payments/stripe authentication order", () => {
  beforeEach(() => {
    mocks.getServerEnvironment.mockReturnValue(paymentEnvironment());
    mocks.resolvePersistedProviderActivation.mockResolvedValue({
      active: true,
      mode: "SANDBOX",
    });
    mocks.ingestVerifiedPaymentEvent.mockResolvedValue({
      inboxId: "0196f82d-3fb4-7f1a-8c9d-123456789abc",
      queued: true,
      replay: false,
    });
  });

  it("does not acquire a database client when the signature header is missing", async () => {
    const response = await postStripe(
      new Request("https://swisstalenthub.test/api/webhooks/payments/stripe", {
        method: "POST",
        body: stripeEventBody(),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_SIGNATURE" });
    expectNoDatabaseEffect();
  });

  it("cryptographically rejects a bad signature before every database call", async () => {
    const rawBody = stripeEventBody();
    const response = await postStripe(
      stripeRequest(rawBody, stripeSignature(rawBody, WRONG_WEBHOOK_SECRET)),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "WEBHOOK_INVALID" });
    expectNoDatabaseEffect();
  });

  it("rejects a declared oversized body before every database call", async () => {
    const rawBody = stripeEventBody();
    const request = stripeRequest(rawBody, stripeSignature(rawBody));
    request.headers.set(
      "content-length",
      String(STRIPE_PAYMENT_ADAPTER_V1.maximumRawBodyBytes + 1),
    );

    const response = await postStripe(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "BODY_TOO_LARGE" });
    expectNoDatabaseEffect();
  });

  it("bounds an oversized chunked stream before every database call", async () => {
    const request = streamedStripeRequest([
      new Uint8Array(STRIPE_PAYMENT_ADAPTER_V1.maximumRawBodyBytes),
      new Uint8Array(1),
    ]);

    const response = await postStripe(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "BODY_TOO_LARGE" });
    expectNoDatabaseEffect();
  });

  it("queries the exact activation only after a valid signed envelope", async () => {
    const rawBody = stripeEventBody();
    const response = await postStripe(
      stripeRequest(rawBody, stripeSignature(rawBody)),
    );

    expect(response.status).toBe(202);
    expect(mocks.getDatabase).toHaveBeenCalledOnce();
    expect(mocks.resolvePersistedProviderActivation).toHaveBeenCalledWith(
      mocks.database,
      expect.objectContaining({
        adapterKey: "stripe_sandbox",
        expectedMode: "SANDBOX",
        expectedSecretVersionRef: "phase33-route-v1",
        useCase: "payments.hosted-checkout",
      }),
    );
    expect(mocks.ingestVerifiedPaymentEvent).toHaveBeenCalledOnce();
    expect(mocks.ingestVerifiedPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outboundActivationActive: true }),
      mocks.database,
    );
  });

  it("accepts a historically authorized settlement after outbound revocation", async () => {
    mocks.resolvePersistedProviderActivation.mockResolvedValue({
      active: false,
      reason: "REVOKED",
    });
    const rawBody = stripeEventBody();

    const response = await postStripe(
      stripeRequest(rawBody, stripeSignature(rawBody)),
    );

    expect(response.status).toBe(202);
    expect(mocks.ingestVerifiedPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outboundActivationActive: false }),
      mocks.database,
    );
  });

  it("accepts the same raw event with independently valid retry signatures", async () => {
    const rawBody = stripeEventBody();
    const signedAt = Math.floor(Date.now() / 1_000);
    const firstSignature = stripeSignature(
      rawBody,
      WEBHOOK_SECRET,
      signedAt,
    );
    const retrySignature = stripeSignature(
      rawBody,
      WEBHOOK_SECRET,
      signedAt + 1,
    );
    mocks.ingestVerifiedPaymentEvent
      .mockResolvedValueOnce({
        inboxId: "0196f82d-3fb4-7f1a-8c9d-123456789abc",
        queued: true,
        replay: false,
      })
      .mockResolvedValueOnce({
        inboxId: "0196f82d-3fb4-7f1a-8c9d-123456789abc",
        queued: true,
        replay: true,
      });

    const first = await postStripe(
      stripeRequest(rawBody, firstSignature),
    );
    const retry = await postStripe(
      stripeRequest(rawBody, retrySignature),
    );

    expect(firstSignature).not.toBe(retrySignature);
    expect(first.status).toBe(202);
    expect(retry.status).toBe(200);
    expect(mocks.ingestVerifiedPaymentEvent).toHaveBeenCalledTimes(2);
  });
});

function paymentEnvironment() {
  return parseEnvironment(
    createValidEnvironment({
      PAYMENT_PROVIDER_MODE: "stripe_sandbox",
      REAL_PAYMENT_INGESTION: "true",
      STRIPE_ACCOUNT_ID: ACCOUNT_ID,
      STRIPE_SECRET_KEY: "sk_test_phase33routekey",
      STRIPE_SECRET_VERSION: "phase33-route-v1",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    }),
  );
}

function stripeEventBody() {
  return JSON.stringify({
    id: "evt_phase33_route_01",
    object: "event",
    created: Math.floor(Date.now() / 1_000),
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_phase33_route_01",
        object: "checkout.session",
      },
    },
  });
}

function stripeSignature(
  rawBody: string,
  secret = WEBHOOK_SECRET,
  timestamp = Math.floor(Date.now() / 1_000),
): string {
  return new Stripe("sk_test_phase33signing").webhooks.generateTestHeaderString(
    { payload: rawBody, secret, timestamp },
  );
}

function stripeRequest(rawBody: string, signature: string) {
  return new Request(
    "https://swisstalenthub.test/api/webhooks/payments/stripe",
    {
      method: "POST",
      body: rawBody,
      headers: { "stripe-signature": signature },
    },
  );
}

function streamedStripeRequest(chunks: Uint8Array[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request(
    "https://swisstalenthub.test/api/webhooks/payments/stripe",
    {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: { "stripe-signature": "t=1,v1=invalid" },
    } as RequestInit & { duplex: "half" },
  );
}

function postStripe(request: Request) {
  return POST(request, {
    params: Promise.resolve({ provider: "stripe" }),
  });
}

function expectNoDatabaseEffect() {
  expect(mocks.getDatabase).not.toHaveBeenCalled();
  expect(mocks.resolvePersistedProviderActivation).not.toHaveBeenCalled();
  expect(mocks.ingestVerifiedPaymentEvent).not.toHaveBeenCalled();
}
