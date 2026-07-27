import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  PHASE24_STARTER_TOTAL_RAPPEN,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 24 real hosted checkout", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture("phase24-real-payment");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("binds a server-authoritative CHF quote to WTP, provider and step-up evidence", async () => {
    const checkout = await createPhase24StarterCheckout(fixture, {
      idempotencyKey: `real-payment-${randomUUID()}`,
    });
    const [order, attempt] = await Promise.all([
      fixture.database.order.findUniqueOrThrow({
        where: { id: checkout.orderId },
        include: { lines: true },
      }),
      fixture.database.paymentAttempt.findUniqueOrThrow({
        where: { id: checkout.paymentAttemptId },
      }),
    ]);

    expect(order).toMatchObject({
      provider: "STRIPE",
      status: "PENDING",
      currency: "CHF",
      totalRappen: PHASE24_STARTER_TOTAL_RAPPEN,
    });
    expect(order.lines).toHaveLength(1);
    expect(attempt).toMatchObject({
      amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
      currency: "CHF",
      environment: "ci",
      paidScopeDecisionId: fixture.scopeDecisionId,
      providerActivationId: fixture.providerActivationId,
      status: "CHECKOUT_CREATED",
    });
    expect(fixture.provider.checkoutInputs).toHaveLength(1);
    expect(fixture.provider.checkoutInputs[0]?.authoritative).toMatchObject({
      amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
      currency: "CHF",
      paymentAttemptId: checkout.paymentAttemptId,
    });
  });
});
