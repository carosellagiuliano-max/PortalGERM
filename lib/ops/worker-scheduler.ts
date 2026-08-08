import "server-only";

import { resumePaymentInboxProjectionBacklog } from "@/lib/billing/payment-inbox";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  documentObjectStoreActivationBinding,
  documentScannerActivationBinding,
  type DocumentProviderActivationBinding,
} from "@/lib/documents/provider-activation-binding";
import {
  WORKER_HANDLER_CATALOG,
  type WorkerHandlerCatalogEntry,
} from "@/lib/ops/handler-catalog";
import {
  resolvePersistedHandlerActivation,
  resolvePersistedProviderActivation,
} from "@/lib/ops/operations-ledger";
import { enqueueWorkItem } from "@/lib/ops/worker-runtime";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { paymentProviderActivationBinding } from "@/lib/providers/payments/provider-activation-binding";

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
    if (
      handler.schedule.startsWith("event-driven") &&
      handler.handlerKey !== "payments.inbox-project"
    ) {
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
      handler.handlerKey === "payments.inbox-project"
        ? await resumePaymentInboxProjectionBacklog(
            {
              batchSize: activation.policy.batchSize,
              environment: dependencies.environment.APP_ENV,
              now: dependencies.now,
            },
            dependencies.database,
          )
        : handler.handlerKey === "documents.scan"
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
  const divisor =
    handler.schedule === "day-boundary"
      ? 24 * 60 * 60_000
      : handler.schedule === "hour-boundary"
        ? 60 * 60_000
        : 60_000;
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
    select: { id: true },
  });
  let created = 0;
  let replayed = 0;
  for (const version of versions) {
    // A document version owns exactly one automatic scan work item. Retries
    // are transitions of that item; deriving a new key from attempt history
    // would create parallel retry chains and bypass the configured DLQ budget.
    const dedupeKey = documentScanDedupeKey(handler, version.id);
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

export function documentScanDedupeKey(
  handler: Pick<WorkerHandlerCatalogEntry, "handlerKey" | "handlerVersion">,
  documentVersionId: string,
) {
  return `${handler.handlerKey}:${handler.handlerVersion}:${documentVersionId}`;
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
  if (handler.handlerKey === "notifications.dispatch") {
    const configuredRequirements = requirements.filter(
      (requirement) => requirement.adapterKey !== "disabled",
    );
    if (configuredRequirements.length === 0) {
      return "PROVIDER_EMAIL_OUTBOX_DISABLED";
    }

    // The shared outbox contains independently revocable purposes. Scheduling
    // is allowed when at least one purpose can make progress; the dispatcher
    // still revalidates the exact purpose immediately before every provider
    // call and pauses rows for any other purpose without consuming an attempt.
    for (const requirement of configuredRequirements) {
      if (
        (await providerRequirementBlock(requirement, dependencies)) === null
      ) {
        return null;
      }
    }
    return "PROVIDER_EMAIL_OUTBOX_NO_ACTIVE_PURPOSE";
  }

  for (const requirement of requirements) {
    const block = await providerRequirementBlock(requirement, dependencies);
    if (block !== null) return block;
  }
  return null;
}

async function providerRequirementBlock(
  requirement: ProviderRequirement,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    now: Date;
  }>,
): Promise<string | null> {
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
      ...(requirement.expectedConfigurationDigest === undefined
        ? {}
        : {
            expectedConfigurationDigest:
              requirement.expectedConfigurationDigest,
          }),
      ...(requirement.expectedMode === undefined
        ? {}
        : { expectedMode: requirement.expectedMode }),
      ...(requirement.expectedSecretVersionRef === undefined
        ? {}
        : {
            expectedSecretVersionRef: requirement.expectedSecretVersionRef,
          }),
      now: dependencies.now,
    },
  );
  return decision.active
    ? null
    : `PROVIDER_${requirement.useCase}_${decision.reason}`;
}

function providerRequirements(
  handler: WorkerHandlerCatalogEntry,
  environment: ServerEnvironment,
): readonly ProviderRequirement[] {
  switch (handler.handlerKey) {
    case "notifications.dispatch":
      // The outbox intentionally contains independently revocable
      // transactional and job-alert purposes. The dispatcher resolves and
      // rechecks the exact use-case binding immediately before each provider
      // I/O instead of allowing one activation to authorize the whole batch.
      return [
        providerRequirement(
          emailProviderActivationBinding(environment, "email.transactional"),
          "email.transactional",
        ),
        providerRequirement(
          emailProviderActivationBinding(environment, "email.job-alert"),
          "email.job-alert",
        ),
      ];
    case "candidate.job-alert-digest":
      return [
        providerRequirement(
          emailProviderActivationBinding(environment, "email.job-alert"),
          "email.job-alert",
        ),
      ];
    case "notifications.provider-event-project":
      return [
        providerRequirement(
          emailProviderActivationBinding(environment, "email.delivery-events"),
          "email.delivery-events",
        ),
      ];
    case "documents.scan":
      return [
        providerRequirement(
          documentObjectStoreActivationBinding(environment),
          "documents.object-store",
        ),
        providerRequirement(
          documentScannerActivationBinding(environment),
          "documents.malware-scan",
        ),
      ];
    case "documents.reconcile":
      return [
        providerRequirement(
          documentObjectStoreActivationBinding(environment),
          "documents.object-store",
        ),
      ];
    case "payments.inbox-project":
    case "payments.reconcile":
      return [
        providerRequirement(
          paymentProviderActivationBinding(environment),
          "payments.hosted-checkout",
        ),
      ];
    default:
      return [];
  }
}

type ProviderRequirement = Readonly<{
  adapterKey: string;
  expectedConfigurationDigest?: string;
  expectedMode?: "SANDBOX" | "ALLOWLIST" | "LIVE";
  expectedSecretVersionRef?: string;
  useCase: string;
}>;

function providerRequirement(
  binding: Pick<
    DocumentProviderActivationBinding,
    | "adapterKey"
    | "expectedConfigurationDigest"
    | "expectedMode"
    | "expectedSecretVersionRef"
  > | null,
  useCase: string,
): ProviderRequirement {
  if (binding === null) {
    return Object.freeze({ adapterKey: "disabled", useCase });
  }
  return Object.freeze({
    adapterKey: binding.adapterKey,
    expectedConfigurationDigest: binding.expectedConfigurationDigest,
    expectedMode: binding.expectedMode,
    ...(binding.expectedSecretVersionRef === undefined
      ? {}
      : {
          expectedSecretVersionRef: binding.expectedSecretVersionRef,
        }),
    useCase,
  });
}
