import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-27T12:00:00.000Z");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase23_worker_schema");
  database = createDatabaseClient(migrated.connectionString);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase-23 worker runtime migration contract", () => {
  it("installs the additive queue, ledger, run and capacity tables with no activation", async () => {
    const fixture = requireFixture();
    const tables = await fixture.migrated.pool.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name
      `,
      [
        [
          "OperationalCapacitySample",
          "OperationsActivationEvent",
          "ProviderActivation",
          "WorkAttempt",
          "WorkDeadLetter",
          "WorkEffectReceipt",
          "WorkItem",
          "WorkReplayAudit",
          "WorkerHandlerActivation",
          "WorkerRun",
        ],
      ],
    );
    expect(tables.rows).toHaveLength(10);
    await expect(
      fixture.database.workerHandlerActivation.count(),
    ).resolves.toBe(0);
    await expect(fixture.database.providerActivation.count()).resolves.toBe(0);

    const indexes = await fixture.migrated.pool.query<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'work_item_claim_due_idx',
          'work_item_stale_lease_idx',
          'worker_handler_one_current_activation',
          'provider_one_current_activation'
        )
      ORDER BY indexname
    `);
    expect(indexes.rows).toHaveLength(4);
    expect(indexes.rows.map(({ indexdef }) => indexdef).join("\n")).toMatch(
      /priority.*DESC.*availableAt/isu,
    );
    expect(indexes.rows.map(({ indexdef }) => indexdef).join("\n")).toMatch(
      /WHERE.*status/isu,
    );
  });

  it("enforces unique dedupe, immutable queue identity and append-only evidence", async () => {
    const fixture = requireFixture();
    const dedupeKey = `ops.diagnostic-effect:v1:${randomUUID()}`;
    const workItem = await fixture.database.workItem.create({
      data: {
        handlerKey: "ops.diagnostic-effect",
        handlerVersion: "v1",
        subjectType: "DIAGNOSTIC",
        subjectId: randomUUID(),
        dedupeKey,
        effectKey: `effect:${dedupeKey}`,
        availableAt: NOW,
        payloadVersion: "v1",
        payloadReference: { effectDigest: "a".repeat(64) },
      },
    });
    await expect(
      fixture.database.workItem.create({
        data: {
          handlerKey: "ops.diagnostic-effect",
          handlerVersion: "v1",
          subjectType: "DIAGNOSTIC",
          subjectId: randomUUID(),
          dedupeKey,
          effectKey: `effect:${dedupeKey}`,
          availableAt: NOW,
          payloadVersion: "v1",
          payloadReference: { effectDigest: "a".repeat(64) },
        },
      }),
    ).rejects.toThrow();
    await expect(
      fixture.database.workItem.update({
        where: { id: workItem.id },
        data: { effectKey: "effect:mutated" },
      }),
    ).rejects.toThrow(/immutable/iu);

    const sample = await fixture.database.operationalCapacitySample.create({
      data: {
        environment: "ci",
        queueKey: "worker",
        handlerKey: "ops.diagnostic-effect",
        handlerVersion: "v1",
        deploymentDigest: "test-build",
        windowStartedAt: NOW,
        windowEndedAt: new Date(NOW.getTime() + 60_000),
        arrivalCount: 0,
        completionCount: 0,
        failureCount: 0,
        retryCount: 0,
        deadLetterCount: 0,
        backlogCount: 0,
        oldestAgeMilliseconds: 0,
        sustainablePerMinute: 100,
        arrivalP95PerMinute: 50,
        handlingP50Milliseconds: 0,
        handlingP95Milliseconds: 0,
        utilizationBasisPoints: 5_000,
        workerCount: 1,
        state: "NORMAL",
        policyVersion: "phase23-v1",
      },
    });
    await expect(
      fixture.database.operationalCapacitySample.update({
        where: { id: sample.id },
        data: { backlogCount: 1 },
      }),
    ).rejects.toThrow(/append-only/iu);
  });

  it("rejects invalid activation/time/payload states and reapplies idempotently", async () => {
    const fixture = requireFixture();
    await expect(
      fixture.database.workerHandlerActivation.create({
        data: {
          environment: "production",
          handlerKey: "ops.diagnostic-effect",
          handlerVersion: "v1",
          payloadVersion: "v1",
          mode: "SANDBOX",
          configurationDigest: "a".repeat(64),
          deploymentDigest: "test-build",
          owner: "Platform",
          runbookRef: "runbook:test",
          sloRef: "slo:test",
          evidenceDigest: "b".repeat(64),
          killSwitchEngaged: false,
          effectiveAt: null,
        },
      }),
    ).rejects.toThrow();
    await expect(
      fixture.database.workItem.create({
        data: {
          handlerKey: "ops.diagnostic-effect",
          handlerVersion: "v1",
          subjectType: "DIAGNOSTIC",
          subjectId: randomUUID(),
          dedupeKey: `oversize:${randomUUID()}`,
          effectKey: `effect:oversize:${randomUUID()}`,
          availableAt: NOW,
          payloadVersion: "v1",
          payloadReference: { unsafe: "x".repeat(8_193) },
        },
      }),
    ).rejects.toThrow();

    const before = await fixture.database.workItem.count();
    await fixture.migrated.migrate();
    await expect(fixture.database.workItem.count()).resolves.toBe(before);
  });
});

function requireFixture() {
  if (migrated === undefined || database === undefined) {
    throw new Error("Phase-23 migration fixture is unavailable.");
  }
  return { migrated, database };
}
