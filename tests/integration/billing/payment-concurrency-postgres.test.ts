import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCheckoutOrder } from "@/lib/billing/orders";
import {
  createPhase24BillingFixture,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 24 concurrent checkout idempotency", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture("phase24-payment-concurrency");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("serializes 20 identical requests into one order and one attempt", async () => {
    const orderId = randomUUID();
    const evidence = await fixture.issueCheckoutStepUp(orderId);
    const command = {
      kind: "PLAN" as const,
      planSlug: "starter" as const,
      paymentOrderId: orderId,
      stepUpEvidenceId: evidence.evidenceId,
      idempotencyKey: `concurrent-${randomUUID()}`,
    };
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        createCheckoutOrder(command, fixture.dependencies()),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok && result.replay)).toHaveLength(
      19,
    );
    expect(await fixture.database.order.count({ where: { id: orderId } })).toBe(
      1,
    );
    expect(
      await fixture.database.paymentAttempt.count({ where: { orderId } }),
    ).toBe(1);
    expect(
      await fixture.database.authAssuranceEvidence.count({
        where: { id: evidence.evidenceId, usedAt: { not: null } },
      }),
    ).toBe(1);
  });
});
