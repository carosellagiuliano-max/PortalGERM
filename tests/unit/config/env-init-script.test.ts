import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parse } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";

import { createValidEnvironment } from "@/tests/fixtures/environment";

const repository = process.cwd();
const script = resolve(repository, "scripts", "env-init.ts");
const tsconfig = resolve(repository, "tsconfig.json");
const tsxCli = resolve(repository, "node_modules", "tsx", "dist", "cli.mjs");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("env:init executable contract", () => {
  it("creates a validated local file once without printing generated secrets", async () => {
    const directory = await temporaryDirectory();
    const first = runEnvInit(directory, ["--non-interactive"]);

    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    const path = join(directory, ".env.local");
    const firstBytes = await readFile(path);
    const values = parse(firstBytes);
    const secretValues = [
      values.SESSION_SECRET,
      keyringSecret(values.AUDIT_IP_HASH_KEYS),
      keyringSecret(values.RADAR_OPAQUE_LOOKUP_KEYS),
      keyringSecret(values.RADAR_OPAQUE_ENCRYPTION_KEYS),
      keyringSecret(values.REVEAL_CONFIRMATION_KEYS),
      keyringSecret(values.PII_REVEAL_KEYS),
      values.DEV_MAILBOX_SECRET,
    ];

    expect(values).toMatchObject({
      APP_ENV: "local",
      NODE_ENV: "development",
      RATE_LIMIT_BACKEND: "postgres",
      STRIPE_SECRET_KEY: "",
      EMAIL_PROVIDER_API_KEY: "",
      OPENAI_API_KEY: "",
      STORAGE_ENDPOINT: "",
      JOBROOM_API_URL: "",
      MAPS_API_KEY: "",
    });
    expect(new Set(secretValues).size).toBe(secretValues.length);
    for (const value of secretValues) {
      expect(value).toBeTruthy();
      expect(first.stdout).not.toContain(value);
    }

    const second = runEnvInit(directory, ["--non-interactive"]);
    expect(second.status).not.toBe(0);
    expect(second.output).toContain("never overwrites");
    await expect(readFile(path)).resolves.toEqual(firstBytes);
  });

  it.each([
    { APP_ENV: "production", NODE_ENV: "production" },
    { APP_ENV: "staging", NODE_ENV: "development" },
  ])("refuses production-like environments before writing", async (override) => {
    const directory = await temporaryDirectory();
    const result = runEnvInit(directory, ["--non-interactive"], override);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("refuses Production and Staging");
    expect(() => readFileSync(join(directory, ".env.local"))).toThrow();
  });

  it("validates a pre-provisioned CI environment without writing a file", async () => {
    const directory = await temporaryDirectory();
    const ciEnvironment = createValidEnvironment({
      APP_ENV: "ci",
      DATABASE_URL:
        "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub_release_ci?schema=public",
      TEST_DATABASE_URL:
        "postgresql://test:test-only@127.0.0.1:5435/swisstalenthub_restore_test?schema=public",
    });
    const result = runEnvInit(directory, ["--ci"], {
      ...withoutUndefined(ciEnvironment),
      CI: "true",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "CI environment validated; no file was written.",
    );
    expect(() => readFileSync(join(directory, ".env.local"))).toThrow();
  });

  it("does not let CI mode bypass the production guard", async () => {
    const directory = await temporaryDirectory();
    const result = runEnvInit(directory, ["--ci"], {
      ...withoutUndefined(createValidEnvironment()),
      APP_ENV: "production",
      NODE_ENV: "production",
      CI: "true",
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("refuses Production and Staging");
    expect(() => readFileSync(join(directory, ".env.local"))).toThrow();
  });
});

function runEnvInit(
  cwd: string,
  args: readonly string[],
  environment: Record<string, string> = {},
) {
  const result = spawnSync(
    process.execPath,
    [tsxCli, "--tsconfig", tsconfig, script, ...args],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...systemEnvironment(),
        ...environment,
        NODE_ENV:
          environment.NODE_ENV === "production"
            ? "production"
            : environment.NODE_ENV === "development"
              ? "development"
              : "test",
      },
      maxBuffer: 1_000_000,
      windowsHide: true,
    },
  );
  return Object.freeze({
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    output: `${result.stdout}${result.stderr}`,
  });
}

function keyringSecret(value: string | undefined) {
  return value?.slice((value.indexOf(":") ?? -1) + 1);
}

function withoutUndefined(input: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function systemEnvironment() {
  const allowed = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
  ] as const;
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "swisstalenthub-env-init-"));
  temporaryDirectories.push(directory);
  return directory;
}
