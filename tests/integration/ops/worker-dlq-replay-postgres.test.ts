import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { executeRegisteredHandler } from "@/lib/ops/registered-handler-runtime";
import {
  claimWorkBatch,
  completeWorkItem,
  createWorkerRun,
  enqueueWorkItem,
  failWorkItem,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { replayDeadLetterInSandbox } from "@/lib/ops/work-replay";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-27T16:00:00.000Z");
const DEPLOYMENT = "phase23-dlq-test";
const EVIDENCE = createHash("sha256").update("phase23-replay").digest("hex");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase23_worker_dlq");
  database = createDatabaseClient(migrated.connectionString);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase-23 poison isolation, DLQ and sandbox replay", () => {
  it("terminalizes one poison item without blocking 100 healthy items", async () => {
    const client = db();
    const handlerKey = "test.poison-isolation";
    const poisonId = (
      await enqueue(handlerKey, "poison", { kind: "poison" })
    ).id;
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        enqueue(handlerKey, `healthy-${index}`, { ordinal: index }),
      ),
    );
    const run = await createRun("poison-worker", NOW);
    const claimed = await claimWorkBatch(client, {
      deploymentDigest: DEPLOYMENT,
      handlerKey,
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "poison-worker",
      workerRunId: run.id,
      now: NOW,
      policy: { batchSize: 100 },
    });
    const secondBatch = await claimWorkBatch(client, {
      deploymentDigest: DEPLOYMENT,
      handlerKey,
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "poison-worker",
      workerRunId: run.id,
      now: NOW,
      policy: { batchSize: 100 },
    });
    const all = [...claimed, ...secondBatch];
    expect(all).toHaveLength(101);
    await Promise.all(
      all.map((item) => {
        const lease = identity(
          item.id,
          run.id,
          "poison-worker",
          item.fencingToken,
        );
        return item.id === poisonId
          ? failWorkItem(client, lease, {
              now: new Date(NOW.getTime() + 100),
              failure: {
                errorCode: "POISON_PAYLOAD",
                explicitClass: "PERMANENT_VALIDATION",
              },
            })
          : completeWorkItem(client, lease, {
              now: new Date(NOW.getTime() + 100),
            });
      }),
    );
    await expect(
      client.workItem.count({
        where: { handlerKey, status: "SUCCEEDED" },
      }),
    ).resolves.toBe(100);
    await expect(
      client.workDeadLetter.count({ where: { workItemId: poisonId } }),
    ).resolves.toBe(1);
  });

  it("denies replay before resource access unless the isolated sandbox gate is exact", async () => {
    const client = db();
    const item = await enqueue("test.replay-denial", "denied", {
      effectDigest: EVIDENCE,
    });
    const run = await createRun("denial-worker", NOW);
    const [claimed] = await claimWorkBatch(client, {
      deploymentDigest: DEPLOYMENT,
      handlerKey: "test.replay-denial",
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "denial-worker",
      workerRunId: run.id,
      now: NOW,
      policy: { batchSize: 1 },
    });
    await failWorkItem(
      client,
      identity(item.id, run.id, "denial-worker", claimed!.fencingToken),
      {
        now: new Date(NOW.getTime() + 1),
        failure: {
          errorCode: "DENIED_POISON",
          explicitClass: "PERMANENT_VALIDATION",
        },
      },
    );
    const input = {
      workItemId: item.id,
      actorReference: "admin-test",
      capability: "OPS_SANDBOX_DLQ_REPLAY" as const,
      stepUpEvidenceDigest: EVIDENCE,
      reasonCode: "CONTROLLED_REPLAY",
      addedAttemptBudget: 1,
      now: new Date(NOW.getTime() + 2),
    };
    await expect(
      replayDeadLetterInSandbox(input, {
        database: client,
        environment: parseEnvironment(createValidEnvironment()),
      }),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(client.workReplayAudit.count()).resolves.toBe(0);
  });

  it("audits one authorized replay with the same effect key and no second DLQ", async () => {
    const client = db();
    const item = await enqueue("ops.diagnostic-effect", "replay", {
      effectDigest: EVIDENCE,
    });
    const firstRun = await createRun("replay-worker-a", NOW);
    const [claimed] = await claimWorkBatch(client, {
      deploymentDigest: DEPLOYMENT,
      handlerKey: "ops.diagnostic-effect",
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "replay-worker-a",
      workerRunId: firstRun.id,
      now: NOW,
      policy: { batchSize: 1 },
    });
    await failWorkItem(
      client,
      identity(
        item.id,
        firstRun.id,
        "replay-worker-a",
        claimed!.fencingToken,
      ),
      {
        now: new Date(NOW.getTime() + 1),
        failure: {
          errorCode: "CONTROLLED_POISON",
          explicitClass: "PERMANENT_VALIDATION",
        },
      },
    );
    const environment = parseEnvironment(
      createValidEnvironment({
        WORKER_RUNTIME: "sandbox_command",
        WORKER_SANDBOX_REPLAY: "true",
      }),
    );
    const replayInput = {
      workItemId: item.id,
      actorReference: "admin-test",
      capability: "OPS_SANDBOX_DLQ_REPLAY" as const,
      stepUpEvidenceDigest: EVIDENCE,
      reasonCode: "CONTROLLED_REPLAY",
      addedAttemptBudget: 1,
      now: new Date(NOW.getTime() + 2),
    };
    const replayed = await replayDeadLetterInSandbox(replayInput, {
      database: client,
      environment,
    });
    expect(replayed).toMatchObject({
      ok: true,
      effectKey: expect.stringContaining("effect:"),
      nextAttemptNumber: 2,
    });
    await expect(
      replayDeadLetterInSandbox(replayInput, { database: client, environment }),
    ).resolves.toEqual({ ok: false, code: "NOT_REPLAYABLE" });
    await expect(
      client.workReplayAudit.findMany({
        where: { workItemId: item.id },
        select: {
          effectKey: true,
          capability: true,
          priorAttemptCount: true,
          addedAttemptBudget: true,
        },
      }),
    ).resolves.toEqual([
      {
        effectKey: (replayed as { effectKey: string }).effectKey,
        capability: "OPS_SANDBOX_DLQ_REPLAY",
        priorAttemptCount: 1,
        addedAttemptBudget: 1,
      },
    ]);
    await expect(
      client.workDeadLetter.count({ where: { workItemId: item.id } }),
    ).resolves.toBe(1);
    const secondRun = await createRun(
      "replay-worker-b",
      new Date(NOW.getTime() + 3),
    );
    const [replayClaim] = await claimWorkBatch(client, {
      deploymentDigest: DEPLOYMENT,
      handlerKey: "ops.diagnostic-effect",
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "replay-worker-b",
      workerRunId: secondRun.id,
      now: new Date(NOW.getTime() + 3),
      policy: { batchSize: 1 },
    });
    await expect(
      executeRegisteredHandler(replayClaim!, {
        database: client,
        environment,
        identity: identity(
          item.id,
          secondRun.id,
          "replay-worker-b",
          replayClaim!.fencingToken,
        ),
        leaseMilliseconds: 60_000,
        now: () => new Date(NOW.getTime() + 4),
      }),
    ).resolves.toMatchObject({ completion: "COMPLETED" });
    await expect(
      client.workEffectReceipt.count({ where: { workItemId: item.id } }),
    ).resolves.toBe(1);
    await expect(
      client.workItem.findUniqueOrThrow({
        where: { id: item.id },
        select: { status: true, replayCount: true },
      }),
    ).resolves.toEqual({ status: "SUCCEEDED", replayCount: 1 });
  });
});

async function enqueue(
  handlerKey: string,
  suffix: string,
  payloadReference: Record<string, string | number>,
) {
  const nonce = randomUUID();
  return enqueueWorkItem(db(), {
    handlerKey,
    handlerVersion: "v1",
    payloadVersion: "v1",
    subjectType: "DIAGNOSTIC",
    subjectId: `${suffix}-${nonce}`,
    dedupeKey: `${handlerKey}:v1:${suffix}:${nonce}`,
    effectKey: `effect:${handlerKey}:v1:${suffix}:${nonce}`,
    availableAt: NOW,
    payloadReference,
  });
}

function createRun(workerId: string, now: Date) {
  return createWorkerRun(db(), {
    workerId,
    environment: "ci",
    deploymentDigest: DEPLOYMENT,
    runtimeVersion: "v1",
    now,
  });
}

function identity(
  workItemId: string,
  workerRunId: string,
  workerId: string,
  fencingToken: number,
): WorkLeaseIdentity {
  return {
    workItemId,
    workerRunId,
    workerId,
    deploymentDigest: DEPLOYMENT,
    fencingToken,
  };
}

function db() {
  if (database === undefined) throw new Error("DLQ test database unavailable.");
  return database;
}
