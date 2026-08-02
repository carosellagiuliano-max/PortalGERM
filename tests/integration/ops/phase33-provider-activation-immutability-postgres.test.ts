import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Prisma } from "@/lib/generated/prisma/client";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const EFFECTIVE_AT = new Date("2026-08-01T09:00:00.000Z");
const CONFIGURATION_DIGEST = "1".repeat(64);
const EVIDENCE_DIGEST = "2".repeat(64);
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase33_provider_activation_immutability",
  );
  database = createDatabaseClient(migrated.connectionString);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase-33 ProviderActivation database authority", () => {
  it("keeps identity snapshots append-only while allowing health observations", async () => {
    const client = db();
    const activation = await client.providerActivation.create({
      data: activationData("identity"),
    });
    const healthCheckedAt = new Date(EFFECTIVE_AT.getTime() + 30_000);

    await expect(
      client.providerActivation.update({
        where: { id: activation.id },
        data: { health: "DEGRADED", healthCheckedAt },
      }),
    ).resolves.toMatchObject({ health: "DEGRADED", healthCheckedAt });

    const immutableMutations = [
      ["id", { id: randomUUID() }],
      ["environment", { environment: "preview" }],
      ["useCase", { useCase: "phase33.provider.changed" }],
      ["adapterKey", { adapterKey: "changed-adapter" }],
      ["adapterVersion", { adapterVersion: "v2" }],
      ["mode", { mode: "SANDBOX" }],
      ["configurationDigest", { configurationDigest: "3".repeat(64) }],
      ["secretVersionRef", { secretVersionRef: "secret:test:v2" }],
      ["region", { region: "changed-region" }],
      ["dpaRef", { dpaRef: "dpa:changed" }],
      ["contractRef", { contractRef: "contract:changed" }],
      ["approvalRef", { approvalRef: "approval:changed" }],
      ["evidenceDigest", { evidenceDigest: "4".repeat(64) }],
      ["owner", { owner: "Changed Owner" }],
      ["runbookRef", { runbookRef: "runbook:changed" }],
      ["quotaUnits", { quotaUnits: 2_000 }],
      ["sustainableCapacity", { sustainableCapacity: 1_500 }],
      ["unitCostMicros", { unitCostMicros: 20n }],
      ["unitCostSource", { unitCostSource: "contract:changed" }],
      [
        "effectiveAt",
        { effectiveAt: new Date(EFFECTIVE_AT.getTime() + 1_000) },
      ],
      ["expiresAt", { expiresAt: new Date(EFFECTIVE_AT.getTime() + 60_000) }],
      ["createdAt", { createdAt: new Date(EFFECTIVE_AT.getTime() - 1_000) }],
    ] satisfies ReadonlyArray<
      readonly [string, Prisma.ProviderActivationUncheckedUpdateInput]
    >;

    for (const [, data] of immutableMutations) {
      await expect(
        client.providerActivation.update({
          where: { id: activation.id },
          data,
        }),
      ).rejects.toThrow(/provider activation identity is immutable/iu);
    }

    await expect(
      client.providerActivation.delete({ where: { id: activation.id } }),
    ).rejects.toThrow(/provider activation authority is append-only/iu);
    await expect(
      client.providerActivation.findUniqueOrThrow({
        where: { id: activation.id },
        select: {
          adapterKey: true,
          configurationDigest: true,
          health: true,
          healthCheckedAt: true,
          killSwitchEngaged: true,
          revokedAt: true,
        },
      }),
    ).resolves.toEqual({
      adapterKey: "phase33-contract-stub",
      configurationDigest: CONFIGURATION_DIGEST,
      health: "DEGRADED",
      healthCheckedAt,
      killSwitchEngaged: false,
      revokedAt: null,
    });
  });

  it("allows authority only to move monotonically towards killed and revoked", async () => {
    const client = db();
    const activation = await client.providerActivation.create({
      data: activationData("monotonic"),
    });

    await expect(
      client.providerActivation.update({
        where: { id: activation.id },
        data: { killSwitchEngaged: true },
      }),
    ).resolves.toMatchObject({ killSwitchEngaged: true, revokedAt: null });
    await expect(
      client.providerActivation.update({
        where: { id: activation.id },
        data: { killSwitchEngaged: false },
      }),
    ).rejects.toThrow(/provider activation kill switch cannot be disengaged/iu);

    const revokedAt = new Date(EFFECTIVE_AT.getTime() + 60_000);
    await expect(
      client.providerActivation.update({
        where: { id: activation.id },
        data: { revokedAt, revokeReasonCode: "CONTROLLED_REVOKE" },
      }),
    ).resolves.toMatchObject({
      killSwitchEngaged: true,
      revokedAt,
      revokeReasonCode: "CONTROLLED_REVOKE",
    });

    for (const data of [
      { revokedAt: null, revokeReasonCode: null },
      { revokedAt: new Date(revokedAt.getTime() + 1_000) },
      { revokeReasonCode: "CHANGED_REASON" },
    ] as const) {
      await expect(
        client.providerActivation.update({
          where: { id: activation.id },
          data,
        }),
      ).rejects.toThrow(/provider activation revocation cannot be changed/iu);
    }
  });

  it("rejects invalid revocation shape and time while accepting the equality boundary", async () => {
    const client = db();

    await expect(
      client.providerActivation.create({
        data: activationData("disabled-revoked", {
          effectiveAt: null,
          killSwitchEngaged: true,
          mode: "DISABLED",
          revokedAt: EFFECTIVE_AT,
          revokeReasonCode: "INVALID_DISABLED_REVOKE",
        }),
      }),
    ).rejects.toThrow(/provider_activation_revocation_monotonic_check/iu);

    const activation = await client.providerActivation.create({
      data: activationData("revocation-shape"),
    });
    for (const data of [
      {
        killSwitchEngaged: true,
        revokedAt: new Date(EFFECTIVE_AT.getTime() - 1),
        revokeReasonCode: "BEFORE_EFFECTIVE",
      },
      {
        killSwitchEngaged: false,
        revokedAt: EFFECTIVE_AT,
        revokeReasonCode: "WITHOUT_KILL_SWITCH",
      },
      {
        killSwitchEngaged: true,
        revokedAt: EFFECTIVE_AT,
        revokeReasonCode: "",
      },
    ] as const) {
      await expect(
        client.providerActivation.update({
          where: { id: activation.id },
          data,
        }),
      ).rejects.toThrow(/provider_activation_revocation_monotonic_check/iu);
    }

    await expect(
      client.providerActivation.update({
        where: { id: activation.id },
        data: {
          killSwitchEngaged: true,
          revokedAt: EFFECTIVE_AT,
          revokeReasonCode: "EQUALITY_BOUNDARY",
        },
      }),
    ).resolves.toMatchObject({
      killSwitchEngaged: true,
      revokedAt: EFFECTIVE_AT,
      revokeReasonCode: "EQUALITY_BOUNDARY",
    });
  });
});

function activationData(
  label: string,
  overrides: Partial<Prisma.ProviderActivationUncheckedCreateInput> = {},
): Prisma.ProviderActivationUncheckedCreateInput {
  return {
    environment: "ci",
    useCase: `phase33.provider.${label}`,
    adapterKey: "phase33-contract-stub",
    adapterVersion: "v1",
    mode: "ALLOWLIST",
    configurationDigest: CONFIGURATION_DIGEST,
    secretVersionRef: "secret:test:v1",
    region: "isolated-test",
    dpaRef: "dpa:phase33-test",
    contractRef: "contract:phase33-test",
    approvalRef: "approval:phase33-test",
    evidenceDigest: EVIDENCE_DIGEST,
    owner: "Phase 33 Test",
    runbookRef: "runbook:phase33-test",
    health: "HEALTHY",
    healthCheckedAt: EFFECTIVE_AT,
    quotaUnits: 1_000,
    sustainableCapacity: 1_000,
    unitCostMicros: 10n,
    unitCostSource: "contract:phase33-test",
    killSwitchEngaged: false,
    effectiveAt: EFFECTIVE_AT,
    ...overrides,
  };
}

function db() {
  if (database === undefined) {
    throw new Error("Phase-33 provider activation database unavailable.");
  }
  return database;
}
