import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reconcilePersistedPayments } from "@/lib/billing/finance-reconciliation";
import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  phase24ProviderEvent,
  PHASE24_NOW,
  projectPhase24ProviderEvent,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 24 persisted payment reconciliation", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture("phase24-reconciliation");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("opens evidence-backed mismatches without repair and later matches projected truth", async () => {
    const checkout = await createPhase24StarterCheckout(fixture);
    const event = phase24ProviderEvent(checkout);
    await projectPhase24ProviderEvent(fixture, event, {
      projectionEnabled: false,
    });
    const before = await reconcilePersistedPayments(
      {
        correlationId: randomUUID(),
        environment: "ci",
        now: new Date(PHASE24_NOW.getTime() + 120_000),
      },
      fixture.database,
    );
    expect(before).toMatchObject({ matched: 0, mismatched: 1, processed: 1 });
    await expect(
      fixture.database.order.findUniqueOrThrow({
        where: { id: checkout.orderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PENDING" });

    await projectPhase24ProviderEvent(fixture, event);
    const after = await reconcilePersistedPayments(
      {
        correlationId: randomUUID(),
        environment: "ci",
        now: new Date(PHASE24_NOW.getTime() + 240_000),
      },
      fixture.database,
    );
    expect(after).toMatchObject({ matched: 1, mismatched: 0, processed: 1 });
    const runs = await fixture.database.reconciliationRun.findMany({
      orderBy: { startedAt: "asc" },
      select: { status: true, manifestDigest: true },
    });
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "COMPLETED")).toBe(true);
    expect(runs.every((run) => run.manifestDigest?.length === 64)).toBe(true);
  });
});
