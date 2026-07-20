import { describe, expect, it, vi } from "vitest";

import {
  DemoSeedGuardError,
  createGuardedSeedClient,
  guardDemoSeedEnvironment,
} from "@/prisma/seed/guard";

const LOCAL_DATABASE =
  "postgresql://seed:local-only@127.0.0.1:5434/swisstalenthub?schema=public";

describe("Phase-05 demo seed guard", () => {
  it.each(["production", "staging"])(
    "blocks %s before constructing a database client",
    (appEnvironment) => {
      const factory = vi.fn(() => ({ connected: false }));

      expectGuardError(() =>
        createGuardedSeedClient(
          {
            APP_ENV: appEnvironment,
            DATABASE_URL: LOCAL_DATABASE,
            ENABLE_DEMO_SEED: "true",
          },
          factory,
        ),
        "PRODUCTION_LIKE_ENVIRONMENT",
      );
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it("allows local seed only on a loopback non-production target", () => {
    expect(
      guardDemoSeedEnvironment({
        APP_ENV: "local",
        DATABASE_URL: LOCAL_DATABASE,
      }),
    ).toEqual({ appEnvironment: "local", mode: "LOCAL_LOOPBACK" });

    expectGuardError(() =>
      guardDemoSeedEnvironment({
        APP_ENV: "local",
        DATABASE_URL:
          "postgresql://seed:secret@database.internal/swisstalenthub",
      }),
      "LOCAL_DATABASE_NOT_LOOPBACK",
    );

    expectGuardError(() =>
      guardDemoSeedEnvironment({
        APP_ENV: "local",
        DATABASE_URL:
          "postgresql://seed:secret@127.0.0.1/swisstalenthub_production",
      }),
      "PRODUCTION_LABELLED_DATABASE",
    );
  });

  it("allows CI only on an explicitly CI- or test-labelled database", () => {
    expect(
      guardDemoSeedEnvironment({
        APP_ENV: "ci",
        DATABASE_URL:
          "postgresql://ci:ci-only@database.internal/swisstalenthub_ci",
      }),
    ).toEqual({ appEnvironment: "ci", mode: "CI_TEST" });

    expectGuardError(() =>
      guardDemoSeedEnvironment({
        APP_ENV: "ci",
        DATABASE_URL:
          "postgresql://ci:ci-only@database.internal/swisstalenthub",
      }),
      "CI_DATABASE_NOT_ISOLATED",
    );
  });

  it("allows preview only with the exact explicit opt-in", () => {
    const preview = {
      APP_ENV: "preview",
      DATABASE_URL:
        "postgresql://preview:preview-only@database.internal/swisstalenthub_preview",
    } as const;

    for (const value of [undefined, "false", "TRUE", "1"]) {
      expectGuardError(() =>
        guardDemoSeedEnvironment({
          ...preview,
          ENABLE_DEMO_SEED: value,
        }),
        "PREVIEW_NOT_ENABLED",
      );
    }

    expect(
      guardDemoSeedEnvironment({
        ...preview,
        ENABLE_DEMO_SEED: "true",
      }),
    ).toEqual({ appEnvironment: "preview", mode: "EXPLICIT_PREVIEW" });
  });

  it("fails closed for missing, unsupported or invalid targets without leaking credentials", () => {
    for (const environment of [
      {},
      { APP_ENV: "development", DATABASE_URL: LOCAL_DATABASE },
      { APP_ENV: "local", DATABASE_URL: "not-a-database-url" },
    ]) {
      expect(() => guardDemoSeedEnvironment(environment)).toThrow(
        DemoSeedGuardError,
      );
    }

    const decision = guardDemoSeedEnvironment({
      APP_ENV: "local",
      DATABASE_URL: LOCAL_DATABASE,
    });
    expect(JSON.stringify(decision)).not.toContain("local-only");
    expect(JSON.stringify(decision)).not.toContain("postgresql");
  });

  it("constructs an allowed client exactly once and only after the guard", () => {
    const factory = vi.fn((databaseUrl: string) => ({ databaseUrl }));

    const result = createGuardedSeedClient(
      { APP_ENV: "local", DATABASE_URL: LOCAL_DATABASE },
      factory,
    );

    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(LOCAL_DATABASE);
    expect(result.guard.mode).toBe("LOCAL_LOOPBACK");
  });
});

function expectGuardError(
  action: () => unknown,
  code: DemoSeedGuardError["code"],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DemoSeedGuardError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected DemoSeedGuardError ${code}.`);
}
