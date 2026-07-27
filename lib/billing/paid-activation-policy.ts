import { createHash } from "node:crypto";

import type { OperationsActivationMode } from "@/lib/generated/prisma/client";
import type { ProviderActivationDecision } from "@/lib/ops/provider-activation-policy";

export const PAID_CHECKOUT_POLICY_V1 = Object.freeze({
  scopeCode: "LC5_PAID_SELF_SERVICE",
  packageCodes: Object.freeze(["STARTER", "PRO"] as const),
  stepUpPurpose: "PAID_CHECKOUT",
  stepUpMaximumAgeMilliseconds: 10 * 60_000,
  checkoutTtlMilliseconds: 30 * 60_000,
  supportedEnvironments: Object.freeze(["local", "ci", "staging"] as const),
});

export type PaidScopeDecisionRecord = Readonly<{
  id: string;
  scopeCode: string;
  packageCode: string;
  status: "GO" | "NO_GO" | "REVOKED";
  maximumMode: OperationsActivationMode;
  evidenceDigest: string;
  effectiveAt: Date;
  expiresAt: Date;
}>;

export type PaidCheckoutActivationDecision =
  | Readonly<{
      active: true;
      mode: "SANDBOX";
      paidScopeDecisionId: string;
    }>
  | Readonly<{
      active: false;
      reason:
        | "PAID_SELF_SERVICE_DISABLED"
        | "SANDBOX_COHORT_REQUIRED"
        | "ENVIRONMENT_FORBIDDEN"
        | "WTP_DECISION_MISSING"
        | "WTP_SCOPE_MISMATCH"
        | "WTP_NOT_GO"
        | "WTP_NOT_YET_EFFECTIVE"
        | "WTP_EXPIRED"
        | "WTP_MODE_FORBIDDEN"
        | "PROVIDER_INACTIVE"
        | "PROVIDER_NOT_SANDBOX";
    }>;

export function resolvePaidCheckoutActivation(
  input: Readonly<{
    environment: string;
    now: Date;
    packageCode: string;
    paidSelfServiceEnabled: boolean;
    provider: ProviderActivationDecision;
    sandboxCohort: string;
    scopeDecision: PaidScopeDecisionRecord | null;
  }>,
): PaidCheckoutActivationDecision {
  if (!input.paidSelfServiceEnabled) {
    return inactive("PAID_SELF_SERVICE_DISABLED");
  }
  if (input.sandboxCohort !== "test") {
    return inactive("SANDBOX_COHORT_REQUIRED");
  }
  if (
    !PAID_CHECKOUT_POLICY_V1.supportedEnvironments.some(
      (environment) => environment === input.environment,
    ) ||
    input.environment === "staging"
  ) {
    // Phase 24 has no user-facing staging cohort until external gates exist.
    return inactive("ENVIRONMENT_FORBIDDEN");
  }
  const decision = input.scopeDecision;
  if (decision === null) return inactive("WTP_DECISION_MISSING");
  if (
    decision.scopeCode !== PAID_CHECKOUT_POLICY_V1.scopeCode ||
    decision.packageCode !== input.packageCode
  ) {
    return inactive("WTP_SCOPE_MISMATCH");
  }
  if (decision.status !== "GO") return inactive("WTP_NOT_GO");
  if (input.now.getTime() < decision.effectiveAt.getTime()) {
    return inactive("WTP_NOT_YET_EFFECTIVE");
  }
  if (input.now.getTime() >= decision.expiresAt.getTime()) {
    return inactive("WTP_EXPIRED");
  }
  if (decision.maximumMode !== "SANDBOX") {
    return inactive("WTP_MODE_FORBIDDEN");
  }
  if (!input.provider.active) return inactive("PROVIDER_INACTIVE");
  if (input.provider.mode !== "SANDBOX") {
    return inactive("PROVIDER_NOT_SANDBOX");
  }
  return Object.freeze({
    active: true,
    mode: "SANDBOX" as const,
    paidScopeDecisionId: decision.id,
  });
}

export function realPaymentQuoteDigest(
  input: Readonly<{
    amountRappen: number;
    companyId: string;
    currency: "CHF";
    description: string;
    orderId: string;
  }>,
): string {
  if (
    !Number.isSafeInteger(input.amountRappen) ||
    input.amountRappen <= 0 ||
    input.description.trim().length === 0
  ) {
    throw new TypeError("Real-payment quote snapshot is invalid.");
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        amountRappen: input.amountRappen,
        companyId: input.companyId,
        currency: input.currency,
        description: input.description,
        orderId: input.orderId,
        policyVersion: "phase24-v1",
      }),
      "utf8",
    )
    .digest("hex");
}

export function checkoutStepUpAction(quoteDigest: string): string {
  if (!/^[a-f0-9]{64}$/u.test(quoteDigest)) {
    throw new TypeError("Quote digest is invalid.");
  }
  return `CHECKOUT:${quoteDigest.slice(0, 55)}`;
}

function inactive(
  reason: Extract<PaidCheckoutActivationDecision, { active: false }>["reason"],
): PaidCheckoutActivationDecision {
  return Object.freeze({ active: false, reason });
}
