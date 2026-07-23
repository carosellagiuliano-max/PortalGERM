import {
  checkDatabaseHealth,
  REQUIRED_MIGRATION_ID,
} from "@/lib/db/health";
import { describe, expect, it, vi } from "vitest";

describe("checkDatabaseHealth", () => {
  it("reports readiness after the bounded schema and migration check succeeds", async () => {
    const query = vi.fn().mockResolvedValue([{ ready: true }]);

    await expect(checkDatabaseHealth({ $queryRaw: query })).resolves.toEqual({
      ready: true,
    });
    expect(query).toHaveBeenCalledOnce();
    const [queryParts, requiredMigrationId] = query.mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    const statement = queryParts.join("?").replaceAll(/\s+/g, " ").trim();
    expect(statement).toContain(`to_regclass('public."User"')`);
    expect(statement).toContain(`to_regclass('public."_prisma_migrations"')`);
    expect(statement).toContain('FROM "_prisma_migrations"');
    expect(statement).toContain("finished_at IS NULL");
    expect(statement).toContain("rolled_back_at IS NULL");
    expect(statement).toContain("migration_name = ?");
    expect(requiredMigrationId).toBe(REQUIRED_MIGRATION_ID);
  });

  it("fails readiness when the database is reachable but migrations are incomplete", async () => {
    const query = vi.fn().mockResolvedValue([{ ready: false }]);

    await expect(checkDatabaseHealth({ $queryRaw: query })).resolves.toEqual({
      ready: false,
      reason: "database_unavailable",
    });
  });

  it("maps database failures to a stable non-sensitive reason", async () => {
    const secretCanary = "driver-secret-canary";
    const query = vi.fn().mockRejectedValue(new Error(secretCanary));

    const result = await checkDatabaseHealth({ $queryRaw: query });

    expect(result).toEqual({
      ready: false,
      reason: "database_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain(secretCanary);
  });

  it("bounds a stalled readiness query", async () => {
    const query = vi.fn(() => new Promise<never>(() => undefined));

    await expect(
      checkDatabaseHealth({ $queryRaw: query }, 5),
    ).resolves.toEqual({
      ready: false,
      reason: "database_unavailable",
    });
  });
});
