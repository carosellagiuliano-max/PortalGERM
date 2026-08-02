import { afterEach, describe, expect, it, vi } from "vitest";

import { startHeartbeatLoop } from "@/lib/ops/heartbeat-loop";

afterEach(() => {
  vi.useRealTimers();
});

describe("Phase-33 non-overlapping heartbeat loop", () => {
  it("runs periodically and stops without leaving a timer behind", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn(async () => true);
    const loop = startHeartbeatLoop({
      heartbeat,
      intervalMilliseconds: 100,
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    await expect(loop.stop()).resolves.toEqual({ healthy: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it("never overlaps slow pulses and becomes unhealthy on ownership loss", async () => {
    vi.useFakeTimers();
    let resolvePulse: ((value: boolean) => void) | undefined;
    const heartbeat = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePulse = resolve;
        }),
    );
    const loop = startHeartbeatLoop({
      heartbeat,
      intervalMilliseconds: 100,
    });

    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(heartbeat).toHaveBeenCalledTimes(1);
    resolvePulse?.(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(loop.isHealthy()).toBe(false);
    await expect(loop.stop()).resolves.toEqual({ healthy: false });
    await vi.advanceTimersByTimeAsync(500);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe intervals", () => {
    expect(() =>
      startHeartbeatLoop({
        heartbeat: async () => true,
        intervalMilliseconds: 0,
      }),
    ).toThrow(TypeError);
  });
});
