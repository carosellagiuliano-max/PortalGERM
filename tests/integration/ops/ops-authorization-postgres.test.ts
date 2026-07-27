import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getRedactedOperationsOverview } from "@/lib/admin/operations-read";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-27T20:00:00.000Z");
const PAYLOAD_CANARY = "secret-payload-canary@example.test";
const SECRET_REFERENCE_CANARY = "kms:secret-reference-canary";
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase23_ops_authorization");
  database = createDatabaseClient(migrated.connectionString);
  vi.stubEnv("APP_ENV", "local");
  await database.workItem.create({
    data: {
      handlerKey: "ops.diagnostic-effect",
      handlerVersion: "v1",
      subjectType: "DIAGNOSTIC",
      subjectId: randomUUID(),
      dedupeKey: `ops.diagnostic-effect:v1:${randomUUID()}`,
      effectKey: `effect:ops.diagnostic-effect:v1:${randomUUID()}`,
      availableAt: NOW,
      payloadVersion: "v1",
      payloadReference: { unsafeLegacyCanary: PAYLOAD_CANARY },
    },
  });
  await database.providerActivation.create({
    data: {
      environment: "local",
      useCase: "email.transactional",
      adapterKey: "local_mock",
      adapterVersion: "v1",
      mode: "SANDBOX",
      configurationDigest: "a".repeat(64),
      secretVersionRef: SECRET_REFERENCE_CANARY,
      region: "local-test",
      dpaRef: "dpa:test",
      contractRef: "contract:test",
      approvalRef: "approval:test",
      evidenceDigest: "b".repeat(64),
      owner: "Communications",
      runbookRef: "runbook:test",
      health: "HEALTHY",
      healthCheckedAt: NOW,
      quotaUnits: 100,
      sustainableCapacity: 100,
      unitCostMicros: 1n,
      unitCostSource: "fixture",
      killSwitchEngaged: false,
      effectiveAt: NOW,
    },
  });
}, 600_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase-23 operations authorization and redaction", () => {
  it("denies a non-admin before touching any queue or payload repository", async () => {
    const forbiddenDatabase = new Proxy(
      {},
      {
        get() {
          throw new Error("DATABASE_MUST_NOT_BE_READ");
        },
      },
    ) as DatabaseClient;
    await expect(
      getRedactedOperationsOverview({
        actor: {
          userId: randomUUID(),
          email: "support@example.test",
          role: "SUPPORT",
          status: "ACTIVE",
        },
        correlationId: randomUUID(),
        database: forbiddenDatabase,
        now: NOW,
      }),
    ).resolves.toBeNull();
  });

  it("returns only bounded operational metadata to an active Admin", async () => {
    const overview = await getRedactedOperationsOverview({
      actor: {
        userId: randomUUID(),
        email: "admin@example.test",
        role: "ADMIN",
        status: "ACTIVE",
      },
      correlationId: randomUUID(),
      database: db(),
      now: NOW,
    });
    expect(overview).not.toBeNull();
    expect(overview?.queue.statuses.PENDING).toBe(1);
    expect(overview?.providerActivations).toHaveLength(1);
    const serialized = JSON.stringify(overview, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serialized).not.toContain(PAYLOAD_CANARY);
    expect(serialized).not.toContain(SECRET_REFERENCE_CANARY);
    expect(serialized).not.toContain("payloadReference");
    expect(serialized).not.toContain("secretVersionRef");
  });
});

function db() {
  if (database === undefined) {
    throw new Error("Ops authorization test database unavailable.");
  }
  return database;
}
