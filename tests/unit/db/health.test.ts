import { checkDatabaseHealth } from "@/lib/db/health";
import { describe, expect, it, vi } from "vitest";

describe("checkDatabaseHealth", () => {
  it("reports readiness after the minimal SELECT succeeds", async () => {
    const query = vi.fn().mockResolvedValue([{ ready: 1 }]);

    await expect(checkDatabaseHealth({ $queryRaw: query })).resolves.toEqual({
      ready: true,
    });
    expect(query).toHaveBeenCalledOnce();
    const [queryParts] = query.mock.calls[0] as [TemplateStringsArray];
    expect(queryParts.join("?").replaceAll(/\s+/g, " ").trim()).toBe(
      "SELECT 1 AS ready",
    );
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
