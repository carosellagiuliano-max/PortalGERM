import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimWorkBatch: vi.fn(),
  executeRegisteredHandler: vi.fn(),
  failWorkItem: vi.fn(),
  resolvePersistedHandlerActivation: vi.fn(),
  scheduleActivatedWork: vi.fn(),
}));

vi.mock("@/lib/ops/handler-catalog", () => ({
  WORKER_HANDLER_CATALOG: [
    {
      defaultPriority: 50,
      execution: "IMPLEMENTED",
      handlerKey: "ops.diagnostic-effect",
      handlerVersion: "v1",
      owner: "Platform",
      payloadVersion: "v1",
      providerUseCase: null,
      runbookRef: "runbook",
      schedule: "manual",
      sloRef: "slo",
    },
  ],
}));
vi.mock("@/lib/ops/operations-ledger", () => ({
  resolvePersistedHandlerActivation: mocks.resolvePersistedHandlerActivation,
}));
vi.mock("@/lib/ops/registered-handler-runtime", () => ({
  executeRegisteredHandler: mocks.executeRegisteredHandler,
}));
vi.mock("@/lib/ops/worker-runtime", () => ({
  claimWorkBatch: mocks.claimWorkBatch,
  failWorkItem: mocks.failWorkItem,
}));
vi.mock("@/lib/ops/worker-scheduler", () => ({
  scheduleActivatedWork: mocks.scheduleActivatedWork,
}));

import { runWorkerConsumerCycle } from "@/lib/ops/worker-service";

const NOW = new Date("2026-08-02T10:00:00.000Z");
const ACTIVATION_ID = "4a62f147-aac4-4cd0-a067-5ef051d0043c";

describe("shared worker consumer activation barrier", () => {
  beforeEach(() => {
    mocks.claimWorkBatch.mockResolvedValue([
      item("item-a", 1),
      item("item-b", 2),
    ]);
    mocks.executeRegisteredHandler.mockResolvedValue({
      completion: "COMPLETED",
      handlerKey: "ops.diagnostic-effect",
      workItemId: "item-a",
    });
    mocks.failWorkItem.mockResolvedValue({ status: "PAUSED" });
    mocks.scheduleActivatedWork.mockResolvedValue({
      created: 0,
      handlerStates: [],
      replayed: 0,
    });
  });

  it("rechecks generation before every rest group and passes the configured heartbeat", async () => {
    mocks.resolvePersistedHandlerActivation
      .mockResolvedValueOnce(active(7))
      .mockResolvedValueOnce(active(7))
      .mockResolvedValueOnce({ active: false, reason: "REVOKED" });

    await expect(
      runWorkerConsumerCycle({
        database: {} as never,
        deploymentDigest: "candidate-a",
        environment: {} as never,
        now: () => NOW,
        workerId: "worker-a",
        workerRunId: "62b0bb0c-7a27-40f1-8d6a-cdc1f2010b0f",
      }),
    ).resolves.toEqual({
      claimed: 2,
      completed: 1,
      deadLettered: 0,
      leaseLost: 0,
      paused: 1,
      retried: 0,
    });

    expect(mocks.resolvePersistedHandlerActivation).toHaveBeenCalledTimes(3);
    expect(mocks.executeRegisteredHandler).toHaveBeenCalledTimes(1);
    expect(mocks.executeRegisteredHandler).toHaveBeenCalledWith(
      expect.objectContaining({ id: "item-a" }),
      expect.objectContaining({
        heartbeatMilliseconds: 777,
        leaseMilliseconds: 6_000,
      }),
    );
    expect(mocks.failWorkItem).toHaveBeenCalledTimes(1);
    expect(mocks.failWorkItem).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ workItemId: "item-b" }),
      expect.objectContaining({
        failure: {
          errorCode: "WORKER_ACTIVATION_REVOKED",
          explicitClass: "CONFIGURATION",
        },
      }),
    );
  });
});

function active(generation: number) {
  return {
    active: true,
    mode: "SANDBOX",
    policy: {
      activationId: ACTIVATION_ID,
      activationGeneration: generation,
      batchSize: 2,
      heartbeatMilliseconds: 777,
      leaseMilliseconds: 6_000,
      maxAttempts: 8,
      maxConcurrency: 1,
    },
  };
}

function item(id: string, fencingToken: number) {
  return {
    attemptNumber: 1,
    availableAt: NOW,
    dedupeKey: `dedupe:${id}`,
    effectKey: `effect:${id}`,
    fencingToken,
    handlerKey: "ops.diagnostic-effect",
    handlerVersion: "v1",
    id,
    leaseClaimedAt: NOW,
    leaseExpiresAt: new Date(NOW.getTime() + 6_000),
    leaseHandlerActivationGeneration: 7,
    leaseHandlerActivationId: ACTIVATION_ID,
    maxAttempts: 8,
    payloadReference: { effectDigest: "a".repeat(64) },
    payloadVersion: "v1",
    priority: 50,
    subjectId: id,
    subjectType: "DIAGNOSTIC",
  };
}
