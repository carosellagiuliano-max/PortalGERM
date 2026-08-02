import { describe, expect, it } from "vitest";

import {
  decideSubscriptionProviderOrdering,
  paymentAttemptProviderRank,
  subscriptionProviderInvoiceProjectionDigestV1,
} from "@/lib/billing/subscription-provider-ordering";

describe("Phase 33 provider subscription ordering", () => {
  const second = new Date("2026-08-01T12:00:00.000Z");

  it("uses semantic safety rather than meaningless event-id order at equal seconds", () => {
    expect(
      decideSubscriptionProviderOrdering({
        currentAt: second,
        currentRank: 10,
        incomingAt: second,
        incomingSignal: "DUNNING",
      }),
    ).toMatchObject({
      apply: true,
      rank: 40,
      reason: "EQUAL_SECOND_SAFER_SIGNAL",
    });
    expect(
      decideSubscriptionProviderOrdering({
        currentAt: second,
        currentRank: 40,
        incomingAt: second,
        incomingSignal: "RECOVERED",
      }),
    ).toMatchObject({
      apply: false,
      reason: "EQUAL_SECOND_DUPLICATE_OR_WEAKER",
    });
  });

  it("makes provider cancellation terminal even when its event timestamp is older", () => {
    const later = new Date(second.getTime() + 60_000);
    expect(
      decideSubscriptionProviderOrdering({
        currentAt: later,
        currentRank: 10,
        incomingAt: second,
        incomingSignal: "CANCELLED",
      }),
    ).toMatchObject({ apply: true, rank: 100 });
    expect(
      decideSubscriptionProviderOrdering({
        currentAt: second,
        currentRank: 100,
        incomingAt: later,
        incomingSignal: "RECOVERED",
      }),
    ).toMatchObject({ apply: false, reason: "ALREADY_CANCELLED" });
  });

  it("defines a total attempt-state precedence for equal-second events", () => {
    expect(
      ["PENDING", "EXPIRED", "FAILED", "SUCCEEDED"].map((state) =>
        paymentAttemptProviderRank(
          state as "PENDING" | "EXPIRED" | "FAILED" | "SUCCEEDED",
        ),
      ),
    ).toEqual([10, 20, 30, 100]);
  });

  it("deduplicates equivalent invoice payment event types across observation times", () => {
    const scope = {
      adapterKey: "stripe_sandbox",
      environment: "ci",
      provider: "STRIPE" as const,
      providerAccountReference: "acct_phase33test",
      providerInvoiceReference: "in_phase33sameinvoice",
    };
    const stableFacts = {
      amountRappen: 16_107,
      currency: "CHF" as const,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      providerPaymentReference: "pi_phase33samepayment",
    };

    expect(
      subscriptionProviderInvoiceProjectionDigestV1(
        scope,
        { ...stableFacts, paidAt: second },
        "sub-internal-phase33",
      ),
    ).toBe(
      subscriptionProviderInvoiceProjectionDigestV1(
        scope,
        { ...stableFacts, paidAt: new Date(second.getTime() + 5_000) },
        "sub-internal-phase33",
      ),
    );
  });

  it("keeps the invoice digest independent of caller object insertion order", () => {
    const facts = {
      amountRappen: 16_107,
      currency: "CHF" as const,
      paidAt: second,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      providerPaymentReference: "pi_phase33canonical",
    };
    const firstScope = {
      adapterKey: "stripe_sandbox",
      environment: "ci",
      provider: "STRIPE" as const,
      providerAccountReference: "acct_phase33test",
      providerInvoiceReference: "in_phase33canonical",
    };
    const secondScope = {
      provider: "STRIPE" as const,
      environment: "ci",
      adapterKey: "stripe_sandbox",
      providerAccountReference: "acct_phase33test",
      providerInvoiceReference: "in_phase33canonical",
    };

    expect(
      subscriptionProviderInvoiceProjectionDigestV1(
        firstScope,
        facts,
        "sub-internal-phase33",
      ),
    ).toBe(
      subscriptionProviderInvoiceProjectionDigestV1(
        secondScope,
        facts,
        "sub-internal-phase33",
      ),
    );
  });
});
