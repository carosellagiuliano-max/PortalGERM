import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";

import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  startHeartbeatLoop,
  type HeartbeatLoop,
} from "@/lib/ops/heartbeat-loop";
import {
  beginWorkerDrain,
  createWorkerRun,
  finishWorkerRun,
  heartbeatWorkerRun,
} from "@/lib/ops/worker-runtime";
import { runWorkerConsumerCycle } from "@/lib/ops/worker-service";
import { scheduleActivatedWork } from "@/lib/ops/worker-scheduler";
import { refreshConfiguredProviderHealth } from "@/lib/ops/provider-health-monitor";

const runtimeVersion = "phase33-runtime-v1";
const workerRunHeartbeatMilliseconds = 10_000;

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-runtime",
      error: safeErrorCode(error),
      status: "FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}

async function main() {
  const command = parseArguments(process.argv.slice(2));
  const environment = parseEnvironment(process.env);
  if (environment.WORKER_RUNTIME === "paused") {
    throw new Error("PHASE33_RUNTIME_PAUSED");
  }
  if (environment.WORKER_RUNTIME === "sandbox_command" && !command.once) {
    throw new Error("SANDBOX_RUNTIME_REQUIRES_ONCE");
  }

  const database = environment.secrets.database.withValue(createDatabaseClient);
  const deploymentDigest = environment.APP_BUILD_ID ?? "local-development";
  const workerId =
    command.workerId ??
    `phase33-${command.role}-${randomBytes(8).toString("hex")}`;
  const state: RuntimeHealthState = {
    buildIdentifier: deploymentDigest,
    lastCycleAt: null,
    ready: false,
    role: command.role,
    shuttingDown: false,
  };
  const healthServer = startHealthServer(command.healthPort, state);
  let workerRunId: string | undefined;
  let workerRunHeartbeat: HeartbeatLoop | null = null;
  let shutdownRequested = false;
  const requestShutdown = () => {
    shutdownRequested = true;
    state.shuttingDown = true;
    state.ready = false;
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  try {
    const startedAt = new Date();
    const workerRun = await createWorkerRun(database, {
      workerId,
      environment: environment.APP_ENV,
      deploymentDigest,
      runtimeVersion,
      now: startedAt,
    });
    workerRunId = workerRun.id;
    const activeWorkerRunId = workerRun.id;
    workerRunHeartbeat = startHeartbeatLoop({
      intervalMilliseconds: workerRunHeartbeatMilliseconds,
      heartbeat: () =>
        heartbeatWorkerRun(database, {
          workerRunId: activeWorkerRunId,
          now: new Date(),
        }),
    });

    do {
      const cycle =
        command.role === "scheduler"
          ? await runSchedulerCycle(database, environment, deploymentDigest)
          : await runConsumerCycle({
              database,
              deploymentDigest,
              environment,
              workerId,
              workerRunId: activeWorkerRunId,
            });
      const cycleAt = new Date();
      if (!workerRunHeartbeat.isHealthy()) {
        throw new Error("PHASE33_WORKER_RUN_HEARTBEAT_LOST");
      }
      state.lastCycleAt = cycleAt.toISOString();
      state.ready = true;
      process.stdout.write(
        `${JSON.stringify({
          command: "phase33-runtime",
          deploymentDigest,
          role: command.role,
          runtime: environment.WORKER_RUNTIME,
          workerId,
          ...cycle,
        })}\n`,
      );
      if (command.once || shutdownRequested) break;
      await waitForNextPoll(command.pollMilliseconds, () => shutdownRequested);
    } while (!shutdownRequested);

    const stoppedAt = new Date();
    const heartbeatState = await workerRunHeartbeat.stop();
    workerRunHeartbeat = null;
    if (!heartbeatState.healthy) {
      throw new Error("PHASE33_WORKER_RUN_HEARTBEAT_LOST");
    }
    await beginWorkerDrain(database, {
      workerRunId: activeWorkerRunId,
      now: stoppedAt,
    });
    await finishWorkerRun(database, {
      workerRunId: activeWorkerRunId,
      now: stoppedAt,
      outcome: shutdownRequested ? "DRAINED" : "CLEAN",
    });
  } catch (error) {
    await workerRunHeartbeat?.stop();
    workerRunHeartbeat = null;
    if (workerRunId !== undefined) {
      await finishWorkerRun(database, {
        workerRunId,
        now: new Date(),
        outcome: "CRASHED",
        errorDigest: createHash("sha256")
          .update(safeErrorCode(error), "utf8")
          .digest("hex"),
      }).catch(() => false);
    }
    throw error;
  } finally {
    await workerRunHeartbeat?.stop();
    state.ready = false;
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    await closeServer(healthServer);
    await database.$disconnect();
  }
}

async function runSchedulerCycle(
  database: DatabaseClient,
  environment: ServerEnvironment,
  deploymentDigest: string,
) {
  const providerHealth = await refreshConfiguredProviderHealth({
    database,
    environment,
    now: new Date(),
  });
  const result = await scheduleActivatedWork({
    database,
    deploymentDigest,
    environment,
    now: new Date(),
  });
  return Object.freeze({
    created: result.created,
    replayed: result.replayed,
    scheduledHandlers: result.handlerStates.filter(
      ({ reason }) => reason === "SCHEDULED",
    ).length,
    providerHealth,
  });
}

async function runConsumerCycle(
  input: Readonly<{
    database: DatabaseClient;
    deploymentDigest: string;
    environment: ServerEnvironment;
    workerId: string;
    workerRunId: string;
  }>,
) {
  return runWorkerConsumerCycle({
    database: input.database,
    deploymentDigest: input.deploymentDigest,
    environment: input.environment,
    workerId: input.workerId,
    workerRunId: input.workerRunId,
  });
}

type RuntimeRole = "scheduler" | "worker";
type RuntimeHealthState = {
  buildIdentifier: string;
  lastCycleAt: string | null;
  ready: boolean;
  role: RuntimeRole;
  shuttingDown: boolean;
};

function startHealthServer(port: number, state: RuntimeHealthState) {
  const server = createServer((request, response) => {
    const path = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "runtime.invalid"}`,
    ).pathname;
    if (request.method !== "GET") {
      return respond(response, 405, { status: "method_not_allowed" });
    }
    if (path === "/health/live") {
      return respond(response, 200, {
        status: "ok",
        buildId: state.buildIdentifier,
        role: state.role,
      });
    }
    if (path === "/health/ready") {
      return respond(response, state.ready ? 200 : 503, {
        status: state.ready ? "ready" : "unavailable",
        role: state.role,
        lastCycleAt: state.lastCycleAt,
      });
    }
    return respond(response, 404, { status: "not_found" });
  });
  server.listen(port, "0.0.0.0");
  return server;
}

function respond(
  response: ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function parseArguments(values: readonly string[]) {
  let role: RuntimeRole | undefined;
  let once = false;
  let pollMilliseconds = 1_000;
  let healthPort = 3_001;
  let workerId: string | undefined;
  for (const value of values) {
    if (value === "--once") {
      once = true;
      continue;
    }
    const roleMatch = /^--role=(worker|scheduler)$/u.exec(value);
    if (roleMatch !== null) {
      role = roleMatch[1] as RuntimeRole;
      continue;
    }
    const pollMatch = /^--poll-ms=(\d{3,5})$/u.exec(value);
    if (pollMatch !== null) {
      pollMilliseconds = Number(pollMatch[1]);
      continue;
    }
    const portMatch = /^--health-port=(\d{4,5})$/u.exec(value);
    if (portMatch !== null) {
      healthPort = Number(portMatch[1]);
      continue;
    }
    const workerMatch =
      /^--worker-id=([A-Za-z0-9][A-Za-z0-9._:-]{0,95})$/u.exec(value);
    if (workerMatch !== null) {
      workerId = workerMatch[1];
      continue;
    }
    throw new Error("PHASE33_RUNTIME_ARGUMENT_INVALID");
  }
  if (role === undefined) throw new Error("PHASE33_RUNTIME_ROLE_REQUIRED");
  if (
    !Number.isInteger(pollMilliseconds) ||
    pollMilliseconds < 250 ||
    pollMilliseconds > 60_000 ||
    !Number.isInteger(healthPort) ||
    healthPort < 1_024 ||
    healthPort > 65_535
  ) {
    throw new Error("PHASE33_RUNTIME_BOUND_INVALID");
  }
  return Object.freeze({
    healthPort,
    once,
    pollMilliseconds,
    role,
    workerId,
  });
}

function waitForNextPoll(milliseconds: number, cancelled: () => boolean) {
  return new Promise<void>((resolve) => {
    if (cancelled()) return resolve();
    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, milliseconds);
    const interval = setInterval(
      () => {
        if (!cancelled()) return;
        clearTimeout(timer);
        clearInterval(interval);
        resolve();
      },
      Math.min(250, milliseconds),
    );
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

function safeErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "PHASE33_RUNTIME_FAILURE";
  const code = error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 64);
  return /^[A-Z0-9][A-Z0-9_:-]{1,63}$/u.test(code)
    ? code
    : "PHASE33_RUNTIME_FAILURE";
}
