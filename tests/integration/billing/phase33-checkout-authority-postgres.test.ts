import { createHash, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
} from "@/lib/auth/assurance/step-up-service";
import { createCheckoutOrder } from "@/lib/billing/orders";
import {
  ingestVerifiedPaymentEvent,
  projectPaymentInboxEvent,
  releaseHeldSettlementForProjection,
} from "@/lib/billing/payment-inbox";
import {
  createPhase24BillingFixture,
  phase24ProviderEvent,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 33 hosted-checkout effect authority", () => {
  let fixture: Phase24BillingFixture;

  beforeEach(async () => {
    fixture = await createPhase24BillingFixture(
      `phase33-checkout-authority-${randomUUID()}`,
    );
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  it("makes zero replay calls and holds the attempt after activation revocation", async () => {
    const command = await checkoutCommand(fixture);
    await expect(
      createCheckoutOrder(command, fixture.dependencies()),
    ).resolves.toMatchObject({ ok: true });
    expect(fixture.provider.checkoutInputs).toHaveLength(1);

    await fixture.database.providerActivation.update({
      where: { id: fixture.providerActivationId },
      data: {
        killSwitchEngaged: true,
        revokedAt: fixture.now,
        revokeReasonCode: "PHASE33_SECURITY_REVOKE",
      },
    });

    await expect(
      createCheckoutOrder(command, fixture.dependencies()),
    ).resolves.toEqual({ ok: false, code: "PAYMENT_HELD" });
    expect(fixture.provider.checkoutInputs).toHaveLength(1);
    await expect(
      fixture.database.paymentAttempt.findFirstOrThrow({
        where: { orderId: command.paymentOrderId },
        select: { failureCode: true, status: true },
      }),
    ).resolves.toEqual({
      failureCode: "CHECKOUT_ACTIVATION_STALE",
      status: "HELD",
    });
  });

  it("makes zero replay calls and holds the attempt after its price binding is revoked", async () => {
    const command = await checkoutCommand(fixture);
    await createCheckoutOrder(command, fixture.dependencies());
    expect(fixture.provider.checkoutInputs).toHaveLength(1);
    const attempt = await fixture.database.paymentAttempt.findFirstOrThrow({
      where: { orderId: command.paymentOrderId },
      select: { paymentPriceBindingId: true },
    });
    if (attempt.paymentPriceBindingId === null) {
      throw new Error("Expected a payment price binding.");
    }
    await fixture.database.paymentPriceBinding.update({
      where: { id: attempt.paymentPriceBindingId },
      data: { revokedAt: fixture.now },
    });

    await expect(
      createCheckoutOrder(command, fixture.dependencies()),
    ).resolves.toEqual({ ok: false, code: "PAYMENT_HELD" });
    expect(fixture.provider.checkoutInputs).toHaveLength(1);
    await expect(
      fixture.database.paymentAttempt.findFirstOrThrow({
        where: { orderId: command.paymentOrderId },
        select: { failureCode: true, status: true },
      }),
    ).resolves.toEqual({
      failureCode: "CHECKOUT_PRICE_BINDING_STALE",
      status: "HELD",
    });
  });

  it("makes zero replay calls when runtime account authority no longer matches the provider", async () => {
    const command = await checkoutCommand(fixture);
    await createCheckoutOrder(command, fixture.dependencies());
    expect(fixture.provider.checkoutInputs).toHaveLength(1);
    const base = fixture.dependencies();
    if (base.realPayment === undefined) {
      throw new Error("Expected real-payment fixture context.");
    }

    await expect(
      createCheckoutOrder(
        command,
        fixture.dependencies({
          realPayment: {
            ...base.realPayment,
            providerAccountReference: "acct_rotatedauthority",
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "PAYMENT_HELD" });
    expect(fixture.provider.checkoutInputs).toHaveLength(1);
    await expect(
      fixture.database.paymentAttempt.findFirstOrThrow({
        where: { orderId: command.paymentOrderId },
        select: { failureCode: true, status: true },
      }),
    ).resolves.toEqual({
      failureCode: "CHECKOUT_RUNTIME_BINDING_STALE",
      status: "HELD",
    });
  });

  it("expires a session created after the reserved activation is revoked", async () => {
    const command = await checkoutCommand(fixture);
    let enteredProvider!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      enteredProvider = resolve;
    });
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    fixture.provider.beforeCheckoutReturn = async () => {
      enteredProvider();
      await providerReleased;
    };

    const checkout = createCheckoutOrder(command, fixture.dependencies());
    await providerEntered;
    await fixture.database.providerActivation.update({
      where: { id: fixture.providerActivationId },
      data: {
        killSwitchEngaged: true,
        revokedAt: fixture.now,
        revokeReasonCode: "PHASE33_RACE_REVOKE",
      },
    });
    releaseProvider();

    await expect(checkout).resolves.toEqual({
      ok: false,
      code: "PAYMENT_HELD",
    });
    expect(fixture.provider.expiredCheckoutInputs).toHaveLength(1);
    await expect(
      fixture.database.paymentAttempt.findFirstOrThrow({
        where: { orderId: command.paymentOrderId },
        select: {
          checkoutReservationDigest: true,
          checkoutReservationToken: true,
          failureCode: true,
          providerSessionReference: true,
          status: true,
        },
      }),
    ).resolves.toMatchObject({
      checkoutReservationDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      checkoutReservationToken: expect.any(String),
      failureCode: "CHECKOUT_ACTIVATION_STALE",
      providerSessionReference: expect.stringMatching(/^cs_test_/u),
      status: "HELD",
    });
  });

  it("allows the first settlement binding but makes provider references immutable afterwards", async () => {
    const command = await checkoutCommand(fixture);
    await expect(
      createCheckoutOrder(command, fixture.dependencies()),
    ).resolves.toMatchObject({ ok: true });
    const attempt = await fixture.database.paymentAttempt.findFirstOrThrow({
      where: { orderId: command.paymentOrderId },
      select: { id: true, providerSessionReference: true },
    });
    if (attempt.providerSessionReference === null) {
      throw new Error("Expected the hosted session binding.");
    }
    const providerPaymentReference = `pi_${randomUUID().replaceAll("-", "")}`;
    await fixture.database.paymentAttempt.update({
      where: { id: attempt.id },
      data: { providerPaymentReference },
    });

    await expect(
      fixture.database.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          providerPaymentReference: `pi_${randomUUID().replaceAll("-", "")}`,
        },
      }),
    ).rejects.toThrow(/payment attempt authority snapshot is immutable/iu);
    await expect(
      fixture.database.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          providerSessionReference: `cs_test_${randomUUID().replaceAll("-", "")}`,
        },
      }),
    ).rejects.toThrow(/payment attempt authority snapshot is immutable/iu);
  });

  it("durably holds a signed historic settlement after outbound revocation", async () => {
    const command = await checkoutCommand(fixture);
    await createCheckoutOrder(command, fixture.dependencies());
    const attempt = await fixture.database.paymentAttempt.findFirstOrThrow({
      where: { orderId: command.paymentOrderId },
      select: { id: true, providerSessionReference: true },
    });
    if (attempt.providerSessionReference === null) {
      throw new Error("Expected the hosted session binding.");
    }
    await fixture.database.providerActivation.update({
      where: { id: fixture.providerActivationId },
      data: {
        killSwitchEngaged: true,
        revokedAt: fixture.now,
        revokeReasonCode: "PHASE33_SETTLEMENT_REVOKE",
      },
    });
    const event = phase24ProviderEvent({
      orderId: command.paymentOrderId,
      paymentAttemptId: attempt.id,
      providerSessionReference: attempt.providerSessionReference,
    });
    const receivedAt = new Date(event.eventCreatedAt.getTime() + 1_000);

    const ingested = await ingestVerifiedPaymentEvent(
      {
        adapterKey: "stripe_sandbox",
        adapterVersion: "v1",
        correlationId: randomUUID(),
        environment: "ci",
        event,
        expectedLiveMode: false,
        outboundActivationActive: false,
        projectionEnabled: true,
        providerMode: "SANDBOX",
        rawBody: JSON.stringify({
          id: event.providerEventId,
          type: event.eventType,
        }),
        receivedAt,
        signatureHeader: `t=${Math.floor(receivedAt.getTime() / 1_000)},v1=${"a".repeat(64)}`,
      },
      fixture.database,
    );

    expect(ingested).toMatchObject({ queued: false, replay: false });
    await expect(
      fixture.database.providerEventInbox.findUniqueOrThrow({
        where: { id: ingested.inboxId },
        select: { errorCode: true, status: true },
      }),
    ).resolves.toEqual({
      errorCode: "SETTLEMENT_AFTER_PROVIDER_REVOKE",
      status: "HELD",
    });

    const releaseNow = new Date(receivedAt.getTime() + 1_000);
    const session = await fixture.database.session.create({
      data: {
        userId: fixture.financeApproverId,
        tokenHash: createHash("sha256")
          .update(`${fixture.financeApproverId}:${randomUUID()}`)
          .digest("hex"),
        createdAt: new Date(releaseNow.getTime() - 60_000),
        expiresAt: new Date(releaseNow.getTime() + 86_400_000),
        absoluteExpiresAt: new Date(releaseNow.getTime() + 604_800_000),
      },
    });
    await fixture.database.sessionAssurance.create({
      data: {
        sessionId: session.id,
        userId: fixture.financeApproverId,
        level: "AAL2",
        method: "WEBAUTHN",
        policyVersion: "ADMIN_MFA_POLICY_V1",
        verifiedAt: new Date(releaseNow.getTime() - 1_000),
        expiresAt: new Date(releaseNow.getTime() + 3_600_000),
        createdAt: releaseNow,
      },
    });
    const actor = {
      capabilities: ["ADMIN_BILLING_MUTATE"],
      role: "ADMIN",
      sessionId: session.id,
      status: "ACTIVE",
      userId: fixture.financeApproverId,
    } as const;
    const stepUpDependencies = {
      actor,
      correlationId: randomUUID(),
      database: fixture.database,
      now: releaseNow,
    } as const;
    const challenge = await beginStepUpChallenge(
      {
        purpose: "FINANCE_RECONCILIATION",
        action: "PAYMENT_SETTLEMENT_RELEASE",
        tenantId: fixture.companyId,
        resourceId: ingested.inboxId,
      },
      stepUpDependencies,
    );
    if (!challenge.ok) throw new Error(challenge.code);
    const grant = await completeStepUpChallenge(
      {
        challengeId: challenge.value.challengeId,
        challengeToken: challenge.value.challengeToken,
      },
      stepUpDependencies,
    );
    if (!grant.ok) throw new Error(grant.code);
    await expect(
      releaseHeldSettlementForProjection(
        {
          correlationId: randomUUID(),
          inboxId: ingested.inboxId,
          reasonCode: "HISTORIC_SETTLEMENT_REVIEWED",
          stepUpEvidenceId: grant.value.evidenceId,
          stepUpGrantToken: grant.value.grantToken,
        },
        {
          actor,
          database: fixture.database,
          financeRepairActionsEnabled: true,
          now: releaseNow,
        },
      ),
    ).resolves.toEqual({ ok: true, inboxId: ingested.inboxId, queued: true });
    await expect(
      projectPaymentInboxEvent(
        {
          correlationId: randomUUID(),
          inboxId: ingested.inboxId,
          now: new Date(releaseNow.getTime() + 1_000),
        },
        {
          database: fixture.database,
          emailProvider: fixture.dependencies().emailProvider,
        },
      ),
    ).resolves.toMatchObject({ status: "PROJECTED" });
    await expect(
      fixture.database.order.findUniqueOrThrow({
        where: { id: command.paymentOrderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PAID" });
  });
});

async function checkoutCommand(fixture: Phase24BillingFixture) {
  const paymentOrderId = randomUUID();
  const stepUp = await fixture.issueCheckoutStepUp(paymentOrderId);
  return Object.freeze({
    kind: "PLAN" as const,
    planSlug: "starter" as const,
    paymentOrderId,
    stepUpEvidenceId: stepUp.evidenceId,
    idempotencyKey: `phase33-authority-${randomUUID()}`,
  });
}
