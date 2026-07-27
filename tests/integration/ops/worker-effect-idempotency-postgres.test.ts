import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createValidEnvironment } from "@/tests/fixtures/environment";
import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { executeRegisteredHandler } from "@/lib/ops/registered-handler-runtime";
import {
  claimWorkBatch,
  createWorkerRun,
  enqueueWorkItem,
  recordFencedEffectReceipt,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-27T14:00:00.000Z");
const EFFECT_DIGEST = createHash("sha256")
  .update("phase23-diagnostic-effect")
  .digest("hex");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase23_worker_effects");
  database = createDatabaseClient(migrated.connectionString);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase-23 crash-boundary effect idempotency", () => {
  it("recovers a crash after effect and before ack with one effect receipt", async () => {
    const client = db();
    const item = await diagnostic("after-effect");
    const firstRun = await run("effect-worker-a", "build-a", NOW);
    const [first] = await claim(client, item.id, firstRun.id, "effect-worker-a", "build-a", NOW);
    const firstIdentity = identity(
      item.id,
      firstRun.id,
      "effect-worker-a",
      "build-a",
      first!.fencingToken,
    );
    await expect(
      recordFencedEffectReceipt(client, firstIdentity, {
        handlerKey: "ops.diagnostic-effect",
        handlerVersion: "v1",
        effectDigest: EFFECT_DIGEST,
        now: new Date(NOW.getTime() + 100),
      }),
    ).resolves.toEqual({ status: "RECORDED" });

    const takeoverAt = new Date(NOW.getTime() + 6_001);
    const secondRun = await run(
      "effect-worker-b",
      "build-b",
      takeoverAt,
    );
    const [second] = await claim(
      client,
      item.id,
      secondRun.id,
      "effect-worker-b",
      "build-b",
      takeoverAt,
    );
    const completed = await executeRegisteredHandler(second!, {
      database: client,
      environment: environment(),
      identity: identity(
        item.id,
        secondRun.id,
        "effect-worker-b",
        "build-b",
        second!.fencingToken,
      ),
      leaseMilliseconds: 6_000,
      now: () => new Date(takeoverAt.getTime() + 100),
    });
    expect(completed.completion).toBe("COMPLETED");
    await expect(
      client.workEffectReceipt.count({ where: { workItemId: item.id } }),
    ).resolves.toBe(1);
    await expect(
      client.workAttempt.findMany({
        where: { workItemId: item.id },
        orderBy: { attemptNumber: "asc" },
        select: { outcome: true },
      }),
    ).resolves.toEqual([
      { outcome: "LEASE_LOST" },
      { outcome: "EFFECT_ALREADY_APPLIED" },
    ]);
  });

  it("recovers a crash before effect and writes the effect exactly once", async () => {
    const client = db();
    const item = await diagnostic("before-effect");
    const firstRun = await run("before-worker-a", "build-a", NOW);
    await claim(client, item.id, firstRun.id, "before-worker-a", "build-a", NOW);

    const takeoverAt = new Date(NOW.getTime() + 6_001);
    const secondRun = await run(
      "before-worker-b",
      "build-b",
      takeoverAt,
    );
    const [second] = await claim(
      client,
      item.id,
      secondRun.id,
      "before-worker-b",
      "build-b",
      takeoverAt,
    );
    await expect(
      executeRegisteredHandler(second!, {
        database: client,
        environment: environment(),
        identity: identity(
          item.id,
          secondRun.id,
          "before-worker-b",
          "build-b",
          second!.fencingToken,
        ),
        leaseMilliseconds: 6_000,
        now: () => new Date(takeoverAt.getTime() + 100),
      }),
    ).resolves.toMatchObject({ completion: "COMPLETED" });
    await expect(
      client.workEffectReceipt.count({ where: { workItemId: item.id } }),
    ).resolves.toBe(1);
  });
});

async function diagnostic(suffix: string) {
  const key = `${suffix}-${randomUUID()}`;
  return enqueueWorkItem(db(), {
    handlerKey: "ops.diagnostic-effect",
    handlerVersion: "v1",
    payloadVersion: "v1",
    subjectType: "DIAGNOSTIC",
    subjectId: key,
    dedupeKey: `ops.diagnostic-effect:v1:${key}`,
    effectKey: `effect:ops.diagnostic-effect:v1:${key}`,
    availableAt: NOW,
    payloadReference: { effectDigest: EFFECT_DIGEST },
  });
}

async function run(
  workerId: string,
  deploymentDigest: string,
  now: Date,
) {
  return createWorkerRun(db(), {
    workerId,
    environment: "ci",
    deploymentDigest,
    runtimeVersion: "v1",
    now,
  });
}

async function claim(
  client: DatabaseClient,
  expectedId: string,
  workerRunId: string,
  workerId: string,
  deploymentDigest: string,
  now: Date,
) {
  const items = await claimWorkBatch(client, {
    deploymentDigest,
    handlerKey: "ops.diagnostic-effect",
    handlerVersion: "v1",
    payloadVersion: "v1",
    workerId,
    workerRunId,
    now,
    policy: {
      batchSize: 1,
      leaseMilliseconds: 6_000,
      heartbeatMilliseconds: 2_000,
    },
  });
  expect(items[0]?.id).toBe(expectedId);
  return items;
}

function identity(
  workItemId: string,
  workerRunId: string,
  workerId: string,
  deploymentDigest: string,
  fencingToken: number,
): WorkLeaseIdentity {
  return {
    workItemId,
    workerRunId,
    workerId,
    deploymentDigest,
    fencingToken,
  };
}

function environment() {
  return parseEnvironment(
    createValidEnvironment({
      WORKER_RUNTIME: "sandbox_command",
    }),
  );
}

function db() {
  if (database === undefined) throw new Error("Effect test database unavailable.");
  return database;
}
