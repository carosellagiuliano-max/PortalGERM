import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { WORKER_HANDLER_CATALOG } from "@/lib/ops/handler-catalog";
import { resolvePersistedHandlerActivation } from "@/lib/ops/operations-ledger";
import { executeRegisteredHandler } from "@/lib/ops/registered-handler-runtime";
import {
  claimWorkBatch,
  failWorkItem,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { scheduleActivatedWork } from "@/lib/ops/worker-scheduler";

export type WorkerCycleResult = Readonly<{
  claimed: number;
  completed: number;
  deadLettered: number;
  leaseLost: number;
  paused: number;
  retried: number;
  scheduled: number;
}>;

type WorkerCycleDependencies = Readonly<{
  database: DatabaseClient;
  deploymentDigest: string;
  environment: ServerEnvironment;
  now?: () => Date;
  workerId: string;
  workerRunId: string;
}>;

export async function runWorkerCycle(
  dependencies: WorkerCycleDependencies,
): Promise<WorkerCycleResult> {
  const now = dependencies.now ?? (() => new Date());
  const schedule = await scheduleActivatedWork({
    database: dependencies.database,
    deploymentDigest: dependencies.deploymentDigest,
    environment: dependencies.environment,
    now: now(),
  });
  const consumed = await runWorkerConsumerCycle({ ...dependencies, now });
  return Object.freeze({
    ...consumed,
    scheduled: schedule.created,
  });
}

/**
 * Shared consumer implementation for every real process entrypoint.
 * Scheduler composition deliberately remains outside this function so the
 * Phase-33 Docker worker and scheduler stay separate roles.
 */
export async function runWorkerConsumerCycle(
  dependencies: WorkerCycleDependencies,
): Promise<Omit<WorkerCycleResult, "scheduled">> {
  const now = dependencies.now ?? (() => new Date());
  const counters = {
    claimed: 0,
    completed: 0,
    deadLettered: 0,
    leaseLost: 0,
    paused: 0,
    retried: 0,
  };

  for (const handler of WORKER_HANDLER_CATALOG) {
    const activation = await resolvePersistedHandlerActivation(
      dependencies.database,
      {
        deploymentDigest: dependencies.deploymentDigest,
        environment: dependencies.environment,
        handler,
        now: now(),
      },
    );
    if (!activation.active) continue;

    const claimed = await claimWorkBatch(dependencies.database, {
      deploymentDigest: dependencies.deploymentDigest,
      handlerKey: handler.handlerKey,
      handlerVersion: handler.handlerVersion,
      payloadVersion: handler.payloadVersion,
      workerId: dependencies.workerId,
      workerRunId: dependencies.workerRunId,
      now: now(),
      policy: activation.policy,
    });
    counters.claimed += claimed.length;

    for (
      let offset = 0;
      offset < claimed.length;
      offset += activation.policy.maxConcurrency
    ) {
      const group = claimed.slice(
        offset,
        offset + activation.policy.maxConcurrency,
      );
      const currentActivation = await resolvePersistedHandlerActivation(
        dependencies.database,
        {
          deploymentDigest: dependencies.deploymentDigest,
          environment: dependencies.environment,
          handler,
          now: now(),
        },
      );
      if (
        !currentActivation.active ||
        currentActivation.policy.activationId !==
          activation.policy.activationId ||
        currentActivation.policy.activationGeneration !==
          activation.policy.activationGeneration
      ) {
        const drained = await Promise.all(
          group.map((item) =>
            failWorkItem(
              dependencies.database,
              leaseIdentity(item, dependencies),
              {
                failure: {
                  errorCode: "WORKER_ACTIVATION_REVOKED",
                  explicitClass: "CONFIGURATION",
                },
                now: now(),
              },
            ),
          ),
        );
        for (const outcome of drained) {
          if (outcome.status === "PAUSED") counters.paused += 1;
          else if (outcome.status === "LEASE_LOST") counters.leaseLost += 1;
          else if (outcome.status === "DEAD_LETTER") counters.deadLettered += 1;
          else counters.retried += 1;
        }
        continue;
      }
      const outcomes = await Promise.all(
        group.map((item) => {
          return executeRegisteredHandler(item, {
            database: dependencies.database,
            environment: dependencies.environment,
            identity: leaseIdentity(item, dependencies),
            heartbeatMilliseconds: activation.policy.heartbeatMilliseconds,
            leaseMilliseconds: activation.policy.leaseMilliseconds,
            now,
          });
        }),
      );
      for (const outcome of outcomes) {
        switch (outcome.completion) {
          case "COMPLETED":
            counters.completed += 1;
            break;
          case "DEAD_LETTER":
            counters.deadLettered += 1;
            break;
          case "LEASE_LOST":
            counters.leaseLost += 1;
            break;
          case "PAUSED":
            counters.paused += 1;
            break;
          case "RETRY":
            counters.retried += 1;
            break;
        }
      }
    }
  }

  return Object.freeze({
    ...counters,
  });
}

function leaseIdentity(
  item: Readonly<{ id: string; fencingToken: number }>,
  dependencies: Readonly<{
    deploymentDigest: string;
    workerId: string;
    workerRunId: string;
  }>,
): WorkLeaseIdentity {
  return Object.freeze({
    workItemId: item.id,
    workerId: dependencies.workerId,
    workerRunId: dependencies.workerRunId,
    deploymentDigest: dependencies.deploymentDigest,
    fencingToken: item.fencingToken,
  });
}
