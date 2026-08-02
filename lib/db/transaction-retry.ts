import { randomInt } from "node:crypto";

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS = 50;
const BASE_DELAY_MILLISECONDS = 5;
const MAX_DELAY_MILLISECONDS = 80;
const MAX_ERROR_NODES = 24;
const MAX_ERROR_DEPTH = 6;

type RetryOptions = Readonly<{
  maxAttempts?: number;
  delay?: (milliseconds: number) => Promise<void>;
  jitter?: (maximumInclusive: number) => number;
}>;

/**
 * Retries a database-only operation after a transient PostgreSQL
 * serialization/deadlock conflict. External effects must remain outside the
 * supplied operation.
 */
export async function runRetryableDatabaseOperation<TResult>(
  operation: () => Promise<TResult>,
  options: RetryOptions = {},
): Promise<TResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > MAX_ATTEMPTS
  ) {
    throw new Error("DATABASE_RETRY_ATTEMPTS_INVALID");
  }
  const delay = options.delay ?? wait;
  const jitter = options.jitter ?? secureJitter;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !isRetryableTransactionError(error) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
      const baseDelay = Math.min(
        BASE_DELAY_MILLISECONDS * 2 ** Math.min(attempt, 4),
        MAX_DELAY_MILLISECONDS,
      );
      const maximumJitter = Math.max(1, Math.floor(baseDelay / 2));
      const jitterDelay = jitter(maximumJitter);
      if (
        !Number.isSafeInteger(jitterDelay) ||
        jitterDelay < 0 ||
        jitterDelay > maximumJitter
      ) {
        throw new Error("DATABASE_RETRY_JITTER_INVALID");
      }
      await delay(baseDelay + jitterDelay);
    }
  }
  throw new Error("DATABASE_RETRY_EXHAUSTED");
}

export function isRetryableTransactionError(error: unknown): boolean {
  const { codes, messages } = collectDatabaseErrorSignals(error);
  if (["P2034", "40001", "40P01"].some((code) => codes.has(code))) {
    return true;
  }
  return /\b(?:40001|40P01)\b|could not serialize access|deadlock detected|write conflict/iu.test(
    messages.join("\n"),
  );
}

function collectDatabaseErrorSignals(error: unknown) {
  const codes = new Set<string>();
  const messages: string[] = [];
  const seen = new Set<unknown>();
  const queue: Array<Readonly<{ depth: number; value: unknown }>> = [
    { depth: 0, value: error },
  ];
  while (queue.length > 0 && seen.size < MAX_ERROR_NODES) {
    const current = queue.shift()!;
    if (
      current.depth > MAX_ERROR_DEPTH ||
      current.value === null ||
      typeof current.value !== "object" ||
      seen.has(current.value)
    ) {
      continue;
    }
    seen.add(current.value);
    const record = current.value as Readonly<Record<string, unknown>>;
    for (const key of ["code", "originalCode", "sqlState", "sqlstate"]) {
      const value = record[key];
      if (typeof value === "string" && value.length <= 32) {
        codes.add(value.toUpperCase());
      }
    }
    for (const key of ["message", "originalMessage"]) {
      const value = record[key];
      if (typeof value === "string") messages.push(value.slice(0, 2_000));
    }
    for (const key of ["cause", "meta", "driverAdapterError", "originalError"]) {
      if (record[key] !== undefined) {
        queue.push({ depth: current.depth + 1, value: record[key] });
      }
    }
  }
  return Object.freeze({ codes, messages: Object.freeze(messages) });
}

function secureJitter(maximumInclusive: number) {
  return randomInt(maximumInclusive + 1);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
