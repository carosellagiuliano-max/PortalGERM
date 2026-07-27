import { describe, expect, it } from "vitest";

import {
  checkoutStepUpAction,
  PAID_CHECKOUT_POLICY_V1,
  realPaymentQuoteDigest,
  resolvePaidCheckoutActivation,
} from "@/lib/billing/paid-activation-policy";

const NOW = new Date("2026-07-28T10:00:00.000Z");
const PROVIDER = Object.freeze({
  active: true as const,
  adapterKey: "stripe_sandbox",
  adapterVersion: "v1",
  mode: "SANDBOX" as const,
});
const GO = Object.freeze({
  id: "00000000-0000-4000-8000-000000000024",
  scopeCode: PAID_CHECKOUT_POLICY_V1.scopeCode,
  packageCode: "STARTER",
  status: "GO" as const,
  maximumMode: "SANDBOX" as const,
  evidenceDigest: "a".repeat(64),
  effectiveAt: new Date(NOW.getTime() - 60_000),
  expiresAt: new Date(NOW.getTime() + 60_000),
});

describe("Phase-24 paid activation policy", () => {
  it("opens only the exact local test sandbox scope with WTP and provider evidence", () => {
    expect(
      resolvePaidCheckoutActivation({
        environment: "local",
        now: NOW,
        packageCode: "STARTER",
        paidSelfServiceEnabled: true,
        provider: PROVIDER,
        sandboxCohort: "test",
        scopeDecision: GO,
      }),
    ).toEqual({
      active: true,
      mode: "SANDBOX",
      paidScopeDecisionId: GO.id,
    });
  });

  it.each([
    [
      "disabled",
      { paidSelfServiceEnabled: false },
      "PAID_SELF_SERVICE_DISABLED",
    ],
    ["missing WTP", { scopeDecision: null }, "WTP_DECISION_MISSING"],
    ["wrong package", { packageCode: "PRO" }, "WTP_SCOPE_MISMATCH"],
    [
      "expired WTP",
      {
        scopeDecision: {
          ...GO,
          expiresAt: NOW,
        },
      },
      "WTP_EXPIRED",
    ],
    ["staging", { environment: "staging" }, "ENVIRONMENT_FORBIDDEN"],
    [
      "provider inactive",
      {
        provider: { active: false as const, reason: "DISABLED" as const },
      },
      "PROVIDER_INACTIVE",
    ],
  ])("fails closed for %s", (_label, override, reason) => {
    expect(
      resolvePaidCheckoutActivation({
        environment: "local",
        now: NOW,
        packageCode: "STARTER",
        paidSelfServiceEnabled: true,
        provider: PROVIDER,
        sandboxCohort: "test",
        scopeDecision: GO,
        ...override,
      }),
    ).toEqual({ active: false, reason });
  });

  it("binds the step-up action to tenant, order and server amount", () => {
    const base = {
      amountRappen: 16_107,
      companyId: "00000000-0000-4000-8000-000000000001",
      currency: "CHF" as const,
      description: "Starter Monatsplan",
      orderId: "00000000-0000-4000-8000-000000000002",
    };
    const digest = realPaymentQuoteDigest(base);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(checkoutStepUpAction(digest)).toHaveLength(64);
    expect(realPaymentQuoteDigest({ ...base, amountRappen: 16_108 })).not.toBe(
      digest,
    );
    expect(
      realPaymentQuoteDigest({
        ...base,
        companyId: "00000000-0000-4000-8000-000000000003",
      }),
    ).not.toBe(digest);
  });
});
