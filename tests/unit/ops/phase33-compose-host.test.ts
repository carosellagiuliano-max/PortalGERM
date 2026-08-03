import { describe, expect, it, vi } from "vitest";

import {
  normalizePhase33ComposeError,
  PHASE33_CONTRACT_HOST,
  PHASE33_CONTRACT_HOST_HEADER,
  type Phase33ContractHealthReceipt,
  waitForPhase33ContractHost,
} from "@/lib/release/phase33-compose-host";

describe("Phase 33 Compose host readiness", () => {
  it("uses the exact IPv4 address published by the Compose contract", () => {
    expect(PHASE33_CONTRACT_HOST).toBe("127.0.0.1");
    expect(PHASE33_CONTRACT_HOST_HEADER).toBe("localhost");
  });

  it("retries a transient aggregate connection failure and then passes", async () => {
    let calls = 0;
    const request = vi.fn(async (path: "/health/live" | "/health/ready") => {
      calls += 1;
      if (calls <= 2) {
        const nested = Object.assign(new Error("not retained"), {
          code: "ECONNREFUSED",
        });
        throw new AggregateError([nested]);
      }
      return health(path);
    });

    await expect(
      waitForPhase33ContractHost({
        buildId: "candidate-sha",
        now: advancingClock(),
        request,
        retryDelayMilliseconds: 0,
        sleep: async () => undefined,
        timeoutMilliseconds: 1_000,
      }),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("fails with a non-empty bounded code when transport readiness expires", async () => {
    const nested = Object.assign(new Error("secret-canary-must-not-escape"), {
      code: "ECONNREFUSED",
    });

    await expect(
      waitForPhase33ContractHost({
        buildId: "candidate-sha",
        now: advancingClock(400),
        request: async () => {
          throw new AggregateError([nested]);
        },
        retryDelayMilliseconds: 0,
        sleep: async () => undefined,
        timeoutMilliseconds: 1_000,
      }),
    ).rejects.toThrow("PRODUCTION_CONTRACT_HOST_READY_TIMEOUT:ECONNREFUSED");
  });

  it("does not retry a deterministic HTTPS contract mismatch", async () => {
    const request = vi.fn(async (path: "/health/live" | "/health/ready") => ({
      ...health(path),
      headers: {},
    }));

    await expect(
      waitForPhase33ContractHost({
        buildId: "candidate-sha",
        request,
      }),
    ).rejects.toThrow("PRODUCTION_CONTRACT_HTTPS_HEALTH_FAILED");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("normalizes empty aggregate errors without reflecting nested messages", () => {
    const nested = Object.assign(new Error("secret-canary-must-not-escape"), {
      code: "ECONNREFUSED",
    });

    expect(normalizePhase33ComposeError(new AggregateError([nested]))).toBe(
      "ECONNREFUSED",
    );
    expect(normalizePhase33ComposeError(new Error())).toBe("UNKNOWN_FAILURE");
    expect(
      normalizePhase33ComposeError(new Error("secret-canary-must-not-escape")),
    ).toBe("UNKNOWN_FAILURE");
    expect(
      normalizePhase33ComposeError(
        new Error("PRODUCTION_CONTRACT_HTTPS_HEALTH_FAILED"),
      ),
    ).toBe("PRODUCTION_CONTRACT_HTTPS_HEALTH_FAILED");
  });
});

function health(
  path: "/health/live" | "/health/ready",
): Phase33ContractHealthReceipt {
  return {
    headers: {
      "strict-transport-security": "max-age=63072000; includeSubDomains",
    },
    json:
      path === "/health/live"
        ? { buildId: "candidate-sha", status: "ok" }
        : { status: "ready" },
    status: 200,
  };
}

function advancingClock(step = 100) {
  let value = -step;
  return () => {
    value += step;
    return value;
  };
}
