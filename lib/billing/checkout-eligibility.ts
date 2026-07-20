import type {
  PublicPlanCatalogRow,
  PublicProductCatalogRow,
} from "@/lib/billing/public-catalog-core";
import { isValidPublicPlanCatalogRowV1 } from "@/lib/billing/public-catalog-core";

export type CheckoutEligibility = Readonly<
  | { eligible: true; kind: "PLAN" | "CONTACT_PACK" | "JOB_BOOST" }
  | {
      eligible: false;
      reason:
        | "PHASE_08_NO_CHECKOUT"
        | "PLAN_NOT_P0_SELF_SERVICE"
        | "CATALOG_VERSION_NOT_EFFECTIVE"
        | "TALENT_RADAR_PLAN_REQUIRED"
        | "PHASE_13_HANDLER_REQUIRED"
        | "ELIGIBLE_OWNED_JOB_REQUIRED"
        | "PRODUCT_NOT_RELEASED";
      suggestedPlanSlug?: "pro";
    }
>;

/** Phase 08 never creates Orders, even for later checkout candidates. */
export function phase08CheckoutDecision(): CheckoutEligibility {
  return Object.freeze({ eligible: false, reason: "PHASE_08_NO_CHECKOUT" });
}

/** Pure candidate policy owned by Phase 08 and consumed by the Phase-12 gate later. */
export function getPlanCheckoutCandidateV1(
  row: PublicPlanCatalogRow,
  at: Date,
): CheckoutEligibility {
  if (!isEffective(row, at)) {
    return Object.freeze({ eligible: false, reason: "CATALOG_VERSION_NOT_EFFECTIVE" });
  }
  const eligible =
    (row.plan.code === "STARTER" || row.plan.code === "PRO") &&
    isValidPublicPlanCatalogRowV1(row) &&
    isPositiveInteger(row.netPriceRappen);
  return eligible
    ? Object.freeze({ eligible: true, kind: "PLAN" })
    : Object.freeze({ eligible: false, reason: "PLAN_NOT_P0_SELF_SERVICE" });
}

/** Product checkout remains deny-by-default until its owning fulfillment phase. */
export function getProductCheckoutCandidateV1(
  row: PublicProductCatalogRow,
  at: Date,
  context: Readonly<{
    hasTalentRadarAccess: boolean;
    phase13BoostHandlerRegistered: boolean;
    hasEligibleOwnedJobTarget: boolean;
  }>,
): CheckoutEligibility {
  if (!isEffective(row, at)) {
    return Object.freeze({ eligible: false, reason: "CATALOG_VERSION_NOT_EFFECTIVE" });
  }
  if (
    row.status !== "ACTIVE" ||
    !row.isPublic ||
    !row.isSelfService ||
    row.requiresLegalReview ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    row.currency !== "CHF" ||
    !isPositiveInteger(row.netPriceRappen) ||
    !Number.isSafeInteger(row.priority) ||
    row.priority < 0
  ) {
    return Object.freeze({ eligible: false, reason: "PRODUCT_NOT_RELEASED" });
  }
  if (row.product.type === "CONTACT_PACK") {
    const expectedCreditAmount = contactPackCreditAmount(row.product.code);
    if (
      expectedCreditAmount === null ||
      row.durationDays !== null ||
      row.creditType !== "TALENT_CONTACT" ||
      row.creditAmount !== expectedCreditAmount
    ) {
      return Object.freeze({ eligible: false, reason: "PRODUCT_NOT_RELEASED" });
    }
    return context.hasTalentRadarAccess
      ? Object.freeze({ eligible: true, kind: "CONTACT_PACK" })
      : Object.freeze({
          eligible: false,
          reason: "TALENT_RADAR_PLAN_REQUIRED",
          suggestedPlanSlug: "pro",
        });
  }
  if (row.product.type === "JOB_BOOST") {
    const expectedDurationDays = boostDurationDays(row.product.code);
    if (
      expectedDurationDays === null ||
      row.durationDays !== expectedDurationDays ||
      row.creditType !== null ||
      row.creditAmount !== null
    ) {
      return Object.freeze({ eligible: false, reason: "PRODUCT_NOT_RELEASED" });
    }
    if (!context.phase13BoostHandlerRegistered) {
      return Object.freeze({ eligible: false, reason: "PHASE_13_HANDLER_REQUIRED" });
    }
    return context.hasEligibleOwnedJobTarget
      ? Object.freeze({ eligible: true, kind: "JOB_BOOST" })
      : Object.freeze({ eligible: false, reason: "ELIGIBLE_OWNED_JOB_REQUIRED" });
  }
  return Object.freeze({ eligible: false, reason: "PRODUCT_NOT_RELEASED" });
}

function isEffective(
  row: Readonly<{ validFrom: Date; validTo: Date | null }>,
  at: Date,
) {
  return Number.isFinite(at.getTime()) &&
    Number.isFinite(row.validFrom.getTime()) &&
    row.validFrom.getTime() <= at.getTime() &&
    (row.validTo === null ||
      (Number.isFinite(row.validTo.getTime()) && at.getTime() < row.validTo.getTime()));
}

function isPositiveInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function contactPackCreditAmount(code: string) {
  if (code === "contact-pack-10") return 10;
  if (code === "contact-pack-50") return 50;
  return null;
}

function boostDurationDays(code: string) {
  if (code === "boost-7d") return 7;
  if (code === "boost-30d") return 30;
  return null;
}
