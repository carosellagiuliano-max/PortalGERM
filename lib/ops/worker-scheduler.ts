import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  WORKER_HANDLER_CATALOG,
  type WorkerHandlerCatalogEntry,
} from "@/lib/ops/handler-catalog";
import {
  resolvePersistedHandlerActivation,
  resolvePersistedProviderActivation,
} from "@/lib/ops/operations-ledger";
import { enqueueWorkItem } from "@/lib/ops/worker-runtime";

export type WorkerScheduleResult = Readonly<{
  created: number;
  handlerStates: readonly Readonly<{
    handlerKey: string;
    reason: string;
    scheduled: number;
  }>[];
  replayed: number;
}>;

export async function scheduleActivatedWork(
  dependencies: Readonly<{
    database: DatabaseClient;
    deploymentDigest: string;
    environment: ServerEnvironment;
    now: Date;
  }>,
): Promise<WorkerScheduleResult> {
  const handlerStates: Array<{
    handlerKey: string;
    reason: string;
    scheduled: number;
  }> = [];
  let created = 0;
  let replayed = 0;

  for (const handler of WORKER_HANDLER_CATALOG) {
    if (handler.schedule === "event-driven") {
      handlerStates.push({
        handlerKey: handler.handlerKey,
        reason: "EVENT_DRIVEN",
        scheduled: 0,
      });
      continue;
    }
    if (handler.schedule === "manual-sandbox-only") {
      handlerStates.push({
        handlerKey: handler.handlerKey,
        reason: "MANUAL_ONLY",
        scheduled: 0,
      });
      continue;
    }
    const activation = await resolvePersistedHandlerActivation(
      dependencies.database,
      {
        deploymentDigest: dependencies.deploymentDigest,
        environment: dependencies.environment,
        handler,
        now: dependencies.now,
      },
    );
    if (!activation.active) {
      handlerStates.push({
        handlerKey: handler.handlerKey,
        reason: activation.reason,
        scheduled: 0,
      });
      continue;
    }
    const providerBlock = await findProviderBlock(handler, dependencies);
    if (providerBlock !== null) {
      handlerStates.push({
        handlerKey: handler.handlerKey,
        reason: providerBlock,
        scheduled: 0,
      });
      continue;
    }

    const outcomes =
      handler.handlerKey === "documents.scan"
        ? await enqueueDocumentScans(
            handler,
            activation.policy.maxAttempts,
            dependencies,
          )
        : await enqueueScheduleTick(
            handler,
            activation.policy.maxAttempts,
            dependencies,
          );
    created += outcomes.created;
    replayed += outcomes.replayed;
    handlerStates.push({
      handlerKey: handler.handlerKey,
      reason: "SCHEDULED",
      scheduled: outcomes.created + outcomes.replayed,
    });
  }

  return Object.freeze({
    created,
    replayed,
    handlerStates: Object.freeze(
      handlerStates.map((state) => Object.freeze(state)),
    ),
  });
}

async function enqueueScheduleTick(
  handler: WorkerHandlerCatalogEntry,
  maxAttempts: number,
  dependencies: Readonly<{
    database: DatabaseClient;
    now: Date;
  }>,
) {
  const divisor = handler.schedule === "hour-boundary" ? 60 * 60_000 : 60_000;
  const bucket = Math.floor(dependencies.now.getTime() / divisor);
  const dedupeKey = `${handler.handlerKey}:${handler.handlerVersion}:${bucket}`;
  const outcome = await enqueueWorkItem(dependencies.database, {
    handlerKey: handler.handlerKey,
    handlerVersion: handler.handlerVersion,
    payloadVersion: handler.payloadVersion,
    subjectType: "SCHEDULE_TICK",
    subjectId: String(bucket),
    dedupeKey,
    effectKey: `effect:${dedupeKey}`,
    priority: handler.defaultPriority,
    maxAttempts,
    availableAt: new Date(bucket * divisor),
    payloadReference: { scheduleBucket: bucket },
  });
  return outcome.created
    ? Object.freeze({ created: 1, replayed: 0 })
    : Object.freeze({ created: 0, replayed: 1 });
}

async function enqueueDocumentScans(
  handler: WorkerHandlerCatalogEntry,
  maxAttempts: number,
  dependencies: Readonly<{
    database: DatabaseClient;
    now: Date;
  }>,
) {
  const versions = await dependencies.database.documentVersion.findMany({
    where: { status: { in: ["QUARANTINED", "SCAN_FAILED"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      createdAt: true,
      _count: { select: { scanAttempts: true } },
    },
  });
  let created = 0;
  let replayed = 0;
  for (const version of versions) {
    const revision = `${version.createdAt.getTime()}-${version._count.scanAttempts}`;
    const dedupeKey = `${handler.handlerKey}:${handler.handlerVersion}:${version.id}:${revision}`;
    const outcome = await enqueueWorkItem(dependencies.database, {
      handlerKey: handler.handlerKey,
      handlerVersion: handler.handlerVersion,
      payloadVersion: handler.payloadVersion,
      subjectType: "DOCUMENT_VERSION",
      subjectId: version.id,
      dedupeKey,
      effectKey: `effect:${dedupeKey}`,
      priority: handler.defaultPriority,
      maxAttempts,
      availableAt: dependencies.now,
      payloadReference: { documentVersionId: version.id },
    });
    if (outcome.created) created += 1;
    else replayed += 1;
  }
  return Object.freeze({ created, replayed });
}

async function findProviderBlock(
  handler: WorkerHandlerCatalogEntry,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    now: Date;
  }>,
): Promise<string | null> {
  const requirements = providerRequirements(handler, dependencies.environment);
  for (const requirement of requirements) {
    if (requirement.adapterKey === "disabled") {
      return `PROVIDER_${requirement.useCase}_DISABLED`;
    }
    const decision = await resolvePersistedProviderActivation(
      dependencies.database,
      {
        environment: dependencies.environment.APP_ENV,
        useCase: requirement.useCase,
        adapterKey: requirement.adapterKey,
        adapterVersion: "v1",
        now: dependencies.now,
      },
    );
    if (!decision.active) {
      return `PROVIDER_${requirement.useCase}_${decision.reason}`;
    }
  }
  return null;
}

function providerRequirements(
  handler: WorkerHandlerCatalogEntry,
  environment: ServerEnvironment,
) {
  switch (handler.handlerKey) {
    case "notifications.dispatch":
      return [
        {
          useCase: "email.transactional",
          adapterKey: environment.EMAIL_PROVIDER_MODE,
        },
      ];
    case "candidate.job-alert-digest":
      return [
        {
          useCase: "email.job-alert",
          adapterKey: environment.EMAIL_PROVIDER_MODE,
        },
      ];
    case "documents.scan":
      return [
        {
          useCase: "documents.object-store",
          adapterKey: environment.DOCUMENT_STORAGE_MODE,
        },
        {
          useCase: "documents.malware-scan",
          adapterKey: "deterministic_sandbox",
        },
      ];
    case "documents.reconcile":
      return [
        {
          useCase: "documents.object-store",
          adapterKey: environment.DOCUMENT_STORAGE_MODE,
        },
      ];
    case "payments.inbox-project":
    case "payments.reconcile":
      return [
        {
          useCase: "payments.hosted-checkout",
          adapterKey: environment.PAYMENT_PROVIDER_MODE,
        },
      ];
    default:
      return [];
  }
}
