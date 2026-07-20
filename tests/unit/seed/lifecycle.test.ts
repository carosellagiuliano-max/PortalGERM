import { describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "@/lib/db/factory";
import { SEED_DATASET_VERSION, SEED_NAMESPACE } from "@/prisma/seed/contract";
import { stableSeedId } from "@/prisma/seed/ids";
import {
  beginSeedRun,
  completeSeedRun,
  SeedLifecycleError,
} from "@/prisma/seed/lifecycle";
import { buildSeedContractHeader, buildSeedManifest } from "@/prisma/seed/manifest";
import { SEED_GOLDEN_COUNTS } from "@/prisma/seed/contract";

const anchorAt = new Date("2026-07-20T10:00:00.000Z");
const identities = [
  {
    entity: "fixture",
    id: stableSeedId("fixture", "demo"),
    naturalKey: "demo",
  },
] as const;
const header = buildSeedContractHeader({
  anchorAt: anchorAt.toISOString(),
  identities,
  seedVersion: SEED_DATASET_VERSION,
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    anchorAt,
    completedAt: null,
    contractHash: header.contractHash,
    createdAt: anchorAt,
    manifestHash: null,
    namespace: SEED_NAMESPACE,
    schemaVersion: header.schemaVersion,
    seedVersion: SEED_DATASET_VERSION,
    ...overrides,
  };
}

function database(delegate: Record<string, unknown>): DatabaseClient {
  return { demoSeedManifest: delegate } as unknown as DatabaseClient;
}

describe("seed lifecycle", () => {
  it("persists the first clock before returning the run", async () => {
    const create = vi.fn(async () => row());
    const lifecycle = await beginSeedRun(
      database({ findUnique: vi.fn(async () => null), create }),
      identities,
      () => anchorAt,
    );

    expect(lifecycle).toEqual({
      anchorAt,
      completed: false,
      manifestHash: null,
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        anchorAt,
        contractHash: header.contractHash,
      }),
    });
  });

  it("reuses an incomplete run's anchor", async () => {
    const lifecycle = await beginSeedRun(
      database({ findUnique: vi.fn(async () => row()), create: vi.fn() }),
      identities,
      () => new Date("2030-01-01T00:00:00.000Z"),
    );

    expect(lifecycle.anchorAt).toEqual(anchorAt);
    expect(lifecycle.completed).toBe(false);
  });

  it("rejects contract drift on a stable namespace and version", async () => {
    await expect(
      beginSeedRun(
        database({
          findUnique: vi.fn(async () => row({ contractHash: "0".repeat(64) })),
          create: vi.fn(),
        }),
        identities,
      ),
    ).rejects.toBeInstanceOf(SeedLifecycleError);
  });

  it("seals an incomplete manifest exactly once", async () => {
    const envelope = buildSeedManifest({
      anchorAt: anchorAt.toISOString(),
      counts: SEED_GOLDEN_COUNTS,
      identities,
      seedVersion: SEED_DATASET_VERSION,
    });
    const updateMany = vi.fn(async () => ({ count: 1 }));

    await completeSeedRun(
      database({ updateMany, findUnique: vi.fn() }),
      envelope,
      () => new Date("2026-07-20T10:01:00.000Z"),
    );

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        completedAt: new Date("2026-07-20T10:01:00.000Z"),
        manifestHash: envelope.manifestSha256,
      },
      where: expect.objectContaining({ manifestHash: null, completedAt: null }),
    });
  });

  it("accepts a concurrent seal only when the result hash matches", async () => {
    const envelope = buildSeedManifest({
      anchorAt: anchorAt.toISOString(),
      counts: SEED_GOLDEN_COUNTS,
      identities,
      seedVersion: SEED_DATASET_VERSION,
    });

    await expect(
      completeSeedRun(
        database({
          updateMany: vi.fn(async () => ({ count: 0 })),
          findUnique: vi.fn(async () =>
            row({
              completedAt: new Date("2026-07-20T10:01:00.000Z"),
              manifestHash: "f".repeat(64),
            }),
          ),
        }),
        envelope,
      ),
    ).rejects.toBeInstanceOf(SeedLifecycleError);
  });
});
