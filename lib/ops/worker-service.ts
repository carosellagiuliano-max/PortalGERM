import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { WORKER_HANDLER_CATALOG } from "@/lib/ops/handler-catalog";
import { resolvePersistedHandlerActivation } from "@/lib/ops/operations-ledger";
import { executeRegisteredHandler } from "@/lib/ops/registered-handler-runtime";
import {
  claimWorkBatch,
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

export async function runWorkerCycle(
  dependencies: Readonly<{
    database: DatabaseClient;
    deploymentDigest: string;
    environment: ServerEnvironment;
    now?: () => Date;
    workerId: string;
    workerRunId: string;
  }>,
): Promise<WorkerCycleResult> {
  const now = dependencies.now ?? (() => new Date());
  const schedule = await scheduleActivatedWork({
    database: dependencies.database,
    deploymentDigest: dependencies.deploymentDigest,
    environment: dependencies.environment,
    now: now(),
  });
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

    for (let offset = 0; offset < claimed.length; offset += activation.policy.maxConcurrency) {
      const group = claimed.slice(
        offset,
        offset + activation.policy.maxConcurrency,
      );
      const outcomes = await Promise.all(
        group.map((item) => {
          const identity: WorkLeaseIdentity = Object.freeze({
            workItemId: item.id,
            workerId: dependencies.workerId,
            workerRunId: dependencies.workerRunId,
            deploymentDigest: dependencies.deploymentDigest,
            fencingToken: item.fencingToken,
          });
          return executeRegisteredHandler(item, {
            database: dependencies.database,
            environment: dependencies.environment,
            identity,
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
    scheduled: schedule.created,
  });
}
