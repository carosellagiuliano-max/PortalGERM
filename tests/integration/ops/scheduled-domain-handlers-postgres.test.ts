import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { WORKER_HANDLER_CATALOG } from "@/lib/ops/handler-catalog";
import { activateSandboxHandler } from "@/lib/ops/operations-ledger";
import { createWorkerRun } from "@/lib/ops/worker-runtime";
import { scheduleActivatedWork } from "@/lib/ops/worker-scheduler";
import { runWorkerCycle } from "@/lib/ops/worker-service";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-27T18:15:30.000Z");
const DEPLOYMENT = "phase23-schedule-test";
const EVIDENCE = createHash("sha256").update("phase23-schedule").digest("hex");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase23_scheduler");
  database = createDatabaseClient(migrated.connectionString);
  const environment = sandboxEnvironment();
  for (const handler of autonomousFixtureHandlers()) {
    await activateSandboxHandler(database, {
      actorReference: "admin-scheduler-test",
      deploymentDigest: DEPLOYMENT,
      environment,
      evidenceDigest: EVIDENCE,
      handlerKey: handler.handlerKey,
      handlerVersion: handler.handlerVersion,
      now: NOW,
      reasonCode: "CONTROLLED_SCHEDULER_TEST",
      stepUpEvidenceDigest: EVIDENCE,
    });
  }
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase-23 scheduled domain handler registry", () => {
  it("gives every catalog handler an owner, runbook, SLO and explicit execution state", () => {
    expect(WORKER_HANDLER_CATALOG.length).toBeGreaterThanOrEqual(12);
    for (const handler of WORKER_HANDLER_CATALOG) {
      expect(handler.owner).not.toHaveLength(0);
      expect(handler.runbookRef).toMatch(/^codex-plan\/runbooks\//u);
      expect(handler.sloRef).toMatch(/^codex-plan\//u);
      expect(existsSync(handler.runbookRef)).toBe(true);
      expect(existsSync(handler.sloRef.replace(/#.*$/u, ""))).toBe(true);
      expect(handler.handlerVersion).toBe("v1");
      expect(handler.payloadVersion).toBe("v1");
    }
  });

  it("enqueues each active boundary once and a disabled handler zero times", async () => {
    const first = await scheduleActivatedWork({
      database: db(),
      deploymentDigest: DEPLOYMENT,
      environment: sandboxEnvironment(),
      now: NOW,
    });
    expect(first.created).toBe(autonomousFixtureHandlers().length);
    const repeated = await scheduleActivatedWork({
      database: db(),
      deploymentDigest: DEPLOYMENT,
      environment: sandboxEnvironment(),
      now: new Date(NOW.getTime() + 10_000),
    });
    expect(repeated.created).toBe(0);
    expect(repeated.replayed).toBe(autonomousFixtureHandlers().length);
    await expect(
      db().workItem.count({
        where: { handlerKey: "candidate.job-alert-digest" },
      }),
    ).resolves.toBe(0);
  });

  it("executes the registered owning commands and records one terminal attempt per tick", async () => {
    const worker = await createWorkerRun(db(), {
      workerId: "scheduled-worker",
      environment: "local",
      deploymentDigest: DEPLOYMENT,
      runtimeVersion: "v1",
      now: NOW,
    });
    const cycle = await runWorkerCycle({
      database: db(),
      environment: sandboxEnvironment(),
      deploymentDigest: DEPLOYMENT,
      workerId: "scheduled-worker",
      workerRunId: worker.id,
      now: () => new Date(NOW.getTime() + 20_000),
    });
    expect(cycle.claimed).toBe(autonomousFixtureHandlers().length);
    expect(cycle.completed).toBe(autonomousFixtureHandlers().length);
    expect(cycle.deadLettered + cycle.paused + cycle.retried).toBe(0);
    await expect(
      db().workAttempt.count({
        where: {
          workItem: {
            handlerKey: {
              in: autonomousFixtureHandlers().map(
                ({ handlerKey }) => handlerKey,
              ),
            },
          },
          outcome: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(autonomousFixtureHandlers().length);
  });

  it("uses absolute UTC buckets so the Zurich fallback hour cannot duplicate a tick", async () => {
    const beforeFallback = new Date("2026-10-25T00:30:00.000Z");
    const afterFallback = new Date("2026-10-25T01:30:00.000Z");
    const before = await scheduleActivatedWork({
      database: db(),
      deploymentDigest: DEPLOYMENT,
      environment: sandboxEnvironment(),
      now: beforeFallback,
    });
    const after = await scheduleActivatedWork({
      database: db(),
      deploymentDigest: DEPLOYMENT,
      environment: sandboxEnvironment(),
      now: afterFallback,
    });
    expect(before.created).toBe(autonomousFixtureHandlers().length);
    expect(after.created).toBe(
      autonomousFixtureHandlers().filter(
        ({ schedule }) => schedule !== "day-boundary",
      ).length,
    );
    await expect(
      db().workItem.count({
        where: {
          handlerKey: "seo.sitemap-capacity",
          availableAt: new Date("2026-10-25T00:00:00.000Z"),
        },
      }),
    ).resolves.toBe(1);
    const keys = await db().workItem.findMany({
      where: {
        handlerKey: "jobs.expiry-projection",
        availableAt: {
          in: [
            new Date(Math.floor(beforeFallback.getTime() / 60_000) * 60_000),
            new Date(Math.floor(afterFallback.getTime() / 60_000) * 60_000),
          ],
        },
      },
      select: { dedupeKey: true },
    });
    expect(keys).toHaveLength(2);
    expect(new Set(keys.map(({ dedupeKey }) => dedupeKey)).size).toBe(
      keys.length,
    );
  });
});

function autonomousFixtureHandlers() {
  return WORKER_HANDLER_CATALOG.filter(
    (handler) =>
      handler.execution === "IMPLEMENTED" &&
      handler.providerUseCase === null &&
      handler.schedule !== "manual-sandbox-only",
  );
}

function sandboxEnvironment() {
  return parseEnvironment(
    createValidEnvironment({
      WORKER_RUNTIME: "sandbox_command",
    }),
  );
}

function db() {
  if (database === undefined) {
    throw new Error("Scheduler test database unavailable.");
  }
  return database;
}
