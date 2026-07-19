// @vitest-environment node

import { performance } from "node:perf_hooks";

import { describe, expect, it, vi } from "vitest";

import {
  createBcryptPasswordHasher,
  hashPassword,
  PASSWORD_HASH_POLICY_V1,
  verifyPassword,
  type PasswordHasher,
} from "@/lib/auth/password";

describe("password hashing policy", () => {
  it("pins bcryptjs cost and hashes/verifies without retaining plain text", async () => {
    const startedAt = performance.now();
    const passwordHash = await hashPassword("StrongPassword1!");
    const elapsed = performance.now() - startedAt;

    expect(PASSWORD_HASH_POLICY_V1.cost).toBe(12);
    expect(passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(passwordHash).not.toContain("StrongPassword1!");
    expect(await verifyPassword("StrongPassword1!", passwordHash)).toBe(true);
    expect(await verifyPassword("WrongPassword1!", passwordHash)).toBe(false);
    expect(elapsed).toBeGreaterThan(50);
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);

  it("is swappable and fails closed on malformed hashes", async () => {
    const hasher: PasswordHasher = {
      hash: vi.fn(async () => "adapter-hash"),
      verify: vi.fn(async () => true),
    };
    expect(await hashPassword("x", hasher)).toBe("adapter-hash");
    expect(await verifyPassword("x", "adapter-hash", hasher)).toBe(true);
    expect(await createBcryptPasswordHasher(10).verify("x", "not-a-hash")).toBe(false);
    expect(() => createBcryptPasswordHasher(9)).toThrow(RangeError);
  });
});
