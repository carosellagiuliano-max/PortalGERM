import {
  ADDON_OFFER_KINDS,
  CORE_OFFER_KINDS,
  gateDecision,
  isSafeRappen,
  type CommercialOfferKind,
  type GateDecision,
} from "@/lib/commercial/contracts";

export type WtpEvidence = Readonly<{
  buyerCompanyId: string;
  buyerIsIndependent: boolean;
  deliveryStatus: "NOT_STARTED" | "STARTED" | "PARTIAL" | "DELIVERED";
  environment:
    | "LIVE_PROVIDER"
    | "MANUAL_RECONCILED"
    | "SANDBOX"
    | "TEST"
    | "DEMO"
    | "FREE"
    | "LOI"
    | "LEAD";
  grossPaidRappen: number;
  offerKind: CommercialOfferKind;
  refundRappen: number;
  reversalRappen: number;
  reconciled: boolean;
  sellerControlledBuyer: boolean;
}>;

export type NetWtpResult = Readonly<{
  buyerCount: number;
  evidenceCount: number;
  netPaidRappen: number;
}>;

export function summarizeNetWtp(
  evidence: readonly WtpEvidence[],
  offerKinds: readonly CommercialOfferKind[] = CORE_OFFER_KINDS,
): NetWtpResult {
  const accepted = evidence.filter(
    (entry) =>
      offerKinds.includes(entry.offerKind) &&
      entry.buyerIsIndependent &&
      !entry.sellerControlledBuyer &&
      entry.reconciled &&
      ["LIVE_PROVIDER", "MANUAL_RECONCILED"].includes(entry.environment) &&
      ["STARTED", "PARTIAL", "DELIVERED"].includes(entry.deliveryStatus) &&
      isSafeRappen(entry.grossPaidRappen) &&
      isSafeRappen(entry.refundRappen) &&
      isSafeRappen(entry.reversalRappen) &&
      entry.grossPaidRappen - entry.refundRappen - entry.reversalRappen > 0,
  );
  return Object.freeze({
    buyerCount: new Set(accepted.map((entry) => entry.buyerCompanyId)).size,
    evidenceCount: accepted.length,
    netPaidRappen: accepted.reduce(
      (sum, entry) =>
        sum + entry.grossPaidRappen - entry.refundRappen - entry.reversalRappen,
      0,
    ),
  });
}

export function evaluateOfferSequence(
  input: Readonly<{
    offerKind: CommercialOfferKind;
    coreWtp: NetWtpResult;
    minimumIndependentBuyers: number;
    minimumNetPaidRappen: number;
  }>,
): GateDecision {
  const missing: string[] = [];
  if (
    !Number.isSafeInteger(input.minimumIndependentBuyers) ||
    input.minimumIndependentBuyers < 1 ||
    !isSafeRappen(input.minimumNetPaidRappen) ||
    input.minimumNetPaidRappen === 0
  ) {
    missing.push("VALID_PREREGISTERED_THRESHOLD");
  }
  if (
    ADDON_OFFER_KINDS.includes(
      input.offerKind as (typeof ADDON_OFFER_KINDS)[number],
    ) &&
    !(
      input.coreWtp.buyerCount >= input.minimumIndependentBuyers &&
      input.coreWtp.netPaidRappen >= input.minimumNetPaidRappen
    )
  ) {
    missing.push("CORE_WTP_BEFORE_ADDON");
  }
  if (
    input.offerKind === "SUCCESS_FEE" ||
    input.offerKind === "SALARY"
  ) {
    missing.push("SEPARATE_PRODUCT_GATE");
  }
  return gateDecision(missing);
}
