import { describe, expect, it } from "vitest";

import { isSafeTrackedEnvironmentTemplateMatch } from "@/lib/security/release-secret-scan-policy";

describe("release secret scan template policy", () => {
  it.each([
    "postgresql://local:password@127.0.0.1:5434/app",
    "postgresql://local:password@127.0.0.1:5434/app?schema=public",
    "postgres://local:password@localhost:5434/app_test",
    "postgresql://local:password@[::1]:5434/app",
  ])("allows an explicit loopback database template: %s", (value) => {
    expect(
      isSafeTrackedEnvironmentTemplateMatch(
        "DATABASE_URL",
        value,
        ".env.example",
      ),
    ).toBe(true);
  });

  it("allows the same public loopback template in setup tooling", () => {
    const value = "postgresql://local:password@127.0.0.1:5434/app";
    expect(
      isSafeTrackedEnvironmentTemplateMatch(
        "DATABASE_URL",
        value,
        "scripts/env-init.ts",
        value,
      ),
    ).toBe(true);
  });

  it.each([
    [
      "DATABASE_URL",
      "postgresql://user:secret@db.example.com:5432/app",
      ".env.example",
    ],
    [
      "DATABASE_URL",
      "postgresql://user:secret@127.0.0.1:5432/app?sslmode=require",
      ".env.example",
    ],
    ["DATABASE_URL", "postgresql://127.0.0.1/app", ".env.example"],
    [
      "STRIPE_SECRET_KEY",
      "postgresql://user:secret@127.0.0.1:5432/app",
      ".env.example",
    ],
    [
      "DATABASE_URL",
      "postgresql://user:secret@127.0.0.1:5432/app",
      "README.md",
    ],
    ["DATABASE_URL", "not-a-url", ".env.example"],
  ])("rejects non-template or unsafe exact values", (variable, value, path) => {
    expect(isSafeTrackedEnvironmentTemplateMatch(variable, value, path)).toBe(
      false,
    );
  });

  it("rejects a different loopback credential outside the public template", () => {
    expect(
      isSafeTrackedEnvironmentTemplateMatch(
        "DATABASE_URL",
        "postgresql://user:private@127.0.0.1:5432/app",
        "scripts/setup.ts",
        "postgresql://local:public@127.0.0.1:5432/app",
      ),
    ).toBe(false);
  });
});
