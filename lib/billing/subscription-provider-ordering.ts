import { createHash } from "node:crypto";

export const SUBSCRIPTION_PROVIDER_SIGNAL_RANK_V1 = Object.freeze({
  RECOVERED: 10,
  CANCELLING: 30,
  DUNNING: 40,
  CANCELLED: 100,
} as const);

export type SubscriptionProviderSignal =
  keyof typeof SUBSCRIPTION_PROVIDER_SIGNAL_RANK_V1;

export type SubscriptionProviderOrderingDecision = Readonly<{
  apply: boolean;
  rank: number;
  reason:
    | "FIRST_SIGNAL"
    | "NEWER_SIGNAL"
    | "EQUAL_SECOND_SAFER_SIGNAL"
    | "TERMINAL_CANCELLATION"
    | "ALREADY_CANCELLED"
    | "OLDER_SIGNAL"
    | "EQUAL_SECOND_DUPLICATE_OR_WEAKER";
}>;

/**
 * Stripe's `event.created` is second-precision and delivery is unordered. The
 * cursor therefore compares semantic safety at an equal timestamp instead of
 * provider event ids (whose lexical order carries no chronology). Cancellation
 * is terminal for a provider subscription and dominates every delivery order.
 */
export function decideSubscriptionProviderOrdering(
  input: Readonly<{
    currentAt: Date | null;
    currentRank: number | null;
    incomingAt: Date;
    incomingSignal: SubscriptionProviderSignal;
  }>,
): SubscriptionProviderOrderingDecision {
  const rank = SUBSCRIPTION_PROVIDER_SIGNAL_RANK_V1[input.incomingSignal];
  if (!Number.isFinite(input.incomingAt.getTime())) {
    throw new TypeError("Provider subscription event timestamp is invalid.");
  }
  if (input.currentAt === null || input.currentRank === null) {
    return Object.freeze({ apply: true, rank, reason: "FIRST_SIGNAL" });
  }
  if (!Number.isFinite(input.currentAt.getTime())) {
    throw new TypeError("Provider subscription cursor is invalid.");
  }
  if (input.currentRank === SUBSCRIPTION_PROVIDER_SIGNAL_RANK_V1.CANCELLED) {
    return Object.freeze({
      apply: false,
      rank,
      reason: "ALREADY_CANCELLED",
    });
  }
  if (rank === SUBSCRIPTION_PROVIDER_SIGNAL_RANK_V1.CANCELLED) {
    return Object.freeze({
      apply: true,
      rank,
      reason: "TERMINAL_CANCELLATION",
    });
  }
  const incomingTime = input.incomingAt.getTime();
  const currentTime = input.currentAt.getTime();
  if (incomingTime > currentTime) {
    return Object.freeze({ apply: true, rank, reason: "NEWER_SIGNAL" });
  }
  if (incomingTime < currentTime) {
    return Object.freeze({ apply: false, rank, reason: "OLDER_SIGNAL" });
  }
  if (rank > input.currentRank) {
    return Object.freeze({
      apply: true,
      rank,
      reason: "EQUAL_SECOND_SAFER_SIGNAL",
    });
  }
  return Object.freeze({
    apply: false,
    rank,
    reason: "EQUAL_SECOND_DUPLICATE_OR_WEAKER",
  });
}

export function paymentAttemptProviderRank(
  state: "PENDING" | "EXPIRED" | "FAILED" | "SUCCEEDED",
) {
  switch (state) {
    case "PENDING":
      return 10;
    case "EXPIRED":
      return 20;
    case "FAILED":
      return 30;
    case "SUCCEEDED":
      return 100;
  }
}

export type SubscriptionProviderInvoiceIdentityV1 = Readonly<{
  adapterKey: string;
  environment: string;
  provider: "STRIPE";
  providerAccountReference: string;
  providerInvoiceReference: string;
}>;

export type SubscriptionProviderInvoicePaidFactsV1 = Readonly<{
  amountRappen: number;
  currency: "CHF";
  paidAt: Date;
  periodEnd: Date;
  periodStart: Date;
  providerPaymentReference: string;
}>;

/**
 * Canonical digest shared by initial and recurring invoice projection. Keeping
 * this in one place prevents the first `invoice.paid` and a later equivalent
 * Stripe delivery from being mistaken for two different settlements.
 */
export function subscriptionProviderInvoiceProjectionDigestV1(
  scope: SubscriptionProviderInvoiceIdentityV1,
  facts: SubscriptionProviderInvoicePaidFactsV1,
  subscriptionId: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        // Spell every field out in one canonical order. Object-spread order is
        // caller-dependent and previously made semantically identical invoice
        // aliases hash differently between initial and recurring projection.
        adapterKey: scope.adapterKey,
        amountRappen: facts.amountRappen,
        currency: facts.currency,
        environment: scope.environment,
        periodEnd: facts.periodEnd.toISOString(),
        periodStart: facts.periodStart.toISOString(),
        provider: scope.provider,
        providerAccountReference: scope.providerAccountReference,
        providerInvoiceReference: scope.providerInvoiceReference,
        providerPaymentReference: facts.providerPaymentReference,
        subscriptionId,
      }),
      "utf8",
    )
    .digest("hex");
}
