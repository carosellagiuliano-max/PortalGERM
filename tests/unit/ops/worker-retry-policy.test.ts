import { describe, expect, it } from "vitest";

import {
  classifyWorkFailure,
  resolveWorkerRetryDecision,
} from "@/lib/ops/worker-retry-policy";

const NOW = new Date("2026-07-27T12:00:00.000Z");

describe("Phase-23 worker retry policy", () => {
  it.each([
    [408, "TIMEOUT"],
    [429, "RATE_LIMITED"],
    [500, "TRANSIENT"],
    [503, "TRANSIENT"],
    [400, "PERMANENT_CLIENT"],
    [404, "PERMANENT_CLIENT"],
  ] as const)("classifies HTTP %s as %s", (httpStatus, expected) => {
    expect(classifyWorkFailure({ errorCode: "HTTP_FAILURE", httpStatus })).toBe(
      expected,
    );
  });

  it("retries transient failures with deterministic bounded jitter", () => {
    const input = {
      attemptNumber: 2,
      maxAttempts: 8,
      dedupeKey: "notifications.dispatch:v1:42",
      failure: { errorCode: "PROVIDER_503", httpStatus: 503 },
      now: NOW,
    } as const;
    const first = resolveWorkerRetryDecision(input);
    const second = resolveWorkerRetryDecision(input);
    expect(first).toEqual(second);
    expect(first.action).toBe("RETRY");
    if (first.action === "RETRY") {
      expect(first.delayMilliseconds).toBeGreaterThanOrEqual(96_000);
      expect(first.delayMilliseconds).toBeLessThanOrEqual(144_000);
      expect(first.nextAvailableAt.getTime()).toBe(
        NOW.getTime() + first.delayMilliseconds,
      );
    }
  });

  it("terminalizes permanent and exhausted failures and pauses configuration", () => {
    expect(
      resolveWorkerRetryDecision({
        attemptNumber: 1,
        maxAttempts: 8,
        dedupeKey: "jobs.expiry:v1:42",
        failure: { errorCode: "BAD_PAYLOAD", httpStatus: 400 },
        now: NOW,
      }),
    ).toEqual({
      action: "DEAD_LETTER",
      failureClass: "PERMANENT_CLIENT",
    });
    expect(
      resolveWorkerRetryDecision({
        attemptNumber: 8,
        maxAttempts: 8,
        dedupeKey: "jobs.expiry:v1:42",
        failure: { errorCode: "UNKNOWN_FAILURE" },
        now: NOW,
      }),
    ).toEqual({ action: "DEAD_LETTER", failureClass: "UNKNOWN" });
    expect(
      resolveWorkerRetryDecision({
        attemptNumber: 1,
        maxAttempts: 8,
        dedupeKey: "jobs.expiry:v1:42",
        failure: {
          errorCode: "PROVIDER_CONFIG_MISSING",
          explicitClass: "CONFIGURATION",
        },
        now: NOW,
      }),
    ).toEqual({ action: "PAUSE", failureClass: "CONFIGURATION" });
  });
});
