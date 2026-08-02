import { createHash } from "node:crypto";

import type { OperationsActivationMode } from "@/lib/generated/prisma/client";
import type { ProviderActivationDecision } from "@/lib/ops/provider-activation-policy";
import type {
  PaymentRuntimeMode,
  StripePaymentAdapterKey,
} from "@/lib/providers/payments";

export const PAID_CHECKOUT_POLICY_V1 = Object.freeze({
  scopeCode: "LC5_PAID_SELF_SERVICE",
  packageCodes: Object.freeze(["STARTER", "PRO"] as const),
  stepUpPurpose: "PAID_CHECKOUT",
  stepUpMaximumAgeMilliseconds: 10 * 60_000,
  checkoutTtlMilliseconds: 30 * 60_000,
  supportedEnvironments: Object.freeze([
    "local",
    "ci",
    "preview",
    "staging",
    "production",
  ] as const),
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
      mode: PaymentRuntimeMode;
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
        | "PROVIDER_MODE_MISMATCH";
    }>;

export function resolvePaidCheckoutActivation(
  input: Readonly<{
    environment: string;
    now: Date;
    packageCode: string;
    paidSelfServiceEnabled: boolean;
    providerMode: PaymentRuntimeMode;
    provider: ProviderActivationDecision;
    sandboxCohort: string;
    scopeDecision: PaidScopeDecisionRecord | null;
  }>,
): PaidCheckoutActivationDecision {
  if (!input.paidSelfServiceEnabled) {
    return inactive("PAID_SELF_SERVICE_DISABLED");
  }
  if (
    (input.providerMode === "LIVE" && input.sandboxCohort !== "none") ||
    (input.providerMode !== "LIVE" && input.sandboxCohort !== "test")
  ) {
    return inactive("SANDBOX_COHORT_REQUIRED");
  }
  if (
    !PAID_CHECKOUT_POLICY_V1.supportedEnvironments.some(
      (environment) => environment === input.environment,
    ) ||
    (input.providerMode === "SANDBOX" &&
      !["local", "ci", "staging"].includes(input.environment)) ||
    (input.providerMode === "LIVE" && input.environment !== "production")
  ) {
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
  if (
    activationModeRank(decision.maximumMode) <
    activationModeRank(expectedActivationMode(input.providerMode))
  ) {
    return inactive("WTP_MODE_FORBIDDEN");
  }
  if (!input.provider.active) return inactive("PROVIDER_INACTIVE");
  if (input.provider.mode !== expectedActivationMode(input.providerMode)) {
    return inactive("PROVIDER_MODE_MISMATCH");
  }
  return Object.freeze({
    active: true,
    mode: input.providerMode,
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
    adapterKey: StripePaymentAdapterKey;
    checkoutKind: "SUBSCRIPTION";
    paymentPriceBindingId: string;
    planVersionId: string;
    providerAccountReference: string;
    providerMode: PaymentRuntimeMode;
    providerPriceReference: string;
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
        adapterKey: input.adapterKey,
        checkoutKind: input.checkoutKind,
        paymentPriceBindingId: input.paymentPriceBindingId,
        planVersionId: input.planVersionId,
        providerAccountReference: input.providerAccountReference,
        providerMode: input.providerMode,
        providerPriceReference: input.providerPriceReference,
        policyVersion: "phase33-v1",
      }),
      "utf8",
    )
    .digest("hex");
}

function expectedActivationMode(mode: PaymentRuntimeMode) {
  return mode === "CONTRACT"
    ? ("ALLOWLIST" as const)
    : mode === "SANDBOX"
      ? ("SANDBOX" as const)
      : ("LIVE" as const);
}

function activationModeRank(mode: OperationsActivationMode) {
  return mode === "DISABLED"
    ? 0
    : mode === "SANDBOX"
      ? 1
      : mode === "ALLOWLIST"
        ? 2
        : 3;
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
