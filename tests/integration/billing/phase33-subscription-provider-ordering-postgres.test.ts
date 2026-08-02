import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { reconcilePersistedSubscriptionProviderInvoices } from "@/lib/billing/finance-reconciliation";
import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  phase24ProviderEvent,
  projectPhase24ProviderEvent,
  type Phase24BillingFixture,
  type Phase24StarterCheckout,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 33 deterministic provider renewal ordering", () => {
  it("lets a verified checkout success dominate an equal-second failure in either delivery order", async () => {
    const failedFirstFixture = await createPhase24BillingFixture(
      "phase33-attempt-failed-paid",
    );
    const paidFirstFixture = await createPhase24BillingFixture(
      "phase33-attempt-paid-failed",
    );
    try {
      const failedFirstCheckout =
        await createPhase24StarterCheckout(failedFirstFixture);
      const paidFirstCheckout =
        await createPhase24StarterCheckout(paidFirstFixture);
      const eventCreatedAt = new Date("2026-07-28T12:01:00.000Z");
      const failedFirstSuccess = phase24ProviderEvent(failedFirstCheckout, {
        eventCreatedAt,
      });
      const failedFirstFailure = phase24ProviderEvent(failedFirstCheckout, {
        eventCreatedAt,
        eventType: "payment_intent.payment_failed",
        providerCustomerReference: null,
        providerEventId: `evt_initial_failed_${randomUUID().replaceAll("-", "")}`,
        providerInvoiceReference: null,
        providerPaymentReference: failedFirstSuccess.providerPaymentReference,
        providerPriceReference: null,
        providerStatus: "failed",
        providerSubscriptionReference: null,
      });
      const paidFirstSuccess = phase24ProviderEvent(paidFirstCheckout, {
        eventCreatedAt,
      });
      const paidFirstFailure = phase24ProviderEvent(paidFirstCheckout, {
        eventCreatedAt,
        eventType: "payment_intent.payment_failed",
        providerCustomerReference: null,
        providerEventId: `evt_initial_failed_${randomUUID().replaceAll("-", "")}`,
        providerInvoiceReference: null,
        providerPaymentReference: paidFirstSuccess.providerPaymentReference,
        providerPriceReference: null,
        providerStatus: "failed",
        providerSubscriptionReference: null,
      });

      await projectPhase24ProviderEvent(failedFirstFixture, failedFirstFailure);
      await projectPhase24ProviderEvent(failedFirstFixture, failedFirstSuccess);
      await projectPhase24ProviderEvent(paidFirstFixture, paidFirstSuccess);
      await expect(
        projectPhase24ProviderEvent(paidFirstFixture, paidFirstFailure),
      ).resolves.toMatchObject({ projection: { status: "IGNORED" } });

      await expect(
        Promise.all([
          failedFirstFixture.database.paymentAttempt.findUniqueOrThrow({
            where: { id: failedFirstCheckout.paymentAttemptId },
            select: { lastProviderEventRank: true, status: true },
          }),
          paidFirstFixture.database.paymentAttempt.findUniqueOrThrow({
            where: { id: paidFirstCheckout.paymentAttemptId },
            select: { lastProviderEventRank: true, status: true },
          }),
        ]),
      ).resolves.toEqual([
        { lastProviderEventRank: 100, status: "SUCCEEDED" },
        { lastProviderEventRank: 100, status: "SUCCEEDED" },
      ]);
    } finally {
      await Promise.all([
        failedFirstFixture.dispose(),
        paidFirstFixture.dispose(),
      ]);
    }
  }, 120_000);

  it("converges for failed→paid and paid→failed at the same provider second", async () => {
    const first = await activateSubscription("phase33-order-failed-paid");
    const second = await activateSubscription("phase33-order-paid-failed");
    try {
      const firstPair = renewalPair(first, "first");
      const secondPair = renewalPair(second, "second");

      await projectPhase24ProviderEvent(first.fixture, firstPair.failed);
      await projectPhase24ProviderEvent(first.fixture, firstPair.paid);
      await projectPhase24ProviderEvent(second.fixture, secondPair.paid);
      await expect(
        projectPhase24ProviderEvent(second.fixture, secondPair.failed),
      ).resolves.toMatchObject({ projection: { status: "IGNORED" } });

      const [failedThenPaid, paidThenFailed] = await Promise.all([
        currentState(first.fixture, first.subscriptionReference),
        currentState(second.fixture, second.subscriptionReference),
      ]);
      expect(failedThenPaid).toMatchObject({
        subscription: {
          currentPeriodStart: firstPair.periodStart,
          currentPeriodEnd: firstPair.periodEnd,
          status: "ACTIVE",
        },
        providerInvoice: {
          status: "PAID",
          providerPaymentReference: firstPair.paid.providerPaymentReference,
        },
        unresolvedDunning: 0,
      });
      expect(paidThenFailed).toMatchObject({
        subscription: {
          currentPeriodStart: secondPair.periodStart,
          currentPeriodEnd: secondPair.periodEnd,
          status: "ACTIVE",
        },
        providerInvoice: {
          status: "PAID",
          providerPaymentReference: secondPair.paid.providerPaymentReference,
        },
        unresolvedDunning: 0,
      });
      const paidEvidence =
        await first.fixture.database.subscriptionProviderInvoice.findFirstOrThrow(
          {
            where: {
              providerInvoiceReference:
                firstPair.paid.providerInvoiceReference!,
            },
            select: { firstFailureAt: true, id: true },
          },
        );
      expect(paidEvidence.firstFailureAt).not.toBeNull();
      await expect(
        first.fixture.database.subscriptionProviderInvoice.update({
          where: { id: paidEvidence.id },
          data: {
            firstFailureAt: new Date(
              paidEvidence.firstFailureAt!.getTime() - 1_000,
            ),
          },
        }),
      ).rejects.toThrow();
    } finally {
      await Promise.all([first.fixture.dispose(), second.fixture.dispose()]);
    }
  }, 120_000);

  it("serializes parallel aliases, persists one invoice, and never resurrects cancellation", async () => {
    const active = await activateSubscription("phase33-order-parallel");
    try {
      const pair = renewalPair(active, "parallel");
      const deliveries = Array.from({ length: 20 }, (_, index) =>
        index % 2 === 0
          ? {
              ...pair.failed,
              providerEventId: `evt_failed_${index}_${randomUUID().replaceAll("-", "")}`,
            }
          : {
              ...pair.paid,
              providerEventId: `evt_paid_${index}_${randomUUID().replaceAll("-", "")}`,
            },
      );
      await Promise.all(
        deliveries.map((event) =>
          projectPhase24ProviderEvent(active.fixture, event),
        ),
      );

      const afterParallel = await currentState(
        active.fixture,
        active.subscriptionReference,
      );
      expect(afterParallel).toMatchObject({
        subscription: { status: "ACTIVE" },
        providerInvoice: { status: "PAID" },
        unresolvedDunning: 0,
      });
      await expect(
        active.fixture.database.subscriptionProviderInvoice.count({
          where: {
            providerInvoiceReference: pair.paid.providerInvoiceReference!,
          },
        }),
      ).resolves.toBe(1);
      await expect(
        active.fixture.database.paymentEvent.count({
          where: {
            orderId: active.checkout.orderId,
            kind: "RENEWAL_PAID",
          },
        }),
      ).resolves.toBe(1);

      const conflictingPaidFact = {
        ...pair.paid,
        providerEventId: `evt_conflict_${randomUUID().replaceAll("-", "")}`,
        providerPaymentReference: `pi_conflict_${randomUUID().replaceAll("-", "")}`,
      };
      await expect(
        projectPhase24ProviderEvent(active.fixture, conflictingPaidFact),
      ).resolves.toMatchObject({ projection: { status: "HELD" } });
      await expect(
        active.fixture.database.employerSubscription.findUniqueOrThrow({
          where: {
            providerSubscriptionReference: active.subscriptionReference,
          },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "SUSPENDED" });
      await expect(
        reconcilePersistedSubscriptionProviderInvoices(
          {
            batchSize: 10,
            correlationId: randomUUID(),
            environment: "ci",
            now: new Date(pair.paid.eventCreatedAt.getTime() + 10_000),
          },
          active.fixture.database,
        ),
      ).resolves.toMatchObject({
        matched: 0,
        mismatched: 1,
        processed: 1,
      });

      const cancellationSecond = new Date(
        pair.paid.eventCreatedAt.getTime() + 60_000,
      );
      const cancellation = phase24ProviderEvent(active.checkout, {
        eventCreatedAt: cancellationSecond,
        eventType: "customer.subscription.deleted",
        providerCancelAtPeriodEnd: false,
        providerEventId: `evt_cancel_${randomUUID().replaceAll("-", "")}`,
        providerPeriodEnd: null,
        providerPeriodStart: null,
        providerStatus: "canceled",
        providerSubscriptionReference: active.subscriptionReference,
      });
      const recovery = phase24ProviderEvent(active.checkout, {
        eventCreatedAt: cancellationSecond,
        eventType: "customer.subscription.updated",
        providerCancelAtPeriodEnd: false,
        providerEventId: `evt_recover_${randomUUID().replaceAll("-", "")}`,
        providerPeriodEnd: null,
        providerPeriodStart: null,
        providerStatus: "active",
        providerSubscriptionReference: active.subscriptionReference,
      });
      await Promise.all([
        projectPhase24ProviderEvent(active.fixture, cancellation),
        projectPhase24ProviderEvent(active.fixture, recovery),
      ]);
      const laterRecovery = {
        ...recovery,
        eventCreatedAt: new Date(cancellationSecond.getTime() + 60_000),
        providerEventId: `evt_late_recover_${randomUUID().replaceAll("-", "")}`,
      };
      await expect(
        projectPhase24ProviderEvent(active.fixture, laterRecovery),
      ).resolves.toMatchObject({ projection: { status: "IGNORED" } });
      await expect(
        active.fixture.database.employerSubscription.findUniqueOrThrow({
          where: {
            providerSubscriptionReference: active.subscriptionReference,
          },
          select: {
            providerCancellationAt: true,
            providerStatusRank: true,
            status: true,
          },
        }),
      ).resolves.toEqual({
        providerCancellationAt: cancellationSecond,
        providerStatusRank: 100,
        status: "CANCELLED",
      });
    } finally {
      await active.fixture.dispose();
    }
  });
});

async function activateSubscription(purpose: string) {
  const fixture = await createPhase24BillingFixture(purpose);
  const checkout = await createPhase24StarterCheckout(fixture);
  const initial = phase24ProviderEvent(checkout);
  await projectPhase24ProviderEvent(fixture, initial);
  if (initial.providerSubscriptionReference === null) {
    await fixture.dispose();
    throw new Error("Provider subscription reference is missing.");
  }
  return Object.freeze({
    checkout,
    fixture,
    subscriptionReference: initial.providerSubscriptionReference,
  });
}

function renewalPair(
  active: Readonly<{
    checkout: Phase24StarterCheckout;
    fixture: Phase24BillingFixture;
    subscriptionReference: string;
  }>,
  suffix: string,
) {
  const eventCreatedAt = new Date("2026-09-28T12:01:00.000Z");
  const periodStart = new Date("2026-08-28T12:00:00.000Z");
  const periodEnd = new Date("2026-09-28T12:00:00.000Z");
  const providerInvoiceReference = `in_${suffix}_${randomUUID().replaceAll("-", "")}`;
  const failed = phase24ProviderEvent(active.checkout, {
    eventCreatedAt,
    eventType: "invoice.payment_failed",
    providerEventId: `evt_failed_${randomUUID().replaceAll("-", "")}`,
    providerInvoiceReference,
    providerPaymentReference: null,
    providerPeriodEnd: null,
    providerPeriodStart: null,
    providerStatus: "failed",
    providerSubscriptionReference: active.subscriptionReference,
  });
  const paid = phase24ProviderEvent(active.checkout, {
    eventCreatedAt,
    eventType: "invoice.payment_succeeded",
    providerEventId: `evt_paid_${randomUUID().replaceAll("-", "")}`,
    providerInvoiceReference,
    providerPaymentReference: `pi_${suffix}_${randomUUID().replaceAll("-", "")}`,
    providerPeriodEnd: periodEnd,
    providerPeriodStart: periodStart,
    providerStatus: "paid",
    providerSubscriptionReference: active.subscriptionReference,
  });
  return Object.freeze({ failed, paid, periodEnd, periodStart });
}

async function currentState(
  fixture: Phase24BillingFixture,
  subscriptionReference: string,
) {
  const subscription =
    await fixture.database.employerSubscription.findUniqueOrThrow({
      where: { providerSubscriptionReference: subscriptionReference },
      select: {
        id: true,
        currentPeriodEnd: true,
        currentPeriodStart: true,
        status: true,
      },
    });
  const [providerInvoice, unresolvedDunning] = await Promise.all([
    fixture.database.subscriptionProviderInvoice.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
      select: {
        providerPaymentReference: true,
        status: true,
      },
    }),
    fixture.database.dunningCase.count({
      where: {
        subscriptionId: subscription.id,
        status: { in: ["OPEN", "GRACE", "SUSPENDED"] },
      },
    }),
  ]);
  return Object.freeze({
    providerInvoice,
    subscription,
    unresolvedDunning,
  });
}
