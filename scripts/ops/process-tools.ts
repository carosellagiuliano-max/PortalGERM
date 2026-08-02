import {
  spawn,
  type ChildProcessByStdio,
  type SpawnOptions,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { createLibpqEnvironment } from "@/lib/ops/recovery-contract";
import { redactSensitiveEvidenceText } from "@/lib/security/sensitive-data-registry";

type IgnoredInputChild = ChildProcessByStdio<null, Readable, Readable>;
type PipedInputChild = ChildProcessByStdio<Writable, Readable, Readable>;

export type RecoveryChild = IgnoredInputChild | PipedInputChild;

export type PostgresToolInvocation = Readonly<{
  command: string;
  args: readonly string[];
  environment: NodeJS.ProcessEnv;
}>;

const DEFAULT_RECOVERY_TIMEOUT_MILLISECONDS = 10 * 60_000;
const TERMINATION_GRACE_MILLISECONDS = 5_000;
export function spawnPostgresTool(
  tool: "pg_dump" | "pg_restore",
  toolArguments: readonly string[],
  databaseUrl: string,
  input: "ignore",
): IgnoredInputChild;
export function spawnPostgresTool(
  tool: "pg_dump" | "pg_restore",
  toolArguments: readonly string[],
  databaseUrl: string,
  input: "pipe",
): PipedInputChild;
export function spawnPostgresTool(
  tool: "pg_dump" | "pg_restore",
  toolArguments: readonly string[],
  databaseUrl: string,
  input: "ignore" | "pipe",
): RecoveryChild {
  const invocation = resolvePostgresToolInvocation(
    tool,
    toolArguments,
    databaseUrl,
  );
  const options: SpawnOptions = {
    cwd: process.cwd(),
    env: invocation.environment,
    shell: false,
    stdio: [input, "pipe", "pipe"],
    windowsHide: true,
  };

  return spawn(
    invocation.command,
    [...invocation.args],
    options,
  ) as RecoveryChild;
}

export function resolvePostgresToolInvocation(
  tool: "pg_dump" | "pg_restore",
  toolArguments: readonly string[],
  databaseUrl: string,
  environment: NodeJS.ProcessEnv = process.env,
): PostgresToolInvocation {
  const libpq = createLibpqEnvironment(databaseUrl);
  const mode = environment.OPS_POSTGRES_TOOL_MODE?.trim() || "host";
  if (
    mode !== "host" &&
    mode !== "docker-compose" &&
    mode !== "docker-container"
  ) {
    throw new Error(
      "OPS_POSTGRES_TOOL_MODE must be host, docker-compose or docker-container.",
    );
  }
  if (mode === "host") {
    return Object.freeze({
      command: tool,
      args: Object.freeze([...toolArguments]),
      environment: Object.freeze({
        ...safeToolEnvironment(environment),
        ...libpq,
      }),
    });
  }

  const forwardedLibpq = Object.keys(libpq).flatMap((name) => ["-e", name]);
  const toolEnvironment = Object.freeze({
    ...safeToolEnvironment(environment),
    ...libpq,
    PGHOST: "127.0.0.1",
    PGPORT: "5432",
  });
  if (mode === "docker-compose") {
    const service = environment.OPS_POSTGRES_DOCKER_SERVICE ?? "postgres";
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/u.test(service)) {
      throw new Error("OPS_POSTGRES_DOCKER_SERVICE is invalid.");
    }
    return Object.freeze({
      command: "docker",
      args: Object.freeze([
        "compose",
        "exec",
        "-T",
        ...forwardedLibpq,
        service,
        tool,
        ...toolArguments,
      ]),
      environment: toolEnvironment,
    });
  }

  const container = environment.OPS_POSTGRES_DOCKER_CONTAINER?.trim();
  if (container === undefined || container === "") {
    throw new Error("OPS_POSTGRES_DOCKER_CONTAINER is required.");
  }
  if (
    !/^swisstalenthub-phase33-gate-[1-9][0-9]{0,9}-[a-f0-9]{8}$/u.test(
      container,
    )
  ) {
    throw new Error("OPS_POSTGRES_DOCKER_CONTAINER is out of scope.");
  }
  return Object.freeze({
    command: "docker",
    args: Object.freeze([
      "exec",
      "-i",
      ...forwardedLibpq,
      container,
      tool,
      ...toolArguments,
    ]),
    environment: toolEnvironment,
  });
}

export function spawnAge(
  args: readonly string[],
  input: "ignore",
): IgnoredInputChild;
export function spawnAge(
  args: readonly string[],
  input: "pipe",
): PipedInputChild;
export function spawnAge(
  args: readonly string[],
  input: "ignore" | "pipe",
): RecoveryChild {
  return spawn(resolveAgeBinary(), [...args], {
    cwd: process.cwd(),
    env: safeToolEnvironment(),
    shell: false,
    stdio: [input, "pipe", "pipe"],
    windowsHide: true,
  }) as RecoveryChild;
}

export async function waitForChild(
  child: RecoveryChild,
  label: string,
  diagnostics: () => string,
) {
  if (child.exitCode !== null || child.signalCode !== null) {
    assertSuccessfulExit(child.exitCode, child.signalCode, label, diagnostics);
    return;
  }

  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit, reject) => {
    child.once("error", (error) => {
      reject(new Error(`${label} could not start: ${redact(error.message)}`));
    });
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  assertSuccessfulExit(result.code, result.signal, label, diagnostics);
}

export async function runRecoveryOperations(
  label: string,
  children: readonly RecoveryChild[],
  operations: readonly Promise<unknown>[],
  timeoutMilliseconds = DEFAULT_RECOVERY_TIMEOUT_MILLISECONDS,
) {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 100) {
    throw new Error("Recovery operation timeout must be at least 100 ms.");
  }

  let timeout: NodeJS.Timeout | undefined;
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${String(timeoutMilliseconds)} ms.`,
        ),
      );
    }, timeoutMilliseconds);
    timeout.unref();
  });

  try {
    await Promise.race([Promise.all(operations), timeoutFailure]);
  } catch (error) {
    const terminationResults = await Promise.allSettled(
      children.map((child) => terminateRecoveryChild(child)),
    );
    await settlesWithin(
      Promise.allSettled(operations),
      TERMINATION_GRACE_MILLISECONDS,
    );
    const terminationFailure = terminationResults.find(
      (result) => result.status === "rejected",
    );
    if (terminationFailure?.status === "rejected") {
      throw new Error(
        `${label} failed and child-process termination could not be proven: ${redact(
          terminationFailure.reason instanceof Error
            ? terminationFailure.reason.message
            : "UNKNOWN_TERMINATION_FAILURE",
        )}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function terminateRecoveryChild(
  child: RecoveryChild,
  graceMilliseconds = TERMINATION_GRACE_MILLISECONDS,
) {
  if (!Number.isSafeInteger(graceMilliseconds) || graceMilliseconds < 10) {
    throw new Error("Termination grace must be at least 10 ms.");
  }
  child.stdin?.destroy();
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const closed = new Promise<void>((resolveClose) => {
    child.once("close", () => resolveClose());
    child.once("error", () => resolveClose());
  });
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (
    process.platform === "win32" &&
    child.pid !== undefined &&
    Number.isSafeInteger(child.pid) &&
    child.pid > 0
  ) {
    let treeTerminationFailure: unknown;
    try {
      await terminateWindowsProcessTree(child.pid, graceMilliseconds);
    } catch (error) {
      treeTerminationFailure = error;
    }
    const stopped = await settlesWithin(closed, graceMilliseconds);
    if (stopped || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.kill("SIGKILL");
    const forceStopped = await settlesWithin(closed, graceMilliseconds);
    if (forceStopped || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    throw new Error(
      `Recovery child process tree is still running${
        treeTerminationFailure instanceof Error
          ? `: ${redact(treeTerminationFailure.message)}`
          : "."
      }`,
    );
  }

  child.kill("SIGTERM");
  const stopped = await settlesWithin(closed, graceMilliseconds);
  if (stopped || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGKILL");
  const forceStopped = await settlesWithin(closed, graceMilliseconds);
  if (!forceStopped && child.exitCode === null && child.signalCode === null) {
    throw new Error("Recovery child process is still running.");
  }
}

export function captureDiagnostics(child: RecoveryChild) {
  let diagnostics = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-8_000);
  });
  return () => diagnostics.trim();
}

export function resolveAgeBinary() {
  const configured = process.env.AGE_BINARY?.trim();
  return configured === undefined || configured === "" ? "age" : configured;
}

export function redact(
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return redactSensitiveEvidenceText(value, environment)
    .replaceAll(
      /((?:secret|token|password|identity|authorization|cookie|pgpassword)[\w.-]*\s*[:=]\s*)[^\s,;]+/giu,
      "$1[REDACTED]",
    )
    .slice(0, 8_000);
}

export function safeToolEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const uppercasePath = environment.PATH;
  const titleCasePath = environment.Path;
  if (
    platform === "win32" &&
    uppercasePath !== undefined &&
    titleCasePath !== undefined &&
    uppercasePath !== titleCasePath
  ) {
    throw new Error(
      "Conflicting PATH and Path values cannot be forwarded safely.",
    );
  }
  const path =
    platform === "win32" ? (uppercasePath ?? titleCasePath) : uppercasePath;
  const allowed = [
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "DOCKER_CONFIG",
    "DOCKER_CONTEXT",
    "DOCKER_HOST",
    "DOCKER_CERT_PATH",
    "DOCKER_TLS_VERIFY",
    "COMPOSE_PROJECT_NAME",
    "COMPOSE_FILE",
    "XDG_CONFIG_HOME",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NPM_CONFIG_CACHE",
    "NPM_CONFIG_USERCONFIG",
    "npm_config_cache",
    "npm_config_userconfig",
    "PLAYWRIGHT_BROWSERS_PATH",
    "CI",
    "GITHUB_ACTIONS",
    "RUNNER_TEMP",
  ] as const;
  return {
    NODE_ENV: environment.NODE_ENV ?? "development",
    ...(path === undefined ? {} : { PATH: path }),
    ...Object.fromEntries(
      allowed.flatMap((name) => {
        const value = environment[name];
        return value === undefined ? [] : [[name, value]];
      }),
    ),
  };
}

function assertSuccessfulExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  label: string,
  diagnostics: () => string,
) {
  if (code !== 0) {
    throw new Error(
      `${label} failed (code ${String(code)}, signal ${String(signal)}): ${redact(diagnostics())}`,
    );
  }
}

async function terminateWindowsProcessTree(
  pid: number,
  graceMilliseconds: number,
) {
  const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
    cwd: process.cwd(),
    env: safeToolEnvironment(),
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const completed = new Promise<{ code: number | null; failed: boolean }>(
    (resolveComplete) => {
      killer.once("error", () => resolveComplete({ code: null, failed: true }));
      killer.once("close", (code) =>
        resolveComplete({ code, failed: code !== 0 }),
      );
    },
  );
  const result = await Promise.race([
    completed,
    new Promise<null>((resolveTimeout) => {
      const timeout = setTimeout(() => resolveTimeout(null), graceMilliseconds);
      timeout.unref();
    }),
  ]);
  if (result === null) {
    if (killer.exitCode === null && killer.signalCode === null) {
      killer.kill("SIGKILL");
    }
    throw new Error("Windows process-tree termination timed out.");
  }
  if (result.failed) {
    throw new Error(
      `Windows process-tree termination failed with code ${String(result.code)}.`,
    );
  }
}

function settlesWithin(
  promise: PromiseLike<unknown>,
  timeoutMilliseconds: number,
) {
  return new Promise<boolean>((resolveResult) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const timeout = setTimeout(() => finish(false), timeoutMilliseconds);
    void Promise.resolve(promise).then(
      () => finish(true),
      () => finish(true),
    );
  });
}
