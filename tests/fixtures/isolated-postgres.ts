import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { Client, Pool } from "pg";

import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

type MigratedTestDatabase = Readonly<{
  connectionString: string;
  databaseName: string;
  pool: Pool;
  migrate: () => Promise<void>;
  dispose: () => Promise<void>;
}>;

const databaseNamePattern = /^swisstalenthub_test_[a-z0-9_]+$/;

export async function createMigratedTestDatabase(
  purpose: string,
): Promise<MigratedTestDatabase> {
  const configuration = getIsolatedTestDatabaseConfiguration();
  const normalizedPurpose = purpose.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  const databaseName = `swisstalenthub_test_${normalizedPurpose}_${randomUUID().replaceAll("-", "")}`;

  if (!databaseNamePattern.test(databaseName)) {
    throw new Error("Generated test database name is outside the safe allowlist.");
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
  });

  await maintenance.connect();
  try {
    await maintenance.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
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

  const migrate = () => runPrismaMigrateDeploy(connectionString);
  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    await pool.end().catch(() => undefined);

    const cleanup = new Client({
      connectionString: maintenanceUrl.toString(),
      connectionTimeoutMillis: 5_000,
    });
    await cleanup.connect();
    try {
      await cleanup.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await cleanup.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    } finally {
      await cleanup.end();
    }
  };

  try {
    await migrate();
  } catch (error) {
    await dispose();
    throw error;
  }

  return Object.freeze({
    connectionString,
    databaseName,
    pool,
    migrate,
    dispose,
  });
}

async function runPrismaMigrateDeploy(connectionString: string) {
  const prismaCli = resolve(
    process.cwd(),
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  const result = await runProcess(process.execPath, [prismaCli, "migrate", "deploy"], {
    ...process.env,
    DATABASE_URL: connectionString,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Prisma migrate deploy failed with exit ${result.exitCode}: ${redactProcessOutput(result.output)}`,
    );
  }
}

function runProcess(
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolvePromise({ exitCode: exitCode ?? 1, output });
    });
  });
}

function quoteIdentifier(value: string) {
  if (!databaseNamePattern.test(value)) {
    throw new Error("Refusing to quote a database name outside the safe allowlist.");
  }
  return `"${value}"`;
}

function redactProcessOutput(output: string) {
  return output
    .replaceAll(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .trim()
    .slice(0, 2_000);
}
