import {
  evidenceDigest,
  gateDecision,
  isSafeRappen,
  type GateDecision,
} from "@/lib/commercial/contracts";

export const REQUIRED_CAPACITY_WORK_TYPES = Object.freeze([
  "COMPANY_VERIFICATION",
  "JOB_MODERATION",
  "MANAGED_IMPORT",
  "PRIVACY_REQUEST",
  "SUPPORT_OR_FRAUD",
  "BILLING_EXCEPTION",
] as const);

export type CapacityWorkType = (typeof REQUIRED_CAPACITY_WORK_TYPES)[number];

export type CapacityWorkload = Readonly<{
  arrivalRatePerWeek: number;
  backlogCount: number;
  availableMinutesPerWeek: number;
  onCallCovered: boolean;
  p50Minutes: number;
  p95Minutes: number;
  slaMinutes: number;
  workType: CapacityWorkType;
}>;

export type CapacityModelResult = Readonly<{
  decision: GateDecision;
  maximumUtilizationBps: number;
  modelDigest: string;
  weeklyDemandMinutes: number;
  weeklySupplyMinutes: number;
}>;

export function evaluateCapacityModel(
  input: Readonly<{
    maximumConciergeCogsRappenPerCustomer: number;
    maximumUtilizationBps: number;
    measuredConciergeCogsRappenPerCustomer: number;
    workloads: readonly CapacityWorkload[];
  }>,
): CapacityModelResult {
  const missing: string[] = [];
  const observedTypes = new Set(input.workloads.map((row) => row.workType));
  if (
    input.workloads.length !== REQUIRED_CAPACITY_WORK_TYPES.length ||
    REQUIRED_CAPACITY_WORK_TYPES.some((type) => !observedTypes.has(type))
  ) {
    missing.push("ALL_REQUIRED_WORK_TYPES");
  }
  if (
    !Number.isSafeInteger(input.maximumUtilizationBps) ||
    input.maximumUtilizationBps < 1 ||
    input.maximumUtilizationBps > 8_000
  ) {
    missing.push("SAFE_UTILIZATION_THRESHOLD");
  }
  if (
    !isSafeRappen(input.maximumConciergeCogsRappenPerCustomer) ||
    input.maximumConciergeCogsRappenPerCustomer === 0 ||
    !isSafeRappen(input.measuredConciergeCogsRappenPerCustomer) ||
    input.measuredConciergeCogsRappenPerCustomer >
      input.maximumConciergeCogsRappenPerCustomer
  ) {
    missing.push("CONCIERGE_COGS_CAP");
  }

  let weeklyDemandMinutes = 0;
  let weeklySupplyMinutes = 0;
  for (const row of input.workloads) {
    const valid =
      Number.isSafeInteger(row.arrivalRatePerWeek) &&
      row.arrivalRatePerWeek >= 0 &&
      Number.isSafeInteger(row.backlogCount) &&
      row.backlogCount >= 0 &&
      Number.isSafeInteger(row.availableMinutesPerWeek) &&
      row.availableMinutesPerWeek > 0 &&
      Number.isSafeInteger(row.p50Minutes) &&
      row.p50Minutes > 0 &&
      Number.isSafeInteger(row.p95Minutes) &&
      row.p95Minutes >= row.p50Minutes &&
      Number.isSafeInteger(row.slaMinutes) &&
      row.slaMinutes >= row.p95Minutes;
    if (!valid) {
      missing.push(`VALID_${row.workType}_MODEL`);
      continue;
    }
    if (!row.onCallCovered && ["SUPPORT_OR_FRAUD", "BILLING_EXCEPTION"].includes(row.workType)) {
      missing.push(`${row.workType}_ON_CALL`);
    }
    weeklyDemandMinutes +=
      row.arrivalRatePerWeek * row.p95Minutes + row.backlogCount * row.p50Minutes;
    weeklySupplyMinutes += row.availableMinutesPerWeek;
  }
  const utilizationBps =
    weeklySupplyMinutes > 0
      ? Math.ceil((weeklyDemandMinutes * 10_000) / weeklySupplyMinutes)
      : 10_001;
  if (utilizationBps > input.maximumUtilizationBps) {
    missing.push("CAPACITY_HEADROOM");
  }
  return Object.freeze({
    decision: gateDecision([...new Set(missing)]),
    maximumUtilizationBps: utilizationBps,
    modelDigest: evidenceDigest(input),
    weeklyDemandMinutes,
    weeklySupplyMinutes,
  });
}
