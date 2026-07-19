// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDatabase: vi.fn() }));

import {
  CURRENT_USER_SELECT,
  getCurrentUserFromToken,
  type CurrentUser,
} from "@/lib/auth/current-user";
import { hashSessionToken } from "@/lib/auth/session";

describe("current user safe select", () => {
  it("contains no credential or password fields", () => {
    expect(CURRENT_USER_SELECT).toEqual({
      id: true,
      email: true,
      role: true,
      name: true,
      status: true,
      emailVerifiedAt: true,
    });
    expect(JSON.stringify(CURRENT_USER_SELECT)).not.toMatch(/credential|password/i);
  });

  it("returns null for malformed tokens and delegates only a hash", async () => {
    const findBySessionTokenHash = vi.fn();
    expect(await getCurrentUserFromToken("short", new Date(), { findBySessionTokenHash })).toBeNull();
    expect(findBySessionTokenHash).not.toHaveBeenCalled();

    const user: CurrentUser = {
      id: "user-1", email: "user@example.ch", role: "CANDIDATE", name: "Ada",
      status: "ACTIVE", emailVerifiedAt: null,
    };
    findBySessionTokenHash.mockResolvedValue(user);
    const token = "a".repeat(43);
    expect(await getCurrentUserFromToken(token, new Date("2026-07-19T00:00:00Z"), { findBySessionTokenHash })).toEqual(user);
    expect(findBySessionTokenHash).toHaveBeenCalledWith(
      hashSessionToken(token),
      new Date("2026-07-19T00:00:00Z"),
    );
    expect(findBySessionTokenHash.mock.calls[0]?.[0]).not.toContain(token);
  });
});
