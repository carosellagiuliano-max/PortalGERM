import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresRateLimitStore,
  type RateLimitCheck,
} from "@/lib/auth/rate-limit";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let database: MigratedDatabase | undefined;
let firstClient: DatabaseClient | undefined;

const CHECK: RateLimitCheck = Object.freeze({
  namespace: "v1:TEST:USER",
  keyHash: `test:${"a".repeat(64)}`,
  scope: "USER",
  limit: 10,
  windowMs: 60_000,
});
const SHARED_CLIENT_CHECK: RateLimitCheck = Object.freeze({
  namespace: "v1:TEST:SHARED_CLIENTS",
  keyHash: `test:${"b".repeat(64)}`,
  scope: "USER",
  limit: 6,
  windowMs: 60_000,
});
const NOW = new Date("2026-07-19T12:00:00.000Z");

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase03_rate_limit");
  firstClient = createDatabaseClient(database.connectionString);
});

afterAll(async () => {
  await firstClient?.$disconnect();
  await database?.dispose();
});

describe("PostgreSQL atomic rolling rate-limit store", () => {
  it("allows exactly ten of eleven concurrent attempts", async () => {
    if (!firstClient) throw new Error("Test database client is unavailable.");
    const store = createPostgresRateLimitStore(firstClient);
    const decisions = await Promise.all(
      Array.from({ length: 11 }, () => store.consume([CHECK], NOW)),
    );
    expect(decisions.filter(({ allowed }) => allowed)).toHaveLength(10);
    const blocked = decisions.filter(({ allowed }) => !allowed);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({
      allowed: false,
      blockedScope: "USER",
      retryAfterMilliseconds: 60_000,
    });
  });

  it("survives a client/store restart and reopens at the half-open boundary", async () => {
    if (!database) throw new Error("Test database is unavailable.");
    const restartedClient = createDatabaseClient(database.connectionString);
    try {
      const restartedStore = createPostgresRateLimitStore(restartedClient);
      await expect(restartedStore.consume([CHECK], new Date(NOW.getTime() + 1_000))).resolves.toMatchObject({ allowed: false });
      await expect(restartedStore.consume([CHECK], new Date(NOW.getTime() + 60_000))).resolves.toEqual({ allowed: true });
    } finally {
      await restartedClient.$disconnect();
    }
  });

  it("enforces one global limit across two independent clients and stores", async () => {
    if (!database || !firstClient)
      throw new Error("Test database is unavailable.");
    const leftClient = createDatabaseClient(database.connectionString);
    const rightClient = createDatabaseClient(database.connectionString);
    try {
      const leftStore = createPostgresRateLimitStore(leftClient);
      const rightStore = createPostgresRateLimitStore(rightClient);
      const decisions = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          (index % 2 === 0 ? leftStore : rightStore).consume(
            [SHARED_CLIENT_CHECK],
            NOW,
          ),
        ),
      );

      expect(decisions.filter(({ allowed }) => allowed)).toHaveLength(6);
      expect(decisions.filter(({ allowed }) => !allowed)).toHaveLength(6);
      expect(
        decisions
          .filter(({ allowed }) => !allowed)
          .every(
            ({ blockedScope, retryAfterMilliseconds }) =>
              blockedScope === "USER" &&
              retryAfterMilliseconds === SHARED_CLIENT_CHECK.windowMs,
          ),
      ).toBe(true);
      await expect(
        firstClient.rateLimitBucket.findMany({
          where: {
            namespace: SHARED_CLIENT_CHECK.namespace,
            keyHash: SHARED_CLIENT_CHECK.keyHash,
          },
          select: { count: true },
        }),
      ).resolves.toEqual([{ count: SHARED_CLIENT_CHECK.limit }]);
    } finally {
      await Promise.all([leftClient.$disconnect(), rightClient.$disconnect()]);
    }
  });
});
