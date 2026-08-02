import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import { Client, Pool } from "pg";

import {
  terminateRecoveryChild,
  type RecoveryChild,
} from "@/scripts/ops/process-tools";
import { resolveIntegrationTemplateDatabaseName } from "@/tests/fixtures/integration-template-policy";
import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

type MigratedTestDatabase = Readonly<{
  connectionString: string;
  databaseName: string;
  pool: Pool;
  migrate: () => Promise<void>;
  sealForCloning: (signal?: AbortSignal) => Promise<void>;
  dispose: () => Promise<void>;
}>;

const databaseNamePattern = /^swisstalenthub_test_(?:tpl_)?[a-f0-9]{32}$/u;

export async function createMigratedTestDatabase(
  _purpose: string,
  options: Readonly<{
    asTemplate?: boolean;
    signal?: AbortSignal;
    throughMigration?: string;
    useTemplate?: boolean;
  }> = {},
): Promise<MigratedTestDatabase> {
  const signal = options.signal;
  const configuration = getIsolatedTestDatabaseConfiguration();
  if (
    options.asTemplate === true &&
    (options.throughMigration !== undefined || options.useTemplate !== false)
  ) {
    throw new Error("INVALID_INTEGRATION_TEMPLATE_CREATION_OPTIONS");
  }
  const templateDatabaseName =
    options.throughMigration === undefined && options.useTemplate !== false
      ? resolveIntegrationTemplateDatabaseName(
          process.env.TEST_DATABASE_TEMPLATE_NAME,
        )
      : undefined;
  const databaseName = `swisstalenthub_test_${options.asTemplate === true ? "tpl_" : ""}${randomUUID().replaceAll("-", "")}`;

  if (!databaseNamePattern.test(databaseName)) {
    throw new Error(
      "Generated test database name is outside the safe allowlist.",
    );
  }

  const baseUrl = new URL(configuration.connectionString);
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.searchParams.delete("schema");

  const databaseUrl = new URL(baseUrl);
  databaseUrl.pathname = `/${databaseName}`;
  databaseUrl.searchParams.set("schema", "public");

  const maintenance = new Client({
    connectionString: maintenanceUrl.toString(),
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    statement_timeout: 15_000,
  });

  assertNotAborted(signal);
  await maintenance.connect();
  try {
    assertNotAborted(signal);
    await maintenance.query(
      templateDatabaseName === undefined
        ? `CREATE DATABASE ${quoteIdentifier(databaseName)}`
        : `CREATE DATABASE ${quoteIdentifier(databaseName)} TEMPLATE ${quoteIdentifier(templateDatabaseName)}`,
    );
  } finally {
    await maintenance.end();
  }

  const connectionString = databaseUrl.toString();
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    max: 8,
  });
  let disposed = false;
  let poolEnded = false;
  let sealedForCloning = false;

  const migrate = () => {
    if (disposed || sealedForCloning) {
      throw new Error("TEST_DATABASE_NOT_MIGRATABLE");
    }
    return runPrismaMigrateDeploy(connectionString, signal);
  };
  const endPool = async () => {
    if (poolEnded) return;
    poolEnded = true;
    await pool.end().catch(() => undefined);
  };
  const sealForCloning = async (sealSignal = signal) => {
    if (disposed) throw new Error("TEST_DATABASE_ALREADY_DISPOSED");
    if (sealedForCloning) return;
    assertNotAborted(sealSignal);
    await endPool();
    assertNotAborted(sealSignal);
    const sealing = new Client({
      connectionString: maintenanceUrl.toString(),
      connectionTimeoutMillis: 5_000,
      query_timeout: 15_000,
      statement_timeout: 15_000,
    });
    await sealing.connect();
    try {
      assertNotAborted(sealSignal);
      await sealing.query(
        `ALTER DATABASE ${quoteIdentifier(databaseName)} ALLOW_CONNECTIONS false`,
      );
      assertNotAborted(sealSignal);
      await sealing.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      assertNotAborted(sealSignal);
      sealedForCloning = true;
    } finally {
      await sealing.end();
    }
  };
  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    await endPool();

    const cleanup = new Client({
      connectionString: maintenanceUrl.toString(),
      connectionTimeoutMillis: 5_000,
      query_timeout: 15_000,
      statement_timeout: 15_000,
    });
    await cleanup.connect();
    try {
      await cleanup.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await cleanup.query(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
      );
    } finally {
      await cleanup.end();
    }
  };

  try {
    assertNotAborted(signal);
    if (
      options.throughMigration === undefined &&
      templateDatabaseName === undefined
    ) {
      await migrate();
    } else if (options.throughMigration !== undefined) {
      await runPrismaMigrateDeployThrough(
        connectionString,
        options.throughMigration,
        signal,
      );
    }
    assertNotAborted(signal);
  } catch (error) {
    await dispose();
    throw error;
  }

  return Object.freeze({
    connectionString,
    databaseName,
    pool,
    migrate,
    sealForCloning,
    dispose,
  });
}

async function runPrismaMigrateDeploy(
  connectionString: string,
  signal?: AbortSignal,
) {
  const prismaCli = resolve(
    process.cwd(),
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  const result = await runProcess(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    {
      ...process.env,
      DATABASE_URL: connectionString,
    },
    signal,
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Prisma migrate deploy failed with exit ${result.exitCode}: ${redactProcessOutput(result.output)}`,
    );
  }
}

async function runPrismaMigrateDeployThrough(
  connectionString: string,
  throughMigration: string,
  signal?: AbortSignal,
) {
  assertNotAborted(signal);
  if (!/^\d{14}_[a-z0-9_]+$/u.test(throughMigration)) {
    throw new Error("Migration cutoff is outside the safe allowlist.");
  }
  const sourcePrisma = resolve(process.cwd(), "prisma");
  const sourceMigrations = resolve(sourcePrisma, "migrations");
  const migrationNames = readdirSync(sourceMigrations, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!migrationNames.includes(throughMigration)) {
    throw new Error("Migration cutoff does not exist.");
  }

  const temporaryRoot = mkdtempSync(
    resolve(process.cwd(), ".phase33-migration-fixture-"),
  );
  try {
    const temporaryPrisma = resolve(temporaryRoot, "prisma");
    const temporaryMigrations = resolve(temporaryPrisma, "migrations");
    mkdirSync(temporaryMigrations, { recursive: true });
    copyFileSync(
      resolve(sourcePrisma, "schema.prisma"),
      resolve(temporaryPrisma, "schema.prisma"),
    );
    const migrationLock = resolve(sourceMigrations, "migration_lock.toml");
    if (existsSync(migrationLock)) {
      copyFileSync(
        migrationLock,
        resolve(temporaryMigrations, "migration_lock.toml"),
      );
    }
    for (const migrationName of migrationNames) {
      assertNotAborted(signal);
      if (migrationName > throughMigration) break;
      cpSync(
        resolve(sourceMigrations, migrationName),
        resolve(temporaryMigrations, migrationName),
        { recursive: true },
      );
    }
    const temporaryConfig = resolve(temporaryRoot, "prisma.config.ts");
    writeFileSync(
      temporaryConfig,
      [
        'import { defineConfig } from "prisma/config";',
        "export default defineConfig({",
        `  schema: ${JSON.stringify(resolve(temporaryPrisma, "schema.prisma"))},`,
        `  migrations: { path: ${JSON.stringify(temporaryMigrations)} },`,
        "  datasource: { url: process.env.DATABASE_URL! },",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    const prismaCli = resolve(
      process.cwd(),
      "node_modules",
      "prisma",
      "build",
      "index.js",
    );
    const result = await runProcess(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--config", temporaryConfig],
      { ...process.env, DATABASE_URL: connectionString },
      signal,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Prisma cutoff migrate deploy failed with exit ${result.exitCode}: ${redactProcessOutput(result.output)}`,
      );
    }
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function runProcess(
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<{ exitCode: number; output: string }> {
  assertNotAborted(signal);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let settled = false;
    let terminating = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      if (settled || terminating) return;
      terminating = true;
      const interruption = abortError(signal);
      void terminateRecoveryChild(child as unknown as RecoveryChild).then(
        () => finish(() => reject(interruption)),
        (terminationError: unknown) =>
          finish(() =>
            reject(
              new AggregateError(
                [interruption, terminationError],
                "MIGRATION_CHILD_TERMINATION_FAILED",
              ),
            ),
          ),
      );
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", (error) => {
      if (!terminating) finish(() => reject(error));
    });
    child.once("close", (exitCode) => {
      if (!terminating) {
        finish(() => resolvePromise({ exitCode: exitCode ?? 1, output }));
      }
    });
    if (signal?.aborted === true) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }
  });
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted === true) throw abortError(signal);
}

function abortError(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("TEST_DATABASE_SETUP_INTERRUPTED");
}

function quoteIdentifier(value: string) {
  if (!databaseNamePattern.test(value)) {
    throw new Error(
      "Refusing to quote a database name outside the safe allowlist.",
    );
  }
  return `"${value}"`;
}

function redactProcessOutput(output: string) {
  return output
    .replaceAll(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .trim()
    .slice(0, 2_000);
}
