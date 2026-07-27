import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { recordOperationalCapacitySample } from "@/lib/ops/operational-capacity";
import {
  claimWorkBatch,
  completeWorkItem,
  createWorkerRun,
  enqueueWorkItem,
  failWorkItem,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const DEPLOYMENT = "phase23-capacity-test";
const HANDLER = "test.capacity";
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let windowStartedAt: Date;
let windowEndedAt: Date;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase23_capacity");
  database = createDatabaseClient(migrated.connectionString);
  windowStartedAt = new Date(Date.now() - 1_000);
  const now = new Date();
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      enqueueWorkItem(database!, {
        handlerKey: HANDLER,
        handlerVersion: "v1",
        payloadVersion: "v1",
        subjectType: "DIAGNOSTIC",
        subjectId: `capacity-${index}`,
        dedupeKey: `${HANDLER}:v1:${randomUUID()}`,
        effectKey: `effect:${HANDLER}:v1:${randomUUID()}`,
        availableAt: now,
        payloadReference: { ordinal: index },
      }),
    ),
  );
  const run = await createWorkerRun(database, {
    workerId: "capacity-worker",
    environment: "ci",
    deploymentDigest: DEPLOYMENT,
    runtimeVersion: "v1",
    now,
  });
  const claimed = await claimWorkBatch(database, {
    deploymentDigest: DEPLOYMENT,
    handlerKey: HANDLER,
    handlerVersion: "v1",
    payloadVersion: "v1",
    workerId: "capacity-worker",
    workerRunId: run.id,
    now,
    policy: { batchSize: 5 },
  });
  await Promise.all(
    claimed.map((item, index) =>
      index === 4
        ? failWorkItem(
            database!,
            identity(item.id, run.id, item.fencingToken),
            {
              now: new Date(now.getTime() + 100),
              failure: {
                errorCode: "CAPACITY_TRANSIENT",
                explicitClass: "TRANSIENT",
              },
            },
          )
        : completeWorkItem(
            database!,
            identity(item.id, run.id, item.fencingToken),
            { now: new Date(now.getTime() + 100) },
          ),
    ),
  );
  windowEndedAt = new Date(Date.now() + 1_000);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase-23 operational capacity evidence", () => {
  it("records arrival, completion, retry, backlog, handling and unit-cost evidence", async () => {
    const sample = await recordOperationalCapacitySample(db(), {
      environment: "ci",
      queueKey: "worker",
      handlerKey: HANDLER,
      handlerVersion: "v1",
      deploymentDigest: DEPLOYMENT,
      windowStartedAt,
      windowEndedAt,
      arrivalP95PerMinute: 5,
      sustainablePerMinute: 10,
      providerQuotaBasisPoints: 2_000,
      databasePoolBasisPoints: 3_000,
      downstreamHealthy: true,
      workerCount: 1,
      unitCostMicros: 50n,
      unitCostSource: "fixture:measured-cost",
      manualHandlingMinutes: 0,
    });
    expect(sample).toMatchObject({
      arrivalCount: 5,
      completionCount: 4,
      failureCount: 1,
      retryCount: 1,
      deadLetterCount: 0,
      backlogCount: 1,
      state: "NORMAL",
      utilizationBasisPoints: 5_000,
      unitCostMicros: 50n,
    });
    expect(sample.handlingP95Milliseconds).toBeGreaterThanOrEqual(
      sample.handlingP50Milliseconds,
    );
  });

  it("persists the 90 percent hard pause as a separate immutable sample", async () => {
    const nextStart = new Date(windowEndedAt.getTime() + 1);
    const sample = await recordOperationalCapacitySample(db(), {
      environment: "ci",
      queueKey: "worker",
      handlerKey: HANDLER,
      handlerVersion: "v1",
      deploymentDigest: DEPLOYMENT,
      windowStartedAt: nextStart,
      windowEndedAt: new Date(nextStart.getTime() + 60_000),
      arrivalP95PerMinute: 90,
      sustainablePerMinute: 100,
      providerQuotaBasisPoints: 1_000,
      databasePoolBasisPoints: 1_000,
      downstreamHealthy: true,
      workerCount: 4,
      unitCostMicros: 40n,
      unitCostSource: "fixture:measured-cost",
    });
    expect(sample.state).toBe("PAUSED");
    expect(sample.utilizationBasisPoints).toBe(9_000);
    await expect(
      db().operationalCapacitySample.count({
        where: { handlerKey: HANDLER },
      }),
    ).resolves.toBe(2);
  });
});

function identity(
  workItemId: string,
  workerRunId: string,
  fencingToken: number,
): WorkLeaseIdentity {
  return {
    workItemId,
    workerRunId,
    workerId: "capacity-worker",
    deploymentDigest: DEPLOYMENT,
    fencingToken,
  };
}

function db() {
  if (database === undefined) {
    throw new Error("Capacity test database unavailable.");
  }
  return database;
}
