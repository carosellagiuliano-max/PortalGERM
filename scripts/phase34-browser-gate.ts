import {
  spawn,
  execFileSync,
  type ChildProcess,
  type ChildProcessByStdio,
} from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { parseEnvironment } from "@/lib/config/env-schema";
import { checkDatabaseHealth } from "@/lib/db/health";
import { createDatabaseClient } from "@/lib/db/factory";
import {
  documentObjectStoreActivationBinding,
  documentScannerActivationBinding,
} from "@/lib/documents/provider-activation-binding";
import { activateSandboxHandler } from "@/lib/ops/operations-ledger";
import { ensurePhase33LocalProviderActivation } from "@/lib/ops/phase33-contract-activation";
import { refreshConfiguredProviderHealth } from "@/lib/ops/provider-health-monitor";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import {
  assertPhase34CandidateDigest,
  validatePhase34BrowserManifest,
} from "@/lib/governance/phase34-browser-manifest";
import { candidateWorkflowSeedCryptoFromEnvironment } from "@/prisma/seed/blocks/candidate-workflows";
import { runDemoSeed } from "@/prisma/seed/orchestrator";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

const HOST = "127.0.0.1";
const PRE_PHASE34_MIGRATION =
  "20260801090000_phase_33_payment_provider_bindings";
const PHASE34_MIGRATIONS = Object.freeze([
  "20260806200000_phase_34_provider_inbox_health",
  "20260806210000_phase_34_public_search_trigram",
  "20260806220000_phase_34_company_closure",
  "20260806230000_phase_34_job_revision_generated_column_immutability",
  "20260806240000_phase_34_talent_radar_legal_gate_serialization",
  "20260806250000_phase_34_public_intake_privacy_evidence",
]);
const COMPANY_TRUST_SANDBOX_ENVIRONMENT = Object.freeze({
  COMPANY_TRUST_V2: "enforce",
  COMPANY_DOMAIN_CHALLENGE: "true",
  COMPANY_REGISTER_CHECK: "true",
  COMPANY_VERIFICATION_DOCUMENT: "true",
  COMPANY_STRONG_BADGE: "true",
  COMPANY_TRUST_PUBLIC_ELIGIBILITY: "true",
  COMPANY_TRUST_RAPID_REVOKE: "true",
  LEGACY_COMPANY_REVERIFY: "true",
  COMPANY_REGISTER_PROVIDER_MODE: "deterministic_sandbox",
  COMPANY_DOMAIN_PROVIDER_MODE: "deterministic_sandbox",
  COMPANY_VERIFICATION_COHORT: "test",
});
const JOB_ALERT_HANDLER_KEY = "candidate.job-alert-digest";
const JOB_ALERT_HANDLER_VERSION = "v1";
const NOTIFICATION_DISPATCH_HANDLER_KEY = "notifications.dispatch";
const NOTIFICATION_DISPATCH_HANDLER_VERSION = "v1";
const DOCUMENT_SCAN_HANDLER_KEY = "documents.scan";
const DOCUMENT_SCAN_HANDLER_VERSION = "v1";
const START_TIMEOUT_MILLISECONDS = 90_000;
const PROVIDER_HEALTH_REFRESH_MILLISECONDS = 30_000;
const MAXIMUM_DIAGNOSTIC_CHARACTERS = 24_000;
const DOCUMENT_TEMP_PREFIX = "swisstalenthub-phase34-documents-";
const SOURCE_ROOT = process.cwd();
const manifestPath = resolve(
  SOURCE_ROOT,
  "test-results",
  "phase34",
  "run-manifest.json",
);
const pendingManifestPath = resolve(
  SOURCE_ROOT,
  "test-results",
  "phase34",
  "run-manifest.pending.json",
);
const clockPath = resolve(
  SOURCE_ROOT,
  "test-results",
  "phase34",
  "logical-clock.json",
);
type RuntimeChild = ChildProcessByStdio<null, Readable, Readable>;
type ChildExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;
type RuntimeMode = "local" | "preview";
type LocalDocumentSandbox = Readonly<{
  keys: string;
  root: string;
}>;
type ProviderHealthControl = Readonly<{
  stop: () => Promise<void>;
}>;

await main();

async function main() {
  mkdirSync(dirname(manifestPath), { recursive: true });
  rmSync(manifestPath, { force: true });
  rmSync(pendingManifestPath, { force: true });
  const candidateDigest = await buildCurrentCandidate();
  if (!existsSync(resolve(SOURCE_ROOT, ".next", "BUILD_ID"))) {
    throw new Error(
      "Phase 34 browser E2E did not produce a production BUILD_ID.",
    );
  }

  writeFileSync(
    clockPath,
    `${JSON.stringify({ offsetMilliseconds: 0 })}\n`,
    "utf8",
  );

  const database = await createMigratedTestDatabase("phase34_browser", {
    throughMigration: PRE_PHASE34_MIGRATION,
  });
  let localRuntime: Awaited<ReturnType<typeof startServer>> | undefined;
  let trustRuntime: Awaited<ReturnType<typeof startServer>> | undefined;
  let previewRuntime: Awaited<ReturnType<typeof startServer>> | undefined;
  let providerHealthControl: ProviderHealthControl | undefined;
  let documentStorageRoot: string | undefined;
  let executionSucceeded = false;
  let cleanupSucceeded = false;
  try {
    await database.migrate();
    await assertPhase34DatabaseUpgrade(database);

    const localPort = await allocatePort();
    const trustPort = await allocatePort();
    const previewPort = await allocatePort();
    const localBaseUrl = `http://${HOST}:${localPort}`;
    const trustBaseUrl = `http://${HOST}:${trustPort}`;
    const previewBaseUrl = `http://${HOST}:${previewPort}`;
    documentStorageRoot = mkdtempSync(resolve(tmpdir(), DOCUMENT_TEMP_PREFIX));
    const documentKeyVersion = `phase34-${createHash("sha256")
      .update(database.databaseName, "utf8")
      .digest("hex")
      .slice(0, 12)}`;
    const documentSandbox = Object.freeze({
      keys: `${documentKeyVersion}:${randomBytes(32).toString("base64")}`,
      root: documentStorageRoot,
    });
    const sharedEnvironment = createValidEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: database.connectionString,
      TEST_DATABASE_URL: undefined,
      APP_BUILD_ID: candidateDigest,
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
    });
    const seedEnvironment = parseEnvironment({
      ...sharedEnvironment,
      APP_ENV: "local",
      APP_URL: localBaseUrl,
      TRUSTED_PROXY_HOPS: "1",
    });
    const workerEnvironment = parseEnvironment({
      ...sharedEnvironment,
      APP_ENV: "local",
      NODE_ENV: "production",
      APP_URL: localBaseUrl,
      DATABASE_URL: database.connectionString,
      TEST_DATABASE_URL: undefined,
      TRUSTED_PROXY_HOPS: "1",
      EMAIL_PROVIDER_MODE: "local_mock",
      NOTIFICATION_DISPATCH: "command",
      ENABLE_LOCAL_MOCK_MAILBOX: "false",
      PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT: "false",
      PAYMENT_PROVIDER_MODE: "disabled",
      WORKER_RUNTIME: "sandbox_command",
      DOCUMENT_STORAGE_KEYS: documentSandbox.keys,
      DOCUMENT_VAULT_WRITES: "true",
      DOCUMENT_STORAGE_MODE: "filesystem_sandbox",
      DOCUMENT_SCANNER_MODE: "sandbox",
      DOCUMENT_CLEAN_READS: "true",
      DOCUMENT_RECONCILIATION: "disabled",
      DOCUMENT_BULK_ACCESS: "false",
      DOCUMENT_VAULT_COHORT: "test",
      DOCUMENT_STORAGE_ROOT: documentSandbox.root,
      DOCUMENT_STORAGE_REGION: "local-test",
    });
    const activations = await activateLocalProviderAndWorkerContracts({
      candidateDigest,
      databaseUrl: database.connectionString,
      environment: workerEnvironment,
    });
    providerHealthControl = await startProviderHealthMonitor(
      database.connectionString,
      workerEnvironment,
    );

    await runDemoSeed(
      {
        APP_ENV: "local",
        DATABASE_URL: database.connectionString,
        ENABLE_DEMO_SEED: "true",
      },
      {
        candidateWorkflowCrypto:
          candidateWorkflowSeedCryptoFromEnvironment(seedEnvironment),
      },
    );

    localRuntime = startServer({
      baseUrl: localBaseUrl,
      port: localPort,
      mode: "local",
      environment: sharedEnvironment,
      documentSandbox,
    });
    trustRuntime = startServer({
      baseUrl: trustBaseUrl,
      port: trustPort,
      mode: "local",
      environment: {
        ...sharedEnvironment,
        ...COMPANY_TRUST_SANDBOX_ENVIRONMENT,
      },
      documentSandbox,
    });
    previewRuntime = startServer({
      baseUrl: previewBaseUrl,
      port: previewPort,
      mode: "preview",
      environment: sharedEnvironment,
    });
    await Promise.all([
      waitUntilLive(localBaseUrl, localRuntime, false),
      waitUntilLive(trustBaseUrl, trustRuntime, false),
      waitUntilLive(previewBaseUrl, previewRuntime, true),
    ]);

    assertCandidateDigest(candidateDigest);

    const playwrightExit = await runPlaywright({
      candidateDigest,
      databaseRunId: createHash("sha256")
        .update(database.databaseName, "utf8")
        .digest("hex"),
      databaseUrl: database.connectionString,
      localBaseUrl,
      trustBaseUrl,
      previewBaseUrl,
      sharedEnvironment,
      jobAlertHandlerActivationId: activations.handlerActivationId,
      jobAlertProviderActivationId: activations.providerActivationId,
      notificationDispatchHandlerActivationId:
        activations.notificationDispatchHandlerActivationId,
      transactionalProviderActivationId:
        activations.transactionalProviderActivationId,
      documentObjectStoreProviderActivationId:
        activations.documentObjectStoreProviderActivationId,
      documentScannerProviderActivationId:
        activations.documentScannerProviderActivationId,
      documentScanHandlerActivationId:
        activations.documentScanHandlerActivationId,
      documentSandbox,
    });
    if (playwrightExit.code !== 0) {
      throw new Error(
        `Phase 34 browser suite failed (code ${String(playwrightExit.code)}, signal ${String(playwrightExit.signal)}).\nLocal diagnostics:\n${redact(localRuntime.diagnostics())}\nTrust-sandbox diagnostics:\n${redact(trustRuntime.diagnostics())}\nPreview diagnostics:\n${redact(previewRuntime.diagnostics())}`,
      );
    }
    executionSucceeded = true;
  } finally {
    try {
      const cleanupErrors: unknown[] = [];
      if (providerHealthControl !== undefined) {
        try {
          await providerHealthControl.stop();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      const runtimeStopResults = await Promise.allSettled([
        localRuntime === undefined
          ? Promise.resolve()
          : stopChild(localRuntime.child, localRuntime.exit),
        trustRuntime === undefined
          ? Promise.resolve()
          : stopChild(trustRuntime.child, trustRuntime.exit),
        previewRuntime === undefined
          ? Promise.resolve()
          : stopChild(previewRuntime.child, previewRuntime.exit),
      ]);
      cleanupErrors.push(
        ...runtimeStopResults.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        ),
      );
      try {
        await database.dispose();
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (documentStorageRoot !== undefined) {
        try {
          removeTemporaryDocumentStorage(documentStorageRoot);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          "PHASE34_BROWSER_GATE_CLEANUP_FAILED",
        );
      }
      cleanupSucceeded = true;
    } finally {
      if (!executionSucceeded || !cleanupSucceeded) {
        rmSync(pendingManifestPath, { force: true });
      }
    }
  }

  try {
    validateManifest(candidateDigest);
    assertCandidateDigest(candidateDigest);
    renameSync(pendingManifestPath, manifestPath);
  } catch (error) {
    rmSync(pendingManifestPath, { force: true });
    rmSync(manifestPath, { force: true });
    throw error;
  }
  console.info(
    `Phase 34 local/preview browser gate passed; manifest ${relativePath(manifestPath)}.`,
  );
}

async function startProviderHealthMonitor(
  databaseUrl: string,
  environment: ReturnType<typeof parseEnvironment>,
): Promise<ProviderHealthControl> {
  const database = createDatabaseClient(databaseUrl);
  try {
    const initial = await refreshConfiguredProviderHealth({
      database,
      environment,
      now: new Date(),
    });
    if (initial.degraded > 0) {
      throw new Error("PHASE34_PROVIDER_HEALTH_DEGRADED");
    }

    const abort = new AbortController();
    let monitorFailure: unknown;
    const monitor = (async () => {
      while (!abort.signal.aborted) {
        try {
          await delay(PROVIDER_HEALTH_REFRESH_MILLISECONDS, undefined, {
            signal: abort.signal,
          });
        } catch (error) {
          if (abort.signal.aborted) return;
          throw error;
        }
        const summary = await refreshConfiguredProviderHealth({
          database,
          environment,
          now: new Date(),
        });
        if (summary.degraded > 0) {
          throw new Error("PHASE34_PROVIDER_HEALTH_DEGRADED");
        }
      }
    })().catch((error: unknown) => {
      monitorFailure = error;
    });
    let stopped = false;
    return Object.freeze({
      async stop() {
        if (stopped) return;
        stopped = true;
        abort.abort();
        await monitor;
        await database.$disconnect();
        if (monitorFailure !== undefined) throw monitorFailure;
      },
    });
  } catch (error) {
    await database.$disconnect();
    throw error;
  }
}

function assertCandidateDigest(expectedDigest: string) {
  assertPhase34CandidateDigest(expectedDigest, workingTreeDigest());
}

async function buildCurrentCandidate() {
  const npmExecutable = process.env.npm_execpath;
  if (npmExecutable === undefined || !existsSync(npmExecutable)) {
    throw new Error(
      "PHASE34_NPM_EXECUTABLE_MISSING: invoke the gate through `npm run phase34:e2e`.",
    );
  }
  const before = workingTreeDigest();
  const child = spawn(process.execPath, [npmExecutable, "run", "build"], {
    cwd: SOURCE_ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  const result = await childExit(child);
  if (result.code !== 0) {
    throw new Error(
      `PHASE34_CURRENT_CANDIDATE_BUILD_FAILED:${String(result.code)}:${String(result.signal)}`,
    );
  }
  const after = workingTreeDigest();
  if (after !== before) {
    throw new Error(
      "PHASE34_SOURCE_CHANGED_DURING_BUILD: rerun after generated tracked files and concurrent edits are stable.",
    );
  }
  return after;
}

function startServer(
  input: Readonly<{
    baseUrl: string;
    port: number;
    mode: RuntimeMode;
    environment: Record<string, string | undefined>;
    documentSandbox?: LocalDocumentSandbox;
  }>,
) {
  if ((input.mode === "local") !== (input.documentSandbox !== undefined)) {
    throw new Error("PHASE34_DOCUMENT_SANDBOX_ENVIRONMENT_SCOPE_INVALID");
  }
  const nextBinary = resolve(
    SOURCE_ROOT,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const runtimeGuard = resolve(
    SOURCE_ROOT,
    "scripts",
    "e2e",
    "runtime-guard.cjs",
  );
  if (!existsSync(nextBinary) || !existsSync(runtimeGuard)) {
    throw new Error("The Next.js binary or local network guard is missing.");
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
      String(input.port),
    ],
    {
      cwd: SOURCE_ROOT,
      env: {
        ...process.env,
        ...input.environment,
        APP_ENV: input.mode,
        NODE_ENV: "production",
        APP_URL: input.baseUrl,
        DATABASE_URL: input.environment.DATABASE_URL,
        TEST_DATABASE_URL: "",
        TRUSTED_PROXY_HOPS: "1",
        IDENTITY_VERIFICATION_ENFORCEMENT: "true",
        EMAIL_PROVIDER_MODE: input.mode === "local" ? "local_mock" : "disabled",
        NOTIFICATION_DISPATCH: input.mode === "local" ? "command" : "paused",
        // The gate exercises the durable local delivery sink directly. It must
        // never expose the developer mailbox from a `next start` production
        // server, even when the application data policy is scoped to `local`.
        ENABLE_LOCAL_MOCK_MAILBOX: "false",
        DEV_MAILBOX_SECRET: "",
        // Phase 34 binds evidence to a working-tree digest, not to the special
        // Phase-33 developer-mailbox contract. Keep that narrower exception
        // disabled and exercise only the local provider/outbox contract here.
        PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT: "false",
        PAYMENT_PROVIDER_MODE: "disabled",
        WORKER_RUNTIME: "paused",
        DOCUMENT_STORAGE_KEYS: input.documentSandbox?.keys ?? "",
        DOCUMENT_VAULT_WRITES:
          input.documentSandbox === undefined ? "false" : "true",
        DOCUMENT_STORAGE_MODE:
          input.documentSandbox === undefined
            ? "disabled"
            : "filesystem_sandbox",
        DOCUMENT_SCANNER_MODE:
          input.documentSandbox === undefined ? "disabled" : "sandbox",
        DOCUMENT_CLEAN_READS:
          input.documentSandbox === undefined ? "false" : "true",
        DOCUMENT_RECONCILIATION: "disabled",
        DOCUMENT_BULK_ACCESS: "false",
        DOCUMENT_VAULT_COHORT:
          input.documentSandbox === undefined ? "none" : "test",
        DOCUMENT_STORAGE_ROOT: input.documentSandbox?.root ?? "",
        DOCUMENT_STORAGE_REGION: "local-test",
        PHASE17_CLOCK_FILE: clockPath,
        NEXT_TELEMETRY_DISABLED: "1",
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

async function waitUntilLive(
  baseUrl: string,
  runtime: Awaited<ReturnType<typeof startServer>>,
  forwarded: boolean,
) {
  const deadline = Date.now() + START_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      const state = await runtime.exit;
      throw new Error(
        `Phase 34 ${baseUrl} exited early (code ${String(state.code)}, signal ${String(state.signal)}):\n${redact(runtime.diagnostics())}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/health/live`, {
        cache: "no-store",
        headers: forwarded ? { "x-forwarded-for": "198.51.100.34" } : undefined,
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status === 200) return;
    } catch {
      // The bounded loop waits for the production build, not external systems.
    }
    await delay(200);
  }
  throw new Error(
    `Phase 34 server did not become live at ${baseUrl}:\n${redact(runtime.diagnostics())}`,
  );
}

async function runPlaywright(
  input: Readonly<{
    candidateDigest: string;
    databaseRunId: string;
    databaseUrl: string;
    documentObjectStoreProviderActivationId: string;
    documentScannerProviderActivationId: string;
    documentScanHandlerActivationId: string;
    documentSandbox: LocalDocumentSandbox;
    jobAlertHandlerActivationId: string;
    jobAlertProviderActivationId: string;
    notificationDispatchHandlerActivationId: string;
    transactionalProviderActivationId: string;
    localBaseUrl: string;
    trustBaseUrl: string;
    previewBaseUrl: string;
    sharedEnvironment: Record<string, string | undefined>;
  }>,
) {
  const playwrightCli = resolve(
    SOURCE_ROOT,
    "node_modules",
    "@playwright",
    "test",
    "cli.js",
  );
  if (!existsSync(playwrightCli)) {
    throw new Error(
      "The pinned Playwright CLI is missing. Run `npm ci` first.",
    );
  }
  const child = spawn(
    process.execPath,
    [playwrightCli, "test", "--config=playwright.phase34.config.ts"],
    {
      cwd: SOURCE_ROOT,
      env: {
        ...process.env,
        ...input.sharedEnvironment,
        DATABASE_URL: input.databaseUrl,
        TEST_DATABASE_URL: "",
        PHASE17_BASE_URL: input.localBaseUrl,
        PHASE17_CLOCK_FILE: clockPath,
        PHASE34_LOCAL_BASE_URL: input.localBaseUrl,
        PHASE34_TRUST_BASE_URL: input.trustBaseUrl,
        PHASE34_PREVIEW_BASE_URL: input.previewBaseUrl,
        PHASE34_MANIFEST_PATH: pendingManifestPath,
        PHASE34_CANDIDATE_DIGEST: input.candidateDigest,
        PHASE34_COMMIT_SHA: commitSha(),
        PHASE34_DATABASE_RUN_ID: input.databaseRunId,
        PHASE34_JOB_ALERT_HANDLER_ACTIVATION_ID:
          input.jobAlertHandlerActivationId,
        PHASE34_JOB_ALERT_PROVIDER_ACTIVATION_ID:
          input.jobAlertProviderActivationId,
        PHASE34_NOTIFICATION_DISPATCH_HANDLER_ACTIVATION_ID:
          input.notificationDispatchHandlerActivationId,
        PHASE34_EMAIL_TRANSACTIONAL_PROVIDER_ACTIVATION_ID:
          input.transactionalProviderActivationId,
        PHASE34_DOCUMENT_OBJECT_STORE_PROVIDER_ACTIVATION_ID:
          input.documentObjectStoreProviderActivationId,
        PHASE34_DOCUMENT_SCANNER_PROVIDER_ACTIVATION_ID:
          input.documentScannerProviderActivationId,
        PHASE34_DOCUMENT_SCAN_HANDLER_ACTIVATION_ID:
          input.documentScanHandlerActivationId,
        PHASE34_DOCUMENT_STORAGE_KEYS: input.documentSandbox.keys,
        PHASE34_DOCUMENT_STORAGE_ROOT: input.documentSandbox.root,
      },
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  return childExit(child);
}

async function assertPhase34DatabaseUpgrade(
  database: Awaited<ReturnType<typeof createMigratedTestDatabase>>,
) {
  const migrationRecords = await database.pool.query<{
    applied_steps_count: number;
    finished_at: Date | null;
    migration_name: string;
    rolled_back_at: Date | null;
  }>(
    `
      SELECT
        migration_name,
        finished_at,
        rolled_back_at,
        applied_steps_count
      FROM "_prisma_migrations"
      WHERE migration_name = ANY($1::text[])
      ORDER BY migration_name ASC
    `,
    [PHASE34_MIGRATIONS],
  );
  if (
    migrationRecords.rows.length !== PHASE34_MIGRATIONS.length ||
    migrationRecords.rows.some(
      (record, index) =>
        record.migration_name !== PHASE34_MIGRATIONS[index] ||
        !(record.finished_at instanceof Date) ||
        record.rolled_back_at !== null ||
        record.applied_steps_count !== 1,
    )
  ) {
    throw new Error("PHASE34_BROWSER_DATABASE_UPGRADE_INCOMPLETE");
  }

  const publicSearchSchema = await database.pool.query<{
    company_search_column: boolean;
    company_search_index: string | null;
    job_search_column: boolean;
    job_search_index: string | null;
    normalize_function: string | null;
    revision_function: string | null;
  }>(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'Company'
            AND column_name = 'searchDocument'
        ) AS company_search_column,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'JobRevision'
            AND column_name = 'searchDocument'
        ) AS job_search_column,
        to_regclass(
          'company_phase34_search_document_trgm_idx'
        )::text AS company_search_index,
        to_regclass(
          'job_revision_phase34_search_document_trgm_idx'
        )::text AS job_search_index,
        to_regprocedure(
          'phase34_normalize_search_text(text)'
        )::text AS normalize_function,
        to_regprocedure(
          'phase34_job_revision_search_document(text,text,text[],text[],text)'
        )::text AS revision_function
    `,
  );
  if (
    publicSearchSchema.rows.length !== 1 ||
    publicSearchSchema.rows[0]?.company_search_column !== true ||
    publicSearchSchema.rows[0]?.job_search_column !== true ||
    publicSearchSchema.rows[0]?.company_search_index !==
      "company_phase34_search_document_trgm_idx" ||
    publicSearchSchema.rows[0]?.job_search_index !==
      "job_revision_phase34_search_document_trgm_idx" ||
    publicSearchSchema.rows[0]?.normalize_function !==
      "phase34_normalize_search_text(text)" ||
    publicSearchSchema.rows[0]?.revision_function !==
      "phase34_job_revision_search_document(text,text,text[],text[],text)"
  ) {
    throw new Error("PHASE34_BROWSER_PUBLIC_SEARCH_SCHEMA_INCOMPLETE");
  }

  const client = createDatabaseClient(database.connectionString);
  try {
    const health = await checkDatabaseHealth(client);
    if (!health.ready) {
      throw new Error("PHASE34_BROWSER_DATABASE_HEALTH_NOT_READY");
    }
  } finally {
    await client.$disconnect();
  }
}

async function activateLocalProviderAndWorkerContracts(
  input: Readonly<{
    candidateDigest: string;
    databaseUrl: string;
    environment: ReturnType<typeof parseEnvironment>;
  }>,
) {
  const jobAlertBinding = emailProviderActivationBinding(
    input.environment,
    "email.job-alert",
  );
  const transactionalBinding = emailProviderActivationBinding(
    input.environment,
    "email.transactional",
  );
  const documentObjectStoreBinding = documentObjectStoreActivationBinding(
    input.environment,
  );
  const documentScannerBinding = documentScannerActivationBinding(
    input.environment,
  );
  if (
    jobAlertBinding === null ||
    jobAlertBinding.expectedMode !== "SANDBOX" ||
    transactionalBinding === null ||
    transactionalBinding.expectedMode !== "SANDBOX" ||
    documentObjectStoreBinding === null ||
    documentObjectStoreBinding.expectedMode !== "SANDBOX" ||
    documentScannerBinding === null ||
    documentScannerBinding.expectedMode !== "SANDBOX"
  ) {
    throw new Error("PHASE34_LOCAL_PROVIDER_BINDING_INVALID");
  }

  const database = createDatabaseClient(input.databaseUrl);
  const now = new Date();
  try {
    const provider = await ensurePhase33LocalProviderActivation(database, {
      binding: {
        ...jobAlertBinding,
        expectedMode: "SANDBOX",
        region: "local-test",
      },
      deploymentDigest: input.candidateDigest,
      environment: input.environment,
      now,
    });
    const transactionalProvider = await ensurePhase33LocalProviderActivation(
      database,
      {
        binding: {
          ...transactionalBinding,
          expectedMode: "SANDBOX",
          region: "local-test",
        },
        deploymentDigest: input.candidateDigest,
        environment: input.environment,
        now,
      },
    );
    const documentObjectStoreProvider =
      await ensurePhase33LocalProviderActivation(database, {
        binding: {
          ...documentObjectStoreBinding,
          expectedMode: "SANDBOX",
        },
        deploymentDigest: input.candidateDigest,
        environment: input.environment,
        now,
      });
    const documentScannerProvider = await ensurePhase33LocalProviderActivation(
      database,
      {
        binding: {
          ...documentScannerBinding,
          expectedMode: "SANDBOX",
        },
        deploymentDigest: input.candidateDigest,
        environment: input.environment,
        now,
      },
    );
    const evidenceDigest = createHash("sha256")
      .update(
        JSON.stringify({
          deploymentDigest: input.candidateDigest,
          environment: "local",
          handlerKey: JOB_ALERT_HANDLER_KEY,
          handlerVersion: JOB_ALERT_HANDLER_VERSION,
          scope: "phase34-browser-worker-alert",
        }),
        "utf8",
      )
      .digest("hex");
    const handler = await activateSandboxHandler(database, {
      actorReference: "phase34-browser-gate",
      deploymentDigest: input.candidateDigest,
      environment: input.environment,
      evidenceDigest,
      handlerKey: JOB_ALERT_HANDLER_KEY,
      handlerVersion: JOB_ALERT_HANDLER_VERSION,
      now,
      reasonCode: "PHASE34_WORKER_ALERT_E2E",
      stepUpEvidenceDigest: evidenceDigest,
    });
    const dispatchEvidenceDigest = createHash("sha256")
      .update(
        JSON.stringify({
          deploymentDigest: input.candidateDigest,
          environment: "local",
          handlerKey: NOTIFICATION_DISPATCH_HANDLER_KEY,
          handlerVersion: NOTIFICATION_DISPATCH_HANDLER_VERSION,
          scope: "phase34-browser-password-recovery",
        }),
        "utf8",
      )
      .digest("hex");
    const notificationDispatchHandler = await activateSandboxHandler(database, {
      actorReference: "phase34-browser-gate",
      deploymentDigest: input.candidateDigest,
      environment: input.environment,
      evidenceDigest: dispatchEvidenceDigest,
      handlerKey: NOTIFICATION_DISPATCH_HANDLER_KEY,
      handlerVersion: NOTIFICATION_DISPATCH_HANDLER_VERSION,
      now,
      reasonCode: "PHASE34_PASSWORD_RECOVERY_E2E",
      stepUpEvidenceDigest: dispatchEvidenceDigest,
    });
    const documentScanEvidenceDigest = createHash("sha256")
      .update(
        JSON.stringify({
          deploymentDigest: input.candidateDigest,
          environment: "local",
          handlerKey: DOCUMENT_SCAN_HANDLER_KEY,
          handlerVersion: DOCUMENT_SCAN_HANDLER_VERSION,
          scope: "phase34-browser-document-scan-worker",
        }),
        "utf8",
      )
      .digest("hex");
    const documentScanHandler = await activateSandboxHandler(database, {
      actorReference: "phase34-browser-gate",
      deploymentDigest: input.candidateDigest,
      environment: input.environment,
      evidenceDigest: documentScanEvidenceDigest,
      handlerKey: DOCUMENT_SCAN_HANDLER_KEY,
      handlerVersion: DOCUMENT_SCAN_HANDLER_VERSION,
      now,
      reasonCode: "PHASE34_DOCUMENT_SCAN_WORKER_E2E",
      stepUpEvidenceDigest: documentScanEvidenceDigest,
    });

    const [
      localJobAlertProviders,
      localTransactionalProviders,
      localDocumentObjectStoreProviders,
      localDocumentScannerProviders,
      localJobAlertHandlers,
      localDispatchHandlers,
      localDocumentScanHandlers,
      previewProviders,
      previewHandlers,
    ] = await Promise.all([
      database.providerActivation.count({
        where: {
          environment: "local",
          useCase: "email.job-alert",
          mode: "SANDBOX",
          revokedAt: null,
        },
      }),
      database.providerActivation.count({
        where: {
          environment: "local",
          useCase: "email.transactional",
          mode: "SANDBOX",
          revokedAt: null,
        },
      }),
      database.providerActivation.count({
        where: {
          environment: "local",
          useCase: "documents.object-store",
          mode: "SANDBOX",
          revokedAt: null,
        },
      }),
      database.providerActivation.count({
        where: {
          environment: "local",
          useCase: "documents.malware-scan",
          mode: "SANDBOX",
          revokedAt: null,
        },
      }),
      database.workerHandlerActivation.count({
        where: {
          environment: "local",
          handlerKey: JOB_ALERT_HANDLER_KEY,
          handlerVersion: JOB_ALERT_HANDLER_VERSION,
          mode: "SANDBOX",
          revokedAt: null,
        },
      }),
      database.workerHandlerActivation.count({
        where: {
          environment: "local",
          handlerKey: NOTIFICATION_DISPATCH_HANDLER_KEY,
          handlerVersion: NOTIFICATION_DISPATCH_HANDLER_VERSION,
          mode: "SANDBOX",
          revokedAt: null,
        },
      }),
      database.workerHandlerActivation.count({
        where: {
          environment: "local",
          handlerKey: DOCUMENT_SCAN_HANDLER_KEY,
          handlerVersion: DOCUMENT_SCAN_HANDLER_VERSION,
          mode: "SANDBOX",
          revokedAt: null,
        },
      }),
      database.providerActivation.count({
        where: {
          environment: "preview",
          useCase: {
            in: [
              "email.job-alert",
              "email.transactional",
              "documents.object-store",
              "documents.malware-scan",
            ],
          },
          revokedAt: null,
        },
      }),
      database.workerHandlerActivation.count({
        where: {
          environment: "preview",
          handlerKey: {
            in: [
              JOB_ALERT_HANDLER_KEY,
              NOTIFICATION_DISPATCH_HANDLER_KEY,
              DOCUMENT_SCAN_HANDLER_KEY,
            ],
          },
          revokedAt: null,
        },
      }),
    ]);
    if (
      localJobAlertProviders !== 1 ||
      localTransactionalProviders !== 1 ||
      localDocumentObjectStoreProviders !== 1 ||
      localDocumentScannerProviders !== 1 ||
      localJobAlertHandlers !== 1 ||
      localDispatchHandlers !== 1 ||
      localDocumentScanHandlers !== 1 ||
      previewProviders !== 0 ||
      previewHandlers !== 0
    ) {
      throw new Error("PHASE34_LOCAL_ACTIVATION_SCOPE_INVALID");
    }
    return Object.freeze({
      handlerActivationId: handler.id,
      providerActivationId: provider.activation.id,
      notificationDispatchHandlerActivationId: notificationDispatchHandler.id,
      transactionalProviderActivationId: transactionalProvider.activation.id,
      documentObjectStoreProviderActivationId:
        documentObjectStoreProvider.activation.id,
      documentScannerProviderActivationId:
        documentScannerProvider.activation.id,
      documentScanHandlerActivationId: documentScanHandler.id,
    });
  } finally {
    await database.$disconnect();
  }
}

function removeTemporaryDocumentStorage(root: string) {
  const resolvedRoot = resolve(root);
  if (
    resolve(dirname(resolvedRoot)).toLowerCase() !==
      resolve(tmpdir()).toLowerCase() ||
    !basename(resolvedRoot).startsWith(DOCUMENT_TEMP_PREFIX)
  ) {
    throw new Error("PHASE34_DOCUMENT_STORAGE_CLEANUP_TARGET_INVALID");
  }
  rmSync(resolvedRoot, { force: true, recursive: true });
}

function validateManifest(expectedDigest: string) {
  validatePhase34BrowserManifest(
    JSON.parse(readFileSync(pendingManifestPath, "utf8")),
    expectedDigest,
  );
}

function workingTreeDigest() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: SOURCE_ROOT },
  );
  const paths = output
    .toString("utf8")
    .split("\0")
    .filter((value) => value.length > 0)
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path.replaceAll("\\", "/"), "utf8");
    hash.update("\0", "utf8");
    hash.update(readFileSync(resolve(SOURCE_ROOT, path)));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function commitSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: SOURCE_ROOT,
    encoding: "utf8",
  }).trim();
}

function allocatePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a loopback port."));
        return;
      }
      const port = address.port;
      server.close((error) =>
        error === undefined ? resolvePort(port) : reject(error),
      );
    });
  });
}

function childExit(child: ChildProcess) {
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
  await Promise.race([exit, delay(10_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exit;
  }
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
  return path.replace(`${SOURCE_ROOT}\\`, "").replaceAll("\\", "/");
}
