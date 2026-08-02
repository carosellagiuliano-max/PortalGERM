import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  activateSandboxProvider,
  resolvePersistedProviderActivation,
} from "@/lib/ops/operations-ledger";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-27T18:00:00.000Z");
const DIGEST = createHash("sha256").update("phase23-provider").digest("hex");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase23_provider_activation");
  database = createDatabaseClient(migrated.connectionString);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase-23 persisted provider activation ledger", () => {
  it("creates one audited Local sandbox activation without exposing its secret reference", async () => {
    const client = db();
    const activation = await activateSandboxProvider(client, {
      actorReference: "admin-provider-test",
      adapterKey: "local_mock",
      adapterVersion: "v1",
      approvalRef: "approval:phase23-test",
      contractRef: "contract:phase23-test",
      dpaRef: "dpa:phase23-test",
      environment: sandboxEnvironment(),
      evidenceDigest: DIGEST,
      now: NOW,
      reasonCode: "CONTROLLED_SANDBOX",
      region: "local-test",
      secretVersionRef: "builtin:local-mock-mailbox:v1",
      stepUpEvidenceDigest: DIGEST,
      sustainableCapacity: 1_000,
      unitCostMicros: 10n,
      unitCostSource: "contract:fixture",
      useCase: "email.transactional",
    });
    const decision = await resolvePersistedProviderActivation(client, {
      adapterKey: "local_mock",
      adapterVersion: "v1",
      environment: "local",
      now: NOW,
      useCase: "email.transactional",
    });
    expect(decision).toEqual({
      activationId: activation.id,
      active: true,
      adapterKey: "local_mock",
      adapterVersion: "v1",
      mode: "SANDBOX",
    });
    await expect(
      client.operationsActivationEvent.findMany({
        where: { activationId: activation.id },
        select: {
          subject: true,
          kind: true,
          capability: true,
          reasonCode: true,
        },
      }),
    ).resolves.toEqual([
      {
        subject: "PROVIDER",
        kind: "CREATED",
        capability: "OPS_SANDBOX_PROVIDER_ACTIVATE",
        reasonCode: "CONTROLLED_SANDBOX",
      },
    ]);
    expect(JSON.stringify(decision)).not.toContain("secret:test:v1");
  });

  it("keeps use cases independent and rejects incomplete, expired or revoked authority", async () => {
    const client = db();
    await expect(
      resolvePersistedProviderActivation(client, {
        adapterKey: "local_mock",
        adapterVersion: "v1",
        environment: "local",
        now: NOW,
        useCase: "email.job-alert",
      }),
    ).resolves.toEqual({ active: false, reason: "MISSING_LEDGER" });

    await client.providerActivation.create({
      data: {
        environment: "local",
        useCase: "email.job-alert",
        adapterKey: "local_mock",
        adapterVersion: "v1",
        mode: "SANDBOX",
        configurationDigest: DIGEST,
        secretVersionRef: "secret:test:v1",
        region: "local-test",
        dpaRef: "dpa:test",
        contractRef: "contract:test",
        approvalRef: "approval:test",
        evidenceDigest: DIGEST,
        owner: "Candidate Product",
        runbookRef: "runbook:test",
        health: "HEALTHY",
        healthCheckedAt: NOW,
        quotaUnits: 100,
        sustainableCapacity: 100,
        unitCostMicros: 10n,
        unitCostSource: "contract:fixture",
        killSwitchEngaged: false,
        effectiveAt: new Date(NOW.getTime() - 60_000),
        expiresAt: NOW,
      },
    });
    await expect(
      resolvePersistedProviderActivation(client, {
        adapterKey: "local_mock",
        adapterVersion: "v1",
        environment: "local",
        now: NOW,
        useCase: "email.job-alert",
      }),
    ).resolves.toEqual({ active: false, reason: "EXPIRED" });

    await client.providerActivation.updateMany({
      where: { useCase: "email.transactional", revokedAt: null },
      data: {
        revokedAt: NOW,
        revokeReasonCode: "CONTROLLED_REVOKE",
        killSwitchEngaged: true,
      },
    });
    await expect(
      resolvePersistedProviderActivation(client, {
        adapterKey: "local_mock",
        adapterVersion: "v1",
        environment: "local",
        now: new Date(NOW.getTime() + 1),
        useCase: "email.transactional",
      }),
    ).resolves.toEqual({ active: false, reason: "REVOKED" });
  });

  it("prevents two simultaneous current activations for one environment/use case", async () => {
    const client = db();
    const data = {
      environment: "ci",
      useCase: "documents.object-store",
      adapterKey: "filesystem_sandbox",
      adapterVersion: "v1",
      mode: "SANDBOX" as const,
      configurationDigest: DIGEST,
      secretVersionRef: "secret:test:v1",
      region: "local-test",
      dpaRef: "dpa:test",
      contractRef: "contract:test",
      approvalRef: "approval:test",
      evidenceDigest: DIGEST,
      owner: "Documents",
      runbookRef: "runbook:test",
      health: "HEALTHY" as const,
      healthCheckedAt: NOW,
      quotaUnits: 100,
      sustainableCapacity: 100,
      unitCostMicros: 1n,
      unitCostSource: "fixture",
      killSwitchEngaged: false,
      effectiveAt: NOW,
    };
    await client.providerActivation.create({ data });
    await expect(client.providerActivation.create({ data })).rejects.toThrow();
  });
});

function sandboxEnvironment() {
  return parseEnvironment(
    createValidEnvironment({
      EMAIL_PROVIDER_MODE: "local_mock",
      WORKER_RUNTIME: "sandbox_command",
    }),
  );
}

function db() {
  if (database === undefined) {
    throw new Error("Provider activation test database unavailable.");
  }
  return database;
}
