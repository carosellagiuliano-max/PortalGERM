import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresRadarDistinctFilterBudget } from "@/lib/auth/rate-limit";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const uuid = (sequence: number) =>
  `63000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
const companyIds = Object.freeze({
  concurrent: uuid(1),
  duplicate: uuid(2),
  boundary: uuid(3),
  restart: uuid(4),
  independent: uuid(5),
  fallBoundary: uuid(6),
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (!database) throw new Error("The Radar budget test database is unavailable.");
  return database;
}

function filterHash(sequence: number): string {
  return sequence.toString(16).padStart(64, "0");
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase03_radar_distinct_budget");
  database = createDatabaseClient(migrated.connectionString);
  await database.company.createMany({
    data: Object.entries(companyIds).map(([name, id]) => ({
      id,
      name: `Radar Budget ${name}`,
      slug: `radar-budget-${name}`,
      values: [],
      benefits: [],
    })),
  });
});

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("PostgreSQL Radar distinct-filter budget", () => {
  it("allows exactly 30 of 31 parallel distinct filters across clients for one Company and Zurich day", async () => {
    if (!migrated) throw new Error("The migrated test database is unavailable.");
    const peerClient = createDatabaseClient(migrated.connectionString);
    const budgets = [
      createPostgresRadarDistinctFilterBudget(client()),
      createPostgresRadarDistinctFilterBudget(peerClient),
    ] as const;
    const now = new Date("2026-07-19T12:00:00.000Z");
    const decisions = await Promise.all(
      Array.from({ length: 31 }, (_, index) => {
        const budget = index % 2 === 0 ? budgets[0] : budgets[1];
        return budget.consume({
          companyId: companyIds.concurrent,
          filterHash: filterHash(index + 1),
          now,
        });
      }),
    ).finally(() => peerClient.$disconnect());

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(30);
    expect(decisions.filter((decision) => !decision.allowed)).toEqual([
      expect.objectContaining({
        status: 429,
        code: "RADAR_DISTINCT_FILTER_BUDGET_EXHAUSTED",
        calendarDate: "2026-07-19",
        distinctFiltersUsed: 30,
        retryAfterSeconds: 36_000,
        audit: {
          action: "RATE_LIMITED",
          preset: "RADAR_LIST",
          scope: "COMPANY",
        },
      }),
    ]);
    await expect(
      client().radarSearchBudget.count({
        where: {
          companyId: companyIds.concurrent,
          calendarDate: new Date("2026-07-19T00:00:00.000Z"),
        },
      }),
    ).resolves.toBe(30);
  });

  it("counts a repeated hash once, including parallel retries and retries at a full budget", async () => {
    const budget = createPostgresRadarDistinctFilterBudget(client());
    const now = new Date("2026-07-19T13:00:00.000Z");
    const repeatedHash = filterHash(100);
    const repeated = await Promise.all(
      Array.from({ length: 12 }, () =>
        budget.consume({
          companyId: companyIds.duplicate,
          filterHash: repeatedHash,
          now,
        }),
      ),
    );

    expect(repeated.every((decision) => decision.allowed)).toBe(true);
    expect(
      repeated.filter(
        (decision) => decision.allowed && decision.isNewFilter,
      ),
    ).toHaveLength(1);
    expect(
      repeated.every(
        (decision) => decision.allowed && decision.distinctFiltersUsed === 1,
      ),
    ).toBe(true);

    for (let index = 1; index < 30; index += 1) {
      await budget.consume({
        companyId: companyIds.duplicate,
        filterHash: filterHash(100 + index),
        now,
      });
    }

    await expect(
      budget.consume({
        companyId: companyIds.duplicate,
        filterHash: repeatedHash,
        now: new Date("2026-07-19T13:05:00.000Z"),
      }),
    ).resolves.toMatchObject({
      allowed: true,
      isNewFilter: false,
      distinctFiltersUsed: 30,
      remaining: 0,
    });
    await expect(
      budget.consume({
        companyId: companyIds.duplicate,
        filterHash: filterHash(999),
        now,
      }),
    ).resolves.toMatchObject({ allowed: false, distinctFiltersUsed: 30 });
  });

  it("resets at the Zurich calendar-day boundary, including the DST summer offset", async () => {
    const budget = createPostgresRadarDistinctFilterBudget(client());
    const beforeLocalMidnight = new Date("2026-03-29T21:59:00.000Z");
    const atLocalMidnight = new Date("2026-03-29T22:00:00.000Z");

    for (let index = 0; index < 30; index += 1) {
      await budget.consume({
        companyId: companyIds.boundary,
        filterHash: filterHash(2_000 + index),
        now: beforeLocalMidnight,
      });
    }
    await expect(
      budget.consume({
        companyId: companyIds.boundary,
        filterHash: filterHash(2_999),
        now: beforeLocalMidnight,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      calendarDate: "2026-03-29",
      retryAfterSeconds: 60,
    });
    await expect(
      budget.consume({
        companyId: companyIds.boundary,
        filterHash: filterHash(2_999),
        now: atLocalMidnight,
      }),
    ).resolves.toMatchObject({
      allowed: true,
      calendarDate: "2026-03-30",
      isNewFilter: true,
      distinctFiltersUsed: 1,
      remaining: 29,
    });

    const dates = await client().radarSearchBudget.findMany({
      where: { companyId: companyIds.boundary },
      distinct: ["calendarDate"],
      orderBy: { calendarDate: "asc" },
      select: { calendarDate: true },
    });
    expect(
      dates.map(({ calendarDate }) => calendarDate.toISOString().slice(0, 10)),
    ).toEqual(["2026-03-29", "2026-03-30"]);
  });

  it("uses a 25-hour Zurich budget day when daylight saving time ends", async () => {
    const budget = createPostgresRadarDistinctFilterBudget(client());
    const localMidnight = new Date("2026-10-24T22:00:00.000Z");

    for (let index = 0; index < 30; index += 1) {
      await budget.consume({
        companyId: companyIds.fallBoundary,
        filterHash: filterHash(4_000 + index),
        now: localMidnight,
      });
    }

    await expect(
      budget.consume({
        companyId: companyIds.fallBoundary,
        filterHash: filterHash(4_999),
        now: localMidnight,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      calendarDate: "2026-10-25",
      retryAfterSeconds: 90_000,
    });
    await expect(
      budget.consume({
        companyId: companyIds.fallBoundary,
        filterHash: filterHash(4_999),
        now: new Date("2026-10-25T22:59:59.000Z"),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      calendarDate: "2026-10-25",
      retryAfterSeconds: 1,
    });
    await expect(
      budget.consume({
        companyId: companyIds.fallBoundary,
        filterHash: filterHash(4_999),
        now: new Date("2026-10-25T23:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      allowed: true,
      calendarDate: "2026-10-26",
      isNewFilter: true,
      distinctFiltersUsed: 1,
      remaining: 29,
    });
  });

  it("keeps the exhausted budget after recreating the Prisma client and store", async () => {
    if (!migrated) throw new Error("The migrated test database is unavailable.");
    const now = new Date("2026-12-15T12:00:00.000Z");
    const writer = createDatabaseClient(migrated.connectionString);
    const firstBudget = createPostgresRadarDistinctFilterBudget(writer);
    try {
      for (let index = 0; index < 30; index += 1) {
        await firstBudget.consume({
          companyId: companyIds.restart,
          filterHash: filterHash(3_000 + index),
          now,
        });
      }
    } finally {
      await writer.$disconnect();
    }

    const restartedClient = createDatabaseClient(migrated.connectionString);
    try {
      const restartedBudget = createPostgresRadarDistinctFilterBudget(restartedClient);
      await expect(
        restartedBudget.consume({
          companyId: companyIds.restart,
          filterHash: filterHash(3_999),
          now: new Date("2026-12-15T12:01:00.000Z"),
        }),
      ).resolves.toMatchObject({
        allowed: false,
        calendarDate: "2026-12-15",
        distinctFiltersUsed: 30,
      });
      await expect(
        restartedBudget.consume({
          companyId: companyIds.restart,
          filterHash: filterHash(3_000),
          now: new Date("2026-12-15T12:01:00.000Z"),
        }),
      ).resolves.toMatchObject({
        allowed: true,
        isNewFilter: false,
        distinctFiltersUsed: 30,
      });
    } finally {
      await restartedClient.$disconnect();
    }
  });

  it("rejects non-canonical identifiers and clocks before writing a budget row", async () => {
    const budget = createPostgresRadarDistinctFilterBudget(client());
    const validInput = {
      companyId: companyIds.independent,
      filterHash: "a".repeat(64),
      now: new Date("2026-07-19T12:00:00.000Z"),
    } as const;

    await expect(
      budget.consume({ ...validInput, companyId: "not-a-company-uuid" }),
    ).rejects.toThrow(TypeError);
    await expect(
      budget.consume({
        ...validInput,
        filterHash: validInput.filterHash.toUpperCase(),
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      budget.consume({ ...validInput, now: new Date(Number.NaN) }),
    ).rejects.toThrow(TypeError);
    await expect(
      client().radarSearchBudget.count({
        where: { companyId: companyIds.independent },
      }),
    ).resolves.toBe(0);
  });

  it("scopes an identical filter hash independently to each Company", async () => {
    const budget = createPostgresRadarDistinctFilterBudget(client());
    const decision = await budget.consume({
      companyId: companyIds.independent,
      filterHash: filterHash(1),
      now: new Date("2026-07-19T12:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      allowed: true,
      isNewFilter: true,
      distinctFiltersUsed: 1,
      remaining: 29,
    });
  });
});
