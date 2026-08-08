import { createServer, type Server } from "node:http";
import type { ProviderInboxProcessingState } from "@/lib/ops/provider-inbox-health";

export const RUNTIME_CYCLE_BUDGET_MILLISECONDS = 5 * 60_000;

export type RuntimeRole = "scheduler" | "worker";

export type RuntimeHealthState = {
  buildIdentifier: string;
  cycleStartedAt: string | null;
  lastCycleAt: string | null;
  providerInboxCheckedAt: string | null;
  providerInboxProcessingState: ProviderInboxProcessingState;
  role: RuntimeRole;
  shuttingDown: boolean;
};

export type RuntimeReadinessReason =
  | "READY"
  | "STARTING"
  | "SHUTTING_DOWN"
  | "WORKER_HEARTBEAT_UNHEALTHY"
  | "CYCLE_RUNTIME_EXCEEDED"
  | "CYCLE_STALE"
  | "PROVIDER_INBOX_DEGRADED"
  | "PROVIDER_INBOX_HEALTH_UNKNOWN"
  | "CLOCK_INVALID";

export type RuntimeReadinessDecision = Readonly<{
  ready: boolean;
  reason: RuntimeReadinessReason;
}>;

export function runtimeReadinessPolicy(pollMilliseconds: number) {
  if (
    !Number.isInteger(pollMilliseconds) ||
    pollMilliseconds < 250 ||
    pollMilliseconds > 60_000
  ) {
    throw new RangeError("Runtime poll interval is outside the bounded contract.");
  }
  return Object.freeze({
    cycleBudgetMilliseconds: RUNTIME_CYCLE_BUDGET_MILLISECONDS,
    staleAfterMilliseconds:
      RUNTIME_CYCLE_BUDGET_MILLISECONDS + 3 * pollMilliseconds,
  });
}

export function evaluateRuntimeReadiness(input: Readonly<{
  heartbeatHealthy: boolean;
  now: Date;
  policy: Readonly<{
    cycleBudgetMilliseconds: number;
    staleAfterMilliseconds: number;
  }>;
  state: Readonly<RuntimeHealthState>;
}>): RuntimeReadinessDecision {
  const nowMilliseconds = input.now.getTime();
  if (
    !Number.isFinite(nowMilliseconds) ||
    !validPolicy(input.policy)
  ) {
    return unavailable("CLOCK_INVALID");
  }
  if (input.state.shuttingDown) return unavailable("SHUTTING_DOWN");

  if (input.state.cycleStartedAt !== null) {
    const cycleStartedAt = Date.parse(input.state.cycleStartedAt);
    if (!Number.isFinite(cycleStartedAt) || cycleStartedAt > nowMilliseconds) {
      return unavailable("CLOCK_INVALID");
    }
    if (
      nowMilliseconds - cycleStartedAt >
      input.policy.cycleBudgetMilliseconds
    ) {
      return unavailable("CYCLE_RUNTIME_EXCEEDED");
    }
  }

  if (input.state.lastCycleAt === null) return unavailable("STARTING");
  const lastCycleAt = Date.parse(input.state.lastCycleAt);
  if (!Number.isFinite(lastCycleAt) || lastCycleAt > nowMilliseconds) {
    return unavailable("CLOCK_INVALID");
  }
  if (!input.heartbeatHealthy) {
    return unavailable("WORKER_HEARTBEAT_UNHEALTHY");
  }
  if (input.state.providerInboxProcessingState === "UNKNOWN") {
    return unavailable("PROVIDER_INBOX_HEALTH_UNKNOWN");
  }
  if (input.state.providerInboxProcessingState === "DEGRADED") {
    return unavailable("PROVIDER_INBOX_DEGRADED");
  }
  if (
    nowMilliseconds - lastCycleAt > input.policy.staleAfterMilliseconds
  ) {
    return unavailable("CYCLE_STALE");
  }
  return Object.freeze({ ready: true, reason: "READY" });
}

export function startRuntimeHealthServer(input: Readonly<{
  heartbeatHealthy: () => boolean;
  now?: () => Date;
  policy: ReturnType<typeof runtimeReadinessPolicy>;
  port: number;
  state: RuntimeHealthState;
}>): Server {
  const now = input.now ?? (() => new Date());
  const server = createServer((request, response) => {
    const path = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "runtime.invalid"}`,
    ).pathname;
    if (request.method !== "GET") {
      respond(response, 405, { status: "method_not_allowed" });
      return;
    }
    if (path === "/health/live") {
      respond(response, 200, {
        status: "ok",
        buildId: input.state.buildIdentifier,
        role: input.state.role,
      });
      return;
    }
    if (path === "/health/ready") {
      const readiness = evaluateRuntimeReadiness({
        heartbeatHealthy: input.heartbeatHealthy(),
        now: now(),
        policy: input.policy,
        state: input.state,
      });
      respond(response, readiness.ready ? 200 : 503, {
        status: readiness.ready ? "ready" : "unavailable",
        reason: readiness.reason,
        role: input.state.role,
        lastCycleAt: input.state.lastCycleAt,
      });
      return;
    }
    respond(response, 404, { status: "not_found" });
  });
  server.listen(input.port, "0.0.0.0");
  return server;
}

function validPolicy(
  policy: Readonly<{
    cycleBudgetMilliseconds: number;
    staleAfterMilliseconds: number;
  }>,
) {
  return (
    Number.isInteger(policy.cycleBudgetMilliseconds) &&
    policy.cycleBudgetMilliseconds >= 1_000 &&
    Number.isInteger(policy.staleAfterMilliseconds) &&
    policy.staleAfterMilliseconds >= policy.cycleBudgetMilliseconds
  );
}

function unavailable(reason: Exclude<RuntimeReadinessReason, "READY">) {
  return Object.freeze({ ready: false, reason });
}

function respond(
  response: import("node:http").ServerResponse,
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
