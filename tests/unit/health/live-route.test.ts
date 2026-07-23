import { GET } from "@/app/health/live/route";
import { describe, expect, it } from "vitest";

describe("GET /health/live", () => {
  it("returns a minimal non-cacheable liveness response", async () => {
    const correlationId = "0196f82d-3fb4-7f1a-8c9d-123456789abc";
    const response = GET(
      new Request("https://swisstalenthub.test/health/live", {
        headers: { "x-correlation-id": correlationId },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      status: "ok",
      buildId: expect.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u),
    });
  });

  it("does not expose configuration, versions or secret-shaped fields", async () => {
    const serialized = JSON.stringify(await GET().json()).toLowerCase();

    expect(serialized).not.toMatch(/database|secret|token|password|environment|process/);
  });
});
