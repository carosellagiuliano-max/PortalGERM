import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/(auth)/session/clear/route";

describe("GET /session/clear", () => {
  it("does not mutate cookies from a GET request", async () => {
    const response = await GET(
      new Request(
        "https://swisstalenthub.test/session/clear?next=%2Fcandidate%2Fdashboard",
        { headers: { cookie: "session=attacker-forced-target" } },
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBe(
      "https://swisstalenthub.test/login?reason=session&next=%2Fcandidate%2Fdashboard",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("does not reflect an unsafe next destination", async () => {
    const response = await GET(
      new Request(
        "https://swisstalenthub.test/session/clear?next=https%3A%2F%2Fevil.test",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://swisstalenthub.test/login?reason=session",
    );
  });
});
