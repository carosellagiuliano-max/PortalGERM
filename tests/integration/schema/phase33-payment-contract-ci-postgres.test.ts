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

describe("Phase 33 CONTRACT payment evidence is CI-only", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture(
      "phase33-payment-contract-ci-only",
    );
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("rejects contract runtime and every persistent contract evidence type outside CI", async () => {
    const checkout = await createPhase24StarterCheckout(fixture);
    const event = phase24ProviderEvent(checkout);
    const rawBody = JSON.stringify({
      id: event.providerEventId,
      type: event.eventType,
    });
    await expect(
      ingestVerifiedPaymentEvent(
        {
          adapterKey: "stripe_contract",
          adapterVersion: "v1",
          correlationId: randomUUID(),
          environment: "production",
          event,
          expectedLiveMode: false,
          projectionEnabled: true,
          providerMode: "CONTRACT",
          rawBody,
          receivedAt: new Date(event.eventCreatedAt.getTime() + 1_000),
          signatureHeader: `t=1,v1=${"a".repeat(64)}`,
        },
        fixture.database,
      ),
    ).rejects.toThrow("Verified payment event envelope is invalid.");

    const contractActivation = await fixture.database.providerActivation.create({
      data: {
        environment: "ci",
        useCase: `payments.contract-ci-test.${randomUUID()}`,
        adapterKey: "stripe_contract",
        adapterVersion: "v1",
        mode: "ALLOWLIST",
        configurationDigest: "1".repeat(64),
        secretVersionRef: "secret:stripe:contract:v1",
        region: "contract-test",
        dpaRef: "dpa:contract:test",
        contractRef: "contract:contract:test",
        approvalRef: "approval:contract:test",
        evidenceDigest: "2".repeat(64),
        owner: "Phase 33 Test",
        runbookRef: "codex-plan/runbooks/payment-operations.md",
        health: "HEALTHY",
        healthCheckedAt: fixture.now,
        quotaUnits: 100,
        sustainableCapacity: 100,
        unitCostMicros: 0n,
        unitCostSource: "phase33-contract-ci-test",
        killSwitchEngaged: false,
        effectiveAt: fixture.now,
      },
    });

    await expect(
      fixture.database.paymentPriceBinding.create({
        data: {
          planVersionId: fixture.starterPlanVersionId,
          providerActivationId: contractActivation.id,
          environment: "production",
          adapterKey: "stripe_contract",
          adapterVersion: "v1",
          providerMode: "CONTRACT",
          providerAccountReference: "acct_contractoutsideci",
          providerPriceReference: "price_contractoutsideci",
          billingInterval: "MONTHLY",
          amountRappen: 16_107,
          currency: "CHF",
          evidenceDigest: "3".repeat(64),
          effectiveAt: fixture.now,
        },
      }),
    ).rejects.toThrow();

    const stepUpEvidence = await fixture.database.authAssuranceEvidence.create({
      data: {
        userId: fixture.actor.userId,
        purpose: "PAID_CHECKOUT",
        action: `phase33-contract-ci:${randomUUID()}`,
        tenantId: fixture.companyId,
        method: "WEBAUTHN",
        issuedAt: fixture.now,
        expiresAt: new Date(fixture.now.getTime() + 5 * 60_000),
      },
    });
    await expect(
      fixture.database.paymentAttempt.create({
        data: {
          orderId: checkout.orderId,
          companyId: fixture.companyId,
          paidScopeDecisionId: fixture.scopeDecisionId,
          providerActivationId: contractActivation.id,
          stepUpEvidenceId: stepUpEvidence.id,
          provider: "STRIPE",
          environment: "production",
          adapterKey: "stripe_contract",
          adapterVersion: "v1",
          providerMode: "CONTRACT",
          checkoutKind: "ONE_TIME",
          expectedLiveMode: false,
          providerAccountReference: "acct_contractoutsideci",
          attemptKey: `contract-ci-${randomUUID()}`,
          quoteDigest: "4".repeat(64),
          amountRappen: 16_107,
          currency: "CHF",
          status: "CREATED",
          expiresAt: new Date(fixture.now.getTime() + 30 * 60_000),
          createdAt: fixture.now,
          updatedAt: fixture.now,
        },
      }),
    ).rejects.toThrow();

    await expect(
      fixture.database.providerEventInbox.create({
        data: {
          provider: "STRIPE",
          environment: "production",
          adapterKey: "stripe_contract",
          adapterVersion: "v1",
          providerMode: "CONTRACT",
          expectedLiveMode: false,
          providerAccountReference: "acct_contractoutsideci",
          providerEventId: `evt_contract_${randomUUID()}`,
          eventType: "checkout.session.completed",
          eventCreatedAt: fixture.now,
          apiVersion: "2026-06-30.basil",
          liveMode: false,
          rawBodyDigest: "5".repeat(64),
          signatureDigest: "6".repeat(64),
          payloadSchemaVersion: "phase33-v1",
          normalizedPayload: {},
          status: "RECEIVED",
          receivedAt: fixture.now,
          createdAt: fixture.now,
          updatedAt: fixture.now,
        },
      }),
    ).rejects.toThrow();

    await projectPhase24ProviderEvent(fixture, event);
    const subscription =
      await fixture.database.employerSubscription.findFirstOrThrow({
        where: { sourceOrderId: checkout.orderId },
        select: { id: true, providerSubscriptionReference: true },
      });
    if (subscription.providerSubscriptionReference === null) {
      throw new Error("Expected provider subscription authority.");
    }
    await expect(
      fixture.database.subscriptionProviderInvoice.create({
        data: {
          subscriptionId: subscription.id,
          paymentAttemptId: checkout.paymentAttemptId,
          orderId: checkout.orderId,
          companyId: fixture.companyId,
          provider: "STRIPE",
          environment: "production",
          adapterKey: "stripe_contract",
          adapterVersion: "v1",
          providerMode: "CONTRACT",
          providerAccountReference: "acct_contractoutsideci",
          providerSubscriptionReference:
            subscription.providerSubscriptionReference,
          providerInvoiceReference: `in_contract_${randomUUID()}`,
          status: "FAILED",
          firstFailureAt: fixture.now,
          createdAt: fixture.now,
          updatedAt: fixture.now,
        },
      }),
    ).rejects.toThrow();

    expect(
      await fixture.database.providerEventInbox.count({
        where: { environment: "production", providerMode: "CONTRACT" },
      }),
    ).toBe(0);
  });
});
