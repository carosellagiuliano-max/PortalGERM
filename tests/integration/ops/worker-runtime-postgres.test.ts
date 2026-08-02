import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  claimWorkBatch,
  completeWorkItem,
  createWorkerRun,
  enqueueWorkItem,
  heartbeatWorkLease,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-27T12:00:00.000Z");
const DEPLOYMENT = "phase23-runtime-test";
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase23_worker_runtime");
  database = createDatabaseClient(migrated.connectionString);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase-23 PostgreSQL worker claims, leases and fencing", () => {
  it("lets four concurrent workers claim 100 items with zero overlap", async () => {
    const client = db();
    const handlerKey = "test.concurrent-claim";
    await Promise.all(
      Array.from({ length: 100 }, async (_, index) =>
        enqueueWorkItem(client, {
          handlerKey,
          handlerVersion: "v1",
          payloadVersion: "v1",
          subjectType: "DIAGNOSTIC",
          subjectId: `item-${index}`,
          dedupeKey: `${handlerKey}:v1:${index}`,
          effectKey: `effect:${handlerKey}:v1:${index}`,
          priority: index % 3,
          availableAt: NOW,
          payloadReference: { ordinal: index },
        }),
      ),
    );
    const runs = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        workerRun(`worker-${index}`, NOW),
      ),
    );
    const batches = await Promise.all(
      runs.map((run, index) =>
        claimWorkBatch(client, {
          deploymentDigest: DEPLOYMENT,
          handlerKey,
          handlerVersion: "v1",
          payloadVersion: "v1",
          workerId: `worker-${index}`,
          workerRunId: run.id,
          now: NOW,
          policy: { batchSize: 100 },
        }),
      ),
    );
    const claims = batches.flat();
    expect(claims).toHaveLength(100);
    expect(new Set(claims.map(({ id }) => id))).toHaveLength(100);

    const runByWorker = new Map(
      runs.map((run, index) => [`worker-${index}`, run.id]),
    );
    await Promise.all(
      batches.flatMap((batch, workerIndex) =>
        batch.map((claim) =>
          completeWorkItem(
            client,
            identity(
              claim.id,
              `worker-${workerIndex}`,
              runByWorker.get(`worker-${workerIndex}`)!,
              claim.fencingToken,
            ),
            { now: new Date(NOW.getTime() + 1_000) },
          ),
        ),
      ),
    );
    await expect(
      client.workItem.count({
        where: { handlerKey, status: "SUCCEEDED" },
      }),
    ).resolves.toBe(100);
    await expect(
      client.workAttempt.count({
        where: {
          workItem: { handlerKey },
          outcome: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(100);
  });

  it("extends only the current lease and prevents a stale fence from committing", async () => {
    const client = db();
    const handlerKey = "test.lease-takeover";
    const item = await enqueueWorkItem(client, {
      handlerKey,
      handlerVersion: "v1",
      payloadVersion: "v1",
      subjectType: "DIAGNOSTIC",
      subjectId: "lease-item",
      dedupeKey: `${handlerKey}:v1:${randomUUID()}`,
      effectKey: `effect:${handlerKey}:v1:${randomUUID()}`,
      availableAt: NOW,
      payloadReference: { kind: "lease" },
    });
    const firstRun = await workerRun("lease-worker-a", NOW);
    const [first] = await claimWorkBatch(client, {
      deploymentDigest: DEPLOYMENT,
      handlerKey,
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "lease-worker-a",
      workerRunId: firstRun.id,
      now: NOW,
      policy: {
        batchSize: 1,
        leaseMilliseconds: 6_000,
        heartbeatMilliseconds: 2_000,
      },
    });
    expect(first?.id).toBe(item.id);
    const firstIdentity = identity(
      item.id,
      "lease-worker-a",
      firstRun.id,
      first!.fencingToken,
    );
    await expect(
      heartbeatWorkLease(client, firstIdentity, {
        now: new Date(NOW.getTime() + 2_000),
        leaseMilliseconds: 6_000,
      }),
    ).resolves.toMatchObject({ extended: true });
    await expect(
      heartbeatWorkLease(
        client,
        { ...firstIdentity, fencingToken: first!.fencingToken + 1 },
        {
          now: new Date(NOW.getTime() + 2_500),
          leaseMilliseconds: 6_000,
        },
      ),
    ).resolves.toMatchObject({ extended: false });

    const takeoverAt = new Date(NOW.getTime() + 8_001);
    const secondRun = await workerRun("lease-worker-b", takeoverAt);
    const [second] = await claimWorkBatch(client, {
      deploymentDigest: DEPLOYMENT,
      handlerKey,
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "lease-worker-b",
      workerRunId: secondRun.id,
      now: takeoverAt,
      policy: {
        batchSize: 1,
        leaseMilliseconds: 6_000,
        heartbeatMilliseconds: 2_000,
      },
    });
    expect(second?.id).toBe(item.id);
    expect(second?.fencingToken).toBe(first!.fencingToken + 1);
    await expect(
      completeWorkItem(client, firstIdentity, {
        now: new Date(takeoverAt.getTime() + 1),
      }),
    ).resolves.toEqual({ status: "LEASE_LOST" });
    await expect(
      completeWorkItem(
        client,
        identity(
          item.id,
          "lease-worker-b",
          secondRun.id,
          second!.fencingToken,
        ),
        { now: new Date(takeoverAt.getTime() + 2) },
      ),
    ).resolves.toEqual({ status: "COMPLETED" });
    await expect(
      client.workAttempt.findMany({
        where: { workItemId: item.id },
        orderBy: { attemptNumber: "asc" },
        select: { attemptNumber: true, fencingToken: true, outcome: true },
      }),
    ).resolves.toEqual([
      { attemptNumber: 1, fencingToken: 1, outcome: "LEASE_LOST" },
      { attemptNumber: 2, fencingToken: 2, outcome: "SUCCEEDED" },
    ]);
  });

  it("never claims an unknown payload version and DLQs an exhausted stale lease once", async () => {
    const client = db();
    const handlerKey = "test.version-fence";
    await enqueueWorkItem(client, {
      handlerKey,
      handlerVersion: "v1",
      payloadVersion: "v2",
      subjectType: "DIAGNOSTIC",
      subjectId: "unknown-version",
      dedupeKey: `${handlerKey}:v2:${randomUUID()}`,
      effectKey: `effect:${handlerKey}:v2:${randomUUID()}`,
      availableAt: NOW,
      payloadReference: { version: 2 },
    });
    const terminal = await enqueueWorkItem(client, {
      handlerKey,
      handlerVersion: "v1",
      payloadVersion: "v1",
      subjectType: "DIAGNOSTIC",
      subjectId: "terminal-lease",
      dedupeKey: `${handlerKey}:v1:${randomUUID()}`,
      effectKey: `effect:${handlerKey}:v1:${randomUUID()}`,
      availableAt: NOW,
      maxAttempts: 1,
      payloadReference: { version: 1 },
    });
    const firstRun = await workerRun("version-worker-a", NOW);
    const first = await claimWorkBatch(client, {
      deploymentDigest: DEPLOYMENT,
      handlerKey,
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "version-worker-a",
      workerRunId: firstRun.id,
      now: NOW,
      policy: {
        batchSize: 10,
        leaseMilliseconds: 6_000,
        heartbeatMilliseconds: 2_000,
      },
    });
    expect(first.map(({ id }) => id)).toEqual([terminal.id]);

    const afterExpiry = new Date(NOW.getTime() + 6_001);
    const secondRun = await workerRun("version-worker-b", afterExpiry);
    await expect(
      claimWorkBatch(client, {
        deploymentDigest: DEPLOYMENT,
        handlerKey,
        handlerVersion: "v1",
        payloadVersion: "v1",
        workerId: "version-worker-b",
        workerRunId: secondRun.id,
        now: afterExpiry,
        policy: {
          batchSize: 10,
          leaseMilliseconds: 6_000,
          heartbeatMilliseconds: 2_000,
        },
      }),
    ).resolves.toEqual([]);
    await expect(
      client.workItem.findUniqueOrThrow({
        where: { id: terminal.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "DEAD_LETTER" });
    await expect(
      client.workDeadLetter.count({ where: { workItemId: terminal.id } }),
    ).resolves.toBe(1);
  });

  it("fences every unstarted item in a claimed batch after the activation kill switch", async () => {
    const client = db();
    const handlerKey = "test.activation-barrier";
    const activation = await client.workerHandlerActivation.create({
      data: {
        environment: "ci",
        handlerKey,
        handlerVersion: "v1",
        payloadVersion: "v1",
        mode: "SANDBOX",
        configurationDigest: "a".repeat(64),
        deploymentDigest: DEPLOYMENT,
        owner: "Platform",
        runbookRef: "codex-plan/runbooks/worker.md",
        sloRef: "codex-plan/worker-slo.md",
        evidenceDigest: "b".repeat(64),
        providerUseCase: null,
        leaseMilliseconds: 6_000,
        heartbeatMilliseconds: 2_000,
        batchSize: 3,
        maxAttempts: 8,
        maxConcurrency: 1,
        killSwitchEngaged: false,
        effectiveAt: NOW,
      },
    });
    await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        enqueueWorkItem(client, {
          handlerKey,
          handlerVersion: "v1",
          payloadVersion: "v1",
          subjectType: "DIAGNOSTIC",
          subjectId: `barrier-${index}`,
          dedupeKey: `${handlerKey}:v1:${index}`,
          effectKey: `effect:${handlerKey}:v1:${index}`,
          availableAt: NOW,
          payloadReference: { ordinal: index },
        }),
      ),
    );
    const run = await workerRun("activation-barrier-worker", NOW);
    const claimed = await claimWorkBatch(client, {
      deploymentDigest: DEPLOYMENT,
      handlerKey,
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "activation-barrier-worker",
      workerRunId: run.id,
      now: NOW,
      policy: {
        activationId: activation.id,
        activationGeneration: activation.generation,
        batchSize: 3,
        leaseMilliseconds: 6_000,
        heartbeatMilliseconds: 2_000,
      },
    });
    expect(claimed).toHaveLength(3);
    expect(claimed.every((item) => item.leaseHandlerActivationId === activation.id)).toBe(true);

    await client.workerHandlerActivation.update({
      where: { id: activation.id },
      data: {
        killSwitchEngaged: true,
        revokedAt: new Date(NOW.getTime() + 1),
        revokeReasonCode: "TEST_KILL_SWITCH",
      },
    });
    const barrierAt = new Date(NOW.getTime() + 2);
    const starts = await Promise.all(
      claimed.map((item) =>
        heartbeatWorkLease(
          client,
          identity(
            item.id,
            "activation-barrier-worker",
            run.id,
            item.fencingToken,
          ),
          { now: barrierAt, leaseMilliseconds: 6_000 },
        ),
      ),
    );

    expect(starts.every((result) => result.extended === false)).toBe(true);
    await expect(
      client.workEffectReceipt.count({
        where: { workItem: { handlerKey } },
      }),
    ).resolves.toBe(0);
    await expect(
      client.workerHandlerActivation.findUniqueOrThrow({
        where: { id: activation.id },
        select: { generation: true },
      }),
    ).resolves.toEqual({ generation: activation.generation + 1 });
  });
});

async function workerRun(workerId: string, now: Date) {
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
  workerId: string,
  workerRunId: string,
  fencingToken: number,
): WorkLeaseIdentity {
  return Object.freeze({
    workItemId,
    workerId,
    workerRunId,
    deploymentDigest: DEPLOYMENT,
    fencingToken,
  });
}

function db() {
  if (database === undefined) throw new Error("Worker test database unavailable.");
  return database;
}
