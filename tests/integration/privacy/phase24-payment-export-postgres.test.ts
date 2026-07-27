import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrivacyExportBillingEvidenceV1 } from "@/lib/privacy/export-v2";
import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  phase24ProviderEvent,
  projectPhase24ProviderEvent,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

let fixture: Phase24BillingFixture | undefined;

beforeAll(async () => {
  fixture = await createPhase24BillingFixture(
    "phase24_privacy_payment_export",
  );
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe("Phase-24 privacy-safe payment export", () => {
  it("includes understandable owned billing evidence without provider or risk secrets", async () => {
    const current = requireFixture();
    const checkout = await createPhase24StarterCheckout(current);
    const event = phase24ProviderEvent(checkout);
    const projected = await projectPhase24ProviderEvent(current, event);
    expect(projected.projection).toEqual(
      expect.objectContaining({ status: "PROJECTED" }),
    );

    const evidence = await getPrivacyExportBillingEvidenceV1(
      current.database,
      current.actor.userId,
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toEqual(
      expect.objectContaining({
        schemaVersion: "phase24-v1",
        kind: "billing-order",
        id: checkout.orderId,
        companyId: current.companyId,
        provider: "STRIPE",
        status: "PAID",
        invoice: expect.objectContaining({
          status: "PAID",
          number: expect.stringMatching(/^STH-\d{4}-\d{5}$/u),
        }),
        paymentAttempts: [
          expect.objectContaining({
            id: checkout.paymentAttemptId,
            provider: "STRIPE",
            status: "SUCCEEDED",
          }),
        ],
      }),
    );

    const serialized = JSON.stringify(evidence);
    expect(serialized).toContain(current.actor.email);
    expect(serialized).not.toContain(event.providerAccountReference);
    expect(serialized).not.toContain(event.providerPaymentReference!);
    expect(serialized).not.toContain(event.providerSessionReference!);
    expect(serialized).not.toContain("quoteDigest");
    expect(serialized).not.toContain("signalCodes");
    expect(serialized).not.toContain("evidenceDigest");
    expect(serialized).not.toContain("idempotencyKey");
    expect(serialized).not.toContain("stepUpEvidence");
  });
});

function requireFixture() {
  if (fixture === undefined) {
    throw new Error("Phase-24 payment-export fixture is unavailable.");
  }
  return fixture;
}
