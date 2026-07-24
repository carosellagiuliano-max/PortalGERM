import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import { Client } from "pg";

import {
  createLibpqEnvironment,
  parseCiphertextChecksum,
  resolveRestoreContract,
} from "@/lib/ops/recovery-contract";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";
import {
  captureDiagnostics,
  redact,
  runRecoveryOperations,
  spawnAge,
  spawnPostgresTool,
  waitForChild,
} from "@/scripts/ops/process-tools";

try {
  loadLocalEnvironment();
  const contract = resolveRestoreContract(process.argv.slice(2), process.env);
  const checksumStats = await stat(contract.checksumPath);
  if (checksumStats.size <= 0 || checksumStats.size > 128) {
    throw new Error("Backup checksum sidecar has an invalid size.");
  }
  const expectedChecksum = parseCiphertextChecksum(
    await readFile(contract.checksumPath, "utf8"),
  );
  const actualChecksum = await sha256(contract.inputPath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error("Encrypted backup checksum does not match.");
  }

  await assertEmptyTarget(contract.target.url);
  const decrypt = spawnAge(
    [
      "--decrypt",
      "--identity",
      contract.identityFile,
      contract.inputPath,
    ],
    "ignore",
  );
  const restore = spawnPostgresTool(
    "pg_restore",
    [
      "--exit-on-error",
      "--clean",
      "--if-exists",
      "--no-owner",
      `--dbname=${contract.target.databaseName}`,
    ],
    contract.target.url,
    "pipe",
  );
  const ageDiagnostics = captureDiagnostics(decrypt);
  const restoreDiagnostics = captureDiagnostics(restore);

  const operations = [
    pipeline(decrypt.stdout, restore.stdin),
    waitForChild(decrypt, "age decryption", ageDiagnostics),
    waitForChild(restore, "pg_restore", restoreDiagnostics),
  ];
  await runRecoveryOperations(
    "encrypted restore pipeline",
    [decrypt, restore],
    operations,
  );

  const verificationEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: "local",
    NODE_ENV: "development",
    DATABASE_URL: contract.target.url,
    TEST_DATABASE_URL: contract.source.url,
  };
  await runNodeTool(
    resolve("node_modules", "prisma", "build", "index.js"),
    ["migrate", "deploy"],
    verificationEnvironment,
    "post-restore migration check",
  );
  await runNodeTool(
    resolve("node_modules", "tsx", "dist", "cli.mjs"),
    [resolve("scripts", "seed-verify.ts")],
    verificationEnvironment,
    "post-restore seed manifest verification",
  );
  await runNodeTool(
    resolve("node_modules", "tsx", "dist", "cli.mjs"),
    [resolve("scripts", "db-smoke.ts")],
    verificationEnvironment,
    "post-restore database smoke",
  );

  console.info(
    `Encrypted restore verified into ${contract.target.databaseName}; checksum ${actualChecksum}; migration, manifest and database smoke passed.`,
  );
} catch (error) {
  console.error(
    redact(error instanceof Error ? error.message : "Restore failed."),
  );
  process.exitCode = 1;
}

async function assertEmptyTarget(databaseUrl: string) {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public')
         +
         (SELECT COUNT(*) FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public')
         +
         (SELECT COUNT(*) FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public')
       )::text AS count`,
    );
    if (Number(result.rows[0]?.count) !== 0) {
      throw new Error("Restore target must be an empty allowlisted database.");
    }
  } finally {
    await client.end();
  }
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function runNodeTool(
  script: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  label: string,
) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: {
      ...environment,
      ...createLibpqEnvironment(environment.DATABASE_URL as string),
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let diagnostics = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const capture = (chunk: string) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-8_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const recoveryChild = child as Parameters<typeof waitForChild>[0];
  await runRecoveryOperations(
    label,
    [recoveryChild],
    [waitForChild(recoveryChild, label, () => diagnostics)],
  );
}
