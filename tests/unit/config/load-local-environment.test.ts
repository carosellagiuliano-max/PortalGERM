import { loadLocalEnvironment } from "@/scripts/load-local-environment";
import { afterEach, describe, expect, it } from "vitest";

const variableNames = [
  "APP_ENV",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "APP_URL",
  "SESSION_SECRET",
] as const;
const originalValues = Object.fromEntries(
  variableNames.map((name) => [name, process.env[name]]),
) as Record<(typeof variableNames)[number], string | undefined>;

afterEach(() => {
  for (const name of variableNames) {
    const originalValue = originalValues[name];
    if (originalValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalValue;
    }
  }
});

describe("loadLocalEnvironment", () => {
  it("refuses to mix a partial process configuration with local files", () => {
    delete process.env.APP_ENV;
    delete process.env.APP_URL;
    delete process.env.SESSION_SECRET;
    process.env.DATABASE_URL =
      "postgresql://external:secret@database.example/production";

    expect(() => loadLocalEnvironment()).toThrow(
      "Explicit runtime configuration must provide APP_ENV, DATABASE_URL and APP_URL together",
    );
    expect(process.env.APP_ENV).toBeUndefined();
  });

  it("also treats a standalone test URL as explicit configuration", () => {
    delete process.env.APP_ENV;
    delete process.env.DATABASE_URL;
    delete process.env.APP_URL;
    process.env.TEST_DATABASE_URL =
      "postgresql://test:test@127.0.0.1:5432/swisstalenthub_test";

    expect(() => loadLocalEnvironment()).toThrow(
      "Explicit runtime configuration must provide APP_ENV, DATABASE_URL and APP_URL together",
    );
  });

  it("does not supplement a coherent explicit runtime from local files", () => {
    process.env.APP_ENV = "ci";
    process.env.DATABASE_URL =
      "postgresql://ci:ci-only@127.0.0.1:5432/swisstalenthub_ci";
    process.env.APP_URL = "http://127.0.0.1:3000";
    delete process.env.TEST_DATABASE_URL;
    delete process.env.SESSION_SECRET;

    loadLocalEnvironment();

    expect(process.env.SESSION_SECRET).toBeUndefined();
  });
});
