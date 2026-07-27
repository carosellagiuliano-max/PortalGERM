import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCheckoutOrder } from "@/lib/billing/orders";
import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 24 payment-risk containment", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture("phase24-payment-fraud");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("stops checkout before the provider when tenant velocity requires review", async () => {
    await createPhase24StarterCheckout(fixture);
    await createPhase24StarterCheckout(fixture);

    const heldOrderId = randomUUID();
    const evidence = await fixture.issueCheckoutStepUp(heldOrderId);
    const held = await createCheckoutOrder(
      {
        kind: "PLAN",
        planSlug: "starter",
        paymentOrderId: heldOrderId,
        stepUpEvidenceId: evidence.evidenceId,
        idempotencyKey: `risk-review-${randomUUID()}`,
      },
      fixture.dependencies(),
    );

    expect(held).toEqual({ ok: false, code: "PAYMENT_HELD" });
    expect(fixture.provider.checkoutInputs).toHaveLength(2);
    const [attempt, risk] = await Promise.all([
      fixture.database.paymentAttempt.findFirstOrThrow({
        where: { orderId: heldOrderId },
      }),
      fixture.database.paymentRiskDecision.findFirstOrThrow({
        where: { paymentAttempt: { orderId: heldOrderId } },
      }),
    ]);
    expect(attempt).toMatchObject({
      failureCode: "PAYMENT_RISK_REVIEW",
      status: "HELD",
    });
    expect(risk.kind).toBe("REVIEW");
    expect(risk.signalCodes).toContain("CHECKOUT_VELOCITY_REVIEW");
  });
});
