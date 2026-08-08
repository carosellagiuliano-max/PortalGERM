import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { getWorkerHandlerDefinition } from "@/lib/ops/handler-catalog";
import {
  resolvePersistedHandlerActivation,
  resolvePersistedProviderActivation,
} from "@/lib/ops/operations-ledger";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";

export const JOB_ALERT_RUNTIME_HEARTBEAT_MAX_AGE_MILLISECONDS = 45_000;

export type JobAlertDeliveryUnavailableReason =
  | "DELIVERY_CONFIGURATION_UNAVAILABLE"
  | "DELIVERY_EVENT_HANDLER_INACTIVE"
  | "DELIVERY_EVENT_PROVIDER_INACTIVE"
  | "DIGEST_HANDLER_INACTIVE"
  | "DISPATCH_HANDLER_INACTIVE"
  | "JOB_ALERT_PROVIDER_INACTIVE"
  | "RUNTIME_BUILD_UNBOUND"
  | "RUNTIME_PAUSED"
  | "SCHEDULER_HEARTBEAT_STALE"
  | "WORKER_HEARTBEAT_STALE";

export type JobAlertDeliveryAvailability = Readonly<{
  canActivate: boolean;
  manualMockEnabled: boolean;
  mode: "LOCAL_MOCK" | "PROVIDER_CONTRACT" | "EXTERNAL" | "UNAVAILABLE";
  reason: "AVAILABLE" | JobAlertDeliveryUnavailableReason;
}>;

/**
 * Resolves the user-facing job-alert capability from the same durable
 * authority used by the worker. Environment variables alone are deliberately
 * insufficient: provider and handler ledgers plus current worker/scheduler
 * heartbeats must agree before a production-like UI may offer activation.
 */
export async function resolveJobAlertDeliveryAvailability(
  database: DatabaseClient,
  environment: ServerEnvironment,
  now: Date,
): Promise<JobAlertDeliveryAvailability> {
  if (!Number.isFinite(now.getTime())) {
    return unavailable("DELIVERY_CONFIGURATION_UNAVAILABLE");
  }

  if (
    (environment.APP_ENV === "local" || environment.APP_ENV === "ci") &&
    environment.EMAIL_PROVIDER_MODE === "local_mock"
  ) {
    return Object.freeze({
      canActivate: true,
      manualMockEnabled: true,
      mode: "LOCAL_MOCK",
      reason: "AVAILABLE",
    });
  }

  if (
    !environment.NOTIFICATION_OUTBOX_PRODUCERS ||
    environment.NOTIFICATION_DISPATCH !== "command" ||
    ![
      "resend_contract",
      "resend_sandbox",
      "resend_live",
    ].includes(environment.EMAIL_PROVIDER_MODE)
  ) {
    return unavailable("DELIVERY_CONFIGURATION_UNAVAILABLE");
  }
  if (environment.WORKER_RUNTIME !== "autonomous") {
    return unavailable("RUNTIME_PAUSED");
  }
  const deploymentDigest = environment.APP_BUILD_ID;
  if (deploymentDigest === undefined) {
    return unavailable("RUNTIME_BUILD_UNBOUND");
  }

  const jobAlertBinding = emailProviderActivationBinding(
    environment,
    "email.job-alert",
  );
  const deliveryEventBinding = emailProviderActivationBinding(
    environment,
    "email.delivery-events",
  );
  const digestHandler = getWorkerHandlerDefinition(
    "candidate.job-alert-digest",
    "v1",
  );
  const dispatchHandler = getWorkerHandlerDefinition(
    "notifications.dispatch",
    "v1",
  );
  const deliveryEventHandler = getWorkerHandlerDefinition(
    "notifications.provider-event-project",
    "v1",
  );
  if (
    jobAlertBinding === null ||
    deliveryEventBinding === null ||
    digestHandler === null ||
    dispatchHandler === null ||
    deliveryEventHandler === null
  ) {
    return unavailable("DELIVERY_CONFIGURATION_UNAVAILABLE");
  }

  const [
    jobAlertProvider,
    deliveryEventProvider,
    digestActivation,
    dispatchActivation,
    deliveryEventActivation,
    currentRuntimeRuns,
  ] = await Promise.all([
    resolvePersistedProviderActivation(database, {
      ...jobAlertBinding,
      environment: environment.APP_ENV,
      now,
    }),
    resolvePersistedProviderActivation(database, {
      ...deliveryEventBinding,
      environment: environment.APP_ENV,
      now,
    }),
    resolvePersistedHandlerActivation(database, {
      deploymentDigest,
      environment,
      handler: digestHandler,
      now,
    }),
    resolvePersistedHandlerActivation(database, {
      deploymentDigest,
      environment,
      handler: dispatchHandler,
      now,
    }),
    resolvePersistedHandlerActivation(database, {
      deploymentDigest,
      environment,
      handler: deliveryEventHandler,
      now,
    }),
    database.workerRun.findMany({
      where: {
        environment: environment.APP_ENV,
        deploymentDigest,
        status: "RUNNING",
        stoppedAt: null,
        heartbeatAt: {
          gte: new Date(
            now.getTime() - JOB_ALERT_RUNTIME_HEARTBEAT_MAX_AGE_MILLISECONDS,
          ),
          lte: now,
        },
        OR: [
          { workerId: { startsWith: "phase33-worker-" } },
          { workerId: { startsWith: "phase33-scheduler-" } },
        ],
      },
      orderBy: [{ heartbeatAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { workerId: true },
    }),
  ]);

  if (!jobAlertProvider.active) {
    return unavailable("JOB_ALERT_PROVIDER_INACTIVE");
  }
  if (!deliveryEventProvider.active) {
    return unavailable("DELIVERY_EVENT_PROVIDER_INACTIVE");
  }
  if (!digestActivation.active) {
    return unavailable("DIGEST_HANDLER_INACTIVE");
  }
  if (!dispatchActivation.active) {
    return unavailable("DISPATCH_HANDLER_INACTIVE");
  }
  if (!deliveryEventActivation.active) {
    return unavailable("DELIVERY_EVENT_HANDLER_INACTIVE");
  }
  if (
    !currentRuntimeRuns.some(({ workerId }) =>
      workerId.startsWith("phase33-worker-"),
    )
  ) {
    return unavailable("WORKER_HEARTBEAT_STALE");
  }
  if (
    !currentRuntimeRuns.some(({ workerId }) =>
      workerId.startsWith("phase33-scheduler-"),
    )
  ) {
    return unavailable("SCHEDULER_HEARTBEAT_STALE");
  }

  return Object.freeze({
    canActivate: true,
    manualMockEnabled: false,
    mode:
      environment.EMAIL_PROVIDER_MODE === "resend_live"
        ? "EXTERNAL"
        : "PROVIDER_CONTRACT",
    reason: "AVAILABLE",
  });
}

function unavailable(
  reason: JobAlertDeliveryUnavailableReason,
): JobAlertDeliveryAvailability {
  return Object.freeze({
    canActivate: false,
    manualMockEnabled: false,
    mode: "UNAVAILABLE",
    reason,
  });
}
