// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(() => ({ value: "A".repeat(43) })),
  set: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: vi.fn(async () => ({})),
  isValidAuthMutationOrigin: vi.fn(() => true),
}));

import { POST } from "@/app/(auth)/session/refresh/route";

describe("session refresh route", () => {
  it("does not overwrite a newly rotated cookie when a racing old-token request gets 401", async () => {
    const response = await POST();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });
});
