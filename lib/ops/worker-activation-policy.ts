import type { OperationsActivationMode } from "@/lib/generated/prisma/client";
import type { WorkerHandlerCatalogEntry } from "@/lib/ops/handler-catalog";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export type WorkerRuntimeMode =
  | "paused"
  | "sandbox_command"
  | "autonomous";

export type WorkerHandlerActivationRecord = Readonly<{
  id: string;
  generation: number;
  batchSize: number;
  configurationDigest: string;
  deploymentDigest: string;
  effectiveAt: Date | null;
  environment: string;
  evidenceDigest: string;
  expiresAt: Date | null;
  handlerKey: string;
  handlerVersion: string;
  heartbeatMilliseconds: number;
  killSwitchEngaged: boolean;
  leaseMilliseconds: number;
  maxAttempts: number;
  maxConcurrency: number;
  mode: OperationsActivationMode;
  owner: string;
  payloadVersion: string;
  providerUseCase: string | null;
  revokedAt: Date | null;
  runbookRef: string;
  sloRef: string;
}>;

export type WorkerHandlerActivationDecision =
  | Readonly<{
      active: true;
      mode: Exclude<OperationsActivationMode, "DISABLED">;
      policy: Readonly<{
        activationId: string;
        activationGeneration: number;
        batchSize: number;
        heartbeatMilliseconds: number;
        leaseMilliseconds: number;
        maxAttempts: number;
        maxConcurrency: number;
      }>;
    }>
  | Readonly<{
      active: false;
      reason:
        | "RUNTIME_PAUSED"
        | "MISSING_LEDGER"
        | "LEDGER_SCOPE_MISMATCH"
        | "HANDLER_NOT_EXECUTABLE"
        | "DISABLED"
        | "KILL_SWITCH"
        | "NOT_YET_EFFECTIVE"
        | "EXPIRED"
        | "REVOKED"
        | "DEPLOYMENT_MISMATCH"
        | "INCOMPLETE_EVIDENCE"
        | "ENVIRONMENT_MODE_FORBIDDEN";
    }>;

export function resolveWorkerHandlerActivation(input: Readonly<{
  activation: WorkerHandlerActivationRecord | null;
  deploymentDigest: string;
  environment: string;
  handler: WorkerHandlerCatalogEntry;
  now: Date;
  runtimeMode: WorkerRuntimeMode;
}>): WorkerHandlerActivationDecision {
  if (input.runtimeMode === "paused") return inactive("RUNTIME_PAUSED");
  if (input.handler.execution !== "IMPLEMENTED") {
    return inactive("HANDLER_NOT_EXECUTABLE");
  }
  const activation = input.activation;
  if (activation === null) return inactive("MISSING_LEDGER");
  if (
    activation.environment !== input.environment ||
    activation.handlerKey !== input.handler.handlerKey ||
    activation.handlerVersion !== input.handler.handlerVersion ||
    activation.payloadVersion !== input.handler.payloadVersion ||
    activation.providerUseCase !== input.handler.providerUseCase
  ) {
    return inactive("LEDGER_SCOPE_MISMATCH");
  }
  if (activation.mode === "DISABLED") return inactive("DISABLED");
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
  if (activation.deploymentDigest !== input.deploymentDigest) {
    return inactive("DEPLOYMENT_MISMATCH");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      activation.id,
    ) ||
    !Number.isSafeInteger(activation.generation) ||
    activation.generation < 1 ||
    !DIGEST_PATTERN.test(activation.configurationDigest) ||
    !DIGEST_PATTERN.test(activation.evidenceDigest) ||
    activation.owner.trim().length < 2 ||
    activation.runbookRef.trim().length < 2 ||
    activation.sloRef.trim().length < 2
  ) {
    return inactive("INCOMPLETE_EVIDENCE");
  }
  if (
    !isModeAllowed(
      activation.mode,
      input.environment,
      input.runtimeMode,
    )
  ) {
    return inactive("ENVIRONMENT_MODE_FORBIDDEN");
  }
  return Object.freeze({
    active: true,
    mode: activation.mode,
    policy: Object.freeze({
      activationId: activation.id,
      activationGeneration: activation.generation,
      batchSize: activation.batchSize,
      heartbeatMilliseconds: activation.heartbeatMilliseconds,
      leaseMilliseconds: activation.leaseMilliseconds,
      maxAttempts: activation.maxAttempts,
      maxConcurrency: activation.maxConcurrency,
    }),
  });
}

function inactive(
  reason: Extract<WorkerHandlerActivationDecision, { active: false }>["reason"],
): WorkerHandlerActivationDecision {
  return Object.freeze({ active: false, reason });
}

function isModeAllowed(
  mode: Exclude<OperationsActivationMode, "DISABLED">,
  environment: string,
  runtimeMode: Exclude<WorkerRuntimeMode, "paused">,
) {
  if (runtimeMode === "sandbox_command") {
    return (
      mode === "SANDBOX" && (environment === "local" || environment === "ci")
    );
  }
  if (mode === "SANDBOX") {
    return (
      environment === "local" ||
      environment === "ci" ||
      environment === "staging"
    );
  }
  if (mode === "ALLOWLIST") {
    return environment === "staging" || environment === "production";
  }
  return environment === "production";
}
