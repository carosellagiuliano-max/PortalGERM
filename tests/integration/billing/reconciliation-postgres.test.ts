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

  it("walks a fixed window with a composite cursor without UUID-order gaps", async () => {
    const source = await fixture.database.paymentAttempt.findFirstOrThrow({
      where: { environment: "ci", provider: "STRIPE" },
    });
    const sameTimestamp = new Date(PHASE24_NOW.getTime() + 300_000);
    for (let index = 0; index < 3; index += 1) {
      const stepUp = await fixture.issueCheckoutStepUp(source.orderId);
      await fixture.database.paymentAttempt.create({
        data: {
          id: randomUUID(),
          orderId: source.orderId,
          companyId: source.companyId,
          paidScopeDecisionId: source.paidScopeDecisionId,
          providerActivationId: source.providerActivationId,
          stepUpEvidenceId: stepUp.evidenceId,
          provider: "STRIPE",
          environment: "ci",
          adapterKey: source.adapterKey,
          adapterVersion: source.adapterVersion,
          providerMode: source.providerMode,
          checkoutKind: "ONE_TIME",
          expectedLiveMode: false,
          providerAccountReference: source.providerAccountReference,
          attemptKey: `phase33-reconcile-${randomUUID()}`,
          quoteDigest: source.quoteDigest,
          amountRappen: source.amountRappen,
          currency: source.currency,
          status: "CREATED",
          providerSessionReference: `cs_test_${randomUUID().replaceAll("-", "")}`,
          expiresAt: new Date(sameTimestamp.getTime() + 30 * 60_000),
          createdAt: sameTimestamp,
        },
      });
    }
    const now = new Date(sameTimestamp.getTime() + 60_000);
    const expected = await fixture.database.paymentAttempt.findMany({
      where: {
        environment: "ci",
        provider: "STRIPE",
        createdAt: {
          gte: new Date(now.getTime() - 24 * 60 * 60_000),
          lte: now,
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });

    const correlationId = randomUUID();
    let cursor: string | null = null;
    let processed = 0;
    do {
      const page = await reconcilePersistedPayments(
        {
          batchSize: 2,
          correlationId,
          cursor,
          environment: "ci",
          now,
        },
        fixture.database,
      );
      processed += page.processed;
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(processed).toBe(expected.length);
    const observed = await fixture.database.reconciliationItem.findMany({
      where: { reconciliationRun: { correlationId } },
      orderBy: [
        { paymentAttempt: { createdAt: "asc" } },
        { paymentAttemptId: "asc" },
      ],
      select: { paymentAttemptId: true },
    });
    expect(observed.map(({ paymentAttemptId }) => paymentAttemptId)).toEqual(
      expected.map(({ id }) => id),
    );
    expect(new Set(observed.map(({ paymentAttemptId }) => paymentAttemptId)).size).toBe(
      observed.length,
    );

    const firstPage = await reconcilePersistedPayments(
      {
        batchSize: 1,
        correlationId: randomUUID(),
        environment: "ci",
        now,
      },
      fixture.database,
    );
    await expect(
      reconcilePersistedPayments(
        {
          batchSize: 1,
          correlationId: randomUUID(),
          cursor: firstPage.nextCursor,
          environment: "staging",
          now,
        },
        fixture.database,
      ),
    ).rejects.toThrow("cursor is invalid");
  });
});
