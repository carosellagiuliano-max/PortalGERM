import { describe, expect, it } from "vitest";

import { phase32IsolatedHarnessEnvironment } from "@/lib/release/phase32-isolated-harness";

describe("Phase 32 isolated harness boundary", () => {
  it("keeps test-database orchestration local while preserving the exact inputs", () => {
    const input: NodeJS.ProcessEnv = {
      APP_ENV: "local",
      NODE_ENV: "test",
      CI: "true",
      DATABASE_URL: "postgresql://local/app",
      TEST_DATABASE_URL: "postgresql://local/app_test",
    };

    const result = phase32IsolatedHarnessEnvironment(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  const unsafeEnvironments: NodeJS.ProcessEnv[] = [
    { APP_ENV: "production", NODE_ENV: "test", CI: "true" },
    { APP_ENV: "local", NODE_ENV: "production", CI: "true" },
    { APP_ENV: "local", NODE_ENV: "test", CI: "false" },
  ];

  it.each(unsafeEnvironments)(
    "rejects an unsafe outer harness environment",
    (environment) => {
      expect(() => phase32IsolatedHarnessEnvironment(environment)).toThrow(
        "only nested builds and servers may run with production semantics",
      );
    },
  );
});
