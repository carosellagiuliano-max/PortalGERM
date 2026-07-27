const SAFE_WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u;
const SAFE_HANDLER_KEY = /^[a-z0-9][a-z0-9._:-]{1,95}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;
const SAFE_DEPLOYMENT_DIGEST = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$/u;

export const DEFAULT_WORKER_LEASE_MILLISECONDS = 60_000;
export const DEFAULT_WORKER_HEARTBEAT_MILLISECONDS = 20_000;
export const DEFAULT_WORKER_BATCH_SIZE = 25;
export const MAXIMUM_WORKER_BATCH_SIZE = 100;
export const DEFAULT_WORKER_MAX_ATTEMPTS = 8;

export type WorkerLeasePolicy = Readonly<{
  batchSize: number;
  heartbeatMilliseconds: number;
  leaseMilliseconds: number;
  maxAttempts: number;
}>;

export type LeaseAuthority = Readonly<{
  fencingToken: number;
  leaseExpiresAt: Date;
  leaseOwner: string;
  status: string;
}>;

export function resolveWorkerLeasePolicy(
  input: Partial<WorkerLeasePolicy> = {},
): WorkerLeasePolicy {
  const policy = {
    batchSize: input.batchSize ?? DEFAULT_WORKER_BATCH_SIZE,
    heartbeatMilliseconds:
      input.heartbeatMilliseconds ?? DEFAULT_WORKER_HEARTBEAT_MILLISECONDS,
    leaseMilliseconds:
      input.leaseMilliseconds ?? DEFAULT_WORKER_LEASE_MILLISECONDS,
    maxAttempts: input.maxAttempts ?? DEFAULT_WORKER_MAX_ATTEMPTS,
  };
  if (
    !Number.isInteger(policy.batchSize) ||
    policy.batchSize < 1 ||
    policy.batchSize > MAXIMUM_WORKER_BATCH_SIZE
  ) {
    throw new RangeError("Worker batch size must be an integer from 1 through 100.");
  }
  if (
    !Number.isInteger(policy.leaseMilliseconds) ||
    policy.leaseMilliseconds < 5_000 ||
    policy.leaseMilliseconds > 900_000
  ) {
    throw new RangeError("Worker lease must be between 5 seconds and 15 minutes.");
  }
  if (
    !Number.isInteger(policy.heartbeatMilliseconds) ||
    policy.heartbeatMilliseconds < 1_000 ||
    policy.heartbeatMilliseconds * 3 > policy.leaseMilliseconds
  ) {
    throw new RangeError(
      "Worker heartbeat must be at least 1 second and no more than one third of the lease.",
    );
  }
  if (
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 64
  ) {
    throw new RangeError("Worker attempt budget must be an integer from 1 through 64.");
  }
  return Object.freeze(policy);
}

export function assertWorkerIdentity(input: Readonly<{
  deploymentDigest: string;
  handlerKey?: string;
  handlerVersion?: string;
  workerId: string;
}>): void {
  if (!SAFE_WORKER_ID.test(input.workerId)) {
    throw new TypeError("Worker identity is outside the closed format.");
  }
  if (!SAFE_DEPLOYMENT_DIGEST.test(input.deploymentDigest)) {
    throw new TypeError("Worker deployment digest is outside the closed format.");
  }
  if (
    input.handlerKey !== undefined &&
    !SAFE_HANDLER_KEY.test(input.handlerKey)
  ) {
    throw new TypeError("Worker handler key is outside the closed format.");
  }
  if (
    input.handlerVersion !== undefined &&
    !SAFE_VERSION.test(input.handlerVersion)
  ) {
    throw new TypeError("Worker handler version is outside the closed format.");
  }
}

export function nextFencingToken(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new RangeError("Current fencing token must be a non-negative safe integer.");
  }
  const next = current + 1;
  if (!Number.isSafeInteger(next)) {
    throw new RangeError("Worker fencing token exhausted the safe integer range.");
  }
  return next;
}

export function hasCurrentLeaseAuthority(
  lease: LeaseAuthority,
  input: Readonly<{
    fencingToken: number;
    now: Date;
    workerId: string;
  }>,
): boolean {
  return (
    lease.status === "LEASED" &&
    lease.leaseOwner === input.workerId &&
    lease.fencingToken === input.fencingToken &&
    Number.isFinite(input.now.getTime()) &&
    Number.isFinite(lease.leaseExpiresAt.getTime()) &&
    input.now.getTime() < lease.leaseExpiresAt.getTime()
  );
}

export function nextLeaseExpiry(
  now: Date,
  leaseMilliseconds: number,
): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Worker lease clock must be valid.");
  }
  const policy = resolveWorkerLeasePolicy({
    leaseMilliseconds,
    heartbeatMilliseconds: Math.min(
      DEFAULT_WORKER_HEARTBEAT_MILLISECONDS,
      Math.floor(leaseMilliseconds / 3),
    ),
  });
  return new Date(now.getTime() + policy.leaseMilliseconds);
}
