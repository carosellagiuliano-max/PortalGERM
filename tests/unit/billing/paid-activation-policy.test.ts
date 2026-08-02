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
        providerMode: "SANDBOX",
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
        providerMode: "SANDBOX",
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
      adapterKey: "stripe_sandbox" as const,
      checkoutKind: "SUBSCRIPTION" as const,
      paymentPriceBindingId: "00000000-0000-4000-8000-000000000004",
      planVersionId: "00000000-0000-4000-8000-000000000005",
      providerAccountReference: "acct_phase33test",
      providerMode: "SANDBOX" as const,
      providerPriceReference: "price_phase33starter",
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

  it("keeps contract, sandbox and live activation modes distinct", () => {
    expect(
      resolvePaidCheckoutActivation({
        environment: "production",
        now: NOW,
        packageCode: "STARTER",
        paidSelfServiceEnabled: true,
        provider: {
          active: true,
          adapterKey: "stripe_contract",
          adapterVersion: "v1",
          mode: "ALLOWLIST",
        },
        providerMode: "CONTRACT",
        sandboxCohort: "test",
        scopeDecision: { ...GO, maximumMode: "ALLOWLIST" },
      }),
    ).toEqual({
      active: true,
      mode: "CONTRACT",
      paidScopeDecisionId: GO.id,
    });
    expect(
      resolvePaidCheckoutActivation({
        environment: "production",
        now: NOW,
        packageCode: "STARTER",
        paidSelfServiceEnabled: true,
        provider: {
          active: true,
          adapterKey: "stripe_live",
          adapterVersion: "v1",
          mode: "LIVE",
        },
        providerMode: "LIVE",
        sandboxCohort: "none",
        scopeDecision: { ...GO, maximumMode: "LIVE" },
      }),
    ).toEqual({
      active: true,
      mode: "LIVE",
      paidScopeDecisionId: GO.id,
    });
    expect(
      resolvePaidCheckoutActivation({
        environment: "production",
        now: NOW,
        packageCode: "STARTER",
        paidSelfServiceEnabled: true,
        provider: {
          active: true,
          adapterKey: "stripe_live",
          adapterVersion: "v1",
          mode: "LIVE",
        },
        providerMode: "CONTRACT",
        sandboxCohort: "test",
        scopeDecision: { ...GO, maximumMode: "LIVE" },
      }),
    ).toEqual({ active: false, reason: "PROVIDER_MODE_MISMATCH" });
  });
});
