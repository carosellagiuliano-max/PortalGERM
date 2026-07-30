import { spawn } from "node:child_process";

export const PHASE32_PROCESS_TERMINATION_DEFAULTS = Object.freeze({
  windowsTaskkillDeadlineMilliseconds: 5_000,
  gracefulTerminationDeadlineMilliseconds: 5_000,
  forceKillDeadlineMilliseconds: 5_000,
});

const MAX_TIMER_DELAY_MILLISECONDS = 2_147_483_647;
const MAX_TERMINATION_GRACE_MILLISECONDS = 60_000;

export type Phase32ChildCloseListener = (
  exitCode: number | null,
  signalCode: NodeJS.Signals | null,
) => void;

/**
 * The deliberately small ChildProcess surface accepted by the release gate.
 * A real Node ChildProcess satisfies this contract, while unit tests can use
 * an EventEmitter-backed fake without starting a foreign process.
 */
export interface Phase32TerminableChild {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "close", listener: Phase32ChildCloseListener): this;
  off(event: "close", listener: Phase32ChildCloseListener): this;
}

export type Phase32WindowsTaskkillResult =
  | Readonly<{
      kind: "EXIT";
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    }>
  | Readonly<{
      kind: "ERROR";
      errorCode: string;
    }>;

export interface Phase32ProcessTerminationRuntime {
  readonly platform: NodeJS.Platform;
  readonly runWindowsTaskkill: (
    pid: number,
    abortSignal: AbortSignal,
  ) => Promise<Phase32WindowsTaskkillResult>;
  readonly signalProcessGroup: (
    pid: number,
    signal: "SIGTERM" | "SIGKILL",
  ) => void;
  readonly timers: Readonly<{
    setTimeout: (
      callback: () => void,
      milliseconds: number,
    ) => ReturnType<typeof setTimeout>;
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  }>;
}

export type Phase32ProcessTerminationRuntimeOverrides =
  Partial<Phase32ProcessTerminationRuntime>;

export type Phase32ProcessTerminationOptions = Readonly<{
  windowsTaskkillDeadlineMilliseconds?: number;
  gracefulTerminationDeadlineMilliseconds?: number;
  forceKillDeadlineMilliseconds?: number;
}>;

export type Phase32TerminationAttempt =
  | "WINDOWS_TASKKILL"
  | "PROCESS_GROUP_SIGTERM"
  | "PROCESS_GROUP_SIGKILL"
  | "CHILD_SIGTERM_FALLBACK"
  | "CHILD_SIGKILL_FALLBACK";

export type Phase32TerminationFailure =
  | "PROCESS_GROUP_SIGTERM_FAILED"
  | "PROCESS_GROUP_SIGKILL_FAILED"
  | "CHILD_SIGTERM_FAILED"
  | "CHILD_SIGKILL_FAILED";

export type Phase32TaskkillStatus =
  "NOT_ATTEMPTED" | "SUCCEEDED" | "NON_ZERO_EXIT" | "ERRORED" | "TIMED_OUT";

export type Phase32ProcessTerminationResult = Readonly<{
  outcome: "ALREADY_EXITED" | "TERMINATED" | "TERMINATION_DEADLINE_EXCEEDED";
  platform: "WINDOWS" | "POSIX";
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  taskkillStatus: Phase32TaskkillStatus;
  taskkillExitCode: number | null;
  taskkillErrorCode: string | null;
  directChildFallbackUsed: boolean;
  attempts: readonly Phase32TerminationAttempt[];
  failures: readonly Phase32TerminationFailure[];
}>;

export type Phase32ProcessWaitOptions = Phase32ProcessTerminationOptions &
  Readonly<{
    timeoutMilliseconds: number;
  }>;

export type Phase32ProcessWaitResult = Readonly<{
  status: "EXITED" | "TIMED_OUT_TERMINATED" | "TIMED_OUT_UNCONFIRMED";
  timedOut: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  termination: Phase32ProcessTerminationResult | null;
}>;

type Phase32ResolvedTerminationOptions = Readonly<{
  windowsTaskkillDeadlineMilliseconds: number;
  gracefulTerminationDeadlineMilliseconds: number;
  forceKillDeadlineMilliseconds: number;
}>;

type Phase32ChildCloseObservation = Readonly<{
  closed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}>;

type Phase32TimedTaskkillResult =
  | Readonly<{ timedOut: true }>
  | Readonly<{
      timedOut: false;
      result: Phase32WindowsTaskkillResult;
    }>;

/**
 * Waits for a command's ordinary deadline and, after it expires, owns the
 * complete bounded process-tree shutdown. This is the preferred integration
 * point for both runCommand and SBOM generation: callers never need to await a
 * second unbounded `close` promise.
 */
export async function waitForPhase32ProcessExit(
  child: Phase32TerminableChild,
  options: Phase32ProcessWaitOptions,
  runtimeOverrides: Phase32ProcessTerminationRuntimeOverrides = {},
): Promise<Phase32ProcessWaitResult> {
  const runtime = resolveRuntime(runtimeOverrides);
  const timeoutMilliseconds = requireDeadline(
    "timeoutMilliseconds",
    options.timeoutMilliseconds,
    MAX_TIMER_DELAY_MILLISECONDS,
  );
  const ordinaryExit = await waitForChildCloseWithin(
    child,
    timeoutMilliseconds,
    runtime,
  );
  if (ordinaryExit.closed) {
    return Object.freeze({
      status: "EXITED",
      timedOut: false,
      exitCode: ordinaryExit.exitCode,
      signalCode: ordinaryExit.signalCode,
      termination: null,
    });
  }

  const termination = await terminatePhase32ProcessTree(
    child,
    options,
    runtime,
  );
  return Object.freeze({
    status:
      termination.outcome === "TERMINATION_DEADLINE_EXCEEDED"
        ? "TIMED_OUT_UNCONFIRMED"
        : "TIMED_OUT_TERMINATED",
    timedOut: true,
    exitCode: termination.exitCode,
    signalCode: termination.signalCode,
    termination,
  });
}

/**
 * Terminates the complete process tree and always settles within bounded
 * grace windows, even when `taskkill` never resolves or the child never emits
 * `close`.
 */
export async function terminatePhase32ProcessTree(
  child: Phase32TerminableChild,
  options: Phase32ProcessTerminationOptions = {},
  runtimeOverrides: Phase32ProcessTerminationRuntimeOverrides = {},
): Promise<Phase32ProcessTerminationResult> {
  const runtime = resolveRuntime(runtimeOverrides);
  const resolvedOptions = resolveTerminationOptions(options);
  const attempts: Phase32TerminationAttempt[] = [];
  const failures: Phase32TerminationFailure[] = [];
  const platform = runtime.platform === "win32" ? "WINDOWS" : "POSIX";
  const initial = snapshotChild(child);

  if (initial.closed) {
    return buildTerminationResult({
      outcome: "ALREADY_EXITED",
      platform,
      observation: initial,
      attempts,
      failures,
    });
  }

  const pid = child.pid;
  if (!isUsablePid(pid)) {
    signalChild(
      child,
      "SIGKILL",
      "CHILD_SIGKILL_FALLBACK",
      "CHILD_SIGKILL_FAILED",
      attempts,
      failures,
    );
    const observation = await waitForChildCloseWithin(
      child,
      resolvedOptions.forceKillDeadlineMilliseconds,
      runtime,
    );
    return buildTerminationResult({
      outcome: observation.closed
        ? "TERMINATED"
        : "TERMINATION_DEADLINE_EXCEEDED",
      platform,
      observation,
      attempts,
      failures,
    });
  }

  if (runtime.platform === "win32") {
    return terminateWindowsProcessTree(
      child,
      pid,
      resolvedOptions,
      runtime,
      attempts,
      failures,
    );
  }

  return terminatePosixProcessTree(
    child,
    pid,
    resolvedOptions,
    runtime,
    attempts,
    failures,
  );
}

export function buildPhase32WindowsTaskkillArguments(
  pid: number,
): readonly string[] {
  if (!isUsablePid(pid)) {
    throw new Error("PHASE32_PROCESS_TERMINATION_INVALID_PID");
  }
  return Object.freeze(["/PID", String(pid), "/T", "/F"]);
}

async function terminateWindowsProcessTree(
  child: Phase32TerminableChild,
  pid: number,
  options: Phase32ResolvedTerminationOptions,
  runtime: Phase32ProcessTerminationRuntime,
  attempts: Phase32TerminationAttempt[],
  failures: Phase32TerminationFailure[],
): Promise<Phase32ProcessTerminationResult> {
  attempts.push("WINDOWS_TASKKILL");
  const taskkill = await runWindowsTaskkillWithin(
    pid,
    options.windowsTaskkillDeadlineMilliseconds,
    runtime,
  );

  let taskkillStatus: Phase32TaskkillStatus;
  let taskkillExitCode: number | null = null;
  let taskkillErrorCode: string | null = null;
  if (taskkill.timedOut) {
    taskkillStatus = "TIMED_OUT";
  } else if (taskkill.result.kind === "ERROR") {
    taskkillStatus = "ERRORED";
    taskkillErrorCode = taskkill.result.errorCode;
  } else {
    taskkillExitCode = taskkill.result.exitCode;
    taskkillStatus =
      taskkill.result.exitCode === 0 ? "SUCCEEDED" : "NON_ZERO_EXIT";
  }

  if (taskkillStatus === "SUCCEEDED") {
    const taskkillClose = await waitForChildCloseWithin(
      child,
      options.forceKillDeadlineMilliseconds,
      runtime,
    );
    if (taskkillClose.closed) {
      return buildTerminationResult({
        outcome: "TERMINATED",
        platform: "WINDOWS",
        observation: taskkillClose,
        taskkillStatus,
        taskkillExitCode,
        taskkillErrorCode,
        attempts,
        failures,
      });
    }
  }

  // A taskkill spawn error, non-zero exit, timeout, or a successful helper
  // that did not actually close the root process all require a direct,
  // awaited fallback.
  signalChild(
    child,
    "SIGKILL",
    "CHILD_SIGKILL_FALLBACK",
    "CHILD_SIGKILL_FAILED",
    attempts,
    failures,
  );
  const directClose = await waitForChildCloseWithin(
    child,
    options.forceKillDeadlineMilliseconds,
    runtime,
  );
  return buildTerminationResult({
    outcome: directClose.closed
      ? "TERMINATED"
      : "TERMINATION_DEADLINE_EXCEEDED",
    platform: "WINDOWS",
    observation: directClose,
    taskkillStatus,
    taskkillExitCode,
    taskkillErrorCode,
    attempts,
    failures,
  });
}

async function terminatePosixProcessTree(
  child: Phase32TerminableChild,
  pid: number,
  options: Phase32ResolvedTerminationOptions,
  runtime: Phase32ProcessTerminationRuntime,
  attempts: Phase32TerminationAttempt[],
  failures: Phase32TerminationFailure[],
): Promise<Phase32ProcessTerminationResult> {
  const groupTermSent = signalProcessGroup(
    pid,
    "SIGTERM",
    "PROCESS_GROUP_SIGTERM",
    "PROCESS_GROUP_SIGTERM_FAILED",
    runtime,
    attempts,
    failures,
  );
  if (!groupTermSent) {
    signalChild(
      child,
      "SIGTERM",
      "CHILD_SIGTERM_FALLBACK",
      "CHILD_SIGTERM_FAILED",
      attempts,
      failures,
    );
  }

  const gracefulClose = await waitForChildCloseWithin(
    child,
    options.gracefulTerminationDeadlineMilliseconds,
    runtime,
  );
  if (gracefulClose.closed) {
    return buildTerminationResult({
      outcome: "TERMINATED",
      platform: "POSIX",
      observation: gracefulClose,
      attempts,
      failures,
    });
  }

  const groupKillSent = signalProcessGroup(
    pid,
    "SIGKILL",
    "PROCESS_GROUP_SIGKILL",
    "PROCESS_GROUP_SIGKILL_FAILED",
    runtime,
    attempts,
    failures,
  );
  let directKillSent = false;
  if (!groupKillSent) {
    directKillSent = true;
    signalChild(
      child,
      "SIGKILL",
      "CHILD_SIGKILL_FALLBACK",
      "CHILD_SIGKILL_FAILED",
      attempts,
      failures,
    );
  }

  const groupKillClose = await waitForChildCloseWithin(
    child,
    options.forceKillDeadlineMilliseconds,
    runtime,
  );
  if (groupKillClose.closed) {
    return buildTerminationResult({
      outcome: "TERMINATED",
      platform: "POSIX",
      observation: groupKillClose,
      attempts,
      failures,
    });
  }

  // The group signal may have reached descendants but not a mis-grouped root.
  // Give the root one final direct, bounded SIGKILL before returning control.
  if (!directKillSent) {
    signalChild(
      child,
      "SIGKILL",
      "CHILD_SIGKILL_FALLBACK",
      "CHILD_SIGKILL_FAILED",
      attempts,
      failures,
    );
    const directClose = await waitForChildCloseWithin(
      child,
      options.forceKillDeadlineMilliseconds,
      runtime,
    );
    return buildTerminationResult({
      outcome: directClose.closed
        ? "TERMINATED"
        : "TERMINATION_DEADLINE_EXCEEDED",
      platform: "POSIX",
      observation: directClose,
      attempts,
      failures,
    });
  }

  return buildTerminationResult({
    outcome: "TERMINATION_DEADLINE_EXCEEDED",
    platform: "POSIX",
    observation: groupKillClose,
    attempts,
    failures,
  });
}

function signalProcessGroup(
  pid: number,
  signal: "SIGTERM" | "SIGKILL",
  attempt: Extract<
    Phase32TerminationAttempt,
    "PROCESS_GROUP_SIGTERM" | "PROCESS_GROUP_SIGKILL"
  >,
  failure: Extract<
    Phase32TerminationFailure,
    "PROCESS_GROUP_SIGTERM_FAILED" | "PROCESS_GROUP_SIGKILL_FAILED"
  >,
  runtime: Phase32ProcessTerminationRuntime,
  attempts: Phase32TerminationAttempt[],
  failures: Phase32TerminationFailure[],
): boolean {
  attempts.push(attempt);
  try {
    runtime.signalProcessGroup(pid, signal);
    return true;
  } catch {
    failures.push(failure);
    return false;
  }
}

function signalChild(
  child: Phase32TerminableChild,
  signal: "SIGTERM" | "SIGKILL",
  attempt: Extract<
    Phase32TerminationAttempt,
    "CHILD_SIGTERM_FALLBACK" | "CHILD_SIGKILL_FALLBACK"
  >,
  failure: Extract<
    Phase32TerminationFailure,
    "CHILD_SIGTERM_FAILED" | "CHILD_SIGKILL_FAILED"
  >,
  attempts: Phase32TerminationAttempt[],
  failures: Phase32TerminationFailure[],
) {
  attempts.push(attempt);
  try {
    child.kill(signal);
  } catch {
    failures.push(failure);
  }
}

function buildTerminationResult(input: {
  outcome: Phase32ProcessTerminationResult["outcome"];
  platform: Phase32ProcessTerminationResult["platform"];
  observation: Phase32ChildCloseObservation;
  taskkillStatus?: Phase32TaskkillStatus;
  taskkillExitCode?: number | null;
  taskkillErrorCode?: string | null;
  attempts: Phase32TerminationAttempt[];
  failures: Phase32TerminationFailure[];
}): Phase32ProcessTerminationResult {
  return Object.freeze({
    outcome: input.outcome,
    platform: input.platform,
    exitCode: input.observation.exitCode,
    signalCode: input.observation.signalCode,
    taskkillStatus: input.taskkillStatus ?? "NOT_ATTEMPTED",
    taskkillExitCode: input.taskkillExitCode ?? null,
    taskkillErrorCode: input.taskkillErrorCode ?? null,
    directChildFallbackUsed:
      input.attempts.includes("CHILD_SIGTERM_FALLBACK") ||
      input.attempts.includes("CHILD_SIGKILL_FALLBACK"),
    attempts: Object.freeze([...input.attempts]),
    failures: Object.freeze([...input.failures]),
  });
}

function snapshotChild(
  child: Phase32TerminableChild,
): Phase32ChildCloseObservation {
  return Object.freeze({
    closed: child.exitCode !== null || child.signalCode !== null,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
  });
}

function waitForChildCloseWithin(
  child: Phase32TerminableChild,
  milliseconds: number,
  runtime: Phase32ProcessTerminationRuntime,
): Promise<Phase32ChildCloseObservation> {
  const initial = snapshotChild(child);
  if (initial.closed) {
    return Promise.resolve(initial);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (observation: Phase32ChildCloseObservation) => {
      if (settled) {
        return;
      }
      settled = true;
      runtime.timers.clearTimeout(timeoutHandle);
      child.off("close", onClose);
      resolve(observation);
    };
    const onClose: Phase32ChildCloseListener = (exitCode, signalCode) => {
      finish(
        Object.freeze({
          closed: true,
          exitCode,
          signalCode,
        }),
      );
    };
    const timeoutHandle = runtime.timers.setTimeout(() => {
      finish(snapshotChild(child));
    }, milliseconds);

    child.once("close", onClose);
    const afterSubscription = snapshotChild(child);
    if (afterSubscription.closed) {
      finish(afterSubscription);
    }
  });
}

function runWindowsTaskkillWithin(
  pid: number,
  milliseconds: number,
  runtime: Phase32ProcessTerminationRuntime,
): Promise<Phase32TimedTaskkillResult> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (result: Phase32TimedTaskkillResult) => {
      if (settled) {
        return;
      }
      settled = true;
      runtime.timers.clearTimeout(timeoutHandle);
      resolve(result);
    };
    const timeoutHandle = runtime.timers.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Object.freeze({ timedOut: true }));
      controller.abort();
    }, milliseconds);

    Promise.resolve()
      .then(() => runtime.runWindowsTaskkill(pid, controller.signal))
      .then(
        (result) => {
          finish(Object.freeze({ timedOut: false, result }));
        },
        (error: unknown) => {
          finish(
            Object.freeze({
              timedOut: false,
              result: Object.freeze({
                kind: "ERROR",
                errorCode: safeErrorCode(error),
              }),
            }),
          );
        },
      );
  });
}

function resolveTerminationOptions(
  options: Phase32ProcessTerminationOptions,
): Phase32ResolvedTerminationOptions {
  return Object.freeze({
    windowsTaskkillDeadlineMilliseconds: requireDeadline(
      "windowsTaskkillDeadlineMilliseconds",
      options.windowsTaskkillDeadlineMilliseconds ??
        PHASE32_PROCESS_TERMINATION_DEFAULTS.windowsTaskkillDeadlineMilliseconds,
      MAX_TERMINATION_GRACE_MILLISECONDS,
    ),
    gracefulTerminationDeadlineMilliseconds: requireDeadline(
      "gracefulTerminationDeadlineMilliseconds",
      options.gracefulTerminationDeadlineMilliseconds ??
        PHASE32_PROCESS_TERMINATION_DEFAULTS.gracefulTerminationDeadlineMilliseconds,
      MAX_TERMINATION_GRACE_MILLISECONDS,
    ),
    forceKillDeadlineMilliseconds: requireDeadline(
      "forceKillDeadlineMilliseconds",
      options.forceKillDeadlineMilliseconds ??
        PHASE32_PROCESS_TERMINATION_DEFAULTS.forceKillDeadlineMilliseconds,
      MAX_TERMINATION_GRACE_MILLISECONDS,
    ),
  });
}

function requireDeadline(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(
      `PHASE32_PROCESS_TERMINATION_INVALID_${name.toUpperCase()}`,
    );
  }
  return value;
}

function isUsablePid(pid: number | undefined): pid is number {
  return (
    typeof pid === "number" &&
    Number.isSafeInteger(pid) &&
    pid > 0 &&
    pid <= 4_294_967_295
  );
}

function resolveRuntime(
  overrides: Phase32ProcessTerminationRuntimeOverrides,
): Phase32ProcessTerminationRuntime {
  return Object.freeze({
    platform: overrides.platform ?? process.platform,
    runWindowsTaskkill:
      overrides.runWindowsTaskkill ?? runWindowsTaskkillAdapter,
    signalProcessGroup:
      overrides.signalProcessGroup ??
      ((pid: number, signal: "SIGTERM" | "SIGKILL") => {
        process.kill(-pid, signal);
      }),
    timers:
      overrides.timers ??
      Object.freeze({
        setTimeout: (callback: () => void, milliseconds: number) =>
          setTimeout(callback, milliseconds),
        clearTimeout: (handle: ReturnType<typeof setTimeout>) =>
          clearTimeout(handle),
      }),
  });
}

function runWindowsTaskkillAdapter(
  pid: number,
  abortSignal: AbortSignal,
): Promise<Phase32WindowsTaskkillResult> {
  return new Promise((resolve) => {
    let helper: ReturnType<typeof spawn>;
    try {
      helper = spawn(
        "taskkill",
        [...buildPhase32WindowsTaskkillArguments(pid)],
        {
          signal: abortSignal,
          stdio: "ignore",
          windowsHide: true,
        },
      );
    } catch (error) {
      resolve(
        Object.freeze({
          kind: "ERROR",
          errorCode: safeErrorCode(error),
        }),
      );
      return;
    }

    let settled = false;
    function finish(result: Phase32WindowsTaskkillResult) {
      if (settled) {
        return;
      }
      settled = true;
      helper.off("error", onError);
      helper.off("close", onClose);
      resolve(result);
    }
    function onError(error: Error) {
      finish(
        Object.freeze({
          kind: "ERROR",
          errorCode: safeErrorCode(error),
        }),
      );
    }
    function onClose(
      exitCode: number | null,
      signalCode: NodeJS.Signals | null,
    ) {
      finish(
        Object.freeze({
          kind: "EXIT",
          exitCode,
          signalCode,
        }),
      );
    }

    helper.once("error", onError);
    helper.once("close", onClose);
  });
}

function safeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_-]{1,64}$/u.test(code)) {
      return code;
    }
  }
  return "UNKNOWN";
}
