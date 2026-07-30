import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildPhase32WindowsTaskkillArguments,
  terminatePhase32ProcessTree,
  waitForPhase32ProcessExit,
  type Phase32ChildCloseListener,
  type Phase32ProcessTerminationOptions,
  type Phase32ProcessTerminationRuntimeOverrides,
  type Phase32TerminableChild,
  type Phase32WindowsTaskkillResult,
} from "@/lib/release/phase32-process-termination";

const SHORT_DEADLINES = Object.freeze({
  windowsTaskkillDeadlineMilliseconds: 10,
  gracefulTerminationDeadlineMilliseconds: 10,
  forceKillDeadlineMilliseconds: 10,
}) satisfies Phase32ProcessTerminationOptions;

describe("Phase 32 process timeout and termination", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the exact Windows tree-force taskkill arguments", () => {
    expect(buildPhase32WindowsTaskkillArguments(31415)).toEqual([
      "/PID",
      "31415",
      "/T",
      "/F",
    ]);
    expect(() => buildPhase32WindowsTaskkillArguments(0)).toThrow(
      "PHASE32_PROCESS_TERMINATION_INVALID_PID",
    );
  });

  it("does nothing when the child has already exited", async () => {
    const child = new FakeChild(123);
    child.close(0, null);
    const taskkill = vi.fn();
    const signalProcessGroup = vi.fn();

    const result = await terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      windowsRuntime(taskkill, signalProcessGroup),
    );

    expect(result).toMatchObject({
      outcome: "ALREADY_EXITED",
      taskkillStatus: "NOT_ATTEMPTED",
      attempts: [],
    });
    expect(taskkill).not.toHaveBeenCalled();
    expect(signalProcessGroup).not.toHaveBeenCalled();
    expect(child.killSignals).toEqual([]);
  });

  it("awaits taskkill and falls back after a non-zero exit", async () => {
    const child = new FakeChild(456, ["SIGKILL"]);
    let resolveTaskkill:
      ((result: Phase32WindowsTaskkillResult) => void) | undefined;
    const taskkillPromise = new Promise<Phase32WindowsTaskkillResult>(
      (resolve) => {
        resolveTaskkill = resolve;
      },
    );
    const taskkill = vi.fn(() => taskkillPromise);

    const pending = terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      windowsRuntime(taskkill),
    );
    await flushMicrotasks();

    expect(taskkill).toHaveBeenCalledOnce();
    expect(child.killSignals).toEqual([]);

    resolveTaskkill?.(taskkillExit(5));
    const result = await pending;

    expect(result).toMatchObject({
      outcome: "TERMINATED",
      taskkillStatus: "NON_ZERO_EXIT",
      taskkillExitCode: 5,
      directChildFallbackUsed: true,
      attempts: ["WINDOWS_TASKKILL", "CHILD_SIGKILL_FALLBACK"],
    });
    expect(child.killSignals).toEqual(["SIGKILL"]);
  });

  it("falls back after a taskkill spawn error without leaking the message", async () => {
    const child = new FakeChild(789, ["SIGKILL"]);
    const error = Object.assign(new Error("sensitive local path"), {
      code: "EACCES",
    });

    const result = await terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      windowsRuntime(() => Promise.reject(error)),
    );

    expect(result).toMatchObject({
      outcome: "TERMINATED",
      taskkillStatus: "ERRORED",
      taskkillErrorCode: "EACCES",
      directChildFallbackUsed: true,
    });
    expect(JSON.stringify(result)).not.toContain("sensitive local path");
    expect(child.killSignals).toEqual(["SIGKILL"]);
  });

  it("aborts a never-settling taskkill and uses the direct fallback", async () => {
    const child = new FakeChild(901, ["SIGKILL"]);
    let taskkillSignal: AbortSignal | undefined;
    const pending = terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      windowsRuntime((_pid, signal) => {
        taskkillSignal = signal;
        return new Promise<Phase32WindowsTaskkillResult>(() => undefined);
      }),
    );

    const result = await settleWithAllDeadlines(pending);

    expect(taskkillSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      outcome: "TERMINATED",
      taskkillStatus: "TIMED_OUT",
      directChildFallbackUsed: true,
    });
    expect(child.killSignals).toEqual(["SIGKILL"]);
  });

  it("uses a direct fallback when taskkill exits zero but the child never closes", async () => {
    const child = new FakeChild(902, ["SIGKILL"]);
    const pending = terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      windowsRuntime(() => Promise.resolve(taskkillExit(0))),
    );

    const result = await settleWithAllDeadlines(pending);

    expect(result).toMatchObject({
      outcome: "TERMINATED",
      taskkillStatus: "SUCCEEDED",
      directChildFallbackUsed: true,
      attempts: ["WINDOWS_TASKKILL", "CHILD_SIGKILL_FALLBACK"],
    });
    expect(child.killSignals).toEqual(["SIGKILL"]);
  });

  it("returns a deadline result when neither taskkill nor direct kill closes the child", async () => {
    const child = new FakeChild(903);
    const pending = terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      windowsRuntime(() => Promise.resolve(taskkillExit(0))),
    );

    const result = await settleWithAllDeadlines(pending);

    expect(result).toMatchObject({
      outcome: "TERMINATION_DEADLINE_EXCEEDED",
      taskkillStatus: "SUCCEEDED",
      directChildFallbackUsed: true,
    });
    expect(child.killSignals).toEqual(["SIGKILL"]);
  });

  it("sends POSIX process-group TERM and stops when the child closes", async () => {
    const child = new FakeChild(1001);
    const groupSignals: NodeJS.Signals[] = [];

    const result = await terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      posixRuntime((_pid, signal) => {
        groupSignals.push(signal);
        child.close(null, signal);
      }),
    );

    expect(groupSignals).toEqual(["SIGTERM"]);
    expect(child.killSignals).toEqual([]);
    expect(result).toMatchObject({
      outcome: "TERMINATED",
      platform: "POSIX",
      attempts: ["PROCESS_GROUP_SIGTERM"],
    });
  });

  it("escalates a POSIX process group from TERM to KILL", async () => {
    const child = new FakeChild(1002);
    const groupSignals: NodeJS.Signals[] = [];
    const pending = terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      posixRuntime((_pid, signal) => {
        groupSignals.push(signal);
        if (signal === "SIGKILL") {
          child.close(null, signal);
        }
      }),
    );

    const result = await settleWithAllDeadlines(pending);

    expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.killSignals).toEqual([]);
    expect(result).toMatchObject({
      outcome: "TERMINATED",
      attempts: ["PROCESS_GROUP_SIGTERM", "PROCESS_GROUP_SIGKILL"],
    });
  });

  it("uses a bounded direct POSIX backstop when the process group never closes", async () => {
    const child = new FakeChild(1003);
    const groupSignals: NodeJS.Signals[] = [];
    const pending = terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      posixRuntime((_pid, signal) => {
        groupSignals.push(signal);
      }),
    );

    const result = await settleWithAllDeadlines(pending);

    expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.killSignals).toEqual(["SIGKILL"]);
    expect(result).toMatchObject({
      outcome: "TERMINATION_DEADLINE_EXCEEDED",
      directChildFallbackUsed: true,
      attempts: [
        "PROCESS_GROUP_SIGTERM",
        "PROCESS_GROUP_SIGKILL",
        "CHILD_SIGKILL_FALLBACK",
      ],
    });
  });

  it("falls back to the root child when POSIX group signalling fails", async () => {
    const child = new FakeChild(1004, ["SIGTERM"]);
    const result = await terminatePhase32ProcessTree(
      child,
      SHORT_DEADLINES,
      posixRuntime(() => {
        throw new Error("ESRCH");
      }),
    );

    expect(child.killSignals).toEqual(["SIGTERM"]);
    expect(result).toMatchObject({
      outcome: "TERMINATED",
      attempts: ["PROCESS_GROUP_SIGTERM", "CHILD_SIGTERM_FALLBACK"],
      failures: ["PROCESS_GROUP_SIGTERM_FAILED"],
    });
  });

  it("returns a normal wait result when close arrives before the command deadline", async () => {
    const child = new FakeChild(1101);
    const pending = waitForPhase32ProcessExit(
      child,
      {
        ...SHORT_DEADLINES,
        timeoutMilliseconds: 100,
      },
      windowsRuntime(() => Promise.resolve(taskkillExit(0))),
    );

    child.close(0, null);
    const result = await pending;

    expect(result).toEqual({
      status: "EXITED",
      timedOut: false,
      exitCode: 0,
      signalCode: null,
      termination: null,
    });
  });

  it("returns after all fixed deadlines even if command, taskkill, and child never close", async () => {
    const child = new FakeChild(1102);
    const pending = waitForPhase32ProcessExit(
      child,
      {
        ...SHORT_DEADLINES,
        timeoutMilliseconds: 10,
      },
      windowsRuntime(
        () => new Promise<Phase32WindowsTaskkillResult>(() => undefined),
      ),
    );

    const result = await settleWithAllDeadlines(pending);

    expect(result).toMatchObject({
      status: "TIMED_OUT_UNCONFIRMED",
      timedOut: true,
      exitCode: null,
      signalCode: null,
      termination: {
        outcome: "TERMINATION_DEADLINE_EXCEEDED",
        taskkillStatus: "TIMED_OUT",
      },
    });
    expect(child.killSignals).toEqual(["SIGKILL"]);
  });
});

class FakeChild implements Phase32TerminableChild {
  readonly pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly killSignals: (NodeJS.Signals | number | undefined)[] = [];
  private readonly closeOnSignals: ReadonlySet<NodeJS.Signals>;
  private readonly closeListeners = new Set<Phase32ChildCloseListener>();

  constructor(
    pid: number | undefined,
    closeOnSignals: readonly NodeJS.Signals[] = [],
  ) {
    this.pid = pid;
    this.closeOnSignals = new Set(closeOnSignals);
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    if (
      typeof signal === "string" &&
      this.closeOnSignals.has(signal as NodeJS.Signals)
    ) {
      this.close(null, signal as NodeJS.Signals);
    }
    return true;
  }

  once(event: "close", listener: Phase32ChildCloseListener): this {
    expect(event).toBe("close");
    this.closeListeners.add(listener);
    return this;
  }

  off(event: "close", listener: Phase32ChildCloseListener): this {
    expect(event).toBe("close");
    this.closeListeners.delete(listener);
    return this;
  }

  close(exitCode: number | null, signalCode: NodeJS.Signals | null) {
    this.exitCode = exitCode;
    this.signalCode = signalCode;
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const listener of listeners) {
      listener(exitCode, signalCode);
    }
  }
}

function windowsRuntime(
  runWindowsTaskkill: NonNullable<
    Phase32ProcessTerminationRuntimeOverrides["runWindowsTaskkill"]
  >,
  signalProcessGroup: NonNullable<
    Phase32ProcessTerminationRuntimeOverrides["signalProcessGroup"]
  > = () => undefined,
): Phase32ProcessTerminationRuntimeOverrides {
  return {
    platform: "win32",
    runWindowsTaskkill,
    signalProcessGroup,
  };
}

function posixRuntime(
  signalProcessGroup: NonNullable<
    Phase32ProcessTerminationRuntimeOverrides["signalProcessGroup"]
  >,
): Phase32ProcessTerminationRuntimeOverrides {
  return {
    platform: "linux",
    runWindowsTaskkill: () => Promise.resolve(taskkillExit(0)),
    signalProcessGroup,
  };
}

function taskkillExit(exitCode: number): Phase32WindowsTaskkillResult {
  return Object.freeze({
    kind: "EXIT",
    exitCode,
    signalCode: null,
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function settleWithAllDeadlines<T>(pending: Promise<T>): Promise<T> {
  for (let index = 0; index < 12; index += 1) {
    await flushMicrotasks();
    if (vi.getTimerCount() > 0) {
      await vi.runOnlyPendingTimersAsync();
    }
  }
  return pending;
}
