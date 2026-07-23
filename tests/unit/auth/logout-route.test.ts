import { beforeEach, describe, expect, it, vi } from "vitest";

const { logoutCurrentSession } = vi.hoisted(() => ({
  logoutCurrentSession: vi.fn(),
}));

vi.mock("@/lib/auth/logout-runtime", () => ({ logoutCurrentSession }));

import { POST } from "@/app/(auth)/logout/route";

describe("POST /logout", () => {
  beforeEach(() => {
    logoutCurrentSession.mockReset();
  });

  it("returns a non-cacheable same-site redirect after logout", async () => {
    logoutCurrentSession.mockResolvedValue(undefined);

    const response = await POST(
      new Request("https://swisstalenthub.test/logout", { method: "POST" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://swisstalenthub.test/login?loggedOut=1",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("returns a non-cacheable 403 when the origin guard denies the mutation", async () => {
    logoutCurrentSession.mockRejectedValue(new Error("AUTH_ORIGIN_DENIED"));

    const response = await POST(
      new Request("https://swisstalenthub.test/logout", { method: "POST" }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(await response.text()).toBe("Forbidden");
  });
});
