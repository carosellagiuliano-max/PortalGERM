import { gateDecision, type GateDecision } from "@/lib/commercial/contracts";

export const PHASE31_RECOVERY_REMEDIES = Object.freeze([
  "RETRY",
  "EXTENSION",
  "REPLACEMENT",
  "CREDIT",
  "PARTIAL_REFUND",
  "REFUND",
] as const);

export function evaluatePaidServiceRecoveryRelease(
  input: Readonly<{
    customerCopyPublished: boolean;
    escalationOwnerAssigned: boolean;
    idempotencyTestPassed: boolean;
    remedies: readonly (typeof PHASE31_RECOVERY_REMEDIES)[number][];
    responseSlaMinutes: number;
    reversalReconciliationTestPassed: boolean;
    supportCapacityReserved: boolean;
  }>,
): GateDecision {
  const missing: string[] = [];
  if (!input.customerCopyPublished) missing.push("CUSTOMER_RECOVERY_COPY");
  if (!input.escalationOwnerAssigned) missing.push("ESCALATION_OWNER");
  if (!input.idempotencyTestPassed) missing.push("IDEMPOTENT_REMEDY");
  if (!input.reversalReconciliationTestPassed) {
    missing.push("REFUND_REVERSAL_RECONCILIATION");
  }
  if (!input.supportCapacityReserved) missing.push("SUPPORT_CAPACITY");
  if (
    !Number.isSafeInteger(input.responseSlaMinutes) ||
    input.responseSlaMinutes < 1
  ) {
    missing.push("RESPONSE_SLA");
  }
  const remedies = new Set(input.remedies);
  if (
    !remedies.has("EXTENSION") ||
    !remedies.has("CREDIT") ||
    !remedies.has("REFUND")
  ) {
    missing.push("MINIMUM_REMEDY_SET");
  }
  return gateDecision(missing);
}
