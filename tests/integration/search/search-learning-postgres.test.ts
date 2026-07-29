import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listAdminSearchLearning,
  reviewAdminSearchLearning,
} from "@/lib/admin/search-learning";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  expireSearchLearningWorkingState,
  recordSearchLearningObservation,
} from "@/lib/search/learning";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-29T12:00:00.000Z");
const SECRET = "phase-30-search-learning-test-secret-is-purpose-separated";
const REVIEWER = "30000000-0000-4000-8000-000000000099";
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase30_search_learning");
  database = createDatabaseClient(migrated.connectionString);
  await database.user.create({
    data: {
      id: REVIEWER,
      email: "phase30-search-reviewer@example.ch",
      emailNormalized: "phase30-search-reviewer@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: NOW,
      identityAssurance: "VERIFIED_EMAIL",
    },
  });
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase 30 privacy-safe search learning", () => {
  it("rejects PII, secret canaries and non-allowlisted filter dimensions", async () => {
    const client = db();
    for (const query of [
      "hans.mueller@example.ch",
      "+41 79 123 45 67",
      "api_key=super-secret-canary",
    ]) {
      await expect(
        recordSearchLearningObservation(
          {
            query,
            contributorId: contributor(1),
            locale: "de-CH",
            resultBucket: "0",
            filters: {},
          },
          { database: client, digestSecret: SECRET, now: NOW },
        ),
      ).resolves.toEqual({
        recorded: false,
        reason: "PII_OR_SECRET",
      });
    }
    await expect(
      recordSearchLearningObservation(
        {
          query: "Pflegefachkraft",
          contributorId: contributor(1),
          locale: "de-CH",
          resultBucket: "0",
          filters: { email: "hans.mueller@example.ch" },
        },
        { database: client, digestSecret: SECRET, now: NOW },
      ),
    ).resolves.toEqual({
      recorded: false,
      reason: "INVALID",
    });
    await expect(client.searchLearningAggregate.count()).resolves.toBe(0);
  });

  it("requires ten distinct pseudonymous contributors before becoming actionable", async () => {
    const client = db();
    let aggregateId = "";
    for (let index = 1; index <= 9; index += 1) {
      const result = await record(client, "Pflegefachkraft Zuerich", index);
      expect(result.recorded).toBe(true);
      if (result.recorded) {
        aggregateId = result.aggregateId;
        expect(result.observationCount).toBe(index);
        expect(result.actionable).toBe(false);
      }
    }

    const replay = await record(client, "Pflegefachkraft Zuerich", 9);
    expect(replay).toMatchObject({
      recorded: true,
      aggregateId,
      observationCount: 9,
      actionable: false,
    });
    await expect(
      client.searchLearningAggregate.findUniqueOrThrow({
        where: { id: aggregateId },
        select: { reviewLabel: true },
      }),
    ).resolves.toEqual({ reviewLabel: null });

    const threshold = await record(client, "Pflegefachkraft Zuerich", 10);
    expect(threshold).toMatchObject({
      recorded: true,
      aggregateId,
      observationCount: 10,
      actionable: true,
    });
    await expect(
      client.searchLearningAggregate.findUniqueOrThrow({
        where: { id: aggregateId },
        select: {
          status: true,
          observationCount: true,
          conceptKeys: true,
          reviewLabel: true,
          tokenBucket: true,
          filterFingerprint: true,
        },
      }),
    ).resolves.toMatchObject({
      status: "ACTIONABLE",
      observationCount: 10,
      conceptKeys: ["occupation:pflegefachperson", "location:ch-zh"],
      reviewLabel: "pflegefachkraft zuerich",
      tokenBucket: expect.stringMatching(/^[a-f0-9]{64}$/u),
      filterFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    await expect(
      client.searchLearningContribution.count({
        where: { aggregateId },
      }),
    ).resolves.toBe(10);
    await expect(
      client.searchLearningEvent.count({
        where: { aggregateId, kind: "BECAME_ACTIONABLE" },
      }),
    ).resolves.toBe(1);

    const columns = await migratedDb().pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('SearchLearningAggregate', 'SearchLearningContribution')`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).not.toEqual(
      expect.arrayContaining(["query", "rawQuery", "email", "phone"]),
    );
    expect(
      JSON.stringify(
        await client.searchLearningAggregate.findUniqueOrThrow({
          where: { id: aggregateId },
        }),
      ),
    ).not.toContain("Pflegefachkraft");
  });

  it("enforces review then promoted release feedback exactly once", async () => {
    const client = db();
    const aggregate = await client.searchLearningAggregate.findFirstOrThrow({
      where: { status: "ACTIONABLE" },
      select: { id: true },
    });
    const reviewInput = {
      aggregateId: aggregate.id,
      idempotencyKey: "phase30-review-once",
      action: "REVIEW" as const,
      reasonCode: "CORPUS_REVIEWED",
    };
    await expect(
      reviewAdminSearchLearning(
        reviewInput,
        adminDependencies(client, [], new Date(NOW.getTime() + 1_000)),
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(
      reviewAdminSearchLearning(
        reviewInput,
        adminDependencies(
          client,
          ["ADMIN_TAXONOMY_MANAGE"],
          new Date(NOW.getTime() + 1_000),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { aggregateId: aggregate.id, status: "REVIEWED" },
    });
    await expect(
      reviewAdminSearchLearning(
        reviewInput,
        adminDependencies(
          client,
          ["ADMIN_TAXONOMY_MANAGE"],
          new Date(NOW.getTime() + 2_000),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      replay: true,
      value: { status: "REVIEWED" },
    });

    await expect(
      reviewAdminSearchLearning(
        {
          ...reviewInput,
          idempotencyKey: "phase30-promote-once",
          action: "PROMOTE",
          reasonCode: "RELEASE_OUTCOME_BOUND",
          releaseOutcomeCode: "TAXONOMY_DE_CH_V2",
        },
        adminDependencies(
          client,
          ["ADMIN_TAXONOMY_MANAGE"],
          new Date(NOW.getTime() + 3_000),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: "PROMOTED" },
    });
    await expect(
      client.searchLearningEvent.count({
        where: {
          aggregateId: aggregate.id,
          kind: { in: ["REVIEWED", "PROMOTED"] },
        },
      }),
    ).resolves.toBe(2);
    await expect(
      client.auditLog.count({
        where: {
          actorUserId: REVIEWER,
          targetId: aggregate.id,
          action: "TAXONOMY_CHANGED",
          capability: "ADMIN_TAXONOMY_MANAGE",
        },
      }),
    ).resolves.toBe(2);
    await expect(
      listAdminSearchLearning(
        adminDependencies(
          client,
          ["ADMIN_TAXONOMY_MANAGE"],
          new Date(NOW.getTime() + 4_000),
        ),
      ),
    ).resolves.toEqual([]);
  });

  it("expires restricted working state exactly at the 30-day boundary", async () => {
    const client = db();
    const hidden = await record(client, "unbekannter fachbegriff", 77);
    if (!hidden.recorded)
      throw new Error("Expected the safe query to be recorded.");
    let actionableId = "";
    for (let index = 88; index < 98; index += 1) {
      const actionable = await record(client, "veralteter lernbegriff", index);
      if (!actionable.recorded)
        throw new Error("Expected the k-anonymous query to be recorded.");
      actionableId = actionable.aggregateId;
    }
    await expect(
      client.searchLearningAggregate.findUniqueOrThrow({
        where: { id: actionableId },
        select: { status: true, reviewLabel: true },
      }),
    ).resolves.toEqual({
      status: "ACTIONABLE",
      reviewLabel: "veralteter lernbegriff",
    });
    const exactBoundary = new Date("2026-08-28T00:00:00.000Z");
    await expect(
      expireSearchLearningWorkingState(client, exactBoundary),
    ).resolves.toEqual({
      expired: 3,
    });
    await expect(
      client.searchLearningAggregate.findMany({
        where: { id: { in: [hidden.aggregateId, actionableId] } },
        orderBy: { id: "asc" },
        select: { status: true, reviewLabel: true },
      }),
    ).resolves.toEqual([
      { status: "EXPIRED", reviewLabel: null },
      { status: "EXPIRED", reviewLabel: null },
    ]);
    await expect(
      expireSearchLearningWorkingState(client, exactBoundary),
    ).resolves.toEqual({
      expired: 0,
    });
    await expect(
      client.searchLearningEvent.count({
        where: { aggregateId: hidden.aggregateId, kind: "EXPIRED" },
      }),
    ).resolves.toBe(1);
    await expect(
      client.searchLearningContribution.count({
        where: { aggregateId: { in: [hidden.aggregateId, actionableId] } },
      }),
    ).resolves.toBe(0);
    await expect(
      client.searchLearningAggregate.findFirstOrThrow({
        where: { releaseOutcomeCode: "TAXONOMY_DE_CH_V2" },
        select: { status: true, reviewLabel: true },
      }),
    ).resolves.toEqual({ status: "EXPIRED", reviewLabel: null });
  });

  it("serializes ten concurrent contributors without losing or duplicating the threshold event", async () => {
    const client = db();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        record(client, "gleichzeitiger suchbegriff", 200 + index),
      ),
    );
    expect(results.every(({ recorded }) => recorded)).toBe(true);
    const aggregateIds = new Set(
      results.flatMap((result) =>
        result.recorded ? [result.aggregateId] : [],
      ),
    );
    expect(aggregateIds.size).toBe(1);
    const [aggregateId] = aggregateIds;
    if (aggregateId === undefined)
      throw new Error("Expected one concurrent search-learning aggregate.");
    await expect(
      client.searchLearningAggregate.findUniqueOrThrow({
        where: { id: aggregateId },
        select: {
          observationCount: true,
          reviewLabel: true,
          status: true,
        },
      }),
    ).resolves.toEqual({
      observationCount: 10,
      reviewLabel: "gleichzeitiger suchbegriff",
      status: "ACTIONABLE",
    });
    await expect(
      client.searchLearningEvent.count({
        where: { aggregateId, kind: "BECAME_ACTIONABLE" },
      }),
    ).resolves.toBe(1);
  });
});

function record(
  client: DatabaseClient,
  query: string,
  contributorIndex: number,
) {
  return recordSearchLearningObservation(
    {
      query,
      contributorId: contributor(contributorIndex),
      locale: "de-CH",
      resultBucket: "0",
      filters: { canton: "zuerich", sort: "relevance" },
    },
    { database: client, digestSecret: SECRET, now: NOW },
  );
}

function contributor(index: number): string {
  return `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function adminDependencies(
  client: DatabaseClient,
  capabilities: readonly "ADMIN_TAXONOMY_MANAGE"[],
  now: Date,
) {
  return {
    actor: {
      userId: REVIEWER,
      email: "phase30-search-reviewer@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
      capabilities,
    },
    correlationId: "30000000-0000-4000-8000-000000000098",
    database: client,
    now,
  } as const;
}

function db(): DatabaseClient {
  if (database === undefined)
    throw new Error("Search-learning database unavailable.");
  return database;
}

function migratedDb(): MigratedDatabase {
  if (migrated === undefined)
    throw new Error("Search-learning database unavailable.");
  return migrated;
}
