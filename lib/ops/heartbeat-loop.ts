export type HeartbeatLoop = Readonly<{
  isHealthy: () => boolean;
  stop: () => Promise<Readonly<{ healthy: boolean }>>;
}>;

/**
 * Runs one heartbeat at a time. The recursive timeout deliberately avoids
 * overlapping writes when a database/provider call takes longer than the
 * interval. Once a pulse fails, ownership is treated as lost and no further
 * pulses are scheduled.
 */
export function startHeartbeatLoop(input: Readonly<{
  heartbeat: () => Promise<boolean>;
  intervalMilliseconds: number;
  timeoutMilliseconds?: number;
}>): HeartbeatLoop {
  const timeoutMilliseconds =
    input.timeoutMilliseconds ?? input.intervalMilliseconds;
  if (
    !Number.isInteger(input.intervalMilliseconds) ||
    input.intervalMilliseconds < 10 ||
    input.intervalMilliseconds > 300_000 ||
    !Number.isInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 10 ||
    timeoutMilliseconds > 300_000
  ) {
    throw new TypeError(
      "Heartbeat interval or timeout is outside the bounded contract.",
    );
  }

  let healthy = true;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  const schedule = () => {
    if (stopped || !healthy) return;
    timer = setTimeout(() => {
      timer = null;
      running = pulse();
    }, input.intervalMilliseconds);
  };

  const pulse = async () => {
    try {
      healthy =
        (await withTimeout(input.heartbeat(), timeoutMilliseconds)) === true;
    } catch {
      healthy = false;
    } finally {
      running = null;
      schedule();
    }
  };

  schedule();

  return Object.freeze({
    isHealthy: () => healthy,
    stop: async () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await running;
      return Object.freeze({ healthy });
    },
  });
}

function withTimeout<T>(operation: Promise<T>, timeoutMilliseconds: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("HEARTBEAT_TIMEOUT")),
      timeoutMilliseconds,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
