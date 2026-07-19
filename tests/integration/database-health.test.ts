import { createDatabaseClient } from "@/lib/db/factory";
import { checkDatabaseHealth } from "@/lib/db/health";
import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";
import { describe, expect, it } from "vitest";

describe("isolated PostgreSQL readiness", () => {
  it("uses only TEST_DATABASE_URL and completes a read-only smoke query", async () => {
    const configuration = getIsolatedTestDatabaseConfiguration();
    const database = createDatabaseClient(configuration.connectionString);

    try {
      await expect(checkDatabaseHealth(database)).resolves.toEqual({ ready: true });

      const rows = await database.$queryRaw<Array<{ database_name: string }>>`
        SELECT current_database() AS database_name
      `;
      expect(rows[0]?.database_name).toBe(configuration.databaseName);
    } finally {
      await database.$disconnect();
    }
  });
});
