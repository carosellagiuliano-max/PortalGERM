import { GET } from "@/app/health/live/route";
import { describe, expect, it } from "vitest";

describe("GET /health/live", () => {
  it("returns a minimal non-cacheable liveness response", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("does not expose configuration, versions or secret-shaped fields", async () => {
    const serialized = JSON.stringify(await GET().json()).toLowerCase();

    expect(serialized).not.toMatch(
      /database|secret|token|password|version|environment|process/,
    );
  });
});
