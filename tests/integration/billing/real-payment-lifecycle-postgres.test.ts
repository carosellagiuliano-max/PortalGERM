import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  approveAndSubmitFinanceRefund,
  financeRefundApprovalAction,
  financeRefundRequestAction,
  requestFinanceRefund,
} from "@/lib/billing/finance-operations";
import {
  projectDueDunningCases,
  resolveCompanyDunningInTransaction,
} from "@/lib/billing/dunning";
import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  phase24ProviderEvent,
  projectPhase24ProviderEvent,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 24 monotonic real-payment lifecycle", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture("phase24-payment-lifecycle");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("keeps unpaid checkout pending, fulfills on paid, and ignores later failure", async () => {
    const checkout = await createPhase24StarterCheckout(fixture);
    const pending = phase24ProviderEvent(checkout, {
      eventType: "checkout.session.completed",
      providerStatus: "unpaid",
      providerPaymentReference: null,
    });
    await projectPhase24ProviderEvent(fixture, pending);
    await expect(
      fixture.database.order.findUniqueOrThrow({
        where: { id: checkout.orderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PENDING" });

    const paid = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date(pending.eventCreatedAt.getTime() + 60_000),
    });
    await projectPhase24ProviderEvent(fixture, paid);

    const lateFailure = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date(paid.eventCreatedAt.getTime() + 60_000),
      eventType: "payment_intent.payment_failed",
      providerStatus: "failed",
    });
    const failure = await projectPhase24ProviderEvent(fixture, lateFailure);
    expect(failure.projection).toMatchObject({ status: "IGNORED" });

    const [order, attempt] = await Promise.all([
      fixture.database.order.findUniqueOrThrow({
        where: { id: checkout.orderId },
      }),
      fixture.database.paymentAttempt.findUniqueOrThrow({
        where: { id: checkout.paymentAttemptId },
      }),
    ]);
    expect(order.status).toBe("PAID");
    expect(attempt.status).toBe("SUCCEEDED");

    const disputeReference = `dp_${randomUUID().replaceAll("-", "")}`;
    await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(checkout, {
        amountRappen: order.totalRappen,
        eventCreatedAt: new Date(lateFailure.eventCreatedAt.getTime() + 60_000),
        eventType: "charge.dispute.created",
        providerEventId: `evt_dispute_open_${randomUUID().replaceAll("-", "")}`,
        providerObjectReference: disputeReference,
        providerStatus: "warning_needs_response",
      }),
    );
    await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(checkout, {
        amountRappen: order.totalRappen,
        eventCreatedAt: new Date(
          lateFailure.eventCreatedAt.getTime() + 120_000,
        ),
        eventType: "charge.dispute.closed",
        providerEventId: `evt_dispute_close_${randomUUID().replaceAll("-", "")}`,
        providerObjectReference: disputeReference,
        providerStatus: "won",
      }),
    );
    await expect(
      fixture.database.chargeback.findUniqueOrThrow({
        where: { providerDisputeReference: disputeReference },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "WON" });

    const renewalEvidence = await fixture.database.authAssuranceEvidence.create(
      {
        data: {
          userId: fixture.actor.userId,
          purpose: "PAID_RENEWAL",
          action: `PAID_RENEWAL:${checkout.orderId}`,
          tenantId: fixture.companyId,
          method: "WEBAUTHN",
          issuedAt: fixture.now,
          expiresAt: new Date(fixture.now.getTime() + 10 * 60_000),
          usedAt: fixture.now,
        },
      },
    );
    const renewalSession = `cs_test_renewal_${randomUUID().replaceAll("-", "")}`;
    const renewalAttempt = await fixture.database.paymentAttempt.create({
      data: {
        orderId: checkout.orderId,
        companyId: fixture.companyId,
        paidScopeDecisionId: fixture.scopeDecisionId,
        providerActivationId: fixture.providerActivationId,
        stepUpEvidenceId: renewalEvidence.id,
        provider: "STRIPE",
        environment: "ci",
        providerAccountReference: "acct_phase24fixture",
        attemptKey: `renewal:${randomUUID()}`,
        quoteDigest: "e".repeat(64),
        amountRappen: order.totalRappen,
        currency: "CHF",
        status: "CHECKOUT_CREATED",
        providerSessionReference: renewalSession,
        expiresAt: new Date(fixture.now.getTime() + 30 * 60_000),
        createdAt: fixture.now,
        updatedAt: fixture.now,
      },
    });
    const failedRenewalAt = new Date(
      lateFailure.eventCreatedAt.getTime() + 180_000,
    );
    await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(
        {
          orderId: checkout.orderId,
          paymentAttemptId: renewalAttempt.id,
          providerSessionReference: renewalSession,
        },
        {
          eventCreatedAt: failedRenewalAt,
          eventType: "payment_intent.payment_failed",
          orderId: null,
          providerStatus: "failed",
        },
      ),
    );
    const dunning = await fixture.database.dunningCase.findFirstOrThrow({
      where: { paymentAttemptId: renewalAttempt.id },
    });
    expect(dunning.status).toBe("GRACE");
    const dueAt = new Date(dunning.graceEndsAt.getTime() + 1_000);
    await expect(
      projectDueDunningCases({
        correlationId: randomUUID(),
        database: fixture.database,
        enabled: true,
        now: dueAt,
      }),
    ).resolves.toMatchObject({ processed: 1, status: "COMPLETED" });
    await expect(
      fixture.database.employerSubscription.findFirstOrThrow({
        where: { companyId: fixture.companyId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "SUSPENDED" });
    await fixture.database.$transaction((transaction) =>
      resolveCompanyDunningInTransaction(transaction, {
        companyId: fixture.companyId,
        correlationId: randomUUID(),
        now: new Date(dueAt.getTime() + 1_000),
      }),
    );
    await expect(
      fixture.database.employerSubscription.findFirstOrThrow({
        where: { companyId: fixture.companyId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "ACTIVE" });

    const amountRappen = order.totalRappen;
    const reasonCode = "CUSTOMER_APPROVED_REFUND";
    const requestAction = financeRefundRequestAction({
      amountRappen,
      companyId: fixture.companyId,
      orderId: checkout.orderId,
      reasonCode,
    });
    const requestEvidenceId = await fixture.issueFinanceStepUp({
      action: requestAction,
      purpose: "FINANCE_REFUND_REQUEST",
      userId: fixture.financeRequesterId,
    });
    const refundRequest = await requestFinanceRefund(
      {
        amountRappen,
        companyId: fixture.companyId,
        correlationId: randomUUID(),
        idempotencyKey: `refund-request-${randomUUID()}`,
        orderId: checkout.orderId,
        reasonCode,
        stepUpEvidenceId: requestEvidenceId,
      },
      {
        actor: {
          capabilities: ["FINANCE_REFUND_REQUEST"],
          userId: fixture.financeRequesterId,
        },
        database: fixture.database,
        financeRepairActionsEnabled: true,
        now: fixture.now,
      },
    );
    expect(refundRequest).toMatchObject({
      ok: true,
      status: "REQUESTED",
    });
    if (!refundRequest.ok) throw new Error("Expected refund request.");
    const approvalEvidenceId = await fixture.issueFinanceStepUp({
      action: financeRefundApprovalAction(refundRequest.refundId),
      purpose: "FINANCE_REFUND_APPROVE",
      userId: fixture.financeApproverId,
    });
    const submitted = await approveAndSubmitFinanceRefund(
      {
        approvalStepUpEvidenceId: approvalEvidenceId,
        correlationId: randomUUID(),
        refundId: refundRequest.refundId,
      },
      {
        actor: {
          capabilities: ["FINANCE_REFUND_EXECUTE"],
          userId: fixture.financeApproverId,
        },
        database: fixture.database,
        financeRepairActionsEnabled: true,
        now: fixture.now,
        paymentProvider: fixture.provider,
      },
    );
    expect(submitted).toMatchObject({ ok: true, status: "PENDING" });
    const refund = await fixture.database.refund.findUniqueOrThrow({
      where: { id: refundRequest.refundId },
    });
    if (refund.providerRefundReference === null) {
      throw new Error("Expected provider refund reference.");
    }
    await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(checkout, {
        amountRappen,
        eventCreatedAt: new Date(
          lateFailure.eventCreatedAt.getTime() + 180_000,
        ),
        eventType: "refund.updated",
        providerEventId: `evt_refund_${randomUUID().replaceAll("-", "")}`,
        providerObjectReference: refund.providerRefundReference,
        providerPaymentReference: null,
        providerStatus: "succeeded",
      }),
    );
    expect(
      await fixture.database.creditNote.count({
        where: { refundId: refund.id, status: "ISSUED" },
      }),
    ).toBe(1);
    expect(
      await fixture.database.paymentEvent.count({
        where: { orderId: checkout.orderId, kind: "REFUNDED" },
      }),
    ).toBe(1);
  });
});
