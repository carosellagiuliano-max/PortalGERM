import { createDatabaseClient } from "@/lib/db/factory";
import { checkDatabaseHealth } from "@/lib/db/health";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import { describe, expect, it } from "vitest";

describe("isolated PostgreSQL readiness", () => {
  it("uses only TEST_DATABASE_URL and verifies a fully migrated database", async () => {
    const isolatedDatabase = await createMigratedTestDatabase("health");
    const database = createDatabaseClient(isolatedDatabase.connectionString);

    try {
      await expect(checkDatabaseHealth(database)).resolves.toEqual({ ready: true });

      const rows = await database.$queryRaw<Array<{ database_name: string }>>`
        SELECT current_database() AS database_name
      `;
      expect(rows[0]?.database_name).toBe(isolatedDatabase.databaseName);
    } finally {
      await database.$disconnect();
      await isolatedDatabase.dispose();
    }
  });
});
