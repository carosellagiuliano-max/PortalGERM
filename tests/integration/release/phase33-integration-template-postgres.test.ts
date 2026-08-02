import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import { resolveIntegrationTemplateDatabaseName } from "@/tests/fixtures/integration-template-policy";
import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

describe("Phase 33 integration database template", () => {
  it("clones the migrated schema without sharing writes or a connectable template", async () => {
    const templateDatabaseName = resolveIntegrationTemplateDatabaseName(
      process.env.TEST_DATABASE_TEMPLATE_NAME,
    );
    expect(templateDatabaseName).toBeDefined();
    expect(
      Buffer.byteLength(templateDatabaseName!, "utf8"),
    ).toBeLessThanOrEqual(63);

    let first:
      | Awaited<ReturnType<typeof createMigratedTestDatabase>>
      | undefined;
    let second:
      | Awaited<ReturnType<typeof createMigratedTestDatabase>>
      | undefined;
    try {
      first = await createMigratedTestDatabase("template-isolation-first");
      second = await createMigratedTestDatabase("template-isolation-second");
      expect(Buffer.byteLength(first.databaseName, "utf8")).toBeLessThanOrEqual(
        63,
      );
      expect(
        Buffer.byteLength(second.databaseName, "utf8"),
      ).toBeLessThanOrEqual(63);
      await first.pool.query(
        'CREATE TABLE "Phase33TemplateIsolationProbe" ("id" integer PRIMARY KEY)',
      );
      await first.pool.query(
        'INSERT INTO "Phase33TemplateIsolationProbe" ("id") VALUES (1)',
      );

      const isolation = await second.pool.query<{ relation: string | null }>(
        `SELECT to_regclass('public."Phase33TemplateIsolationProbe"')::text AS relation`,
      );
      expect(isolation.rows[0]?.relation).toBeNull();

      const [firstHistory, secondHistory] = await Promise.all([
        first.pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
        ),
        second.pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
        ),
      ]);
      expect(Number(firstHistory.rows[0]?.count)).toBeGreaterThan(0);
      expect(firstHistory.rows[0]?.count).toBe(secondHistory.rows[0]?.count);

      const templateClient = new Client({
        connectionString: databaseUrlFor(templateDatabaseName!),
        connectionTimeoutMillis: 2_000,
      });
      await expect(templateClient.connect()).rejects.toBeDefined();
      await templateClient.end().catch(() => undefined);
    } finally {
      const cleanup = await Promise.allSettled([
        first?.dispose() ?? Promise.resolve(),
        second?.dispose() ?? Promise.resolve(),
      ]);
      const failures = cleanup.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length > 0) {
        throw new AggregateError(failures, "Integration clone cleanup failed.");
      }
    }

    if (first === undefined || second === undefined) {
      throw new Error("Integration template clones were not created.");
    }
    await expect(first.dispose()).resolves.toBeUndefined();
    await expect(second.dispose()).resolves.toBeUndefined();
    const maintenance = new Client({
      connectionString: databaseUrlFor("postgres"),
      connectionTimeoutMillis: 2_000,
    });
    await maintenance.connect();
    try {
      const remaining = await maintenance.query<{ database_name: string }>(
        `SELECT datname AS database_name FROM pg_database WHERE datname = ANY($1::text[])`,
        [[first.databaseName, second.databaseName]],
      );
      expect(remaining.rows).toEqual([]);
    } finally {
      await maintenance.end();
    }
  });
});

function databaseUrlFor(databaseName: string) {
  const configuration = getIsolatedTestDatabaseConfiguration();
  const url = new URL(configuration.connectionString);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}
