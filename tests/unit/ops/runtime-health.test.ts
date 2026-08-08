import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateRuntimeReadiness,
  runtimeReadinessPolicy,
  startRuntimeHealthServer,
  type RuntimeHealthState,
} from "@/lib/ops/runtime-health";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const policy = runtimeReadinessPolicy(1_000);
const servers: import("node:http").Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

describe("Phase-34 runtime readiness", () => {
  it("keeps a fresh completed cycle ready", () => {
    expect(
      evaluateRuntimeReadiness({
        heartbeatHealthy: true,
        now: NOW,
        policy,
        state: healthyState(),
      }),
    ).toEqual({ ready: true, reason: "READY" });
  });

  it("fails closed for startup, stale cycles, hung cycles and heartbeat loss", () => {
    expect(
      evaluateRuntimeReadiness({
        heartbeatHealthy: true,
        now: NOW,
        policy,
        state: { ...healthyState(), lastCycleAt: null },
      }).reason,
    ).toBe("STARTING");
    expect(
      evaluateRuntimeReadiness({
        heartbeatHealthy: true,
        now: NOW,
        policy,
        state: {
          ...healthyState(),
          lastCycleAt: new Date(
            NOW.getTime() - policy.staleAfterMilliseconds - 1,
          ).toISOString(),
        },
      }).reason,
    ).toBe("CYCLE_STALE");
    expect(
      evaluateRuntimeReadiness({
        heartbeatHealthy: true,
        now: NOW,
        policy,
        state: {
          ...healthyState(),
          cycleStartedAt: new Date(
            NOW.getTime() - policy.cycleBudgetMilliseconds - 1,
          ).toISOString(),
        },
      }).reason,
    ).toBe("CYCLE_RUNTIME_EXCEEDED");
    expect(
      evaluateRuntimeReadiness({
        heartbeatHealthy: false,
        now: NOW,
        policy,
        state: healthyState(),
      }).reason,
    ).toBe("WORKER_HEARTBEAT_UNHEALTHY");
    expect(
      evaluateRuntimeReadiness({
        heartbeatHealthy: true,
        now: NOW,
        policy,
        state: {
          ...healthyState(),
          providerInboxProcessingState: "UNKNOWN",
        },
      }).reason,
    ).toBe("PROVIDER_INBOX_HEALTH_UNKNOWN");
    expect(
      evaluateRuntimeReadiness({
        heartbeatHealthy: true,
        now: NOW,
        policy,
        state: {
          ...healthyState(),
          providerInboxProcessingState: "DEGRADED",
        },
      }).reason,
    ).toBe("PROVIDER_INBOX_DEGRADED");
  });

  it("serves live while the real readiness endpoint becomes unavailable", async () => {
    const state = healthyState();
    const server = startRuntimeHealthServer({
      heartbeatHealthy: () => true,
      now: () => NOW,
      policy,
      port: 0,
      state,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;

    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    expect(await ready.json()).toMatchObject({
      reason: "READY",
      status: "ready",
    });

    state.cycleStartedAt = new Date(
      NOW.getTime() - policy.cycleBudgetMilliseconds - 1,
    ).toISOString();
    const unavailable = await fetch(
      `http://127.0.0.1:${port}/health/ready`,
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      reason: "CYCLE_RUNTIME_EXCEEDED",
      status: "unavailable",
    });
    expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(
      200,
    );
  });
});

function healthyState(): RuntimeHealthState {
  return {
    buildIdentifier: "phase34-test",
    cycleStartedAt: null,
    lastCycleAt: new Date(NOW.getTime() - 1_000).toISOString(),
    providerInboxCheckedAt: new Date(NOW.getTime() - 1_000).toISOString(),
    providerInboxProcessingState: "HEALTHY",
    role: "worker",
    shuttingDown: false,
  };
}
