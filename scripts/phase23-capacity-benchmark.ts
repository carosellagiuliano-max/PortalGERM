import { performance } from "node:perf_hooks";

import { createDatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import { recordOperationalCapacitySample } from "@/lib/ops/operational-capacity";
import {
  claimWorkBatch,
  completeWorkItem,
  createWorkerRun,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

const command = parseArguments(process.argv.slice(2));
const arrivalP95PerMinute = command.profile === "lc3" ? 100 : 25;
const deploymentDigest = `phase23-capacity-${command.profile}`;
const handlerKey = `benchmark.${command.profile}`;
const harness = await createMigratedTestDatabase("phase23_capacity_benchmark");
const database = createDatabaseClient(harness.connectionString);
const startedAt = new Date();
const heapBefore = process.memoryUsage().heapUsed;

try {
  for (let offset = 0; offset < command.items; offset += 1_000) {
    const count = Math.min(1_000, command.items - offset);
    await database.workItem.createMany({
      data: Array.from({ length: count }, (_, localIndex) => {
        const ordinal = offset + localIndex;
        return {
          handlerKey,
          handlerVersion: "v1",
          subjectType: "BENCHMARK",
          subjectId: String(ordinal),
          dedupeKey: `${handlerKey}:v1:${ordinal}`,
          effectKey: `effect:${handlerKey}:v1:${ordinal}`,
          priority: ordinal % 101,
          availableAt: startedAt,
          payloadVersion: "v1",
          payloadReference: { ordinal },
        };
      }),
    });
  }
  await database.$executeRaw`ANALYZE "WorkItem"`;
  const queryPlanRows = await database.$queryRaw<Array<{ "QUERY PLAN": string }>>(
    Prisma.sql`
      EXPLAIN (COSTS TRUE, FORMAT TEXT)
      SELECT "id"
      FROM "WorkItem"
      WHERE "handlerKey" = ${handlerKey}
        AND "handlerVersion" = 'v1'
        AND "status" IN ('PENDING', 'RETRY')
        AND "availableAt" <= ${startedAt}
      ORDER BY "priority" DESC, "availableAt" ASC, "id" ASC
      LIMIT 100
    `,
  );
  const queryPlan = queryPlanRows
    .map((row) => row["QUERY PLAN"])
    .join("\n");
  assert(
    /work_item_claim_due_idx|Index Scan/iu.test(queryPlan) &&
      !/\bSeq Scan on "WorkItem"/iu.test(queryPlan),
    "Claim query did not use the bounded due index.",
  );

  const runs = await Promise.all(
    Array.from({ length: command.workers }, (_, index) =>
      createWorkerRun(database, {
        workerId: `benchmark-worker-${index}`,
        environment: "ci",
        deploymentDigest,
        runtimeVersion: "v1",
        now: startedAt,
      }),
    ),
  );
  const benchmarkStarted = performance.now();
  let terminalCount = 0;
  let rounds = 0;
  while (terminalCount < command.items) {
    const claimAt = new Date(startedAt.getTime() + rounds);
    const batches = await Promise.all(
      runs.map((run, index) =>
        claimWorkBatch(database, {
          deploymentDigest,
          handlerKey,
          handlerVersion: "v1",
          payloadVersion: "v1",
          workerId: `benchmark-worker-${index}`,
          workerRunId: run.id,
          now: claimAt,
          policy: { batchSize: 100 },
        }),
      ),
    );
    const claimed = batches.flat();
    if (claimed.length === 0) break;
    await Promise.all(
      batches.map(async (batch, workerIndex) => {
        for (const item of batch) {
          await completeWorkItem(
            database,
            identity(
              item.id,
              runs[workerIndex]!.id,
              `benchmark-worker-${workerIndex}`,
              deploymentDigest,
              item.fencingToken,
            ),
            { now: new Date(claimAt.getTime() + 1) },
          );
        }
      }),
    );
    terminalCount += claimed.length;
    rounds += 1;
  }
  const durationMilliseconds = performance.now() - benchmarkStarted;
  const heapDeltaBytes = Math.max(
    0,
    process.memoryUsage().heapUsed - heapBefore,
  );
  const [succeeded, attempts, duplicateEffects, open] = await Promise.all([
    database.workItem.count({ where: { handlerKey, status: "SUCCEEDED" } }),
    database.workAttempt.count({ where: { workItem: { handlerKey } } }),
    database.workEffectReceipt.groupBy({
      by: ["effectKey"],
      where: { workItem: { handlerKey } },
      _count: { _all: true },
      having: { effectKey: { _count: { gt: 1 } } },
    }),
    database.workItem.count({
      where: {
        handlerKey,
        status: { in: ["PENDING", "RETRY", "LEASED", "PAUSED"] },
      },
    }),
  ]);
  assert(succeeded === command.items, "Benchmark lost non-terminal work items.");
  assert(attempts === command.items, "Benchmark wrote an invalid attempt count.");
  assert(duplicateEffects.length === 0, "Benchmark found duplicate effect keys.");
  assert(open === 0, "Benchmark left open work items.");
  const sustainablePerMinute =
    durationMilliseconds <= 0
      ? 0
      : (command.items / durationMilliseconds) * 60_000;
  assert(
    sustainablePerMinute >= arrivalP95PerMinute * 1.5,
    "Benchmark did not demonstrate the required 50 percent headroom.",
  );
  const completedAt = new Date();
  const sample = await recordOperationalCapacitySample(database, {
    environment: "ci",
    queueKey: "worker",
    handlerKey,
    handlerVersion: "v1",
    deploymentDigest,
    windowStartedAt: new Date(startedAt.getTime() - 1),
    windowEndedAt: new Date(completedAt.getTime() + 1),
    arrivalP95PerMinute,
    sustainablePerMinute,
    databasePoolBasisPoints: 7_000,
    providerQuotaBasisPoints: null,
    downstreamHealthy: true,
    workerCount: command.workers,
    unitCostMicros: 0n,
    unitCostSource: "local-benchmark-no-external-provider",
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        contract: "phase23-capacity-benchmark-v1",
        status: "PASSED",
        profile: command.profile,
        items: command.items,
        workers: command.workers,
        rounds,
        durationMilliseconds: Math.round(durationMilliseconds),
        sustainablePerMinute: Number(sustainablePerMinute.toFixed(2)),
        arrivalP95PerMinute,
        headroomRatio: Number(
          (sustainablePerMinute / arrivalP95PerMinute).toFixed(2),
        ),
        terminalCount,
        openCount: open,
        duplicateEffectKeys: duplicateEffects.length,
        heapDeltaBytes,
        capacityState: sample.state,
        queryPlan: queryPlan.split(/\r?\n/u),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await database.$disconnect();
  await harness.dispose();
}

function parseArguments(values: readonly string[]) {
  let profile: "lc2" | "lc3" | undefined;
  let items: number | undefined;
  let workers: number | undefined;
  for (const value of values) {
    const profileMatch = /^--profile=(lc2|lc3)$/u.exec(value);
    if (profileMatch !== null) {
      profile = profileMatch[1] as typeof profile;
      continue;
    }
    const itemMatch = /^--items=(\d{1,6})$/u.exec(value);
    if (itemMatch !== null) {
      items = Number(itemMatch[1]);
      continue;
    }
    const workerMatch = /^--workers=(\d{1,2})$/u.exec(value);
    if (workerMatch !== null) {
      workers = Number(workerMatch[1]);
      continue;
    }
    throw new Error("CAPACITY_BENCHMARK_ARGUMENT_INVALID");
  }
  if (
    profile === undefined ||
    items === undefined ||
    workers === undefined ||
    items < 100 ||
    items > 100_000 ||
    workers < 1 ||
    workers > 16
  ) {
    throw new Error("CAPACITY_BENCHMARK_ARGUMENT_INCOMPLETE");
  }
  return Object.freeze({ profile, items, workers });
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
