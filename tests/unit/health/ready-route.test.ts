import { beforeEach, describe, expect, it, vi } from "vitest";

const { database, getDatabase, checkDatabaseHealth } = vi.hoisted(() => {
  const database = { name: "test-double" };
  return {
    database,
    getDatabase: vi.fn(() => database),
    checkDatabaseHealth: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ getDatabase }));
vi.mock("@/lib/db/health", () => ({ checkDatabaseHealth }));

import { GET } from "@/app/health/ready/route";

describe("GET /health/ready", () => {
  beforeEach(() => {
    getDatabase.mockClear();
    checkDatabaseHealth.mockReset();
  });

  it("returns ready when the database health check succeeds", async () => {
    checkDatabaseHealth.mockResolvedValue({ ready: true });
    const correlationId = "0196f82d-3fb4-7f1a-8c9d-123456789abc";

    const response = await GET(
      new Request("https://swisstalenthub.test/health/ready", {
        headers: { "x-correlation-id": correlationId },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(getDatabase).toHaveBeenCalledOnce();
    expect(checkDatabaseHealth).toHaveBeenCalledWith(database);
  });

  it("returns a minimal 503 when the health result is unavailable", async () => {
    checkDatabaseHealth.mockResolvedValue({
      ready: false,
      reason: "database_unavailable",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "unavailable",
      correlationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    });
    expect(response.headers.get("x-correlation-id")).toBe(body.correlationId);
  });

  it("fails closed without leaking an unexpected database error", async () => {
    const secretCanary = "database-secret-canary";
    checkDatabaseHealth.mockRejectedValue(new Error(secretCanary));

    const response = await GET();
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(body).toMatch(
      /^\{"status":"unavailable","correlationId":"[0-9a-f-]+"\}$/u,
    );
    expect(body).not.toContain(secretCanary);
  });
});
