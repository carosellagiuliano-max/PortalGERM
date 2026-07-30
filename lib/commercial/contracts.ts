import { createHash } from "node:crypto";

export const PHASE31_POLICY_VERSION = "phase31-v1" as const;

export const CORE_OFFER_KINDS = Object.freeze([
  "CORE_WORKFLOW",
  "HIRING_SPRINT",
  "RETAINER_CREDITS",
  "CONCIERGE",
  "MANAGED_IMPORT",
] as const);

export const ADDON_OFFER_KINDS = Object.freeze([
  "BOOST",
  "PAID_RADAR",
] as const);

export type CoreOfferKind = (typeof CORE_OFFER_KINDS)[number];
export type AddonOfferKind = (typeof ADDON_OFFER_KINDS)[number];
export type CommercialOfferKind =
  | CoreOfferKind
  | AddonOfferKind
  | "SALARY"
  | "SUCCESS_FEE";

export type GateDecision = Readonly<{
  allowed: boolean;
  missing: readonly string[];
  policyVersion: typeof PHASE31_POLICY_VERSION;
}>;

export function gateDecision(missing: readonly string[]): GateDecision {
  return Object.freeze({
    allowed: missing.length === 0,
    missing: Object.freeze([...missing]),
    policyVersion: PHASE31_POLICY_VERSION,
  });
}

export function evidenceDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

export function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

export function isSafeRappen(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
