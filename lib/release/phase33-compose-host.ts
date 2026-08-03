export const PHASE33_CONTRACT_HOST = "127.0.0.1";
export const PHASE33_CONTRACT_HOST_HEADER = "localhost";

export type Phase33ContractHealthReceipt = Readonly<{
  headers: Readonly<Record<string, string | string[] | undefined>>;
  json: Readonly<Record<string, unknown>>;
  status: number;
}>;

type HostReadinessInput = Readonly<{
  buildId: string;
  now?: () => number;
  request: (
    path: "/health/live" | "/health/ready",
  ) => Promise<Phase33ContractHealthReceipt>;
  retryDelayMilliseconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMilliseconds?: number;
}>;

const transientTransportCodes = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

const stableMessagePrefixes = [
  "ACTION_",
  "ARGUMENT_",
  "CAPTURE_",
  "COMPOSE_",
  "DESTROY_",
  "GIT_",
  "INTERNAL_",
  "LOCAL_",
  "NO_BUILD_",
  "PHASE33_",
  "PROCESS_",
  "PRODUCTION_",
  "PROFILE_",
  "RUNTIME_",
  "SENSITIVE_",
  "SMOKE_",
] as const;

export async function waitForPhase33ContractHost(
  input: HostReadinessInput,
): Promise<void> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const retryDelayMilliseconds = input.retryDelayMilliseconds ?? 250;
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 15_000;
  if (
    !Number.isSafeInteger(retryDelayMilliseconds) ||
    retryDelayMilliseconds < 0 ||
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1
  ) {
    throw new Error("PRODUCTION_CONTRACT_HOST_RETRY_CONFIG_INVALID");
  }
  const deadline = now() + timeoutMilliseconds;
  let lastTransientFailure = "UNKNOWN_FAILURE";

  while (true) {
    try {
      const [live, ready] = await Promise.all([
        input.request("/health/live"),
        input.request("/health/ready"),
      ]);
      const transientStatus = transientHealthStatus(live, ready);
      if (transientStatus !== null) {
        lastTransientFailure = transientStatus;
      } else {
        assertHealthContract(live, ready, input.buildId);
        return;
      }
    } catch (error) {
      if (!isTransientTransportError(error)) throw error;
      lastTransientFailure = normalizePhase33ComposeError(error);
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(
        `PRODUCTION_CONTRACT_HOST_READY_TIMEOUT:${lastTransientFailure}`,
      );
    }
    await sleep(Math.min(retryDelayMilliseconds, remaining));
  }
}

export function normalizePhase33ComposeError(error: unknown): string {
  const transportCode = collectErrorCodes(error).find((candidate) =>
    transientTransportCodes.has(candidate),
  );
  if (transportCode !== undefined) return transportCode;

  if (error instanceof Error) {
    const message = stableErrorMessage(error.message);
    if (message !== null) return message;
    const name = /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
      ? error.name
      : "";
    if (name !== "" && name !== "Error" && name !== "AggregateError") {
      return name;
    }
  }
  return "UNKNOWN_FAILURE";
}

function assertHealthContract(
  live: Phase33ContractHealthReceipt,
  ready: Phase33ContractHealthReceipt,
  buildId: string,
) {
  const expectedHsts = "max-age=63072000; includeSubDomains";
  if (
    live.status !== 200 ||
    live.headers["strict-transport-security"] !== expectedHsts ||
    live.headers.server !== undefined ||
    live.json.status !== "ok" ||
    live.json.buildId !== buildId ||
    ready.status !== 200 ||
    ready.headers["strict-transport-security"] !== expectedHsts ||
    ready.json.status !== "ready"
  ) {
    throw new Error("PRODUCTION_CONTRACT_HTTPS_HEALTH_FAILED");
  }
}

function transientHealthStatus(
  live: Phase33ContractHealthReceipt,
  ready: Phase33ContractHealthReceipt,
) {
  const transient = [live.status, ready.status].filter((status) =>
    [502, 503, 504].includes(status),
  );
  return transient.length === 0
    ? null
    : `HTTP_${[...new Set(transient)].sort().join("_")}`;
}

function isTransientTransportError(error: unknown) {
  if (
    error instanceof Error &&
    error.message === "PRODUCTION_CONTRACT_HEALTH_TIMEOUT"
  ) {
    return true;
  }
  return collectErrorCodes(error).some((candidate) =>
    transientTransportCodes.has(candidate),
  );
}

function collectErrorCodes(error: unknown) {
  const codes: string[] = [];
  const visited = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    const record = value as Readonly<Record<string, unknown>>;
    if (
      typeof record.code === "string" &&
      /^E[A-Z0-9_]{1,63}$/u.test(record.code)
    ) {
      codes.push(record.code);
    }
    if (Array.isArray(record.errors)) {
      for (const nested of record.errors) visit(nested, depth + 1);
    }
    if (record.cause !== undefined) visit(record.cause, depth + 1);
  };
  visit(error, 0);
  return codes;
}

function stableErrorMessage(value: string) {
  const message = value.trim();
  if (
    message.length === 0 ||
    message.length > 1_024 ||
    !/^[A-Za-z0-9_:,.-]+$/u.test(message) ||
    !stableMessagePrefixes.some((prefix) => message.startsWith(prefix))
  ) {
    return null;
  }
  return message;
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolveWait) =>
    setTimeout(resolveWait, milliseconds),
  );
}
