// @vitest-environment node

import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  StripePaymentProvider,
  StripePaymentProviderError,
} from "@/lib/providers/payments";

const ACCOUNT = "acct_phase33contract";
const requests: Array<{
  body: string;
  headers: IncomingHttpHeaders;
  method: string | undefined;
  path: string | undefined;
}> = [];
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  requests.push({
    body: Buffer.concat(chunks).toString("utf8"),
    headers: request.headers,
    method: request.method,
    path: request.url,
  });
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
  });
  if (request.url?.startsWith("/v1/invoice_payments") === true) {
    response.end(
      JSON.stringify({
        object: "list",
        data: [
          {
            id: "inpay_phase33contract",
            object: "invoice_payment",
            amount_paid: 16_107,
            amount_requested: 16_107,
            created: 1_786_000_000,
            currency: "chf",
            invoice: "in_phase33contract",
            is_default: true,
            livemode: false,
            payment: {
              type: "payment_intent",
              payment_intent: "pi_phase33contract",
            },
            status: "paid",
            status_transitions: { canceled_at: null, paid_at: 1_786_000_001 },
          },
        ],
        has_more: false,
        url: "/v1/invoice_payments",
      }),
    );
    return;
  }
  if (request.url === "/v1/refunds") {
    response.end(
      JSON.stringify({
        id: "re_phase33contract",
        object: "refund",
        amount: 5_000,
        currency: "chf",
        status: "pending",
      }),
    );
    return;
  }
  response.end(
    JSON.stringify({
      id: "cs_contract_phase33checkout",
      object: "checkout.session",
      url: "https://checkout.contract.invalid/session/phase33",
    }),
  );
});

let endpoint = "";

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  endpoint = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

beforeEach(() => {
  requests.length = 0;
});

describe("Phase-33 Stripe HTTP contract transport", () => {
  it("executes contract checkout against the explicit stub endpoint", async () => {
    const provider = new StripePaymentProvider({
      accountId: ACCOUNT,
      contractEndpoint: endpoint,
      mode: "stripe_contract",
      secretKey: "sk_test_phase33contract",
      webhookSecret: "whsec_phase33contract",
    });
    const orderId = randomUUID();
    const paymentAttemptId = randomUUID();
    const expiresAt = new Date(Date.now() + 35 * 60_000);
    await expect(
      provider.createCheckout({
        authoritative: {
          amountRappen: 16_107,
          checkout: {
            billingInterval: "MONTHLY",
            kind: "SUBSCRIPTION",
            providerPriceReference: "price_phase33contract",
          },
          currency: "CHF",
          customerEmail: "contract@example.ch",
          description: "Starter Monatsplan",
          expiresAt,
          paymentAttemptId,
          quoteDigest: "a".repeat(64),
        },
        cancelUrl: "https://example.ch/employer/billing/subscription",
        idempotencyKey: `contract:${orderId}`,
        orderId,
        successUrl: `https://example.ch/employer/billing/success?order=${orderId}`,
      }),
    ).resolves.toMatchObject({
      provider: "STRIPE",
      providerSessionReference: "cs_contract_phase33checkout",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/checkout/sessions",
    });
    expect(requests[0]!.headers["stripe-account"]).toBeUndefined();
    expect(requests[0]!.headers["idempotency-key"]).toBe(`contract:${orderId}`);
    expect(requests[0]!.body).toContain("mode=subscription");
    expect(requests[0]!.body).toContain("price_phase33contract");
    expect(requests[0]!.body).toContain(
      `expires_at=${Math.floor(expiresAt.getTime() / 1_000)}`,
    );
  });

  it("never permits a custom endpoint outside contract mode or an implicit contract endpoint", () => {
    expect(
      () =>
        new StripePaymentProvider({
          accountId: ACCOUNT,
          contractEndpoint: endpoint,
          mode: "stripe_sandbox",
          secretKey: "sk_test_phase33sandbox",
          webhookSecret: "whsec_phase33sandbox",
        }),
    ).toThrow(StripePaymentProviderError);
    expect(
      () =>
        new StripePaymentProvider({
          accountId: ACCOUNT,
          mode: "stripe_contract",
          secretKey: "sk_test_phase33contract",
          webhookSecret: "whsec_phase33contract",
        }),
    ).toThrow(StripePaymentProviderError);
    expect(
      () =>
        new StripePaymentProvider({
          accountId: ACCOUNT,
          contractEndpoint: "http://api.stripe.com:8080",
          mode: "stripe_contract",
          secretKey: "sk_test_phase33contract",
          webhookSecret: "whsec_phase33contract",
        }),
    ).toThrow(StripePaymentProviderError);
  });

  it("hydrates an unexpanded paid invoice through one bounded InvoicePayment list", async () => {
    const provider = new StripePaymentProvider({
      accountId: ACCOUNT,
      contractEndpoint: endpoint,
      mode: "stripe_contract",
      secretKey: "sk_test_phase33contract",
      webhookSecret: "whsec_phase33contract",
    });
    await expect(
      provider.resolveInvoicePayment({
        amountRappen: 16_107,
        currency: "CHF",
        providerInvoiceReference: "in_phase33contract",
      }),
    ).resolves.toMatchObject({
      amountRappen: 16_107,
      currency: "CHF",
      evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      providerInvoicePaymentReference: "inpay_phase33contract",
      providerPaymentReference: "pi_phase33contract",
      source: "STRIPE_INVOICE_PAYMENTS_LIST_V1",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.path).toContain("/v1/invoice_payments?");
    expect(requests[0]!.path).toContain("invoice=in_phase33contract");
    expect(requests[0]!.path).toContain("limit=10");
    expect(requests[0]!.path).toContain("status=paid");
  });

  it("binds the immutable internal refund id and source into provider metadata", async () => {
    const provider = new StripePaymentProvider({
      accountId: ACCOUNT,
      contractEndpoint: endpoint,
      mode: "stripe_contract",
      secretKey: "sk_test_phase33contract",
      webhookSecret: "whsec_phase33contract",
    });
    const refundId = randomUUID();
    await expect(
      provider.createRefund({
        amountRappen: 5_000,
        idempotencyKey: `refund:${refundId}`,
        orderId: randomUUID(),
        paymentAttemptId: randomUUID(),
        providerPaymentReference: "pi_phase33contract",
        reasonCode: "PLATFORM_FAILURE",
        refundId,
        sourceKind: "SUBSCRIPTION_PROVIDER_INVOICE",
      }),
    ).resolves.toMatchObject({
      providerRefundReference: "re_phase33contract",
      status: "PENDING",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.path).toBe("/v1/refunds");
    expect(requests[0]!.body).toContain(`metadata[refund_id]=${refundId}`);
    expect(requests[0]!.body).toContain(
      "metadata[source_kind]=SUBSCRIPTION_PROVIDER_INVOICE",
    );
  });
});
