import { createHash, randomBytes } from "node:crypto";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import {
  beginWorkerDrain,
  createWorkerRun,
  finishWorkerRun,
  heartbeatWorkerRun,
} from "@/lib/ops/worker-runtime";
import { startHeartbeatLoop, type HeartbeatLoop } from "@/lib/ops/heartbeat-loop";
import { runWorkerCycle } from "@/lib/ops/worker-service";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

const RUNTIME_VERSION = "v1";
const WORKER_RUN_HEARTBEAT_MILLISECONDS = 10_000;

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      command: "phase23-worker",
      status: "FAILED",
      error: errorCode(error),
    }),
  );
  process.exitCode = 1;
}

async function main() {
  const command = parseArguments(process.argv.slice(2));
  loadLocalEnvironment();
  const environment = parseEnvironment(process.env);

  if (environment.WORKER_RUNTIME === "paused") {
    console.info(
      JSON.stringify({
        command: "phase23-worker",
        runtime: "paused",
        status: "PAUSED",
      }),
    );
    return;
  }
  const deploymentDigest =
    environment.APP_BUILD_ID ?? "local-development";
  const workerId =
    command.workerId ?? `phase23-${randomBytes(8).toString("hex")}`;
  const database = environment.secrets.database.withValue(createDatabaseClient);
  let workerRunId: string | undefined;
  let workerHeartbeat: HeartbeatLoop | null = null;
  let shutdownRequested = false;
  const requestShutdown = () => {
    shutdownRequested = true;
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  try {
    if (
      environment.WORKER_RUNTIME === "sandbox_command" &&
      !command.once
    ) {
      throw new Error("SANDBOX_WORKER_REQUIRES_ONCE");
    }
    const startedAt = new Date();
    const workerRun = await createWorkerRun(database, {
      workerId,
      environment: environment.APP_ENV,
      deploymentDigest,
      runtimeVersion: RUNTIME_VERSION,
      now: startedAt,
    });
    workerRunId = workerRun.id;
    workerHeartbeat = startHeartbeatLoop({
      intervalMilliseconds: WORKER_RUN_HEARTBEAT_MILLISECONDS,
      heartbeat: () =>
        heartbeatWorkerRun(database, {
          workerRunId: workerRun.id,
          now: new Date(),
        }),
    });

    do {
      const cycle = await runWorkerCycle({
        database,
        environment,
        deploymentDigest,
        workerId,
        workerRunId,
      });
      if (!workerHeartbeat.isHealthy()) {
        throw new Error("WORKER_RUN_HEARTBEAT_LOST");
      }
      console.info(
        JSON.stringify({
          command: "phase23-worker",
          deploymentDigest,
          runtime: environment.WORKER_RUNTIME,
          workerId,
          ...cycle,
        }),
      );
      if (command.once || shutdownRequested) break;
      await waitForNextPoll(command.pollMilliseconds, () => shutdownRequested);
    } while (!shutdownRequested);

    const stoppedAt = new Date();
    const heartbeatState = await workerHeartbeat.stop();
    workerHeartbeat = null;
    if (!heartbeatState.healthy) {
      throw new Error("WORKER_RUN_HEARTBEAT_LOST");
    }
    await beginWorkerDrain(database, { workerRunId, now: stoppedAt });
    await finishWorkerRun(database, {
      workerRunId,
      now: stoppedAt,
      outcome: shutdownRequested ? "DRAINED" : "CLEAN",
    });
  } catch (error) {
    await workerHeartbeat?.stop();
    workerHeartbeat = null;
    if (workerRunId !== undefined) {
      await finishWorkerRun(database, {
        workerRunId,
        now: new Date(),
        outcome: "CRASHED",
        errorDigest: createHash("sha256")
          .update(errorCode(error), "utf8")
          .digest("hex"),
      }).catch(() => false);
    }
    console.error(
      JSON.stringify({
        command: "phase23-worker",
        status: "FAILED",
        error: errorCode(error),
      }),
    );
    process.exitCode = 1;
  } finally {
    await workerHeartbeat?.stop();
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    await database.$disconnect();
  }
}

function parseArguments(values: readonly string[]) {
  let once = false;
  let pollMilliseconds = 1_000;
  let workerId: string | undefined;
  for (const value of values) {
    if (value === "--once") {
      once = true;
      continue;
    }
    const poll = /^--poll-ms=(\d{3,5})$/u.exec(value);
    if (poll !== null) {
      pollMilliseconds = Number(poll[1]);
      continue;
    }
    const worker = /^--worker-id=([A-Za-z0-9][A-Za-z0-9._:-]{0,95})$/u.exec(
      value,
    );
    if (worker !== null) {
      workerId = worker[1];
      continue;
    }
    throw new Error("WORKER_ARGUMENT_INVALID");
  }
  if (
    !Number.isInteger(pollMilliseconds) ||
    pollMilliseconds < 250 ||
    pollMilliseconds > 60_000
  ) {
    throw new Error("WORKER_POLL_INTERVAL_INVALID");
  }
  return Object.freeze({ once, pollMilliseconds, workerId });
}

function waitForNextPoll(
  milliseconds: number,
  cancelled: () => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    if (cancelled()) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, milliseconds);
    const interval = setInterval(() => {
      if (!cancelled()) return;
      clearTimeout(timer);
      clearInterval(interval);
      resolve();
    }, Math.min(250, milliseconds));
  });
}

function errorCode(error: unknown) {
  if (!(error instanceof Error)) return "WORKER_UNKNOWN_FAILURE";
  const normalized = error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 64);
  return /^[A-Z0-9][A-Z0-9_:-]{1,63}$/u.test(normalized)
    ? normalized
    : "WORKER_FAILURE";
}
