import { spawn } from "node:child_process";
import {
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  join,
  resolve,
} from "node:path";
import { performance } from "node:perf_hooks";

import { Client } from "pg";

import { inspectPostgresTarget } from "@/lib/db/database-target";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";
import {
  redact,
  safeToolEnvironment,
  terminateRecoveryChild,
  type RecoveryChild,
} from "@/scripts/ops/process-tools";

type CommandRecord = Readonly<{
  command: string;
  durationMs: number;
  exitCode: number;
}>;

type RunResult = Readonly<{
  durationMs: number;
  output: string;
}>;

const repository = process.cwd();
const manifestPath = resolve(
  repository,
  "test-results",
  "phase18",
  "run-manifest.json",
);
let npmCli = "";
const runId = randomBytes(8).toString("hex");
const databaseNames = Object.freeze({
  source: `swisstalenthub_release_test_${runId}`,
  restore: `swisstalenthub_restore_test_${runId}`,
  guard: `swisstalenthub_guard_test_${runId}`,
});
const databaseNamePattern =
  /^swisstalenthub_(?:release|restore|guard)_test_[0-9a-f]{16}$/u;
const commands: CommandRecord[] = [];
const startedAt = new Date();
let temporaryRoot: string | undefined;
let cleanup = {
  backupRemoved: false,
  cloneRemoved: false,
  databasesRemoved: false,
  identityRemoved: false,
};

await main();

async function main() {
  let baseDatabaseUrl = "";
  let maintenanceTargetValidated = false;
  let commit = "unknown";
  let branch = "unknown";
  let tools: Awaited<ReturnType<typeof collectToolVersions>> =
    unavailableToolVersions();
  let status: "passed" | "failed" = "failed";
  let failure = "";
  let manifestSha256 = "";
  let checksum = "";
  let backupBytes = 0;
  let sourceSnapshotAt: Date | undefined;
  let backupCompletedAt: Date | undefined;
  let restoreStartedAt: Date | undefined;
  let restoreCompletedAt: Date | undefined;

  try {
    loadLocalEnvironment();
    npmCli = requireNpmCli();
    baseDatabaseUrl = requiredEnvironment("DATABASE_URL");
    assertSafeMaintenanceTarget(baseDatabaseUrl);
    maintenanceTargetValidated = true;
    commit = await gitOutput(["rev-parse", "HEAD"], repository);
    branch = await gitOutput(["branch", "--show-current"], repository);
    tools = await collectToolVersions();

    temporaryRoot = await mkdtemp(
      join(tmpdir(), "swisstalenthub-phase18-"),
    );
    const clone = join(temporaryRoot, "clean-clone");
    const identity = join(temporaryRoot, "phase18-age-identity.txt");
    const backup = join(temporaryRoot, "phase18-release.dump.age");
    const sourceUrl = databaseUrl(baseDatabaseUrl, databaseNames.source);
    const restoreUrl = databaseUrl(baseDatabaseUrl, databaseNames.restore);
    const guardUrl = databaseUrl(baseDatabaseUrl, databaseNames.guard);

    await createDatabases(baseDatabaseUrl, Object.values(databaseNames));
    await run(
      "git clean clone",
      "git",
      ["clone", "--no-local", "--no-checkout", repository, clone],
      { cwd: repository },
    );
    await run(
      "git detached release checkout",
      "git",
      ["checkout", "--detach", commit],
      { cwd: clone },
    );
    const cleanStatus = await gitOutput(["status", "--porcelain"], clone);
    if (cleanStatus !== "") {
      throw new Error("Clean clone contains an unexpected worktree change.");
    }

    const ageTools = resolveAgeTools();
    const recipient = await createAgeIdentity(ageTools.keygen, identity);
    const environment = releaseEnvironment({
      sourceUrl,
      restoreUrl,
      recipient,
      identity,
      commit,
    });

    await runNpm("npm ci", ["ci"], clone, environment, 20 * 60_000);
    await runNpm(
      "env:init CI no-write validation",
      ["run", "env:init", "--", "--ci"],
      clone,
      { ...environment, APP_ENV: "ci", NODE_ENV: "test", CI: "true" },
    );
    if (
      existsSync(join(clone, ".env.local")) ||
      existsSync(join(clone, ".env"))
    ) {
      throw new Error("CI env:init wrote a local environment file.");
    }

    await runNpm("Prisma generate", ["run", "db:generate"], clone, environment);
    await runNpm(
      "release DB migration",
      ["run", "db:migrate"],
      clone,
      environment,
    );
    const firstSeed = await runNpm(
      "deterministic seed first run",
      ["run", "db:seed"],
      clone,
      { ...environment, ENABLE_DEMO_SEED: "true" },
      10 * 60_000,
    );
    const secondSeed = await runNpm(
      "deterministic seed second run",
      ["run", "db:seed"],
      clone,
      { ...environment, ENABLE_DEMO_SEED: "true" },
      10 * 60_000,
    );
    const firstManifest = seedManifest(firstSeed.output);
    const secondManifest = seedManifest(secondSeed.output);
    if (
      firstManifest.manifestSha256 !== secondManifest.manifestSha256 ||
      JSON.stringify(firstManifest) !== JSON.stringify(secondManifest)
    ) {
      throw new Error("Second seed run produced a different sealed manifest.");
    }
    manifestSha256 = firstManifest.manifestSha256;
    sourceSnapshotAt = new Date();
    await runNpm(
      "read-only seed verification",
      ["run", "seed:verify"],
      clone,
      environment,
    );

    await runNpm(
      "guard DB migration",
      ["run", "db:migrate"],
      clone,
      { ...environment, DATABASE_URL: guardUrl },
    );
    const beforeGuard = await domainRowCounts(guardUrl);
    if (Object.values(beforeGuard).some((count) => count !== 0)) {
      throw new Error(
        "Fresh Production-guard database unexpectedly contains domain rows.",
      );
    }
    const guard = await runNpmExpectFailure(
      "Production demo-seed guard",
      ["run", "db:seed"],
      clone,
      {
        ...environment,
        APP_ENV: "production",
        NODE_ENV: "production",
        APP_URL: "https://phase18.invalid",
        APP_BUILD_ID: commit,
        DATABASE_URL: guardUrl,
        TEST_DATABASE_URL: "",
        TRUSTED_PROXY_HOPS: "1",
        ENABLE_DEMO_SEED: "true",
      },
    );
    if (
      !/Demo seed failed: DemoSeedGuardError \(PRODUCTION_LIKE_ENVIRONMENT\)\./u.test(
        guard.output,
      )
    ) {
      throw new Error("Production seed failed for an unexpected reason.");
    }
    const afterGuard = await domainRowCounts(guardUrl);
    if (
      JSON.stringify(afterGuard) !== JSON.stringify(beforeGuard)
    ) {
      throw new Error("Production demo-seed guard allowed a DEMO write.");
    }

    await runNpm(
      "production build",
      ["run", "build"],
      clone,
      { ...environment, NODE_ENV: "production" },
      20 * 60_000,
    );

    await runNpm(
      "encrypted release backup",
      [
        "run",
        "ops:backup",
        "--",
        "--source",
        "release-test",
        "--out",
        backup,
      ],
      clone,
      {
        ...environment,
        AGE_BINARY: ageTools.age,
        OPS_POSTGRES_TOOL_MODE: "docker-compose",
        OPS_POSTGRES_DOCKER_SERVICE: "postgres",
      },
      10 * 60_000,
    );
    backupCompletedAt = new Date();
    checksum = (await readFile(`${backup}.sha256`, "utf8")).trim();
    if (!/^[0-9a-f]{64}$/u.test(checksum)) {
      throw new Error("Backup did not write a valid SHA-256 sidecar.");
    }
    backupBytes = statSync(backup).size;
    if (backupBytes <= 0) {
      throw new Error("Encrypted backup is empty.");
    }

    restoreStartedAt = new Date();
    await runNpm(
      "isolated encrypted restore",
      [
        "run",
        "ops:restore",
        "--",
        "--in",
        backup,
        "--target",
        "restore-test",
      ],
      clone,
      {
        ...environment,
        AGE_BINARY: ageTools.age,
        OPS_POSTGRES_TOOL_MODE: "docker-compose",
        OPS_POSTGRES_DOCKER_SERVICE: "postgres",
      },
      10 * 60_000,
    );
    const restoredEnvironment = {
      ...environment,
      DATABASE_URL: restoreUrl,
      TEST_DATABASE_URL: sourceUrl,
    };
    await runNpm(
      "post-restore four-role public production smoke",
      ["run", "ops:release-smoke"],
      clone,
      restoredEnvironment,
      10 * 60_000,
    );
    await runNpm(
      "post-restore password reset browser journey",
      ["run", "ops:password-reset-smoke"],
      clone,
      restoredEnvironment,
      10 * 60_000,
    );
    restoreCompletedAt = new Date();

    await runNpm(
      "route inventory audit",
      ["run", "route:audit"],
      clone,
      environment,
    );
    await runNpm(
      "plan evidence/link audit",
      ["run", "plan:audit"],
      clone,
      environment,
    );
    await runNpm(
      "release secret scan",
      ["run", "security:release-scan"],
      clone,
      environment,
    );
    await runNpm(
      "license policy scan",
      ["run", "license:audit"],
      clone,
      environment,
    );
    status = "passed";
  } catch (error) {
    failure = safeMessage(error);
    console.error(`Phase 18 release gate failed: ${failure}`);
  } finally {
    if (maintenanceTargetValidated) {
      try {
        await dropDatabases(baseDatabaseUrl, Object.values(databaseNames));
        cleanup = { ...cleanup, databasesRemoved: true };
      } catch (error) {
        failure = appendFailure(
          failure,
          `database cleanup: ${safeMessage(error)}`,
        );
        status = "failed";
      }
    }
    if (temporaryRoot !== undefined) {
      try {
        await rm(temporaryRoot, { recursive: true, force: true });
        cleanup = {
          ...cleanup,
          backupRemoved: true,
          cloneRemoved: true,
          identityRemoved: true,
        };
      } catch (error) {
        failure = appendFailure(failure, `file cleanup: ${safeMessage(error)}`);
        status = "failed";
      }
    }

    const completedAt = new Date();
    const rpoSeconds =
      sourceSnapshotAt === undefined || backupCompletedAt === undefined
        ? null
        : Math.max(
            0,
            Math.round(
              (backupCompletedAt.getTime() -
                sourceSnapshotAt.getTime()) /
                1_000,
            ),
          );
    const rtoSeconds =
      restoreStartedAt === undefined || restoreCompletedAt === undefined
        ? null
        : Math.max(
            0,
            Math.round(
              (restoreCompletedAt.getTime() -
                restoreStartedAt.getTime()) /
                1_000,
            ),
          );
    const manifest = Object.freeze({
      schemaVersion: "phase18-release-gate-v1",
      status,
      runId,
      release: Object.freeze({
        branch,
        commit,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      }),
      runtime: tools,
      database: Object.freeze({
        source: databaseNames.source,
        restore: databaseNames.restore,
        productionGuard: databaseNames.guard,
        seedManifestSha256: manifestSha256 || null,
      }),
      recovery: Object.freeze({
        ciphertextSha256: checksum || null,
        encryptedBytes: backupBytes || null,
        location: "external ephemeral drill directory (removed after evidence)",
        retentionClass: "ephemeral restore-drill artifact",
        retentionTarget: "30 daily + 12 monthly encrypted objects (not configured/approved)",
        measuredRpoSeconds: rpoSeconds,
        measuredRtoSeconds: rtoSeconds,
        rpoHypothesisSeconds: 86_400,
        rtoHypothesisSeconds: 28_800,
      }),
      commands,
      cleanup,
      knownLimitations: Object.freeze([
        "No real Staging deployment was available; staging smoke remains open.",
        "Retention lifecycle and RPO/RTO require Ops/Owner approval.",
        "License scan is technical evidence, not legal approval.",
      ]),
      ...(failure === "" ? {} : { failure }),
    });
    mkdirSync(resolve(manifestPath, ".."), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    console.info(
      `Phase 18 release manifest written: test-results/phase18/run-manifest.json (${status}).`,
    );
    if (status === "passed") {
      console.info(
        `Phase 18 E2E-08 passed for ${commit}; seed ${manifestSha256}; backup ${checksum}; RPO ${String(rpoSeconds)} s; RTO ${String(rtoSeconds)} s; cleanup complete.`,
      );
    } else {
      process.exitCode = 1;
    }
  }
}

async function collectToolVersions() {
  const [git, docker, compose, pgDump, pgRestore, age] = await Promise.all([
    version("git", ["--version"]),
    version("docker", ["--version"]),
    version("docker", ["compose", "version"]),
    version("docker", [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "--version",
    ]),
    version("docker", [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_restore",
      "--version",
    ]),
    version(resolveAgeTools().age, ["--version"]),
  ]);
  const npm = (
    await runRaw(
      process.execPath,
      [npmCli, "--version"],
      repository,
      safeToolEnvironment(),
      30_000,
    )
  ).output.trim();
  return Object.freeze({
    node: process.version,
    npm,
    git,
    docker,
    compose,
    pgDump,
    pgRestore,
    age,
    os: `${process.platform}-${process.arch}`,
  });
}

function unavailableToolVersions() {
  return Object.freeze({
    node: process.version,
    npm: "unavailable",
    git: "unavailable",
    docker: "unavailable",
    compose: "unavailable",
    pgDump: "unavailable",
    pgRestore: "unavailable",
    age: "unavailable",
    os: `${process.platform}-${process.arch}`,
  });
}

async function createAgeIdentity(binary: string, path: string) {
  const result = await run(
    "ephemeral Age identity generation",
    binary,
    ["--output", path],
    { cwd: temporaryRoot as string },
  );
  const recipient = result.output.match(
    /age1[023456789acdefghjklmnpqrstuvwxyz]{58}/u,
  )?.[0];
  if (recipient === undefined || !existsSync(path)) {
    throw new Error("age-keygen did not produce an X25519 identity.");
  }
  return recipient;
}

function releaseEnvironment(input: Readonly<{
  sourceUrl: string;
  restoreUrl: string;
  recipient: string;
  identity: string;
  commit: string;
}>): NodeJS.ProcessEnv {
  const secret = () => randomBytes(32).toString("base64");
  return {
    ...safeToolEnvironment(),
    APP_ENV: "local",
    NODE_ENV: "development",
    DATABASE_URL: input.sourceUrl,
    TEST_DATABASE_URL: input.restoreUrl,
    APP_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_APP_NAME: "SwissTalentHub",
    APP_BUILD_ID: input.commit,
    SESSION_SECRET: secret(),
    AUDIT_IP_HASH_KEYS: `v1:${secret()}`,
    RADAR_OPAQUE_LOOKUP_KEYS: `v1:${secret()}`,
    RADAR_OPAQUE_ENCRYPTION_KEYS: `v1:${secret()}`,
    REVEAL_CONFIRMATION_KEYS: `v1:${secret()}`,
    PII_REVEAL_KEYS: `v1:${secret()}`,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    DEV_MAILBOX_SECRET: randomBytes(32).toString("base64url"),
    ABUSE_REPORT_ADMIN_EMAILS: "admin@demo.ch",
    LOG_LEVEL: "info",
    BACKUP_AGE_RECIPIENT: input.recipient,
    BACKUP_AGE_IDENTITY_FILE: input.identity,
    STRIPE_SECRET_KEY: "",
    EMAIL_PROVIDER_API_KEY: "",
    OPENAI_API_KEY: "",
    STORAGE_ENDPOINT: "",
    JOBROOM_API_URL: "",
    MAPS_API_KEY: "",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

async function runNpm(
  label: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs = 5 * 60_000,
) {
  return run(label, process.execPath, [npmCli, ...args], {
    cwd,
    environment,
    timeoutMs,
  });
}

async function runNpmExpectFailure(
  label: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
) {
  console.info(`START ${label}`);
  const started = performance.now();
  const result = await runRaw(
    process.execPath,
    [npmCli, ...args],
    cwd,
    environment,
    5 * 60_000,
  );
  const durationMs = Math.round(performance.now() - started);
  commands.push({ command: label, durationMs, exitCode: result.exitCode });
  if (result.exitCode === 0) {
    throw new Error(`${label} unexpectedly succeeded.`);
  }
  console.info(`PASS ${label} (expected refusal, ${durationMs} ms)`);
  return Object.freeze({ durationMs, output: result.output });
}

async function run(
  label: string,
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    environment?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }>,
): Promise<RunResult> {
  console.info(`START ${label}`);
  const started = performance.now();
  const result = await runRaw(
    command,
    args,
    options.cwd,
    options.environment ?? safeToolEnvironment(),
    options.timeoutMs ?? 5 * 60_000,
  );
  const durationMs = Math.round(performance.now() - started);
  commands.push({
    command: label,
    durationMs,
    exitCode: result.exitCode,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} exited ${result.exitCode}: ${redact(
        result.output,
        options.environment ?? process.env,
      )}`,
    );
  }
  console.info(`PASS ${label} (${durationMs} ms)`);
  return Object.freeze({ durationMs, output: result.output });
}

function runRaw(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100) {
    throw new Error("Command timeout must be at least 100 ms.");
  }
  return new Promise<{ exitCode: number; output: string }>(
    (resolveExit, reject) => {
      const child = spawn(command, [...args], {
        cwd,
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "";
      let settled = false;
      let timedOut = false;
      const capture = (chunk: Buffer | string) => {
        output = `${output}${chunk.toString()}`.slice(-64_000);
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      const timeout = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        void terminateRecoveryChild(child as RecoveryChild).then(
          () => {
            finish({
              exitCode: 124,
              output: `${output}\nCommand timed out after ${String(timeoutMs)} ms.`,
            });
          },
          (error: unknown) => {
            fail(error);
          },
        );
      }, timeoutMs);
      timeout.unref();

      const finish = (result: { exitCode: number; output: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveExit(result);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };

      child.once("error", (error) => {
        if (timedOut) {
          finish({
            exitCode: 124,
            output: `${output}\nCommand timed out after ${String(timeoutMs)} ms.`,
          });
        } else {
          fail(error);
        }
      });
      child.once("close", (code) => {
        finish({
          exitCode: timedOut ? 124 : (code ?? 1),
          output: timedOut
            ? `${output}\nCommand timed out after ${String(timeoutMs)} ms.`
            : output,
        });
      });
    },
  );
}

async function version(command: string, args: readonly string[]) {
  const result = await runRaw(
    command,
    args,
    repository,
    safeToolEnvironment(),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(`Required tool is unavailable: ${basename(command)}.`);
  }
  return result.output.trim().split(/\r?\n/u)[0] ?? "unknown";
}

async function createDatabases(baseUrl: string, names: readonly string[]) {
  const client = await maintenanceClient(baseUrl);
  try {
    for (const name of names) {
      assertGeneratedDatabaseName(name);
      await client.query(`CREATE DATABASE ${quoteDatabase(name)}`);
    }
  } finally {
    await client.end();
  }
}

async function dropDatabases(baseUrl: string, names: readonly string[]) {
  const client = await maintenanceClient(baseUrl);
  try {
    for (const name of names) {
      assertGeneratedDatabaseName(name);
      await client.query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()`,
        [name],
      );
      await client.query(`DROP DATABASE IF EXISTS ${quoteDatabase(name)}`);
    }
  } finally {
    await client.end();
  }
}

async function maintenanceClient(baseUrl: string) {
  const url = new URL(baseUrl);
  url.pathname = "/postgres";
  url.searchParams.delete("schema");
  const client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5_000,
    statement_timeout: 20_000,
  });
  await client.connect();
  return client;
}

async function domainRowCounts(url: string) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 20_000,
  });
  await client.connect();
  try {
    const tables = await client.query<{ tableName: string }>(
      `SELECT tablename AS "tableName"
         FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations'
        ORDER BY tablename`,
    );
    const counts: Record<string, number> = {};
    for (const { tableName } of tables.rows) {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(tableName)}`,
      );
      counts[tableName] = Number(result.rows[0]?.count);
    }
    return Object.freeze(counts);
  } finally {
    await client.end();
  }
}

function seedManifest(output: string) {
  const line = output
    .split(/\r?\n/u)
    .find((value) => value.startsWith("Seed manifest {"));
  if (line === undefined) {
    throw new Error("Seed command did not print its sealed manifest.");
  }
  const parsed = JSON.parse(line.slice("Seed manifest ".length)) as {
    manifest?: unknown;
    manifestSha256?: unknown;
  };
  if (
    typeof parsed.manifestSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(parsed.manifestSha256) ||
    parsed.manifest === undefined
  ) {
    throw new Error("Seed manifest output is invalid.");
  }
  return parsed as {
    manifest: unknown;
    manifestSha256: string;
  };
}

function databaseUrl(baseUrl: string, name: string) {
  assertGeneratedDatabaseName(name);
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

function assertSafeMaintenanceTarget(value: string) {
  const target = inspectPostgresTarget(value);
  if (
    target === undefined ||
    target.hostname !== "loopback" ||
    target.databaseName !== "swisstalenthub" ||
    target.schemaName !== "public"
  ) {
    throw new Error(
      "Phase 18 runner requires the documented loopback swisstalenthub maintenance database.",
    );
  }
}

function assertGeneratedDatabaseName(name: string) {
  if (!databaseNamePattern.test(name)) {
    throw new Error("Generated database name is outside the cleanup allowlist.");
  }
}

function quoteDatabase(name: string) {
  assertGeneratedDatabaseName(name);
  return `"${name}"`;
}

function quoteIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

async function gitOutput(args: readonly string[], cwd: string) {
  const result = await runRaw(
    "git",
    args,
    cwd,
    safeToolEnvironment(),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0] ?? "command"} failed.`);
  }
  return result.output.trim();
}

function resolveAgeTools() {
  const links =
    process.env.LOCALAPPDATA === undefined
      ? undefined
      : resolve(
          process.env.LOCALAPPDATA,
          "Microsoft",
          "WinGet",
          "Links",
        );
  const age =
    process.env.AGE_BINARY ??
    (links === undefined ? "age" : resolve(links, "age.exe"));
  const keygen =
    process.env.AGE_KEYGEN_BINARY ??
    (links === undefined ? "age-keygen" : resolve(links, "age-keygen.exe"));
  return Object.freeze({ age, keygen });
}

function requireNpmCli() {
  const value = process.env.npm_execpath;
  if (value === undefined || !existsSync(value)) {
    throw new Error("Phase 18 release gate must be started through npm.");
  }
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function safeMessage(error: unknown) {
  return redact(error instanceof Error ? error.message : "unknown failure");
}

function appendFailure(current: string, next: string) {
  return current === "" ? next : `${current}; ${next}`;
}
