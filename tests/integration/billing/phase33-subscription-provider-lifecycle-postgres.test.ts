import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ingestVerifiedPaymentEvent } from "@/lib/billing/payment-inbox";
import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  phase24ProviderEvent,
  projectPhase24ProviderEvent,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 33 signed subscription provider lifecycle", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture(
      "phase33-subscription-provider-lifecycle",
    );
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("projects renewals monotonically, recovers dunning, and honours provider cancellation", async () => {
    const checkout = await createPhase24StarterCheckout(fixture);
    const checkoutCompleted = phase24ProviderEvent(checkout, {
      providerInvoiceReference: null,
      providerPaymentReference: null,
      providerPeriodEnd: null,
      providerPeriodStart: null,
    });
    await expect(
      projectPhase24ProviderEvent(fixture, checkoutCompleted),
    ).resolves.toMatchObject({
      ingestion: { replay: false },
      projection: { replay: false, status: "PROJECTED" },
    });
    await expect(
      fixture.database.order.findUniqueOrThrow({
        where: { id: checkout.orderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PENDING" });
    await expect(
      fixture.database.employerSubscription.count({
        where: { companyId: fixture.companyId },
      }),
    ).resolves.toBe(0);

    const subscriptionReference =
      checkoutCompleted.providerSubscriptionReference;
    if (subscriptionReference === null) {
      throw new Error("Expected a signed provider subscription reference.");
    }
    const initialInvoice = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date(
        checkoutCompleted.eventCreatedAt.getTime() + 1_000,
      ),
      eventType: "invoice.paid",
      providerEventId: `evt_initial_invoice_${randomUUID().replaceAll("-", "")}`,
      providerInvoiceReference: `in_initial_${randomUUID().replaceAll("-", "")}`,
      providerPaymentReference: `pi_initial_${randomUUID().replaceAll("-", "")}`,
      providerSessionReference: null,
      providerStatus: "paid",
      providerSubscriptionReference: subscriptionReference,
    });
    await expect(
      projectPhase24ProviderEvent(fixture, initialInvoice),
    ).resolves.toMatchObject({
      ingestion: { replay: false },
      projection: { replay: false, status: "PROJECTED" },
    });
    await expect(
      fixture.database.order.findUniqueOrThrow({
        where: { id: checkout.orderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PAID" });

    const renewal = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date("2026-08-28T12:01:00.000Z"),
      eventType: "invoice.paid",
      providerEventId: `evt_renewal_${randomUUID().replaceAll("-", "")}`,
      providerInvoiceReference: `in_renewal_${randomUUID().replaceAll("-", "")}`,
      providerPaymentReference: `pi_renewal_${randomUUID().replaceAll("-", "")}`,
      providerPeriodStart: new Date("2026-08-28T12:00:00.000Z"),
      providerPeriodEnd: new Date("2026-09-28T12:00:00.000Z"),
      providerStatus: "paid",
      providerSubscriptionReference: subscriptionReference,
    });
    const renewalResult = await projectPhase24ProviderEvent(fixture, renewal);
    expect(renewalResult.projection).toMatchObject({
      replay: false,
      status: "PROJECTED",
    });

    const replay = await projectPhase24ProviderEvent(fixture, renewal);
    expect(replay).toMatchObject({
      ingestion: { replay: true },
      projection: { replay: true, status: "PROJECTED" },
    });

    const freshRetryAt = new Date(renewal.eventCreatedAt.getTime() + 5_000);
    await expect(
      ingestVerifiedPaymentEvent(
        {
          adapterKey: "stripe_sandbox",
          adapterVersion: "v1",
          correlationId: randomUUID(),
          environment: "ci",
          event: renewal,
          expectedLiveMode: false,
          projectionEnabled: true,
          providerMode: "SANDBOX",
          rawBody: JSON.stringify({
            id: renewal.providerEventId,
            type: renewal.eventType,
          }),
          receivedAt: freshRetryAt,
          signatureHeader: `t=${Math.floor(
            freshRetryAt.getTime() / 1_000,
          )},v1=${"b".repeat(64)}`,
        },
        fixture.database,
      ),
    ).resolves.toMatchObject({ replay: true });

    await expect(
      ingestVerifiedPaymentEvent(
        {
          adapterKey: "stripe_sandbox",
          adapterVersion: "v1",
          correlationId: randomUUID(),
          environment: "ci",
          event: renewal,
          expectedLiveMode: false,
          projectionEnabled: true,
          providerMode: "SANDBOX",
          rawBody: JSON.stringify({
            id: renewal.providerEventId,
            tampered: true,
            type: renewal.eventType,
          }),
          receivedAt: new Date(renewal.eventCreatedAt.getTime() + 1_000),
          signatureHeader: `t=${Math.floor(
            (renewal.eventCreatedAt.getTime() + 1_000) / 1_000,
          )},v1=${"a".repeat(64)}`,
        },
        fixture.database,
      ),
    ).rejects.toThrow("Payment event replay envelope conflicts.");

    const outOfOrder = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date("2026-08-28T12:00:30.000Z"),
      eventType: "customer.subscription.updated",
      providerCancelAtPeriodEnd: true,
      providerEventId: `evt_stale_${randomUUID().replaceAll("-", "")}`,
      providerPeriodEnd: null,
      providerPeriodStart: null,
      providerStatus: "active",
      providerSubscriptionReference: subscriptionReference,
    });
    await expect(
      projectPhase24ProviderEvent(fixture, outOfOrder),
    ).resolves.toMatchObject({
      projection: { status: "IGNORED" },
    });

    const failure = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date("2026-09-27T12:01:00.000Z"),
      eventType: "invoice.payment_failed",
      providerEventId: `evt_failed_${randomUUID().replaceAll("-", "")}`,
      providerInvoiceReference: `in_failed_${randomUUID().replaceAll("-", "")}`,
      providerPaymentReference: null,
      providerPeriodEnd: null,
      providerPeriodStart: null,
      providerStatus: "failed",
      providerSubscriptionReference: subscriptionReference,
    });
    await expect(
      projectPhase24ProviderEvent(fixture, failure),
    ).resolves.toMatchObject({
      projection: { status: "PROJECTED" },
    });
    await expect(
      fixture.database.dunningCase.findFirstOrThrow({
        where: {
          companyId: fixture.companyId,
          idempotencyKey: `dunning:invoice:${failure.providerInvoiceReference}`,
        },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "GRACE" });

    const recovery = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date("2026-09-27T13:01:00.000Z"),
      eventType: "invoice.payment_succeeded",
      providerEventId: `evt_recovery_${randomUUID().replaceAll("-", "")}`,
      providerInvoiceReference: failure.providerInvoiceReference,
      providerPaymentReference: `pi_recovery_${randomUUID().replaceAll("-", "")}`,
      providerPeriodStart: new Date("2026-09-28T12:00:00.000Z"),
      providerPeriodEnd: new Date("2026-10-28T12:00:00.000Z"),
      providerStatus: "paid",
      providerSubscriptionReference: subscriptionReference,
    });
    await expect(
      projectPhase24ProviderEvent(fixture, recovery),
    ).resolves.toMatchObject({
      projection: { status: "PROJECTED" },
    });
    await expect(
      fixture.database.dunningCase.findFirstOrThrow({
        where: {
          companyId: fixture.companyId,
          idempotencyKey: `dunning:invoice:${failure.providerInvoiceReference}`,
        },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "RESOLVED" });

    const cancelAtPeriodEnd = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date("2026-09-27T13:02:00.000Z"),
      eventType: "customer.subscription.updated",
      providerCancelAtPeriodEnd: true,
      providerEventId: `evt_cancel_pending_${randomUUID().replaceAll("-", "")}`,
      providerPeriodEnd: null,
      providerPeriodStart: null,
      providerStatus: "active",
      providerSubscriptionReference: subscriptionReference,
    });
    await projectPhase24ProviderEvent(fixture, cancelAtPeriodEnd);
    await expect(
      fixture.database.employerSubscription.findUniqueOrThrow({
        where: { providerSubscriptionReference: subscriptionReference },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "CANCELLING" });

    const cancelled = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date("2026-10-28T12:01:00.000Z"),
      eventType: "customer.subscription.deleted",
      providerCancelAtPeriodEnd: false,
      providerEventId: `evt_cancelled_${randomUUID().replaceAll("-", "")}`,
      providerPeriodEnd: null,
      providerPeriodStart: null,
      providerStatus: "canceled",
      providerSubscriptionReference: subscriptionReference,
    });
    await projectPhase24ProviderEvent(fixture, cancelled);

    const [subscription, recurringPaymentEvents] = await Promise.all([
      fixture.database.employerSubscription.findUniqueOrThrow({
        where: { providerSubscriptionReference: subscriptionReference },
        select: {
          id: true,
          currentPeriodEnd: true,
          currentPeriodStart: true,
          endedAt: true,
          status: true,
        },
      }),
      fixture.database.paymentEvent.findMany({
        where: {
          orderId: checkout.orderId,
        },
        orderBy: { createdAt: "asc" },
        select: { idempotencyKey: true, kind: true },
      }),
    ]);
    expect(subscription).toMatchObject({
      currentPeriodEnd: new Date("2026-10-28T12:00:00.000Z"),
      currentPeriodStart: new Date("2026-09-28T12:00:00.000Z"),
      status: "CANCELLED",
    });
    expect(subscription.endedAt).not.toBeNull();
    expect(
      recurringPaymentEvents.filter(({ kind }) => kind === "RENEWAL_PAID"),
    ).toHaveLength(2);
    expect(
      recurringPaymentEvents.filter(({ kind }) => kind === "RENEWAL_FAILED"),
    ).toHaveLength(1);
    await expect(
      fixture.database.subscriptionProviderInvoice.findMany({
        where: { subscriptionId: subscription.id },
        orderBy: { periodStart: "asc" },
        select: {
          providerInvoiceReference: true,
          status: true,
        },
      }),
    ).resolves.toEqual([
      {
        providerInvoiceReference: initialInvoice.providerInvoiceReference,
        status: "PAID",
      },
      {
        providerInvoiceReference: renewal.providerInvoiceReference,
        status: "PAID",
      },
      {
        providerInvoiceReference: recovery.providerInvoiceReference,
        status: "PAID",
      },
    ]);
  });
});
