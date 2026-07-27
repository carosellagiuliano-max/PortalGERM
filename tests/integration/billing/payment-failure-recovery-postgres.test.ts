import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCheckoutOrder } from "@/lib/billing/orders";
import { projectPaymentInboxEvent } from "@/lib/billing/payment-inbox";
import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  phase24ProviderEvent,
  projectPhase24ProviderEvent,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 24 payment failure recovery", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture(
      "phase24-payment-failure-recovery",
    );
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("holds an ambiguous provider failure and never falls back to Mock", async () => {
    fixture.provider.checkoutFailure = true;
    const orderId = randomUUID();
    const evidence = await fixture.issueCheckoutStepUp(orderId);
    const command = {
      kind: "PLAN" as const,
      planSlug: "starter" as const,
      paymentOrderId: orderId,
      stepUpEvidenceId: evidence.evidenceId,
      idempotencyKey: `failure-${randomUUID()}`,
    };
    const first = await createCheckoutOrder(command, fixture.dependencies());
    const replay = await createCheckoutOrder(command, fixture.dependencies());

    expect(first).toEqual({ ok: false, code: "PAYMENT_PROVIDER_FAILED" });
    expect(replay).toEqual({ ok: false, code: "PAYMENT_HELD" });
    expect(fixture.provider.checkoutInputs).toHaveLength(1);
    await expect(
      fixture.database.paymentAttempt.findFirstOrThrow({
        where: { orderId },
        select: { failureCode: true, status: true },
      }),
    ).resolves.toEqual({
      failureCode: "CHECKOUT_CALL_UNCERTAIN",
      status: "HELD",
    });
    expect(
      await fixture.database.paymentEvent.count({
        where: { orderId, provider: "MOCK" },
      }),
    ).toBe(0);
  });

  it("keeps ingestion durable while projection is disabled and projects later", async () => {
    fixture.provider.checkoutFailure = false;
    const checkout = await createPhase24StarterCheckout(fixture);
    const event = phase24ProviderEvent(checkout);
    const deferred = await projectPhase24ProviderEvent(fixture, event, {
      projectionEnabled: false,
    });
    expect(deferred.projection).toBeNull();
    expect(
      await fixture.database.workItem.count({
        where: { subjectId: deferred.ingestion.inboxId },
      }),
    ).toBe(0);

    const projected = await projectPaymentInboxEvent(
      {
        correlationId: randomUUID(),
        inboxId: deferred.ingestion.inboxId,
        now: new Date(event.eventCreatedAt.getTime() + 5_000),
      },
      {
        database: fixture.database,
        emailProvider: fixture.dependencies().emailProvider,
      },
    );
    expect(projected).toMatchObject({ status: "PROJECTED" });
    await expect(
      fixture.database.order.findUniqueOrThrow({
        where: { id: checkout.orderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PAID" });
  });
});
