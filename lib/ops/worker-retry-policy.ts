import { createHash } from "node:crypto";

import type { WorkFailureClass } from "@/lib/generated/prisma/client";

const MAXIMUM_BACKOFF_MILLISECONDS = 6 * 60 * 60 * 1_000;
const MINIMUM_BACKOFF_MILLISECONDS = 1_000;

export type WorkFailureDescriptor = Readonly<{
  errorCode: string;
  explicitClass?: WorkFailureClass;
  httpStatus?: number;
  retryAfterMilliseconds?: number;
}>;

export type WorkerRetryDecision =
  | Readonly<{
      action: "RETRY";
      failureClass: WorkFailureClass;
      nextAvailableAt: Date;
      delayMilliseconds: number;
    }>
  | Readonly<{
      action: "DEAD_LETTER";
      failureClass: WorkFailureClass;
    }>
  | Readonly<{
      action: "PAUSE";
      failureClass: "CONFIGURATION";
    }>;

export function classifyWorkFailure(
  failure: WorkFailureDescriptor,
): WorkFailureClass {
  if (failure.explicitClass !== undefined) {
    return failure.explicitClass;
  }
  if (failure.httpStatus === 408) return "TIMEOUT";
  if (failure.httpStatus === 429) return "RATE_LIMITED";
  if (
    failure.httpStatus !== undefined &&
    failure.httpStatus >= 500 &&
    failure.httpStatus <= 599
  ) {
    return "TRANSIENT";
  }
  if (
    failure.httpStatus !== undefined &&
    failure.httpStatus >= 400 &&
    failure.httpStatus <= 499
  ) {
    return "PERMANENT_CLIENT";
  }
  return "UNKNOWN";
}

export function resolveWorkerRetryDecision(input: Readonly<{
  attemptNumber: number;
  dedupeKey: string;
  failure: WorkFailureDescriptor;
  maxAttempts: number;
  now: Date;
}>): WorkerRetryDecision {
  if (
    !Number.isInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    !Number.isInteger(input.maxAttempts) ||
    input.maxAttempts < input.attemptNumber ||
    !Number.isFinite(input.now.getTime()) ||
    input.dedupeKey.length < 1 ||
    input.dedupeKey.length > 160 ||
    !/^[A-Z0-9][A-Z0-9_:-]{1,63}$/u.test(input.failure.errorCode)
  ) {
    throw new TypeError("Worker retry decision input is invalid.");
  }

  const failureClass = classifyWorkFailure(input.failure);
  if (failureClass === "CONFIGURATION") {
    return Object.freeze({ action: "PAUSE", failureClass });
  }
  if (
    failureClass === "PERMANENT_VALIDATION" ||
    failureClass === "PERMANENT_CLIENT" ||
    input.attemptNumber >= input.maxAttempts
  ) {
    return Object.freeze({ action: "DEAD_LETTER", failureClass });
  }

  const baseMilliseconds = resolveBaseDelay(failureClass, input.failure);
  const exponential = Math.min(
    MAXIMUM_BACKOFF_MILLISECONDS,
    baseMilliseconds * 2 ** Math.min(input.attemptNumber - 1, 12),
  );
  const jitterBasisPoints = deterministicJitterBasisPoints(
    input.dedupeKey,
    input.attemptNumber,
  );
  const delayMilliseconds = Math.max(
    MINIMUM_BACKOFF_MILLISECONDS,
    Math.min(
      MAXIMUM_BACKOFF_MILLISECONDS,
      Math.round((exponential * jitterBasisPoints) / 10_000),
    ),
  );

  return Object.freeze({
    action: "RETRY",
    failureClass,
    delayMilliseconds,
    nextAvailableAt: new Date(input.now.getTime() + delayMilliseconds),
  });
}

function resolveBaseDelay(
  failureClass: WorkFailureClass,
  failure: WorkFailureDescriptor,
): number {
  if (
    failureClass === "RATE_LIMITED" &&
    failure.retryAfterMilliseconds !== undefined
  ) {
    return Math.max(
      MINIMUM_BACKOFF_MILLISECONDS,
      Math.min(MAXIMUM_BACKOFF_MILLISECONDS, failure.retryAfterMilliseconds),
    );
  }
  if (failureClass === "TIMEOUT") return 30_000;
  if (failureClass === "TRANSIENT") return 60_000;
  return 120_000;
}

function deterministicJitterBasisPoints(
  dedupeKey: string,
  attemptNumber: number,
): number {
  const digest = createHash("sha256")
    .update(`${dedupeKey}\0${attemptNumber}`, "utf8")
    .digest();
  const bucket = digest.readUInt16BE(0);
  return 8_000 + (bucket % 4_001);
}
