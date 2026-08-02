import type {
  OperationsActivationMode,
  OperationsHealthStatus,
} from "@/lib/generated/prisma/client";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export type ProviderActivationRecord = Readonly<{
  adapterKey: string;
  adapterVersion: string;
  approvalRef: string | null;
  configurationDigest: string;
  contractRef: string | null;
  dpaRef: string | null;
  effectiveAt: Date | null;
  environment: string;
  evidenceDigest: string;
  expiresAt: Date | null;
  health: OperationsHealthStatus;
  healthCheckedAt: Date | null;
  killSwitchEngaged: boolean;
  mode: OperationsActivationMode;
  owner: string;
  quotaUnits: number | null;
  region: string | null;
  revokedAt: Date | null;
  runbookRef: string;
  secretVersionRef: string | null;
  sustainableCapacity: number | null;
  unitCostMicros: bigint | null;
  unitCostSource: string | null;
  useCase: string;
}>;

export type ProviderActivationDecision =
  | Readonly<{
      active: true;
      adapterKey: string;
      adapterVersion: string;
      mode: Exclude<OperationsActivationMode, "DISABLED">;
    }>
  | Readonly<{
      active: false;
      reason:
        | "MISSING_LEDGER"
        | "LEDGER_SCOPE_MISMATCH"
        | "ACTIVATION_MODE_MISMATCH"
        | "CONFIGURATION_MISMATCH"
        | "SECRET_VERSION_MISMATCH"
        | "DISABLED"
        | "KILL_SWITCH"
        | "NOT_YET_EFFECTIVE"
        | "EXPIRED"
        | "REVOKED"
        | "ENVIRONMENT_MODE_FORBIDDEN"
        | "INCOMPLETE_EVIDENCE"
        | "UNHEALTHY"
        | "STALE_HEALTH"
        | "CAPACITY_UNKNOWN";
    }>;

export function resolveProviderActivation(input: Readonly<{
  activation: ProviderActivationRecord | null;
  adapterKey: string;
  adapterVersion: string;
  environment: string;
  expectedConfigurationDigest?: string;
  expectedMode?: Exclude<OperationsActivationMode, "DISABLED">;
  expectedSecretVersionRef?: string;
  healthMaximumAgeMilliseconds?: number;
  now: Date;
  useCase: string;
}>): ProviderActivationDecision {
  const activation = input.activation;
  if (activation === null) {
    return inactive("MISSING_LEDGER");
  }
  if (
    activation.environment !== input.environment ||
    activation.useCase !== input.useCase ||
    activation.adapterKey !== input.adapterKey ||
    activation.adapterVersion !== input.adapterVersion
  ) {
    return inactive("LEDGER_SCOPE_MISMATCH");
  }
  if (activation.mode === "DISABLED") return inactive("DISABLED");
  if (
    input.expectedMode !== undefined &&
    activation.mode !== input.expectedMode
  ) {
    return inactive("ACTIVATION_MODE_MISMATCH");
  }
  if (
    input.expectedConfigurationDigest !== undefined &&
    activation.configurationDigest !== input.expectedConfigurationDigest
  ) {
    return inactive("CONFIGURATION_MISMATCH");
  }
  if (
    input.expectedSecretVersionRef !== undefined &&
    activation.secretVersionRef !== input.expectedSecretVersionRef
  ) {
    return inactive("SECRET_VERSION_MISMATCH");
  }
  if (activation.revokedAt !== null) return inactive("REVOKED");
  if (activation.killSwitchEngaged) return inactive("KILL_SWITCH");
  if (
    activation.effectiveAt === null ||
    input.now.getTime() < activation.effectiveAt.getTime()
  ) {
    return inactive("NOT_YET_EFFECTIVE");
  }
  if (
    activation.expiresAt !== null &&
    input.now.getTime() >= activation.expiresAt.getTime()
  ) {
    return inactive("EXPIRED");
  }
  if (!isModeAllowedInEnvironment(activation.mode, input.environment)) {
    return inactive("ENVIRONMENT_MODE_FORBIDDEN");
  }
  if (!hasCompleteEvidence(activation)) {
    return inactive("INCOMPLETE_EVIDENCE");
  }
  if (activation.health !== "HEALTHY" || activation.healthCheckedAt === null) {
    return inactive("UNHEALTHY");
  }
  const maximumHealthAge = input.healthMaximumAgeMilliseconds ?? 5 * 60_000;
  if (
    !Number.isFinite(input.now.getTime()) ||
    input.now.getTime() - activation.healthCheckedAt.getTime() >
      maximumHealthAge ||
    activation.healthCheckedAt.getTime() > input.now.getTime()
  ) {
    return inactive("STALE_HEALTH");
  }
  if (
    activation.quotaUnits === null ||
    activation.quotaUnits < 1 ||
    activation.sustainableCapacity === null ||
    activation.sustainableCapacity < 1 ||
    activation.unitCostMicros === null ||
    activation.unitCostMicros < 0n ||
    activation.unitCostSource === null
  ) {
    return inactive("CAPACITY_UNKNOWN");
  }
  return Object.freeze({
    active: true,
    adapterKey: activation.adapterKey,
    adapterVersion: activation.adapterVersion,
    mode: activation.mode,
  });
}

function inactive(
  reason: Extract<ProviderActivationDecision, { active: false }>["reason"],
): ProviderActivationDecision {
  return Object.freeze({ active: false, reason });
}

function isModeAllowedInEnvironment(
  mode: Exclude<OperationsActivationMode, "DISABLED">,
  environment: string,
) {
  if (mode === "SANDBOX") {
    return environment === "local" || environment === "ci" || environment === "staging";
  }
  if (mode === "ALLOWLIST") {
    return (
      environment === "ci" ||
      environment === "staging" ||
      environment === "production"
    );
  }
  return environment === "production";
}

function hasCompleteEvidence(activation: ProviderActivationRecord) {
  return (
    DIGEST_PATTERN.test(activation.configurationDigest) &&
    DIGEST_PATTERN.test(activation.evidenceDigest) &&
    activation.secretVersionRef !== null &&
    activation.region !== null &&
    activation.dpaRef !== null &&
    activation.contractRef !== null &&
    activation.approvalRef !== null &&
    activation.owner.trim().length >= 2 &&
    activation.runbookRef.trim().length >= 2
  );
}
