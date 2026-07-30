import {
  gateDecision,
  isSafeRappen,
  type CommercialOfferKind,
  type GateDecision,
} from "@/lib/commercial/contracts";

export type ProductionOfferDecision = Readonly<{
  copyMode: "RESEARCH_ONLY" | "PRODUCTION";
  ctaMode: "LEAD_ONLY" | "PURCHASE";
  gate: GateDecision;
  indexable: boolean;
}>;

export function evaluateProductionOffer(
  input: Readonly<{
    accountingApproved: boolean;
    avgApproved: boolean;
    capacityReleased: boolean;
    cashflowReleased: boolean;
    clusterPublicActive: boolean;
    entitlementContractTested: boolean;
    legalApproved: boolean;
    offerKind: CommercialOfferKind;
    privacyApproved: boolean;
    productionOfferFlag: boolean;
    recoveryPolicyReleased: boolean;
    serverPriceRappen: number;
    taxApproved: boolean;
    wtpReleased: boolean;
  }>,
): ProductionOfferDecision {
  const missing: string[] = [];
  if (!input.productionOfferFlag) missing.push("PRODUCTION_OFFER_FLAG");
  if (!input.clusterPublicActive) missing.push("PUBLIC_CLUSTER");
  if (!input.wtpReleased) missing.push("NET_PAID_WTP");
  if (!input.capacityReleased) missing.push("CAPACITY_RELEASE");
  if (!input.cashflowReleased) missing.push("CASHFLOW_RELEASE");
  if (!input.recoveryPolicyReleased) missing.push("RECOVERY_POLICY_RELEASE");
  if (!input.entitlementContractTested) missing.push("ENTITLEMENT_CONTRACT");
  if (!input.legalApproved) missing.push("LEGAL_APPROVAL");
  if (!input.taxApproved) missing.push("TAX_APPROVAL");
  if (!input.accountingApproved) missing.push("ACCOUNTING_APPROVAL");
  if (!input.privacyApproved) missing.push("PRIVACY_APPROVAL");
  if (!input.avgApproved) missing.push("AVG_APPROVAL");
  if (
    !isSafeRappen(input.serverPriceRappen) ||
    input.serverPriceRappen === 0
  ) {
    missing.push("SERVER_AUTHORIZED_PRICE");
  }
  if (["SALARY", "SUCCESS_FEE"].includes(input.offerKind)) {
    missing.push("SEPARATE_PRODUCT_GATE");
  }
  const gate = gateDecision([...new Set(missing)]);
  return Object.freeze({
    copyMode: gate.allowed ? "PRODUCTION" : "RESEARCH_ONLY",
    ctaMode: gate.allowed ? "PURCHASE" : "LEAD_ONLY",
    gate,
    indexable: gate.allowed,
  });
}

export const PHASE31_RESEARCH_COPY = Object.freeze({
  badge: "Marktvalidierung · kein öffentliches Kaufangebot",
  body:
    "Preise und Pakete sind Hypothesen. Demo, Testzahlung und Anfrage gelten nicht als Zahlungsnachweis.",
  cta: "Unverbindlich Bedarf besprechen",
});
