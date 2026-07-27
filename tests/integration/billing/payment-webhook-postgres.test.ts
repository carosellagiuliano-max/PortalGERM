import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  phase24ProviderEvent,
  projectPhase24ProviderEvent,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 24 durable payment webhook", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture("phase24-payment-webhook");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("deduplicates signed events and fulfills exactly once from the durable inbox", async () => {
    const checkout = await createPhase24StarterCheckout(fixture);
    const event = phase24ProviderEvent(checkout);
    const first = await projectPhase24ProviderEvent(fixture, event);
    const replay = await projectPhase24ProviderEvent(fixture, event);

    expect(first.ingestion).toMatchObject({ queued: true, replay: false });
    expect(first.projection).toMatchObject({
      replay: false,
      status: "PROJECTED",
    });
    expect(replay.ingestion).toMatchObject({ replay: true });
    expect(replay.projection).toMatchObject({
      replay: true,
      status: "PROJECTED",
    });

    const [order, attempts, inboxes, invoices, subscriptions, paidEvents] =
      await Promise.all([
        fixture.database.order.findUniqueOrThrow({
          where: { id: checkout.orderId },
        }),
        fixture.database.paymentAttempt.count({
          where: { orderId: checkout.orderId },
        }),
        fixture.database.providerEventInbox.count({
          where: { providerEventId: event.providerEventId },
        }),
        fixture.database.invoice.count({
          where: { orderId: checkout.orderId },
        }),
        fixture.database.employerSubscription.count({
          where: { sourceOrderId: checkout.orderId },
        }),
        fixture.database.paymentEvent.count({
          where: { orderId: checkout.orderId, kind: "PAID" },
        }),
      ]);
    expect(order.status).toBe("PAID");
    expect({ attempts, inboxes, invoices, subscriptions, paidEvents }).toEqual({
      attempts: 1,
      inboxes: 1,
      invoices: 1,
      subscriptions: 1,
      paidEvents: 1,
    });
  });

  it("holds conflicting identifiers without changing either tenant order", async () => {
    const first = await createPhase24StarterCheckout(fixture);
    const otherAttempt = await fixture.database.paymentAttempt.findFirstOrThrow(
      {
        where: { id: { not: first.paymentAttemptId } },
        select: { orderId: true },
      },
    );
    const event = phase24ProviderEvent(first, {
      orderId: otherAttempt.orderId,
    });
    const result = await projectPhase24ProviderEvent(fixture, event);

    expect(result.projection).toMatchObject({ status: "HELD" });
    await expect(
      fixture.database.order.findUniqueOrThrow({
        where: { id: first.orderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PENDING" });
  });
});
