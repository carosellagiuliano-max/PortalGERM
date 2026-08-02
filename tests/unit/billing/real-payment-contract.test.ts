import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { checkoutIntentSchema } from "@/lib/billing/contracts";
import {
  checkoutStepUpAction,
  realPaymentQuoteDigest,
} from "@/lib/billing/paid-activation-policy";

describe("Phase-24 server-authoritative payment contract", () => {
  it("binds step-up to amount, company, currency, description and order", () => {
    const base = {
      amountRappen: 16_107,
      companyId: randomUUID(),
      currency: "CHF" as const,
      description: "Starter Monatsplan",
      orderId: randomUUID(),
      adapterKey: "stripe_sandbox" as const,
      checkoutKind: "SUBSCRIPTION" as const,
      paymentPriceBindingId: randomUUID(),
      planVersionId: randomUUID(),
      providerAccountReference: "acct_phase33test",
      providerMode: "SANDBOX" as const,
      providerPriceReference: "price_phase33starter",
    };
    const digest = realPaymentQuoteDigest(base);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(checkoutStepUpAction(digest)).toMatch(/^CHECKOUT:[a-f0-9]{55}$/u);
    expect(realPaymentQuoteDigest({ ...base, amountRappen: 16_108 })).not.toBe(
      digest,
    );
    expect(
      realPaymentQuoteDigest({ ...base, companyId: randomUUID() }),
    ).not.toBe(digest);
    expect(realPaymentQuoteDigest({ ...base, orderId: randomUUID() })).not.toBe(
      digest,
    );
  });

  it("rejects client-supplied price, currency and tenant authority", () => {
    const intent = {
      kind: "PLAN",
      planSlug: "starter",
      paymentOrderId: randomUUID(),
      stepUpEvidenceId: randomUUID(),
      idempotencyKey: "phase24-authoritative-contract",
    } as const;
    expect(checkoutIntentSchema.safeParse(intent).success).toBe(true);
    for (const field of [
      ["amountRappen", 1],
      ["currency", "EUR"],
      ["companyId", randomUUID()],
      ["vatBasisPoints", 0],
    ] as const) {
      expect(
        checkoutIntentSchema.safeParse({
          ...intent,
          [field[0]]: field[1],
        }).success,
      ).toBe(false);
    }
  });
});
