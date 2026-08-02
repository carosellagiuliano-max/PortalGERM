import "server-only";

import { createHash } from "node:crypto";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  WORKER_HANDLER_CATALOG,
  type WorkerHandlerCatalogEntry,
} from "@/lib/ops/handler-catalog";
import { activateSandboxHandler } from "@/lib/ops/operations-ledger";
import { getProviderDefinition } from "@/lib/ops/provider-catalog";
import { resolveWorkerLeasePolicy } from "@/lib/ops/worker-lease-policy";

const digestPattern = /^[a-f0-9]{64}$/u;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/+ -]{1,127}$/u;

export type Phase33ContractProviderBinding = Readonly<{
  adapterKey: string;
  adapterVersion: string;
  expectedConfigurationDigest: string;
  expectedMode: "ALLOWLIST";
  expectedSecretVersionRef: string;
  region: string;
  useCase: string;
}>;

export type Phase33LocalProviderBinding = Readonly<{
  adapterKey: string;
  adapterVersion: string;
  expectedConfigurationDigest: string;
  expectedMode: "SANDBOX";
  expectedSecretVersionRef: string;
  region: string;
  useCase: string;
}>;

/**
 * Creates only CI contract-test authority. It cannot create SANDBOX or LIVE
 * provider authority and its evidence strings explicitly deny Production
 * approval. Re-running with the same immutable binding is idempotent.
 */
export async function ensurePhase33ContractProviderActivation(
  database: DatabaseClient,
  input: Readonly<{
    binding: Phase33ContractProviderBinding;
    deploymentDigest: string;
    environment: ServerEnvironment;
    now: Date;
  }>,
) {
  assertContractAuthority(input);
  const provider = getProviderDefinition(
    input.binding.useCase,
    input.binding.adapterKey,
    input.binding.adapterVersion,
  );
  if (provider === null) throw new Error("CONTRACT_PROVIDER_NOT_REGISTERED");

  const evidenceDigest = digestJson({
    adapterKey: input.binding.adapterKey,
    adapterVersion: input.binding.adapterVersion,
    configurationDigest: input.binding.expectedConfigurationDigest,
    deploymentDigest: input.deploymentDigest,
    environment: input.environment.APP_ENV,
    mode: input.binding.expectedMode,
    region: input.binding.region,
    secretVersionRef: input.binding.expectedSecretVersionRef,
    useCase: input.binding.useCase,
  });

  return database.$transaction(async (transaction) => {
    const lockKey = `phase33:contract-provider:${input.environment.APP_ENV}:${input.binding.useCase}`;
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS "locked"
    `;
    const active = await transaction.providerActivation.findMany({
      where: {
        environment: input.environment.APP_ENV,
        useCase: input.binding.useCase,
        mode: { not: "DISABLED" },
        revokedAt: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const exact = active.find(
      (activation) =>
        activation.adapterKey === input.binding.adapterKey &&
        activation.adapterVersion === input.binding.adapterVersion &&
        activation.mode === "ALLOWLIST" &&
        activation.configurationDigest ===
          input.binding.expectedConfigurationDigest &&
        activation.secretVersionRef ===
          input.binding.expectedSecretVersionRef &&
        activation.region === input.binding.region &&
        activation.evidenceDigest === evidenceDigest &&
        activation.health === "HEALTHY" &&
        activation.killSwitchEngaged === false &&
        activation.effectiveAt !== null &&
        activation.effectiveAt.getTime() <= input.now.getTime() &&
        activation.expiresAt === null,
    );
    if (exact !== undefined && active.length === 1) {
      const activation = await transaction.providerActivation.update({
        where: { id: exact.id },
        data: { healthCheckedAt: input.now },
      });
      return Object.freeze({ activation, reused: true as const });
    }

    for (const activation of active) {
      await transaction.providerActivation.update({
        where: { id: activation.id },
        data: {
          killSwitchEngaged: true,
          revokedAt: input.now,
          revokeReasonCode: "SUPERSEDED",
        },
      });
      await transaction.operationsActivationEvent.create({
        data: {
          subject: "PROVIDER",
          activationId: activation.id,
          environment: input.environment.APP_ENV,
          useCase: input.binding.useCase,
          mode: activation.mode,
          kind: "REVOKED",
          actorReference: "phase33-contract-bootstrap",
          capability: "OPS_PHASE33_CONTRACT_BOOTSTRAP",
          stepUpEvidenceDigest: evidenceDigest,
          reasonCode: "SUPERSEDED",
          evidenceDigest: activation.evidenceDigest,
          createdAt: input.now,
        },
      });
    }

    const activation = await transaction.providerActivation.create({
      data: {
        environment: input.environment.APP_ENV,
        useCase: input.binding.useCase,
        adapterKey: input.binding.adapterKey,
        adapterVersion: input.binding.adapterVersion,
        mode: "ALLOWLIST",
        configurationDigest: input.binding.expectedConfigurationDigest,
        secretVersionRef: input.binding.expectedSecretVersionRef,
        region: input.binding.region,
        dpaRef: "phase33-contract-only-no-external-dpa",
        contractRef: "phase33-isolated-provider-contract-v1",
        approvalRef: "phase33-technical-test-not-production-approval",
        evidenceDigest,
        owner: provider.owner,
        runbookRef: provider.runbookRef,
        health: "HEALTHY",
        healthCheckedAt: input.now,
        quotaUnits: 10_000,
        sustainableCapacity: 1_000,
        unitCostMicros: 0n,
        unitCostSource: "isolated-contract-stub-no-real-cost",
        killSwitchEngaged: false,
        effectiveAt: input.now,
      },
    });
    await transaction.operationsActivationEvent.create({
      data: {
        subject: "PROVIDER",
        activationId: activation.id,
        environment: input.environment.APP_ENV,
        useCase: input.binding.useCase,
        mode: "ALLOWLIST",
        kind: "CREATED",
        actorReference: "phase33-contract-bootstrap",
        capability: "OPS_PHASE33_CONTRACT_BOOTSTRAP",
        stepUpEvidenceDigest: evidenceDigest,
        reasonCode: "PHASE33_CONTRACT_BOOTSTRAP",
        evidenceDigest,
        createdAt: input.now,
      },
    });
    return Object.freeze({ activation, reused: false as const });
  });
}

/**
 * Local-only twin of the contract bootstrap. It creates truthful SANDBOX
 * authority for in-process mocks and never accepts a network/live adapter.
 */
export async function ensurePhase33LocalProviderActivation(
  database: DatabaseClient,
  input: Readonly<{
    binding: Phase33LocalProviderBinding;
    deploymentDigest: string;
    environment: ServerEnvironment;
    now: Date;
  }>,
) {
  assertLocalAuthority(input);
  const provider = getProviderDefinition(
    input.binding.useCase,
    input.binding.adapterKey,
    input.binding.adapterVersion,
  );
  if (provider === null) throw new Error("LOCAL_PROVIDER_NOT_REGISTERED");
  const evidenceDigest = digestJson({
    adapterKey: input.binding.adapterKey,
    adapterVersion: input.binding.adapterVersion,
    configurationDigest: input.binding.expectedConfigurationDigest,
    deploymentDigest: input.deploymentDigest,
    environment: input.environment.APP_ENV,
    mode: input.binding.expectedMode,
    region: input.binding.region,
    scope: "phase33-local-mock-runtime",
    secretVersionRef: input.binding.expectedSecretVersionRef,
    useCase: input.binding.useCase,
  });

  return database.$transaction(async (transaction) => {
    const lockKey = `phase33:local-provider:${input.binding.useCase}`;
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS "locked"
    `;
    const active = await transaction.providerActivation.findMany({
      where: {
        environment: "local",
        useCase: input.binding.useCase,
        mode: { not: "DISABLED" },
        revokedAt: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const exact = active.find(
      (activation) =>
        activation.adapterKey === input.binding.adapterKey &&
        activation.adapterVersion === input.binding.adapterVersion &&
        activation.mode === "SANDBOX" &&
        activation.configurationDigest ===
          input.binding.expectedConfigurationDigest &&
        activation.secretVersionRef ===
          input.binding.expectedSecretVersionRef &&
        activation.region === input.binding.region &&
        activation.evidenceDigest === evidenceDigest &&
        activation.health === "HEALTHY" &&
        !activation.killSwitchEngaged &&
        activation.effectiveAt !== null &&
        activation.effectiveAt.getTime() <= input.now.getTime() &&
        activation.expiresAt === null,
    );
    if (exact !== undefined && active.length === 1) {
      const activation = await transaction.providerActivation.update({
        where: { id: exact.id },
        data: { healthCheckedAt: input.now },
      });
      return Object.freeze({ activation, reused: true as const });
    }

    for (const activation of active) {
      await transaction.providerActivation.update({
        where: { id: activation.id },
        data: {
          killSwitchEngaged: true,
          revokedAt: input.now,
          revokeReasonCode: "SUPERSEDED",
        },
      });
      await transaction.operationsActivationEvent.create({
        data: {
          subject: "PROVIDER",
          activationId: activation.id,
          environment: "local",
          useCase: input.binding.useCase,
          mode: activation.mode,
          kind: "REVOKED",
          actorReference: "phase33-local-bootstrap",
          capability: "OPS_PHASE33_LOCAL_BOOTSTRAP",
          stepUpEvidenceDigest: evidenceDigest,
          reasonCode: "SUPERSEDED",
          evidenceDigest: activation.evidenceDigest,
          createdAt: input.now,
        },
      });
    }

    const activation = await transaction.providerActivation.create({
      data: {
        environment: "local",
        useCase: input.binding.useCase,
        adapterKey: input.binding.adapterKey,
        adapterVersion: input.binding.adapterVersion,
        mode: "SANDBOX",
        configurationDigest: input.binding.expectedConfigurationDigest,
        secretVersionRef: input.binding.expectedSecretVersionRef,
        region: input.binding.region,
        dpaRef: "phase33-local-mock-no-external-dpa",
        contractRef: "phase33-local-mock-contract-v1",
        approvalRef: "phase33-local-technical-test-not-production-approval",
        evidenceDigest,
        owner: provider.owner,
        runbookRef: provider.runbookRef,
        health: "HEALTHY",
        healthCheckedAt: input.now,
        quotaUnits: 10_000,
        sustainableCapacity: 1_000,
        unitCostMicros: 0n,
        unitCostSource: "isolated-local-mock-no-real-cost",
        killSwitchEngaged: false,
        effectiveAt: input.now,
      },
    });
    await transaction.operationsActivationEvent.create({
      data: {
        subject: "PROVIDER",
        activationId: activation.id,
        environment: "local",
        useCase: input.binding.useCase,
        mode: "SANDBOX",
        kind: "CREATED",
        actorReference: "phase33-local-bootstrap",
        capability: "OPS_PHASE33_LOCAL_BOOTSTRAP",
        stepUpEvidenceDigest: evidenceDigest,
        reasonCode: "PHASE33_LOCAL_BOOTSTRAP",
        evidenceDigest,
        createdAt: input.now,
      },
    });
    return Object.freeze({ activation, reused: false as const });
  });
}

export async function ensurePhase33ContractHandlerActivations(
  database: DatabaseClient,
  input: Readonly<{
    deploymentDigest: string;
    environment: ServerEnvironment;
    now: Date;
  }>,
) {
  assertContractEnvironment(input.environment, input.deploymentDigest);
  const results = [];
  for (const handler of WORKER_HANDLER_CATALOG) {
    if (handler.execution !== "IMPLEMENTED") continue;
    results.push(
      await ensureContractHandlerActivation(database, {
        ...input,
        handler,
      }),
    );
  }
  return Object.freeze(results);
}

export async function ensurePhase33LocalHandlerActivations(
  database: DatabaseClient,
  input: Readonly<{
    deploymentDigest: string;
    environment: ServerEnvironment;
    now: Date;
  }>,
) {
  assertLocalEnvironment(input.environment, input.deploymentDigest);
  const results = [];
  for (const handler of WORKER_HANDLER_CATALOG) {
    if (handler.execution !== "IMPLEMENTED") continue;
    results.push(
      await ensureContractHandlerActivation(database, {
        ...input,
        handler,
      }),
    );
  }
  return Object.freeze(results);
}

async function ensureContractHandlerActivation(
  database: DatabaseClient,
  input: Readonly<{
    deploymentDigest: string;
    environment: ServerEnvironment;
    handler: WorkerHandlerCatalogEntry;
    now: Date;
  }>,
) {
  const policy = resolveWorkerLeasePolicy();
  const configurationDigest = digestJson({
    handlerKey: input.handler.handlerKey,
    handlerVersion: input.handler.handlerVersion,
    payloadVersion: input.handler.payloadVersion,
    deploymentDigest: input.deploymentDigest,
    ...policy,
  });
  const existing = await database.workerHandlerActivation.findFirst({
    where: {
      environment: input.environment.APP_ENV,
      handlerKey: input.handler.handlerKey,
      handlerVersion: input.handler.handlerVersion,
      mode: "SANDBOX",
      revokedAt: null,
      killSwitchEngaged: false,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (
    existing !== null &&
    existing.payloadVersion === input.handler.payloadVersion &&
    existing.deploymentDigest === input.deploymentDigest &&
    existing.configurationDigest === configurationDigest &&
    existing.providerUseCase === input.handler.providerUseCase &&
    existing.expiresAt === null
  ) {
    return Object.freeze({ activation: existing, reused: true as const });
  }

  const evidenceDigest = digestJson({
    configurationDigest,
    deploymentDigest: input.deploymentDigest,
    handlerKey: input.handler.handlerKey,
    handlerVersion: input.handler.handlerVersion,
    scope: "phase33-isolated-contract-runtime",
  });
  const activation = await activateSandboxHandler(database, {
    actorReference: "phase33-contract-bootstrap",
    deploymentDigest: input.deploymentDigest,
    environment: input.environment,
    evidenceDigest,
    handlerKey: input.handler.handlerKey,
    handlerVersion: input.handler.handlerVersion,
    now: input.now,
    reasonCode: "PHASE33_CONTRACT_BOOTSTRAP",
    stepUpEvidenceDigest: evidenceDigest,
  });
  return Object.freeze({ activation, reused: false as const });
}

function assertContractAuthority(input: Readonly<{
  binding: Phase33ContractProviderBinding;
  deploymentDigest: string;
  environment: ServerEnvironment;
  now: Date;
}>) {
  assertContractEnvironment(input.environment, input.deploymentDigest);
  if (
    input.binding.expectedMode !== "ALLOWLIST" ||
    !digestPattern.test(input.binding.expectedConfigurationDigest) ||
    !versionPattern.test(input.binding.expectedSecretVersionRef) ||
    !/^[a-z0-9][a-z0-9-]{1,31}$/u.test(input.binding.region) ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new Error("PHASE33_CONTRACT_PROVIDER_AUTHORITY_INVALID");
  }
}

function assertLocalAuthority(input: Readonly<{
  binding: Phase33LocalProviderBinding;
  deploymentDigest: string;
  environment: ServerEnvironment;
  now: Date;
}>) {
  assertLocalEnvironment(input.environment, input.deploymentDigest);
  if (
    input.binding.expectedMode !== "SANDBOX" ||
    !digestPattern.test(input.binding.expectedConfigurationDigest) ||
    !versionPattern.test(input.binding.expectedSecretVersionRef) ||
    !/^[a-z0-9][a-z0-9-]{1,31}$/u.test(input.binding.region) ||
    !Number.isFinite(input.now.getTime()) ||
    ![
      "local_mock",
      "filesystem_sandbox",
      "deterministic_sandbox",
    ].includes(input.binding.adapterKey)
  ) {
    throw new Error("PHASE33_LOCAL_PROVIDER_AUTHORITY_INVALID");
  }
}

function assertContractEnvironment(
  environment: ServerEnvironment,
  deploymentDigest: string,
) {
  if (
    environment.APP_ENV !== "ci" ||
    environment.NODE_ENV !== "production" ||
    environment.WORKER_RUNTIME !== "sandbox_command" ||
    environment.APP_BUILD_ID !== deploymentDigest ||
    deploymentDigest.trim().length < 8
  ) {
    throw new Error("PHASE33_CONTRACT_BOOTSTRAP_FORBIDDEN");
  }
}

function assertLocalEnvironment(
  environment: ServerEnvironment,
  deploymentDigest: string,
) {
  if (
    environment.APP_ENV !== "local" ||
    environment.WORKER_RUNTIME !== "sandbox_command" ||
    environment.APP_BUILD_ID !== deploymentDigest ||
    deploymentDigest.trim().length < 8
  ) {
    throw new Error("PHASE33_LOCAL_BOOTSTRAP_FORBIDDEN");
  }
}

function digestJson(value: object): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      ),
      "utf8",
    )
    .digest("hex");
}
