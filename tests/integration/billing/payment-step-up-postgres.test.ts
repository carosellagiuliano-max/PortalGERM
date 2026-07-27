import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCheckoutOrder } from "@/lib/billing/orders";
import {
  createPhase24BillingFixture,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 24 payment step-up", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture("phase24-payment-step-up");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("denies missing or action-mismatched evidence before order/provider side effects", async () => {
    const missingOrderId = randomUUID();
    const missing = await createCheckoutOrder(
      {
        kind: "PLAN",
        planSlug: "starter",
        paymentOrderId: missingOrderId,
        idempotencyKey: `stepup-missing-${randomUUID()}`,
      },
      fixture.dependencies(),
    );
    expect(missing).toEqual({ ok: false, code: "STEP_UP_REQUIRED" });

    const intendedOrderId = randomUUID();
    const wrongEvidence = await fixture.issueCheckoutStepUp(randomUUID());
    const mismatched = await createCheckoutOrder(
      {
        kind: "PLAN",
        planSlug: "starter",
        paymentOrderId: intendedOrderId,
        stepUpEvidenceId: wrongEvidence.evidenceId,
        idempotencyKey: `stepup-mismatch-${randomUUID()}`,
      },
      fixture.dependencies(),
    );
    expect(mismatched).toEqual({ ok: false, code: "STEP_UP_REQUIRED" });
    expect(fixture.provider.checkoutInputs).toHaveLength(0);
    expect(
      await fixture.database.order.count({
        where: { id: { in: [missingOrderId, intendedOrderId] } },
      }),
    ).toBe(0);
  });

  it("consumes exact evidence once and replays the persisted operation", async () => {
    const orderId = randomUUID();
    const idempotencyKey = `stepup-replay-${randomUUID()}`;
    const evidence = await fixture.issueCheckoutStepUp(orderId);
    const command = {
      kind: "PLAN" as const,
      planSlug: "starter" as const,
      paymentOrderId: orderId,
      stepUpEvidenceId: evidence.evidenceId,
      idempotencyKey,
    };
    const first = await createCheckoutOrder(command, fixture.dependencies());
    const replay = await createCheckoutOrder(command, fixture.dependencies());

    expect(first).toMatchObject({ ok: true });
    expect(replay).toMatchObject({ ok: true, replay: true });
    await expect(
      fixture.database.authAssuranceEvidence.findUniqueOrThrow({
        where: { id: evidence.evidenceId },
        select: { usedAt: true },
      }),
    ).resolves.toEqual({ usedAt: fixture.now });
    expect(
      await fixture.database.paymentAttempt.count({ where: { orderId } }),
    ).toBe(1);
  });
});
