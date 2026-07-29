import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { getWorkerHandlerDefinition } from "@/lib/ops/handler-catalog";
import { measureAndPersistSitemapCapacity } from "@/lib/seo/sitemap-capacity-monitor";
import { PUBLIC_SITEMAP_STATIC_PATHS } from "@/lib/seo/public-sitemap";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase30_sitemap_capacity");
  database = createDatabaseClient(migrated.connectionString);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase 30 PostgreSQL sitemap capacity monitor", () => {
  it("persists exact successful counts, bytes, runtime, owner and forecast", async () => {
    const result = await measureAndPersistSitemapCapacity({
      database: db(),
      origin: "http://localhost:3000",
      now: new Date("2026-07-29T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      urlCount: PUBLIC_SITEMAP_STATIC_PATHS.length,
      level: "HEALTHY",
      shardImplementationTriggered: false,
    });
    expect(result.estimatedBytes).toBeGreaterThan(0);
    expect(result.runtimeMs).toBeGreaterThanOrEqual(0);

    await expect(
      db().sitemapCapacityObservation.findUniqueOrThrow({
        where: { id: result.observationId },
      }),
    ).resolves.toMatchObject({
      resourceKey: "public-sitemap",
      urlCount: PUBLIC_SITEMAP_STATIC_PATHS.length,
      capacityLevel: "HEALTHY",
      owner: "SEO / Platform Operations",
      successful: true,
    });
  });

  it("records a failed run fail-closed and leaves the evidence append-only", async () => {
    await expect(
      measureAndPersistSitemapCapacity({
        database: db(),
        origin: "http://localhost:3000",
        now: new Date("2026-07-30T00:00:00.000Z"),
        buildSitemap: async () => {
          throw new Error("SYNTHETIC_SITEMAP_TIMEOUT");
        },
      }),
    ).rejects.toThrow("SYNTHETIC_SITEMAP_TIMEOUT");

    const failed = await db().sitemapCapacityObservation.findFirstOrThrow({
      where: { successful: false },
      orderBy: { observedAt: "desc" },
    });
    expect(failed).toMatchObject({
      urlCount: PUBLIC_SITEMAP_STATIC_PATHS.length,
      capacityLevel: "EXPANSION_BLOCKED",
      owner: "SEO / Platform Operations",
      successful: false,
    });
    await expect(
      db().sitemapCapacityObservation.update({
        where: { id: failed.id },
        data: { successful: true },
      }),
    ).rejects.toThrow();
  });

  it("registers the monitor as a daily implemented worker", () => {
    expect(
      getWorkerHandlerDefinition("seo.sitemap-capacity", "v1"),
    ).toMatchObject({
      execution: "IMPLEMENTED",
      schedule: "day-boundary",
      owner: "SEO / Platform Operations",
    });
  });
});

function db() {
  if (database === undefined) {
    throw new Error("Sitemap capacity test database unavailable.");
  }
  return database;
}
