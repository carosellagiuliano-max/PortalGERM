import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { DatabaseClient } from "@/lib/db/factory";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  getWorkerHandlerDefinition,
  type WorkerHandlerCatalogEntry,
} from "@/lib/ops/handler-catalog";
import {
  resolveProviderActivation,
  type ProviderActivationDecision,
} from "@/lib/ops/provider-activation-policy";
import {
  resolveWorkerHandlerActivation,
  type WorkerHandlerActivationDecision,
} from "@/lib/ops/worker-activation-policy";
import { getProviderDefinition } from "@/lib/ops/provider-catalog";
import { resolveWorkerLeasePolicy } from "@/lib/ops/worker-lease-policy";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeReferenceSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+ -]{1,127}$/u);
const reasonSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u);

export async function resolvePersistedHandlerActivation(
  database: DatabaseClient,
  input: Readonly<{
    deploymentDigest: string;
    environment: ServerEnvironment;
    handler: WorkerHandlerCatalogEntry;
    now: Date;
  }>,
): Promise<WorkerHandlerActivationDecision> {
  const activation = await database.workerHandlerActivation.findFirst({
    where: {
      environment: input.environment.APP_ENV,
      handlerKey: input.handler.handlerKey,
      handlerVersion: input.handler.handlerVersion,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return resolveWorkerHandlerActivation({
    activation,
    deploymentDigest: input.deploymentDigest,
    environment: input.environment.APP_ENV,
    handler: input.handler,
    now: input.now,
    runtimeMode: input.environment.WORKER_RUNTIME,
  });
}

export async function resolvePersistedProviderActivation(
  database: DatabaseClient,
  input: Readonly<{
    adapterKey: string;
    adapterVersion: string;
    environment: string;
    now: Date;
    useCase: string;
  }>,
): Promise<ProviderActivationDecision> {
  const activation = await database.providerActivation.findFirst({
    where: {
      environment: input.environment,
      useCase: input.useCase,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return resolveProviderActivation({ ...input, activation });
}

export async function activateSandboxHandler(
  database: DatabaseClient,
  input: Readonly<{
    actorReference: string;
    deploymentDigest: string;
    environment: ServerEnvironment;
    evidenceDigest: string;
    handlerKey: string;
    handlerVersion: string;
    now: Date;
    reasonCode: string;
    stepUpEvidenceDigest: string;
  }>,
) {
  assertLocalSandboxAuthority(input);
  const handler = getWorkerHandlerDefinition(
    input.handlerKey,
    input.handlerVersion,
  );
  if (handler === null || handler.execution !== "IMPLEMENTED") {
    throw new Error("WORKER_HANDLER_NOT_SANDBOX_EXECUTABLE");
  }
  const policy = resolveWorkerLeasePolicy();
  const configurationDigest = digestJson({
    handlerKey: handler.handlerKey,
    handlerVersion: handler.handlerVersion,
    payloadVersion: handler.payloadVersion,
    deploymentDigest: input.deploymentDigest,
    ...policy,
  });

  return database.$transaction(async (transaction) => {
    const previous = await transaction.workerHandlerActivation.findMany({
      where: {
        environment: input.environment.APP_ENV,
        handlerKey: handler.handlerKey,
        handlerVersion: handler.handlerVersion,
        mode: { not: "DISABLED" },
        revokedAt: null,
      },
      select: { id: true, mode: true, evidenceDigest: true },
    });
    for (const activation of previous) {
      await transaction.workerHandlerActivation.update({
        where: { id: activation.id },
        data: {
          killSwitchEngaged: true,
          revokedAt: input.now,
          revokeReasonCode: "SUPERSEDED",
        },
      });
      await transaction.operationsActivationEvent.create({
        data: {
          subject: "HANDLER",
          activationId: activation.id,
          environment: input.environment.APP_ENV,
          useCase: handler.handlerKey,
          mode: activation.mode,
          kind: "REVOKED",
          actorReference: input.actorReference,
          capability: "OPS_SANDBOX_HANDLER_ACTIVATE",
          stepUpEvidenceDigest: input.stepUpEvidenceDigest,
          reasonCode: "SUPERSEDED",
          evidenceDigest: activation.evidenceDigest,
          createdAt: input.now,
        },
      });
    }
    const activation = await transaction.workerHandlerActivation.create({
      data: {
        environment: input.environment.APP_ENV,
        handlerKey: handler.handlerKey,
        handlerVersion: handler.handlerVersion,
        payloadVersion: handler.payloadVersion,
        mode: "SANDBOX",
        configurationDigest,
        deploymentDigest: input.deploymentDigest,
        owner: handler.owner,
        runbookRef: handler.runbookRef,
        sloRef: handler.sloRef,
        evidenceDigest: input.evidenceDigest,
        providerUseCase: handler.providerUseCase,
        leaseMilliseconds: policy.leaseMilliseconds,
        heartbeatMilliseconds: policy.heartbeatMilliseconds,
        batchSize: policy.batchSize,
        maxAttempts: policy.maxAttempts,
        maxConcurrency: 1,
        killSwitchEngaged: false,
        effectiveAt: input.now,
      },
    });
    await transaction.operationsActivationEvent.create({
      data: {
        subject: "HANDLER",
        activationId: activation.id,
        environment: input.environment.APP_ENV,
        useCase: handler.handlerKey,
        mode: "SANDBOX",
        kind: "CREATED",
        actorReference: input.actorReference,
        capability: "OPS_SANDBOX_HANDLER_ACTIVATE",
        stepUpEvidenceDigest: input.stepUpEvidenceDigest,
        reasonCode: input.reasonCode,
        evidenceDigest: input.evidenceDigest,
        createdAt: input.now,
      },
    });
    return activation;
  });
}

export async function activateSandboxProvider(
  database: DatabaseClient,
  input: Readonly<{
    actorReference: string;
    adapterKey: string;
    adapterVersion: string;
    approvalRef: string;
    contractRef: string;
    dpaRef: string;
    environment: ServerEnvironment;
    evidenceDigest: string;
    now: Date;
    reasonCode: string;
    region: string;
    secretVersionRef: string;
    stepUpEvidenceDigest: string;
    sustainableCapacity: number;
    unitCostMicros: bigint;
    unitCostSource: string;
    useCase: string;
  }>,
) {
  assertLocalSandboxAuthority(input);
  const provider = getProviderDefinition(
    input.useCase,
    input.adapterKey,
    input.adapterVersion,
  );
  if (provider === null) throw new Error("PROVIDER_NOT_REGISTERED");
  const configurationDigest = digestJson({
    adapterKey: provider.adapterKey,
    adapterVersion: provider.adapterVersion,
    region: input.region,
    useCase: provider.useCase,
  });

  return database.$transaction(async (transaction) => {
    const previous = await transaction.providerActivation.findMany({
      where: {
        environment: input.environment.APP_ENV,
        useCase: provider.useCase,
        mode: { not: "DISABLED" },
        revokedAt: null,
      },
      select: { id: true, mode: true, evidenceDigest: true },
    });
    for (const activation of previous) {
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
          useCase: provider.useCase,
          mode: activation.mode,
          kind: "REVOKED",
          actorReference: input.actorReference,
          capability: "OPS_SANDBOX_PROVIDER_ACTIVATE",
          stepUpEvidenceDigest: input.stepUpEvidenceDigest,
          reasonCode: "SUPERSEDED",
          evidenceDigest: activation.evidenceDigest,
          createdAt: input.now,
        },
      });
    }
    const activation = await transaction.providerActivation.create({
      data: {
        environment: input.environment.APP_ENV,
        useCase: provider.useCase,
        adapterKey: provider.adapterKey,
        adapterVersion: provider.adapterVersion,
        mode: "SANDBOX",
        configurationDigest,
        secretVersionRef: input.secretVersionRef,
        region: input.region,
        dpaRef: input.dpaRef,
        contractRef: input.contractRef,
        approvalRef: input.approvalRef,
        evidenceDigest: input.evidenceDigest,
        owner: provider.owner,
        runbookRef: provider.runbookRef,
        health: "HEALTHY",
        healthCheckedAt: input.now,
        quotaUnits: input.sustainableCapacity,
        sustainableCapacity: input.sustainableCapacity,
        unitCostMicros: input.unitCostMicros,
        unitCostSource: input.unitCostSource,
        killSwitchEngaged: false,
        effectiveAt: input.now,
      },
    });
    await transaction.operationsActivationEvent.create({
      data: {
        subject: "PROVIDER",
        activationId: activation.id,
        environment: input.environment.APP_ENV,
        useCase: provider.useCase,
        mode: "SANDBOX",
        kind: "CREATED",
        actorReference: input.actorReference,
        capability: "OPS_SANDBOX_PROVIDER_ACTIVATE",
        stepUpEvidenceDigest: input.stepUpEvidenceDigest,
        reasonCode: input.reasonCode,
        evidenceDigest: input.evidenceDigest,
        createdAt: input.now,
      },
    });
    return activation;
  });
}

function assertLocalSandboxAuthority(input: Readonly<{
  actorReference: string;
  environment: ServerEnvironment;
  evidenceDigest: string;
  now: Date;
  reasonCode: string;
  stepUpEvidenceDigest: string;
}>) {
  if (
    (input.environment.APP_ENV !== "local" &&
      input.environment.APP_ENV !== "ci") ||
    input.environment.WORKER_RUNTIME !== "sandbox_command" ||
    !safeReferenceSchema.safeParse(input.actorReference).success ||
    !sha256Schema.safeParse(input.evidenceDigest).success ||
    !sha256Schema.safeParse(input.stepUpEvidenceDigest).success ||
    !reasonSchema.safeParse(input.reasonCode).success ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new Error("OPS_SANDBOX_ACTIVATION_FORBIDDEN");
  }
}

function digestJson(value: object) {
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
