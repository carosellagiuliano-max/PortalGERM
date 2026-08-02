import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCheckoutOrder } from "@/lib/billing/orders";
import { reconcilePersistedPayments } from "@/lib/billing/finance-reconciliation";
import {
  projectPaymentInboxEvent,
  resumePaymentInboxProjectionBacklog,
} from "@/lib/billing/payment-inbox";
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

  it("resolves an ambiguous provider failure by replaying the exact Stripe idempotency key", async () => {
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
    await expect(
      reconcilePersistedPayments(
        {
          correlationId: randomUUID(),
          environment: "ci",
          now: new Date(fixture.now.getTime() + 1_000),
        },
        fixture.database,
      ),
    ).resolves.toMatchObject({ matched: 0, mismatched: 1, processed: 1 });
    fixture.provider.checkoutFailure = false;
    const replay = await createCheckoutOrder(command, fixture.dependencies());

    expect(first).toEqual({ ok: false, code: "PAYMENT_PROVIDER_FAILED" });
    expect(replay).toMatchObject({
      ok: true,
      replay: true,
      value: { orderId, status: "PENDING" },
    });
    expect(fixture.provider.checkoutInputs).toHaveLength(2);
    expect(fixture.provider.checkoutInputs[0]?.idempotencyKey).toBe(
      fixture.provider.checkoutInputs[1]?.idempotencyKey,
    );
    await expect(
      fixture.database.paymentAttempt.findFirstOrThrow({
        where: { orderId },
        select: { failureCode: true, status: true },
      }),
    ).resolves.toEqual({
      failureCode: null,
      status: "CHECKOUT_CREATED",
    });
    expect(
      await fixture.database.paymentEvent.count({
        where: { orderId, provider: "MOCK" },
      }),
    ).toBe(0);
  });

  it("atomically resumes a disabled projection backlog exactly once and projects later", async () => {
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

    const resumed = await Promise.all(
      Array.from({ length: 4 }, () =>
        resumePaymentInboxProjectionBacklog(
          {
            batchSize: 100,
            now: new Date(event.eventCreatedAt.getTime() + 4_000),
          },
          fixture.database,
        ),
      ),
    );
    expect(resumed.reduce((sum, result) => sum + result.created, 0)).toBe(1);
    expect(
      await fixture.database.workItem.count({
        where: {
          handlerKey: "payments.inbox-project",
          subjectId: deferred.ingestion.inboxId,
        },
      }),
    ).toBe(1);
    await expect(
      resumePaymentInboxProjectionBacklog(
        {
          batchSize: 100,
          now: new Date(event.eventCreatedAt.getTime() + 4_500),
        },
        fixture.database,
      ),
    ).resolves.toEqual({ selected: 0, created: 0, replayed: 0 });

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
