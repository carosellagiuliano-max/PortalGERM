import { createHash } from "node:crypto";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { executeRegisteredHandler } from "@/lib/ops/registered-handler-runtime";
import {
  claimWorkBatch,
  createWorkerRun,
  enqueueWorkItem,
  heartbeatWorkLease,
  recordFencedEffectReceipt,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

const ALLOWED_SCENARIOS = Object.freeze([
  "before-effect",
  "after-effect-before-ack",
  "heartbeat-loss",
  "restart",
  "rolling-deploy",
] as const);
type Scenario = (typeof ALLOWED_SCENARIOS)[number];
const requested = parseScenarios(process.argv.slice(2));
const harness = await createMigratedTestDatabase("phase23_worker_chaos");
const database = createDatabaseClient(harness.connectionString);
const environment = parseEnvironment(
  createValidEnvironment({ WORKER_RUNTIME: "sandbox_command" }),
);
const effectDigest = createHash("sha256")
  .update("phase23-chaos-effect")
  .digest("hex");
const results: Array<Record<string, unknown>> = [];

try {
  for (const [index, scenario] of requested.entries()) {
    const base = new Date(
      Date.UTC(2026, 6, 27, 22, 0, index * 2),
    );
    const key = `phase23-chaos-${scenario}`;
    const item = await enqueueWorkItem(database, {
      handlerKey: "ops.diagnostic-effect",
      handlerVersion: "v1",
      payloadVersion: "v1",
      subjectType: "DIAGNOSTIC",
      subjectId: scenario,
      dedupeKey: `ops.diagnostic-effect:v1:${key}`,
      effectKey: `effect:ops.diagnostic-effect:v1:${key}`,
      availableAt: base,
      payloadReference: { effectDigest },
    });
    const firstDeployment =
      scenario === "rolling-deploy" ? "phase23-chaos-old" : "phase23-chaos";
    const firstRun = await createWorkerRun(database, {
      workerId: `chaos-first-${index}`,
      environment: "ci",
      deploymentDigest: firstDeployment,
      runtimeVersion: "v1",
      now: base,
    });
    const [first] = await claimWorkBatch(database, {
      deploymentDigest: firstDeployment,
      handlerKey: "ops.diagnostic-effect",
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: `chaos-first-${index}`,
      workerRunId: firstRun.id,
      now: base,
      policy: leasePolicy(),
    });
    assert(first?.id === item.id, `${scenario}: first claim missing`);
    const firstIdentity = identity(
      item.id,
      firstRun.id,
      `chaos-first-${index}`,
      firstDeployment,
      first!.fencingToken,
    );
    if (scenario === "after-effect-before-ack") {
      const receipt = await recordFencedEffectReceipt(database, firstIdentity, {
        handlerKey: "ops.diagnostic-effect",
        handlerVersion: "v1",
        effectDigest,
        now: new Date(base.getTime() + 100),
      });
      assert(receipt.status === "RECORDED", `${scenario}: effect not recorded`);
    }
    if (scenario === "heartbeat-loss") {
      const heartbeat = await heartbeatWorkLease(
        database,
        { ...firstIdentity, fencingToken: first!.fencingToken + 1 },
        {
          now: new Date(base.getTime() + 1_000),
          leaseMilliseconds: 6_000,
        },
      );
      assert(!heartbeat.extended, `${scenario}: stale heartbeat extended lease`);
    }

    const takeoverAt = new Date(base.getTime() + 6_001);
    const secondDeployment =
      scenario === "rolling-deploy" ? "phase23-chaos-new" : "phase23-chaos";
    const secondRun = await createWorkerRun(database, {
      workerId: `chaos-second-${index}`,
      environment: "ci",
      deploymentDigest: secondDeployment,
      runtimeVersion: "v1",
      now: takeoverAt,
    });
    const [second] = await claimWorkBatch(database, {
      deploymentDigest: secondDeployment,
      handlerKey: "ops.diagnostic-effect",
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: `chaos-second-${index}`,
      workerRunId: secondRun.id,
      now: takeoverAt,
      policy: leasePolicy(),
    });
    assert(second?.id === item.id, `${scenario}: takeover claim missing`);
    const execution = await executeRegisteredHandler(second!, {
      database,
      environment,
      identity: identity(
        item.id,
        secondRun.id,
        `chaos-second-${index}`,
        secondDeployment,
        second!.fencingToken,
      ),
      leaseMilliseconds: 6_000,
      now: () => new Date(takeoverAt.getTime() + 100),
    });
    const evidence = await database.workItem.findUniqueOrThrow({
      where: { id: item.id },
      select: {
        status: true,
        attempts: { orderBy: { attemptNumber: "asc" }, select: { outcome: true } },
        effectReceipts: { select: { effectDigest: true } },
      },
    });
    assert(execution.completion === "COMPLETED", `${scenario}: not completed`);
    assert(evidence.status === "SUCCEEDED", `${scenario}: not terminal`);
    assert(evidence.effectReceipts.length === 1, `${scenario}: duplicate effect`);
    assert(
      evidence.attempts.length === 2 &&
        evidence.attempts[0]?.outcome === "LEASE_LOST",
      `${scenario}: lease-loss evidence missing`,
    );
    results.push({
      scenario,
      status: evidence.status,
      effectCount: evidence.effectReceipts.length,
      attempts: evidence.attempts.map(({ outcome }) => outcome),
      recoveryMilliseconds: 6_101,
      evidenceDigest: createHash("sha256")
        .update(`${scenario}:${evidence.status}:1`, "utf8")
        .digest("hex"),
    });
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        contract: "phase23-worker-chaos-v1",
        status: "PASSED",
        scenarios: results,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await database.$disconnect();
  await harness.dispose();
}

function parseScenarios(values: readonly string[]): readonly Scenario[] {
  if (values.length !== 1) {
    throw new Error("Expected exactly --scenario=<comma-separated-matrix>.");
  }
  const match = /^--scenario=([a-z,-]+)$/u.exec(values[0]!);
  if (match === null) throw new Error("Invalid chaos scenario argument.");
  const scenarios = match[1]!.split(",") as Scenario[];
  if (
    scenarios.length === 0 ||
    new Set(scenarios).size !== scenarios.length ||
    scenarios.some((scenario) => !ALLOWED_SCENARIOS.includes(scenario))
  ) {
    throw new Error("Chaos scenario is outside the closed matrix.");
  }
  return Object.freeze(scenarios);
}

function leasePolicy() {
  return {
    batchSize: 1,
    leaseMilliseconds: 6_000,
    heartbeatMilliseconds: 2_000,
  } as const;
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
