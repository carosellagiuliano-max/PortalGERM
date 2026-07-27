import type { OperationalCapacityState } from "@/lib/generated/prisma/client";

export const CAPACITY_POLICY_VERSION = "phase23-v1";
export const NORMAL_CAPACITY_LIMIT_BASIS_POINTS = 7_000;
export const THROTTLE_CAPACITY_LIMIT_BASIS_POINTS = 8_000;
export const PAUSE_CAPACITY_LIMIT_BASIS_POINTS = 9_000;

export type CapacityBackpressureDecision = Readonly<{
  claimBatchMultiplier: 0 | 0.5 | 1;
  intakeAllowed: boolean;
  reasonCode:
    | "CAPACITY_NORMAL"
    | "HEADROOM_BELOW_50_PERCENT"
    | "UTILIZATION_WARNING"
    | "UTILIZATION_PAUSE"
    | "DOWNSTREAM_DEGRADED"
    | "CAPACITY_UNMEASURED";
  state: OperationalCapacityState;
  utilizationBasisPoints: number;
}>;

export function resolveCapacityBackpressure(input: Readonly<{
  arrivalP95PerMinute: number;
  databasePoolBasisPoints?: number | null;
  downstreamHealthy: boolean;
  providerQuotaBasisPoints?: number | null;
  sustainablePerMinute: number;
}>): CapacityBackpressureDecision {
  const values = [
    input.arrivalP95PerMinute,
    input.sustainablePerMinute,
    input.databasePoolBasisPoints ?? 0,
    input.providerQuotaBasisPoints ?? 0,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError("Capacity inputs must be finite and non-negative.");
  }
  if (
    (input.databasePoolBasisPoints ?? 0) > 10_000 ||
    (input.providerQuotaBasisPoints ?? 0) > 10_000
  ) {
    throw new RangeError("Capacity utilization cannot exceed 10000 basis points.");
  }
  if (!input.downstreamHealthy) {
    return decision("DEGRADED", 0, false, "DOWNSTREAM_DEGRADED", 10_000);
  }
  if (input.sustainablePerMinute === 0) {
    return decision("PAUSED", 0, false, "CAPACITY_UNMEASURED", 10_000);
  }

  const arrivalUtilization = Math.min(
    10_000,
    Math.round(
      (input.arrivalP95PerMinute / input.sustainablePerMinute) * 10_000,
    ),
  );
  const utilizationBasisPoints = Math.max(
    arrivalUtilization,
    input.databasePoolBasisPoints ?? 0,
    input.providerQuotaBasisPoints ?? 0,
  );
  if (utilizationBasisPoints >= PAUSE_CAPACITY_LIMIT_BASIS_POINTS) {
    return decision(
      "PAUSED",
      0,
      false,
      "UTILIZATION_PAUSE",
      utilizationBasisPoints,
    );
  }
  if (utilizationBasisPoints >= THROTTLE_CAPACITY_LIMIT_BASIS_POINTS) {
    return decision(
      "THROTTLED",
      0.5,
      true,
      "UTILIZATION_WARNING",
      utilizationBasisPoints,
    );
  }
  if (
    utilizationBasisPoints > NORMAL_CAPACITY_LIMIT_BASIS_POINTS ||
    input.sustainablePerMinute < input.arrivalP95PerMinute * 1.5
  ) {
    return decision(
      "HEADROOM_LOW",
      0.5,
      true,
      "HEADROOM_BELOW_50_PERCENT",
      utilizationBasisPoints,
    );
  }
  return decision(
    "NORMAL",
    1,
    true,
    "CAPACITY_NORMAL",
    utilizationBasisPoints,
  );
}

function decision(
  state: OperationalCapacityState,
  claimBatchMultiplier: 0 | 0.5 | 1,
  intakeAllowed: boolean,
  reasonCode: CapacityBackpressureDecision["reasonCode"],
  utilizationBasisPoints: number,
): CapacityBackpressureDecision {
  return Object.freeze({
    state,
    claimBatchMultiplier,
    intakeAllowed,
    reasonCode,
    utilizationBasisPoints,
  });
}
