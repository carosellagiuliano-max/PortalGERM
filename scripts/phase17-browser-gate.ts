import {
  spawn,
  execFileSync,
  type ChildProcessByStdio,
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { parseEnvironment } from "@/lib/config/env-schema";
import {
  candidateWorkflowSeedCryptoFromEnvironment,
} from "@/prisma/seed/blocks/candidate-workflows";
import { runDemoSeed } from "@/prisma/seed/orchestrator";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";
import { PHASE17_FIXTURE_VERSION } from "@/tests/e2e/phase17-cases";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import {
  PHASE17_NETWORK_POLICY,
  validatePhase17RunManifest,
  type Phase17RunIdentity,
} from "@/tests/e2e/manifest-contract";

const HOST = "127.0.0.1";
const SERVER_TIMEOUT_MILLISECONDS = 90_000;
const MAXIMUM_DIAGNOSTIC_CHARACTERS = 24_000;
const manifestPath = resolve(
  process.cwd(),
  "test-results",
  "phase17",
  "run-manifest.json",
);
const clockPath = resolve(
  process.cwd(),
  "test-results",
  "phase17",
  "logical-clock.json",
);
const playwrightArguments = Object.freeze(process.argv.slice(2));

type ChildExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

type RuntimeChild = ChildProcessByStdio<null, Readable, Readable>;

await main();

async function main() {
  if (!existsSync(resolve(process.cwd(), ".next", "BUILD_ID"))) {
    throw new Error(
      "Phase 17 browser E2E requires a production build. Run `npm run build` first.",
    );
  }

  mkdirSync(dirname(manifestPath), { recursive: true });
  rmSync(manifestPath, { force: true });
  writeFileSync(
    clockPath,
    `${JSON.stringify({ offsetMilliseconds: 0 })}\n`,
    "utf8",
  );

  loadLocalEnvironment();
  const database = await createMigratedTestDatabase("phase17_browser");
  try {
    const runIdentity = createRunIdentity(database.databaseName);
    const port = await allocatePort();
    const baseUrl = `http://${HOST}:${port}`;
    const runtimeEnvironment = parseEnvironment({
      ...process.env,
      APP_ENV: "local",
      NODE_ENV: "production",
      APP_URL: baseUrl,
      APP_BUILD_ID: "phase17-browser-gate",
      DATABASE_URL: database.connectionString,
      TEST_DATABASE_URL: undefined,
    });
    await runDemoSeed({
      APP_ENV: "local",
      DATABASE_URL: database.connectionString,
      ENABLE_DEMO_SEED: "true",
    }, {
      candidateWorkflowCrypto:
        candidateWorkflowSeedCryptoFromEnvironment(runtimeEnvironment),
    });
    const runtime = await startServer(database.connectionString, baseUrl, port);
    let playwrightExit: ChildExit;
    try {
      await waitUntilReady(baseUrl, runtime);
      playwrightExit = await runPlaywright({
        baseUrl,
        databaseUrl: database.connectionString,
        runIdentity,
      });
    } finally {
      await stopChild(runtime.child, runtime.exit);
    }

    if (playwrightExit.code !== 0) {
      throw new Error(
        `Phase 17 browser suite failed (code ${String(playwrightExit.code)}, signal ${String(playwrightExit.signal)}).\nServer diagnostics:\n${redact(runtime.diagnostics())}`,
      );
    }
    validateRunManifest(
      playwrightArguments.length === 0 ? "full" : "targeted",
      runIdentity,
    );
    console.info(
      playwrightArguments.length === 0
        ? `Phase 17 browser gate passed: E2E-01–07 plus desktop/mobile quality checks; manifest ${relativePath(manifestPath)}.`
        : `Phase 17 targeted browser run passed (${playwrightArguments.join(" ")}); manifest ${relativePath(manifestPath)}.`,
    );
  } finally {
    await database.dispose();
  }
}

async function startServer(
  databaseUrl: string,
  baseUrl: string,
  port: number,
) {
  const nextBinary = resolve(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const runtimeGuard = resolve(
    process.cwd(),
    "scripts",
    "e2e",
    "runtime-guard.cjs",
  );
  if (!existsSync(nextBinary) || !existsSync(runtimeGuard)) {
    throw new Error("The local Next.js binary or Phase 17 runtime guard is missing.");
  }
  const child = spawn(
    process.execPath,
    [
      "--require",
      runtimeGuard,
      nextBinary,
      "start",
      "--hostname",
      HOST,
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "local",
        NODE_ENV: "production",
        APP_URL: baseUrl,
        APP_BUILD_ID: "phase17-browser-gate",
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: "",
        RATE_LIMIT_BACKEND: "postgres",
        TRUSTED_PROXY_HOPS: "0",
        ENABLE_LOCAL_MOCK_MAILBOX: "false",
        DEV_MAILBOX_SECRET: "",
        STRIPE_SECRET_KEY: "",
        EMAIL_PROVIDER_API_KEY: "",
        OPENAI_API_KEY: "",
        STORAGE_ENDPOINT: "",
        JOBROOM_API_URL: "",
        MAPS_API_KEY: "",
        NEXT_TELEMETRY_DISABLED: "1",
        PHASE17_CLOCK_FILE: clockPath,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const exit = childExit(child);
  let diagnostics = "";
  const record = (chunk: Buffer | string) => {
    diagnostics = `${diagnostics}${chunk.toString()}`.slice(
      -MAXIMUM_DIAGNOSTIC_CHARACTERS,
    );
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  return Object.freeze({ child, exit, diagnostics: () => diagnostics });
}

async function waitUntilReady(
  baseUrl: string,
  runtime: Awaited<ReturnType<typeof startServer>>,
) {
  const deadline = Date.now() + SERVER_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    if (
      runtime.child.exitCode !== null ||
      runtime.child.signalCode !== null
    ) {
      const state = await runtime.exit;
      throw new Error(
        `Phase 17 server exited early (code ${String(state.code)}, signal ${String(state.signal)}):\n${redact(runtime.diagnostics())}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/health/ready`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status === 200) return;
    } catch {
      // The bounded loop waits until Next and PostgreSQL are both ready.
    }
    await delay(200);
  }
  throw new Error(
    `Phase 17 server did not become ready:\n${redact(runtime.diagnostics())}`,
  );
}

async function runPlaywright(input: Readonly<{
  baseUrl: string;
  databaseUrl: string;
  runIdentity: Phase17RunIdentity;
}>) {
  const playwrightCli = resolve(
    process.cwd(),
    "node_modules",
    "@playwright",
    "test",
    "cli.js",
  );
  if (!existsSync(playwrightCli)) {
    throw new Error("The pinned Playwright CLI is missing. Run `npm ci` first.");
  }
  const child = spawn(
    process.execPath,
    [
      playwrightCli,
      "test",
      "--config=playwright.config.ts",
      ...playwrightArguments,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: input.databaseUrl,
        PHASE17_BASE_URL: input.baseUrl,
        PHASE17_CLOCK_FILE: clockPath,
        PHASE17_MANIFEST_PATH: manifestPath,
        PHASE17_COMMIT_SHA: input.runIdentity.commit,
        PHASE17_DATABASE_RUN_ID:
          input.runIdentity.database.anonymousRunId,
        PHASE17_MIGRATION_COUNT: String(
          input.runIdentity.database.migrationCount,
        ),
        PHASE17_MIGRATION_HASH:
          input.runIdentity.database.migrationHash,
        PHASE17_PLAYWRIGHT_VERSION:
          input.runIdentity.runtime.playwright,
        PHASE17_NPM_VERSION: input.runIdentity.runtime.npm,
      },
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  return new Promise<ChildExit>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolveExit(Object.freeze({ code, signal })),
    );
  });
}

function validateRunManifest(
  mode: "full" | "targeted",
  expectedIdentity: Phase17RunIdentity,
) {
  validatePhase17RunManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    { mode, expectedIdentity },
  );
}

function createRunIdentity(databaseName: string): Phase17RunIdentity {
  const migrations = migrationContract();
  return Object.freeze({
    fixtureVersion: PHASE17_FIXTURE_VERSION,
    commit: commitSha(),
    runtime: Object.freeze({
      node: process.version,
      npm: npmVersion(),
      playwright: packageVersion(
        resolve(
          process.cwd(),
          "node_modules",
          "@playwright",
          "test",
          "package.json",
        ),
      ),
    }),
    database: Object.freeze({
      anonymousRunId: createHash("sha256")
        .update(databaseName, "utf8")
        .digest("hex")
        .slice(0, 24),
      migrationCount: migrations.count,
      migrationHash: migrations.hash,
    }),
    networkPolicy: PHASE17_NETWORK_POLICY,
  });
}

function migrationContract() {
  const directory = resolve(process.cwd(), "prisma", "migrations");
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(directory, entry.name, "migration.sql"))
    .filter(existsSync)
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relativePath(file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return Object.freeze({ count: files.length, hash: hash.digest("hex") });
}

function packageVersion(path: string) {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    version?: unknown;
  };
  return typeof parsed.version === "string" ? parsed.version : "unknown";
}

function npmVersion() {
  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined || !existsSync(npmCli)) {
    throw new Error(
      "Phase 17 browser E2E must be launched through npm so the actual npm CLI can be identified.",
    );
  }
  const version = execFileSync(process.execPath, [npmCli, "--version"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error("The active npm CLI returned an invalid version.");
  }
  return version;
}

function commitSha() {
  const fromEnvironment = process.env.GITHUB_SHA;
  if (
    fromEnvironment !== undefined &&
    /^[0-9a-f]{40}$/iu.test(fromEnvironment)
  ) {
    return fromEnvironment.toLowerCase();
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return "unknown";
  }
}

function childExit(child: RuntimeChild) {
  return new Promise<ChildExit>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolveExit(Object.freeze({ code, signal })),
    );
  });
}

async function stopChild(child: RuntimeChild, exit: Promise<ChildExit>) {
  if (child.exitCode !== null || child.signalCode !== null) {
    await exit;
    return;
  }
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exit.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exit;
  }
}

function allocatePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: HOST, port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a free loopback port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function redact(value: string) {
  return value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(
      /((?:secret|token|password|authorization|cookie)[\w.-]*\s*[:=]\s*)[^\s,;]+/giu,
      "$1[REDACTED]",
    );
}

function relativePath(path: string) {
  return resolve(path)
    .replace(resolve(process.cwd()), "")
    .replace(/^[/\\]+/u, "")
    .replaceAll("\\", "/");
}
