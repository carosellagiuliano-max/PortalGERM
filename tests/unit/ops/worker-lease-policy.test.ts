import { describe, expect, it } from "vitest";

import {
  hasCurrentLeaseAuthority,
  nextFencingToken,
  resolveWorkerLeasePolicy,
} from "@/lib/ops/worker-lease-policy";
import { resolveWorkerHandlerActivation } from "@/lib/ops/worker-activation-policy";
import { getWorkerHandlerDefinition } from "@/lib/ops/handler-catalog";

const NOW = new Date("2026-07-27T12:00:00.000Z");

describe("Phase-23 worker lease policy", () => {
  it("uses the bounded 60s lease, 20s heartbeat and batch <= 100 contract", () => {
    expect(resolveWorkerLeasePolicy()).toEqual({
      batchSize: 25,
      heartbeatMilliseconds: 20_000,
      leaseMilliseconds: 60_000,
      maxAttempts: 8,
    });
    expect(() => resolveWorkerLeasePolicy({ batchSize: 101 })).toThrow(
      /1 through 100/u,
    );
    expect(() =>
      resolveWorkerLeasePolicy({
        leaseMilliseconds: 60_000,
        heartbeatMilliseconds: 20_001,
      }),
    ).toThrow(/one third/u);
  });

  it("accepts only the exact unexpired owner and monotonically increasing fence", () => {
    const lease = {
      status: "LEASED",
      leaseOwner: "worker-a",
      fencingToken: 7,
      leaseExpiresAt: new Date(NOW.getTime() + 1_000),
    };
    expect(
      hasCurrentLeaseAuthority(lease, {
        workerId: "worker-a",
        fencingToken: 7,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      hasCurrentLeaseAuthority(lease, {
        workerId: "worker-a",
        fencingToken: 6,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      hasCurrentLeaseAuthority(lease, {
        workerId: "worker-a",
        fencingToken: 7,
        now: lease.leaseExpiresAt,
      }),
    ).toBe(false);
    expect(nextFencingToken(7)).toBe(8);
  });

  it("keeps execution paused without an exact environment/build activation", () => {
    const handler = getWorkerHandlerDefinition("ops.diagnostic-effect", "v1");
    expect(handler).not.toBeNull();
    const base = {
      environment: "local",
      handlerKey: "ops.diagnostic-effect",
      handlerVersion: "v1",
      payloadVersion: "v1",
      mode: "SANDBOX" as const,
      configurationDigest: "a".repeat(64),
      deploymentDigest: "build-a",
      owner: "Platform",
      runbookRef: "runbook:worker",
      sloRef: "slo:worker",
      evidenceDigest: "b".repeat(64),
      providerUseCase: null,
      leaseMilliseconds: 60_000,
      heartbeatMilliseconds: 20_000,
      batchSize: 25,
      maxAttempts: 8,
      maxConcurrency: 1,
      killSwitchEngaged: false,
      effectiveAt: NOW,
      expiresAt: null,
      revokedAt: null,
    };
    expect(
      resolveWorkerHandlerActivation({
        activation: base,
        deploymentDigest: "build-a",
        environment: "local",
        handler: handler!,
        now: NOW,
        runtimeMode: "paused",
      }),
    ).toEqual({ active: false, reason: "RUNTIME_PAUSED" });
    expect(
      resolveWorkerHandlerActivation({
        activation: base,
        deploymentDigest: "build-b",
        environment: "local",
        handler: handler!,
        now: NOW,
        runtimeMode: "sandbox_command",
      }),
    ).toEqual({ active: false, reason: "DEPLOYMENT_MISMATCH" });
  });
});
