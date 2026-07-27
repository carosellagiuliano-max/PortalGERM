import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { DatabaseClient } from "@/lib/db/factory";
import {
  Prisma,
  type WorkAttemptOutcome,
  type WorkFailureClass,
} from "@/lib/generated/prisma/client";
import {
  assertWorkerIdentity,
  resolveWorkerLeasePolicy,
  type WorkerLeasePolicy,
} from "@/lib/ops/worker-lease-policy";
import {
  resolveWorkerRetryDecision,
  type WorkFailureDescriptor,
} from "@/lib/ops/worker-retry-policy";

const identifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._:-]{1,159}$/u);
const versionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u);
const subjectTypeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,63}$/u);
const subjectIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const uuidSchema = z.uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeReferenceValueSchema = z.union([
  z.string().max(255),
  z.number().finite().safe(),
  z.boolean(),
  z.null(),
]);
const payloadReferenceSchema = z
  .record(
    z.string().regex(/^[a-z][A-Za-z0-9]{0,47}$/u),
    safeReferenceValueSchema,
  )
  .refine((value) => Object.keys(value).length <= 16, {
    message: "Work payload references are limited to 16 scalar fields.",
  })
  .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 8_192, {
    message: "Work payload reference exceeds the bounded storage contract.",
  });

export type MinimalWorkPayload = z.infer<typeof payloadReferenceSchema>;

export type ClaimedWorkItem = Readonly<{
  attemptNumber: number;
  availableAt: Date;
  dedupeKey: string;
  effectKey: string;
  fencingToken: number;
  handlerKey: string;
  handlerVersion: string;
  id: string;
  leaseClaimedAt: Date;
  leaseExpiresAt: Date;
  maxAttempts: number;
  payloadReference: MinimalWorkPayload;
  payloadVersion: string;
  priority: number;
  subjectId: string;
  subjectType: string;
}>;

export type WorkLeaseIdentity = Readonly<{
  deploymentDigest: string;
  fencingToken: number;
  workerId: string;
  workerRunId: string;
  workItemId: string;
}>;

export type WorkCompletionResult =
  | Readonly<{ status: "COMPLETED" }>
  | Readonly<{ status: "LEASE_LOST" }>;

export type WorkFailureResult =
  | Readonly<{
      status: "RETRY";
      nextAvailableAt: Date;
    }>
  | Readonly<{ status: "DEAD_LETTER" | "PAUSED" | "LEASE_LOST" }>;

export async function enqueueWorkItem(
  database: DatabaseClient,
  raw: Readonly<{
    availableAt: Date;
    dedupeKey: string;
    effectKey: string;
    handlerKey: string;
    handlerVersion: string;
    maxAttempts?: number;
    payloadReference: MinimalWorkPayload;
    payloadVersion: string;
    priority?: number;
    subjectId: string;
    subjectType: string;
  }>,
) {
  const parsed = z
    .strictObject({
      availableAt: z.date(),
      dedupeKey: identifierSchema,
      effectKey: identifierSchema,
      handlerKey: identifierSchema.max(96),
      handlerVersion: versionSchema,
      maxAttempts: z.int().min(1).max(64).default(8),
      payloadReference: payloadReferenceSchema,
      payloadVersion: versionSchema,
      priority: z.int().min(0).max(100).default(50),
      subjectId: subjectIdSchema,
      subjectType: subjectTypeSchema,
    })
    .safeParse(raw);
  if (
    !parsed.success ||
    !Number.isFinite(parsed.data.availableAt.getTime())
  ) {
    throw new TypeError("Work item does not satisfy the closed queue contract.");
  }

  const payloadReference = canonicalPayload(parsed.data.payloadReference);
  const inserted = await database.workItem.createMany({
    data: [
      {
        ...parsed.data,
        payloadReference,
      },
    ],
    skipDuplicates: true,
  });
  const item = await database.workItem.findUniqueOrThrow({
    where: { dedupeKey: parsed.data.dedupeKey },
    select: {
      id: true,
      handlerKey: true,
      handlerVersion: true,
      subjectType: true,
      subjectId: true,
      effectKey: true,
      priority: true,
      availableAt: true,
      maxAttempts: true,
      payloadVersion: true,
      payloadReference: true,
      status: true,
    },
  });
  if (
    item.handlerKey !== parsed.data.handlerKey ||
    item.handlerVersion !== parsed.data.handlerVersion ||
    item.subjectType !== parsed.data.subjectType ||
    item.subjectId !== parsed.data.subjectId ||
    item.effectKey !== parsed.data.effectKey ||
    item.priority !== parsed.data.priority ||
    item.availableAt.getTime() !== parsed.data.availableAt.getTime() ||
    item.maxAttempts !== parsed.data.maxAttempts ||
    item.payloadVersion !== parsed.data.payloadVersion ||
    canonicalJson(item.payloadReference) !== canonicalJson(payloadReference)
  ) {
    throw new Error("WORK_ITEM_DEDUPE_CONFLICT");
  }
  return Object.freeze({
    created: inserted.count === 1,
    id: item.id,
    status: item.status,
  });
}

export async function createWorkerRun(
  database: DatabaseClient,
  input: Readonly<{
    deploymentDigest: string;
    environment: string;
    now: Date;
    runtimeVersion: string;
    workerId: string;
  }>,
) {
  assertWorkerIdentity(input);
  if (
    !["local", "ci", "preview", "staging", "production"].includes(
      input.environment,
    ) ||
    !versionSchema.safeParse(input.runtimeVersion).success ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError("Worker run identity is invalid.");
  }
  return database.workerRun.create({
    data: {
      workerId: input.workerId,
      environment: input.environment,
      deploymentDigest: input.deploymentDigest,
      runtimeVersion: input.runtimeVersion,
      status: "RUNNING",
      startedAt: input.now,
      heartbeatAt: input.now,
    },
  });
}

export async function heartbeatWorkerRun(
  database: DatabaseClient,
  input: Readonly<{ now: Date; workerRunId: string }>,
) {
  if (
    !uuidSchema.safeParse(input.workerRunId).success ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError("Worker run heartbeat is invalid.");
  }
  const updated = await database.workerRun.updateMany({
    where: {
      id: input.workerRunId,
      status: { in: ["STARTING", "RUNNING"] },
      stoppedAt: null,
    },
    data: { heartbeatAt: input.now, status: "RUNNING" },
  });
  return updated.count === 1;
}

export async function beginWorkerDrain(
  database: DatabaseClient,
  input: Readonly<{ now: Date; workerRunId: string }>,
) {
  const updated = await database.workerRun.updateMany({
    where: {
      id: input.workerRunId,
      status: { in: ["STARTING", "RUNNING"] },
      stoppedAt: null,
    },
    data: {
      status: "DRAINING",
      drainingAt: input.now,
      heartbeatAt: input.now,
    },
  });
  return updated.count === 1;
}

export async function finishWorkerRun(
  database: DatabaseClient,
  input: Readonly<{
    errorDigest?: string;
    now: Date;
    outcome: "CLEAN" | "DRAINED" | "LEASE_EXPIRED" | "CRASHED" | "FORCED";
    workerRunId: string;
  }>,
) {
  if (
    !uuidSchema.safeParse(input.workerRunId).success ||
    !Number.isFinite(input.now.getTime()) ||
    (input.errorDigest !== undefined &&
      !sha256Schema.safeParse(input.errorDigest).success)
  ) {
    throw new TypeError("Worker shutdown evidence is invalid.");
  }
  const failed = input.outcome === "CRASHED" || input.outcome === "FORCED";
  const updated = await database.workerRun.updateMany({
    where: { id: input.workerRunId, stoppedAt: null },
    data: {
      status: failed ? "FAILED" : "STOPPED",
      stoppedAt: input.now,
      heartbeatAt: input.now,
      shutdownOutcome: input.outcome,
      lastErrorDigest: input.errorDigest,
      ...(failed ? {} : { drainingAt: input.now }),
    },
  });
  return updated.count === 1;
}

export async function claimWorkBatch(
  database: DatabaseClient,
  input: Readonly<{
    deploymentDigest: string;
    handlerKey: string;
    handlerVersion: string;
    now: Date;
    payloadVersion: string;
    policy?: Partial<WorkerLeasePolicy>;
    workerId: string;
    workerRunId: string;
  }>,
): Promise<readonly ClaimedWorkItem[]> {
  assertWorkerIdentity(input);
  if (
    !uuidSchema.safeParse(input.workerRunId).success ||
    !versionSchema.safeParse(input.payloadVersion).success ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError("Worker claim identity is invalid.");
  }
  const policy = resolveWorkerLeasePolicy(input.policy);
  const leaseExpiresAt = new Date(
    input.now.getTime() + policy.leaseMilliseconds,
  );

  await terminalizeExpiredAttemptBudgets(database, {
    ...input,
    batchSize: policy.batchSize,
  });

  const rows = await database.$transaction(async (transaction) => {
    const claimed = await transaction.$queryRaw<ClaimedWorkItemRow[]>(
      Prisma.sql`
        WITH candidates AS MATERIALIZED (
          SELECT item.*
            FROM "WorkItem" AS item
           WHERE item."handlerKey" = ${input.handlerKey}
             AND item."handlerVersion" = ${input.handlerVersion}
             AND item."payloadVersion" = ${input.payloadVersion}
             AND item."attemptCount" < item."maxAttempts"
             AND (
               (
                 item."status" IN ('PENDING', 'RETRY')
                 AND item."availableAt" <= ${input.now}
               )
               OR (
                 item."status" = 'LEASED'
                 AND item."leaseExpiresAt" <= ${input.now}
               )
             )
           ORDER BY item."priority" DESC, item."availableAt" ASC, item."id" ASC
           FOR UPDATE SKIP LOCKED
           LIMIT ${policy.batchSize}
        ),
        lost_attempts AS (
          INSERT INTO "WorkAttempt" (
            "id",
            "workItemId",
            "workerRunId",
            "attemptNumber",
            "fencingToken",
            "workerId",
            "deploymentDigest",
            "outcome",
            "failureClass",
            "errorCode",
            "errorDigest",
            "leaseClaimedAt",
            "leaseExpiresAt",
            "startedAt",
            "completedAt",
            "createdAt"
          )
          SELECT
            gen_random_uuid(),
            candidate."id",
            candidate."leaseWorkerRunId",
            candidate."attemptCount",
            candidate."fencingToken",
            candidate."leaseOwner",
            candidate."leaseDeploymentDigest",
            'LEASE_LOST'::"WorkAttemptOutcome",
            'TIMEOUT'::"WorkFailureClass",
            'LEASE_EXPIRED',
            encode(digest('LEASE_EXPIRED', 'sha256'), 'hex'),
            candidate."leaseClaimedAt",
            candidate."leaseExpiresAt",
            candidate."leaseClaimedAt",
            ${input.now},
            ${input.now}
          FROM candidates AS candidate
          WHERE candidate."status" = 'LEASED'
          ON CONFLICT ("workItemId", "attemptNumber") DO NOTHING
        ),
        claimed AS (
          UPDATE "WorkItem" AS item
             SET "status" = 'LEASED',
                 "attemptCount" = item."attemptCount" + 1,
                 "fencingToken" = item."fencingToken" + 1,
                 "leaseOwner" = ${input.workerId},
                 "leaseWorkerRunId" = ${input.workerRunId}::uuid,
                 "leaseDeploymentDigest" = ${input.deploymentDigest},
                 "leaseClaimedAt" = ${input.now},
                 "leaseExpiresAt" = ${leaseExpiresAt},
                 "heartbeatAt" = ${input.now},
                 "updatedAt" = ${input.now}
            FROM candidates AS candidate
           WHERE item."id" = candidate."id"
          RETURNING
            item."id",
            item."handlerKey",
            item."handlerVersion",
            item."subjectType",
            item."subjectId",
            item."dedupeKey",
            item."effectKey",
            item."priority",
            item."availableAt",
            item."attemptCount",
            item."maxAttempts",
            item."payloadVersion",
            item."payloadReference",
            item."leaseClaimedAt",
            item."leaseExpiresAt",
            item."fencingToken"
        )
        SELECT *
          FROM claimed
         ORDER BY "priority" DESC, "availableAt" ASC, "id" ASC
      `,
    );
    if (claimed.length > 0) {
      await transaction.workerRun.update({
        where: { id: input.workerRunId },
        data: {
          claimedCount: { increment: claimed.length },
          heartbeatAt: input.now,
        },
      });
    }
    return claimed;
  });
  return Object.freeze(rows.map(parseClaimedWorkItem));
}

export async function heartbeatWorkLease(
  database: DatabaseClient,
  identity: WorkLeaseIdentity,
  input: Readonly<{ leaseMilliseconds: number; now: Date }>,
) {
  assertLeaseIdentity(identity);
  const policy = resolveWorkerLeasePolicy({
    leaseMilliseconds: input.leaseMilliseconds,
    heartbeatMilliseconds: Math.min(
      20_000,
      Math.floor(input.leaseMilliseconds / 3),
    ),
  });
  const leaseExpiresAt = new Date(
    input.now.getTime() + policy.leaseMilliseconds,
  );
  const updated = await database.workItem.updateMany({
    where: {
      id: identity.workItemId,
      status: "LEASED",
      leaseOwner: identity.workerId,
      leaseWorkerRunId: identity.workerRunId,
      leaseDeploymentDigest: identity.deploymentDigest,
      fencingToken: identity.fencingToken,
      leaseExpiresAt: { gt: input.now },
    },
    data: {
      heartbeatAt: input.now,
      leaseExpiresAt,
      updatedAt: input.now,
    },
  });
  return Object.freeze({
    extended: updated.count === 1,
    leaseExpiresAt: updated.count === 1 ? leaseExpiresAt : null,
  });
}

export async function recordFencedEffectReceipt(
  database: DatabaseClient,
  identity: WorkLeaseIdentity,
  input: Readonly<{
    effectDigest: string;
    handlerKey: string;
    handlerVersion: string;
    now: Date;
    providerReceiptDigest?: string;
  }>,
) {
  assertLeaseIdentity(identity);
  if (
    !sha256Schema.safeParse(input.effectDigest).success ||
    (input.providerReceiptDigest !== undefined &&
      !sha256Schema.safeParse(input.providerReceiptDigest).success)
  ) {
    throw new TypeError("Worker effect evidence must contain only SHA-256 digests.");
  }
  return database.$transaction(async (transaction) => {
    const lease = await lockCurrentLease(transaction, identity, input.now);
    if (lease === null) {
      return Object.freeze({ status: "LEASE_LOST" as const });
    }
    const existing = await transaction.workEffectReceipt.findUnique({
      where: { effectKey: lease.effectKey },
      select: {
        effectDigest: true,
        handlerKey: true,
        handlerVersion: true,
      },
    });
    if (existing !== null) {
      if (
        existing.effectDigest !== input.effectDigest ||
        existing.handlerKey !== input.handlerKey ||
        existing.handlerVersion !== input.handlerVersion
      ) {
        throw new Error("WORK_EFFECT_KEY_CONFLICT");
      }
      return Object.freeze({ status: "ALREADY_APPLIED" as const });
    }
    await transaction.workEffectReceipt.create({
      data: {
        workItemId: identity.workItemId,
        effectKey: lease.effectKey,
        handlerKey: input.handlerKey,
        handlerVersion: input.handlerVersion,
        effectDigest: input.effectDigest,
        providerReceiptDigest: input.providerReceiptDigest,
        createdAt: input.now,
      },
    });
    return Object.freeze({ status: "RECORDED" as const });
  });
}

export async function completeWorkItem(
  database: DatabaseClient,
  identity: WorkLeaseIdentity,
  input: Readonly<{
    now: Date;
    outcome?: Extract<
      WorkAttemptOutcome,
      "SUCCEEDED" | "EFFECT_ALREADY_APPLIED"
    >;
  }>,
): Promise<WorkCompletionResult> {
  assertLeaseIdentity(identity);
  return database.$transaction(async (transaction) => {
    const lease = await lockCurrentLease(transaction, identity, input.now);
    if (lease === null) {
      return Object.freeze({ status: "LEASE_LOST" as const });
    }
    const outcome = input.outcome ?? "SUCCEEDED";
    await transaction.workAttempt.create({
      data: {
        workItemId: identity.workItemId,
        workerRunId: identity.workerRunId,
        attemptNumber: lease.attemptCount,
        fencingToken: identity.fencingToken,
        workerId: identity.workerId,
        deploymentDigest: identity.deploymentDigest,
        outcome,
        leaseClaimedAt: lease.leaseClaimedAt,
        leaseExpiresAt: lease.leaseExpiresAt,
        startedAt: lease.leaseClaimedAt,
        completedAt: input.now,
        createdAt: input.now,
      },
    });
    await transaction.workItem.update({
      where: { id: identity.workItemId },
      data: clearLease({
        status: "SUCCEEDED",
        completedAt: input.now,
        updatedAt: input.now,
        lastFailureClass: null,
        lastErrorCode: null,
        lastErrorDigest: null,
      }),
    });
    await transaction.workerRun.update({
      where: { id: identity.workerRunId },
      data: {
        succeededCount: { increment: 1 },
        heartbeatAt: input.now,
      },
    });
    return Object.freeze({ status: "COMPLETED" as const });
  });
}

export async function failWorkItem(
  database: DatabaseClient,
  identity: WorkLeaseIdentity,
  input: Readonly<{
    failure: WorkFailureDescriptor;
    now: Date;
  }>,
): Promise<WorkFailureResult> {
  assertLeaseIdentity(identity);
  const errorDigest = digestWorkerError(input.failure);
  return database.$transaction(async (transaction) => {
    const lease = await lockCurrentLease(transaction, identity, input.now);
    if (lease === null) {
      return Object.freeze({ status: "LEASE_LOST" as const });
    }
    const decision = resolveWorkerRetryDecision({
      attemptNumber: lease.attemptCount,
      dedupeKey: lease.dedupeKey,
      failure: input.failure,
      maxAttempts: lease.maxAttempts,
      now: input.now,
    });
    const errorCode = input.failure.errorCode;
    if (decision.action === "RETRY") {
      await transaction.workAttempt.create({
        data: attemptData({
          identity,
          lease,
          now: input.now,
          outcome: "RETRY_SCHEDULED",
          failureClass: decision.failureClass,
          errorCode,
          errorDigest,
          nextAvailableAt: decision.nextAvailableAt,
        }),
      });
      await transaction.workItem.update({
        where: { id: identity.workItemId },
        data: clearLease({
          status: "RETRY",
          availableAt: decision.nextAvailableAt,
          updatedAt: input.now,
          lastFailureClass: decision.failureClass,
          lastErrorCode: errorCode,
          lastErrorDigest: errorDigest,
        }),
      });
      await incrementFailedRun(transaction, identity.workerRunId, input.now);
      return Object.freeze({
        status: "RETRY" as const,
        nextAvailableAt: decision.nextAvailableAt,
      });
    }
    if (decision.action === "PAUSE") {
      await transaction.workAttempt.create({
        data: attemptData({
          identity,
          lease,
          now: input.now,
          outcome: "PAUSED",
          failureClass: decision.failureClass,
          errorCode,
          errorDigest,
        }),
      });
      await transaction.workItem.update({
        where: { id: identity.workItemId },
        data: clearLease({
          status: "PAUSED",
          updatedAt: input.now,
          lastFailureClass: decision.failureClass,
          lastErrorCode: errorCode,
          lastErrorDigest: errorDigest,
        }),
      });
      await incrementFailedRun(transaction, identity.workerRunId, input.now);
      return Object.freeze({ status: "PAUSED" as const });
    }

    await transaction.workAttempt.create({
      data: attemptData({
        identity,
        lease,
        now: input.now,
        outcome: "DEAD_LETTERED",
        failureClass: decision.failureClass,
        errorCode,
        errorDigest,
      }),
    });
    await transaction.workItem.update({
      where: { id: identity.workItemId },
      data: clearLease({
        status: "DEAD_LETTER",
        deadLetteredAt: input.now,
        updatedAt: input.now,
        lastFailureClass: decision.failureClass,
        lastErrorCode: errorCode,
        lastErrorDigest: errorDigest,
      }),
    });
    await transaction.workDeadLetter.createMany({
      data: [{
          workItemId: identity.workItemId,
          terminalAttempt: lease.attemptCount,
          failureClass: decision.failureClass,
          reasonCode: errorCode,
          errorDigest,
          deploymentDigest: identity.deploymentDigest,
          createdAt: input.now,
        }],
      skipDuplicates: true,
    });
    await incrementFailedRun(transaction, identity.workerRunId, input.now);
    return Object.freeze({ status: "DEAD_LETTER" as const });
  });
}

export function digestWorkerError(failure: WorkFailureDescriptor): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        errorCode: failure.errorCode,
        explicitClass: failure.explicitClass ?? null,
        httpStatus: failure.httpStatus ?? null,
        retryAfterMilliseconds: failure.retryAfterMilliseconds ?? null,
      }),
      "utf8",
    )
    .digest("hex");
}

type ClaimedWorkItemRow = Readonly<{
  attemptCount: number;
  availableAt: Date;
  dedupeKey: string;
  effectKey: string;
  fencingToken: number;
  handlerKey: string;
  handlerVersion: string;
  id: string;
  leaseClaimedAt: Date;
  leaseExpiresAt: Date;
  maxAttempts: number;
  payloadReference: unknown;
  payloadVersion: string;
  priority: number;
  subjectId: string;
  subjectType: string;
}>;

type LockedLease = Readonly<{
  attemptCount: number;
  dedupeKey: string;
  effectKey: string;
  leaseClaimedAt: Date;
  leaseExpiresAt: Date;
  maxAttempts: number;
}>;

function parseClaimedWorkItem(row: ClaimedWorkItemRow): ClaimedWorkItem {
  return Object.freeze({
    id: row.id,
    handlerKey: row.handlerKey,
    handlerVersion: row.handlerVersion,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    dedupeKey: row.dedupeKey,
    effectKey: row.effectKey,
    priority: row.priority,
    availableAt: row.availableAt,
    attemptNumber: row.attemptCount,
    maxAttempts: row.maxAttempts,
    payloadVersion: row.payloadVersion,
    payloadReference: payloadReferenceSchema.parse(row.payloadReference),
    leaseClaimedAt: row.leaseClaimedAt,
    leaseExpiresAt: row.leaseExpiresAt,
    fencingToken: row.fencingToken,
  });
}

async function terminalizeExpiredAttemptBudgets(
  database: DatabaseClient,
  input: Readonly<{
    batchSize: number;
    deploymentDigest: string;
    handlerKey: string;
    handlerVersion: string;
    now: Date;
  }>,
) {
  await database.$executeRaw(
    Prisma.sql`
      WITH exhausted AS MATERIALIZED (
        SELECT item.*
          FROM "WorkItem" AS item
         WHERE item."handlerKey" = ${input.handlerKey}
           AND item."handlerVersion" = ${input.handlerVersion}
           AND item."status" = 'LEASED'
           AND item."leaseExpiresAt" <= ${input.now}
           AND item."attemptCount" >= item."maxAttempts"
         ORDER BY item."leaseExpiresAt" ASC, item."id" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT ${input.batchSize}
      ),
      attempts AS (
        INSERT INTO "WorkAttempt" (
          "id",
          "workItemId",
          "workerRunId",
          "attemptNumber",
          "fencingToken",
          "workerId",
          "deploymentDigest",
          "outcome",
          "failureClass",
          "errorCode",
          "errorDigest",
          "leaseClaimedAt",
          "leaseExpiresAt",
          "startedAt",
          "completedAt",
          "createdAt"
        )
        SELECT
          gen_random_uuid(),
          exhausted."id",
          exhausted."leaseWorkerRunId",
          exhausted."attemptCount",
          exhausted."fencingToken",
          exhausted."leaseOwner",
          exhausted."leaseDeploymentDigest",
          'DEAD_LETTERED'::"WorkAttemptOutcome",
          'TIMEOUT'::"WorkFailureClass",
          'LEASE_EXPIRED_MAX_ATTEMPTS',
          encode(digest('LEASE_EXPIRED_MAX_ATTEMPTS', 'sha256'), 'hex'),
          exhausted."leaseClaimedAt",
          exhausted."leaseExpiresAt",
          exhausted."leaseClaimedAt",
          ${input.now},
          ${input.now}
        FROM exhausted
        ON CONFLICT ("workItemId", "attemptNumber") DO NOTHING
        RETURNING "workItemId"
      ),
      terminal AS (
        UPDATE "WorkItem" AS item
           SET "status" = 'DEAD_LETTER',
               "leaseOwner" = NULL,
               "leaseWorkerRunId" = NULL,
               "leaseDeploymentDigest" = NULL,
               "leaseClaimedAt" = NULL,
               "leaseExpiresAt" = NULL,
               "heartbeatAt" = NULL,
               "deadLetteredAt" = ${input.now},
               "lastFailureClass" = 'TIMEOUT',
               "lastErrorCode" = 'LEASE_EXPIRED_MAX_ATTEMPTS',
               "lastErrorDigest" = encode(
                 digest('LEASE_EXPIRED_MAX_ATTEMPTS', 'sha256'),
                 'hex'
               ),
               "updatedAt" = ${input.now}
          FROM attempts
         WHERE item."id" = attempts."workItemId"
        RETURNING item."id", item."attemptCount", item."lastErrorDigest"
      )
      INSERT INTO "WorkDeadLetter" (
        "id",
        "workItemId",
        "terminalAttempt",
        "failureClass",
        "reasonCode",
        "errorDigest",
        "deploymentDigest",
        "createdAt"
      )
      SELECT
        gen_random_uuid(),
        terminal."id",
        terminal."attemptCount",
        'TIMEOUT'::"WorkFailureClass",
        'LEASE_EXPIRED_MAX_ATTEMPTS',
        terminal."lastErrorDigest",
        ${input.deploymentDigest},
        ${input.now}
      FROM terminal
      ON CONFLICT ("workItemId") DO NOTHING
    `,
  );
}

async function lockCurrentLease(
  transaction: Prisma.TransactionClient,
  identity: WorkLeaseIdentity,
  now: Date,
): Promise<LockedLease | null> {
  const rows = await transaction.$queryRaw<LockedLease[]>(
    Prisma.sql`
      SELECT
        "attemptCount",
        "dedupeKey",
        "effectKey",
        "leaseClaimedAt",
        "leaseExpiresAt",
        "maxAttempts"
      FROM "WorkItem"
      WHERE "id" = ${identity.workItemId}::uuid
        AND "status" = 'LEASED'
        AND "leaseOwner" = ${identity.workerId}
        AND "leaseWorkerRunId" = ${identity.workerRunId}::uuid
        AND "leaseDeploymentDigest" = ${identity.deploymentDigest}
        AND "fencingToken" = ${identity.fencingToken}
        AND "leaseExpiresAt" > ${now}
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

function clearLease<T extends object>(data: T) {
  return {
    ...data,
    leaseOwner: null,
    leaseWorkerRunId: null,
    leaseDeploymentDigest: null,
    leaseClaimedAt: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
  };
}

function attemptData(input: Readonly<{
  errorCode: string;
  errorDigest: string;
  failureClass: WorkFailureClass;
  identity: WorkLeaseIdentity;
  lease: LockedLease;
  nextAvailableAt?: Date;
  now: Date;
  outcome: Extract<
    WorkAttemptOutcome,
    "RETRY_SCHEDULED" | "DEAD_LETTERED" | "PAUSED"
  >;
}>) {
  return {
    workItemId: input.identity.workItemId,
    workerRunId: input.identity.workerRunId,
    attemptNumber: input.lease.attemptCount,
    fencingToken: input.identity.fencingToken,
    workerId: input.identity.workerId,
    deploymentDigest: input.identity.deploymentDigest,
    outcome: input.outcome,
    failureClass: input.failureClass,
    errorCode: input.errorCode,
    errorDigest: input.errorDigest,
    leaseClaimedAt: input.lease.leaseClaimedAt,
    leaseExpiresAt: input.lease.leaseExpiresAt,
    startedAt: input.lease.leaseClaimedAt,
    completedAt: input.now,
    nextAvailableAt: input.nextAvailableAt,
    createdAt: input.now,
  };
}

async function incrementFailedRun(
  transaction: Prisma.TransactionClient,
  workerRunId: string,
  now: Date,
) {
  await transaction.workerRun.update({
    where: { id: workerRunId },
    data: {
      failedCount: { increment: 1 },
      heartbeatAt: now,
    },
  });
}

function assertLeaseIdentity(identity: WorkLeaseIdentity) {
  assertWorkerIdentity(identity);
  if (
    !uuidSchema.safeParse(identity.workerRunId).success ||
    !uuidSchema.safeParse(identity.workItemId).success ||
    !Number.isInteger(identity.fencingToken) ||
    identity.fencingToken < 1
  ) {
    throw new TypeError("Worker lease identity is invalid.");
  }
}

function canonicalPayload(value: MinimalWorkPayload): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, item]),
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}
