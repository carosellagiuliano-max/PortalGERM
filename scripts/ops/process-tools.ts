import {
  spawn,
  type ChildProcessByStdio,
  type SpawnOptions,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { createLibpqEnvironment } from "@/lib/ops/recovery-contract";

type IgnoredInputChild = ChildProcessByStdio<null, Readable, Readable>;
type PipedInputChild = ChildProcessByStdio<Writable, Readable, Readable>;

export type RecoveryChild = IgnoredInputChild | PipedInputChild;

const DEFAULT_RECOVERY_TIMEOUT_MILLISECONDS = 10 * 60_000;
const TERMINATION_GRACE_MILLISECONDS = 5_000;
const SENSITIVE_ENVIRONMENT_VARIABLES = [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "SESSION_SECRET",
  "AUDIT_IP_HASH_KEYS",
  "RADAR_OPAQUE_LOOKUP_KEYS",
  "RADAR_OPAQUE_ENCRYPTION_KEYS",
  "REVEAL_CONFIRMATION_KEYS",
  "PII_REVEAL_KEYS",
  "NOTIFICATION_DELIVERY_KEYS",
  "DEV_MAILBOX_SECRET",
  "BACKUP_AGE_IDENTITY_FILE",
  "STRIPE_SECRET_KEY",
  "EMAIL_PROVIDER_API_KEY",
  "OPENAI_API_KEY",
] as const;

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
  const libpq = createLibpqEnvironment(databaseUrl);
  const mode = process.env.OPS_POSTGRES_TOOL_MODE?.trim() || "host";
  if (mode !== "host" && mode !== "docker-compose") {
    throw new Error(
      "OPS_POSTGRES_TOOL_MODE must be host or docker-compose.",
    );
  }
  const dockerMode = mode === "docker-compose";
  const options: SpawnOptions = {
    cwd: process.cwd(),
    env: {
      ...safeToolEnvironment(),
      ...libpq,
      ...(dockerMode
        ? {
            PGHOST: "127.0.0.1",
            PGPORT: "5432",
          }
        : {}),
    },
    shell: false,
    stdio: [input, "pipe", "pipe"],
    windowsHide: true,
  };

  if (dockerMode) {
    const service = process.env.OPS_POSTGRES_DOCKER_SERVICE ?? "postgres";
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/u.test(service)) {
      throw new Error("OPS_POSTGRES_DOCKER_SERVICE is invalid.");
    }
    const forwardedLibpq = Object.keys(libpq).flatMap((name) => [
      "-e",
      name,
    ]);
    return spawn(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        ...forwardedLibpq,
        service,
        tool,
        ...toolArguments,
      ],
      options,
    ) as RecoveryChild;
  }

  return spawn(tool, [...toolArguments], options) as RecoveryChild;
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
    assertSuccessfulExit(
      child.exitCode,
      child.signalCode,
      label,
      diagnostics,
    );
    return;
  }

  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit, reject) => {
    child.once("error", (error) => {
      reject(
        new Error(
          `${label} could not start: ${redact(error.message)}`,
        ),
      );
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
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 100
  ) {
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
    await Promise.allSettled(children.map(terminateRecoveryChild));
    await settlesWithin(
      Promise.allSettled(operations),
      TERMINATION_GRACE_MILLISECONDS,
    );
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function terminateRecoveryChild(child: RecoveryChild) {
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
    await terminateWindowsProcessTree(child.pid);
    await settlesWithin(closed, TERMINATION_GRACE_MILLISECONDS);
    return;
  }

  child.kill("SIGTERM");
  const stopped = await settlesWithin(
    closed,
    TERMINATION_GRACE_MILLISECONDS,
  );
  if (stopped || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGKILL");
  await settlesWithin(closed, TERMINATION_GRACE_MILLISECONDS);
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
  let redacted = value;
  for (const secret of sensitiveValues(environment)) {
    redacted = redacted.replaceAll(secret, "[REDACTED_CONFIGURED_SECRET]");
  }

  return redacted
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(
      /AGE-SECRET-KEY-[A-Z0-9-]+/gu,
      "[REDACTED_AGE_IDENTITY]",
    )
    .replaceAll(
      /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu,
      "Bearer [REDACTED]",
    )
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
    platform === "win32"
      ? (uppercasePath ?? titleCasePath)
      : uppercasePath;
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

function sensitiveValues(environment: NodeJS.ProcessEnv) {
  const values = new Set<string>();
  for (const name of SENSITIVE_ENVIRONMENT_VARIABLES) {
    const value = environment[name]?.trim();
    if (value === undefined || value.length < 8) {
      continue;
    }
    values.add(value);
    if (name.endsWith("_KEYS")) {
      for (const entry of value.split(",")) {
        const separator = entry.indexOf(":");
        if (separator >= 0) {
          const key = entry.slice(separator + 1).trim();
          if (key.length >= 8) values.add(key);
        }
      }
    }
  }
  return [...values].sort((left, right) => right.length - left.length);
}

async function terminateWindowsProcessTree(pid: number) {
  const killer = spawn(
    "taskkill",
    ["/PID", String(pid), "/T", "/F"],
    {
      cwd: process.cwd(),
      env: safeToolEnvironment(),
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const completed = new Promise<void>((resolveComplete) => {
    killer.once("error", () => resolveComplete());
    killer.once("close", () => resolveComplete());
  });
  const stopped = await settlesWithin(
    completed,
    TERMINATION_GRACE_MILLISECONDS,
  );
  if (!stopped && killer.exitCode === null && killer.signalCode === null) {
    killer.kill("SIGKILL");
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
    const timeout = setTimeout(
      () => finish(false),
      timeoutMilliseconds,
    );
    void Promise.resolve(promise).then(
      () => finish(true),
      () => finish(true),
    );
  });
}
