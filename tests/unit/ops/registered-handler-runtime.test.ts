import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeWorkItem: vi.fn(),
  failWorkItem: vi.fn(),
  heartbeatWorkLease: vi.fn(),
  recordFencedEffectReceipt: vi.fn(),
  startHeartbeatLoop: vi.fn(),
  stopHeartbeatLoop: vi.fn(),
}));

vi.mock("@/lib/ops/heartbeat-loop", () => ({
  startHeartbeatLoop: mocks.startHeartbeatLoop,
}));
vi.mock("@/lib/ops/worker-runtime", () => ({
  completeWorkItem: mocks.completeWorkItem,
  failWorkItem: mocks.failWorkItem,
  heartbeatWorkLease: mocks.heartbeatWorkLease,
  recordFencedEffectReceipt: mocks.recordFencedEffectReceipt,
}));

import { executeRegisteredHandler } from "@/lib/ops/registered-handler-runtime";

const NOW = new Date("2026-08-02T12:00:00.000Z");
const EFFECT_DIGEST = "d".repeat(64);

describe("registered handler revoke boundary", () => {
  beforeEach(() => {
    mocks.heartbeatWorkLease.mockResolvedValue({
      extended: true,
      leaseExpiresAt: new Date(NOW.getTime() + 6_000),
    });
    mocks.stopHeartbeatLoop.mockResolvedValue({ healthy: false });
    mocks.startHeartbeatLoop.mockReturnValue({
      isHealthy: () => false,
      stop: mocks.stopHeartbeatLoop,
    });
    mocks.recordFencedEffectReceipt.mockResolvedValue({ status: "RECORDED" });
    mocks.completeWorkItem.mockResolvedValue({ status: "COMPLETED" });
    mocks.failWorkItem.mockResolvedValue({ status: "PAUSED" });
  });

  it("records and completes a returned effect even when revoke stopped the heartbeat", async () => {
    const database = {
      workEffectReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    await expect(
      executeRegisteredHandler(claimed(), {
        database: database as never,
        environment: {} as never,
        heartbeatMilliseconds: 777,
        identity: identity(),
        leaseMilliseconds: 6_000,
        now: () => NOW,
      }),
    ).resolves.toEqual({
      completion: "COMPLETED",
      handlerKey: "ops.diagnostic-effect",
      workItemId: "d88624bd-d3fb-41e3-983f-71f122b01d14",
    });

    expect(mocks.startHeartbeatLoop).toHaveBeenCalledWith(
      expect.objectContaining({ intervalMilliseconds: 777 }),
    );
    expect(mocks.recordFencedEffectReceipt).toHaveBeenCalledWith(
      database,
      identity(),
      {
        effectDigest: EFFECT_DIGEST,
        handlerKey: "ops.diagnostic-effect",
        handlerVersion: "v1",
        now: NOW,
      },
    );
    expect(mocks.completeWorkItem).toHaveBeenCalledOnce();
    expect(mocks.failWorkItem).not.toHaveBeenCalled();
  });
});

function identity() {
  return {
    deploymentDigest: "candidate-a",
    fencingToken: 4,
    workerId: "worker-a",
    workerRunId: "d0e8836f-0252-4cba-bc2a-0edb29b3fb85",
    workItemId: "d88624bd-d3fb-41e3-983f-71f122b01d14",
  };
}

function claimed() {
  return {
    attemptNumber: 1,
    availableAt: NOW,
    dedupeKey: "ops.diagnostic-effect:v1:test",
    effectKey: "effect:ops.diagnostic-effect:v1:test",
    fencingToken: 4,
    handlerKey: "ops.diagnostic-effect",
    handlerVersion: "v1",
    id: "d88624bd-d3fb-41e3-983f-71f122b01d14",
    leaseClaimedAt: NOW,
    leaseExpiresAt: new Date(NOW.getTime() + 6_000),
    leaseHandlerActivationGeneration: 9,
    leaseHandlerActivationId: "92312686-15fb-49b0-a2d3-54e7e7acd77f",
    maxAttempts: 8,
    payloadReference: { effectDigest: EFFECT_DIGEST },
    payloadVersion: "v1",
    priority: 50,
    subjectId: "test",
    subjectType: "DIAGNOSTIC",
  };
}
