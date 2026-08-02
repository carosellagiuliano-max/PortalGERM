import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

import { WORKER_HANDLER_CATALOG } from "@/lib/ops/handler-catalog";
import { PROVIDER_CATALOG } from "@/lib/ops/provider-catalog";
import {
  PHASE33_CI_WORKFLOW_PATH,
  inspectPhase33CiWorkflow,
} from "@/lib/release/phase33-ci-workflow-contract";
import {
  PHASE33_EXTERNAL_GATE_IDS,
  PHASE33_TECHNICAL_GATE_IDS,
} from "@/lib/release/phase33-release-verdict";

const repository = resolve(import.meta.dirname, "..");
const phase33BaselineCommit = "59ed81033d409aac847c55f1da3ecf5370f4f035";
const baselinePath = resolve(
  repository,
  "codex-plan/evidence/phase33-migration-baseline.json",
);

try {
  const outputPath = parseOutput(process.argv.slice(2));
  const declaredBaseline = parseBaseline(await readJson(baselinePath));
  const anchoredBaseline = migrationBaselineFromGit(phase33BaselineCommit);
  const [
    phasePlan,
    masterPlan,
    routeInventory,
    serverActionInventory,
    featureFlagInventory,
    compose,
    environmentSchema,
    packageManifest,
    phase33CiWorkflow,
    forbiddenTestDirectives,
  ] = await Promise.all([
    readText("codex-plan/33-go-live-readiness-e2e-acceptance.md"),
    readText("codex-plan/00-PLAN.md"),
    readJson(resolve(repository, "codex-plan/route-inventory.json")),
    readJson(resolve(repository, "codex-plan/server-action-inventory.json")),
    readJson(resolve(repository, "codex-plan/feature-flag-inventory.json")),
    readText("compose.phase33.yml"),
    readText("lib/config/env-schema.ts"),
    readJson(resolve(repository, "package.json")),
    readText(PHASE33_CI_WORKFLOW_PATH),
    findForbiddenTestDirectives(),
  ]);
  const migrations = await migrationInventory(anchoredBaseline);
  const checks = [
    check(
      "PHASE_33_REGISTERED",
      masterPlan.includes("33-go-live-readiness-e2e-acceptance.md"),
      "Phase 33 must be linked from the authoritative master plan.",
    ),
    check(
      "PHASE_33_28_POINT_CONTRACT",
      Array.from({ length: 28 }, (_, index) => index + 1).every((number) =>
        new RegExp(`^### ${number}\\. `, "mu").test(phasePlan),
      ),
      "Every mandatory section 1 through 28 must exist.",
    ),
    migrationBaselineDeclarationCheck(declaredBaseline, anchoredBaseline),
    historicalMigrationCheck(anchoredBaseline, migrations),
    check(
      "PHASE_33_ADDITIVE_MIGRATION",
      migrations.newFiles.length === 1 &&
        /phase_33/iu.test(migrations.newFiles[0] ?? ""),
      `Expected exactly one additive Phase-33 migration; observed ${migrations.newFiles.length}.`,
    ),
    check(
      "ROUTE_INVENTORY_CLASSIFIED",
      isRouteInventory(routeInventory),
      "Route inventory must contain bounded page, handler and metadata classifications.",
    ),
    check(
      "ACTION_FLAG_INVENTORIES_CLASSIFIED",
      isServerActionInventory(serverActionInventory) &&
        isFeatureFlagInventory(featureFlagInventory),
      "Server actions and runtime controls must have bounded source, owner, role, launch-class and status classifications.",
    ),
    providerMatrixCheck(),
    workerCatalogCheck(),
    runtimeTopologyCheck(compose),
    modeMatrixCheck(environmentSchema),
    releaseCommandCheck(packageManifest),
    phase33CiWorkflowCheck(phase33CiWorkflow),
    check(
      "NO_TEST_QUARANTINE_DIRECTIVES",
      forbiddenTestDirectives.length === 0,
      forbiddenTestDirectives.length === 0
        ? "No test.skip/test.only/test.todo/describe.skip/describe.only directives."
        : forbiddenTestDirectives.join(","),
    ),
    check(
      "RELEASE_GATE_IDENTITIES_UNIQUE",
      unique([...PHASE33_TECHNICAL_GATE_IDS, ...PHASE33_EXTERNAL_GATE_IDS]),
      "Technical and external release gate identities must be unique.",
    ),
    phase32EvidenceCheck(),
  ];
  const report = Object.freeze({
    schemaVersion: "phase33-static-audit-v1",
    baselineCommit: anchoredBaseline.baselineCommit,
    currentCommit: git("rev-parse", "HEAD").trim(),
    status: checks.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
    counts: Object.freeze({
      historicalMigrations: migrations.historicalFiles.length,
      additiveMigrations: migrations.newFiles.length,
      providers: PROVIDER_CATALOG.length,
      workerHandlers: WORKER_HANDLER_CATALOG.length,
      checks: checks.length,
    }),
    digests: Object.freeze({
      historicalMigrations: migrations.aggregateDigest,
      providerCatalog: digestJson(PROVIDER_CATALOG),
      workerCatalog: digestJson(WORKER_HANDLER_CATALOG),
      routeInventory: digestJson(routeInventory),
      serverActionInventory: digestJson(serverActionInventory),
      featureFlagInventory: digestJson(featureFlagInventory),
      runtimeCompose: digestText(compose),
      phaseContract: digestText(phasePlan),
    }),
    checks: Object.freeze(checks),
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath !== undefined) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
  }
  process.stdout.write(serialized);
  process.exitCode = report.status === "PASS" ? 0 : 1;
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-audit",
      status: "FAIL",
      error: safeError(error),
    })}\n`,
  );
  process.exitCode = 1;
}

function check(id: string, passed: boolean, detail: string) {
  return Object.freeze({ id, status: passed ? "PASS" : "FAIL", detail });
}

function historicalMigrationCheck(
  baseline: Baseline,
  inventory: Awaited<ReturnType<typeof migrationInventory>>,
) {
  const missing = Object.keys(baseline.files).filter(
    (path) => inventory.byPath[path] === undefined,
  );
  const changed = Object.entries(baseline.files).filter(
    ([path, digest]) => inventory.byPath[path] !== digest,
  );
  return check(
    "HISTORICAL_MIGRATIONS_BYTE_IDENTICAL",
    missing.length === 0 &&
      changed.length === 0 &&
      inventory.aggregateDigest === baseline.aggregateDigest,
    `missing=${missing.length}; changed=${changed.length}; aggregate=${inventory.aggregateDigest}`,
  );
}

function migrationBaselineDeclarationCheck(
  declared: Baseline,
  anchored: Baseline,
) {
  const declaredEntries = Object.entries(declared.files).sort(
    ([left], [right]) => left.localeCompare(right, "en"),
  );
  const anchoredEntries = Object.entries(anchored.files).sort(
    ([left], [right]) => left.localeCompare(right, "en"),
  );
  const passed =
    declared.schemaVersion === anchored.schemaVersion &&
    declared.baselineCommit === anchored.baselineCommit &&
    declared.historicalMigrationCount === anchored.historicalMigrationCount &&
    declared.aggregateDigest === anchored.aggregateDigest &&
    JSON.stringify(declaredEntries) === JSON.stringify(anchoredEntries);
  return check(
    "MIGRATION_BASELINE_ANCHORED_TO_GIT",
    passed,
    passed
      ? `${anchored.historicalMigrationCount} migration digests recomputed from ${anchored.baselineCommit}.`
      : "The declared migration baseline differs from the immutable Git baseline.",
  );
}

function providerMatrixCheck() {
  const identities = new Set(
    PROVIDER_CATALOG.map(
      ({ useCase, adapterKey, adapterVersion }) =>
        `${useCase}:${adapterKey}:${adapterVersion}`,
    ),
  );
  const required = [
    "email.transactional:local_mock:v1",
    "email.transactional:resend_contract:v1",
    "email.transactional:resend_sandbox:v1",
    "email.transactional:resend_live:v1",
    "email.job-alert:local_mock:v1",
    "email.job-alert:resend_contract:v1",
    "email.job-alert:resend_sandbox:v1",
    "email.job-alert:resend_live:v1",
    "email.delivery-events:resend_contract:v1",
    "email.delivery-events:resend_sandbox:v1",
    "email.delivery-events:resend_live:v1",
    "documents.object-store:filesystem_sandbox:v1",
    "documents.object-store:s3_contract:v1",
    "documents.object-store:s3_live:v1",
    "documents.malware-scan:deterministic_sandbox:v1",
    "documents.malware-scan:clamav_contract:v1",
    "documents.malware-scan:clamav_live:v1",
    "privacy.export-store:filesystem_sandbox:v1",
    "privacy.export-store:s3_contract:v1",
    "privacy.export-store:s3_live:v1",
    "payments.hosted-checkout:stripe_contract:v1",
    "payments.hosted-checkout:stripe_sandbox:v1",
    "payments.hosted-checkout:stripe_live:v1",
  ];
  const missing = required.filter((identity) => !identities.has(identity));
  return check(
    "PROVIDER_MODE_MATRIX",
    missing.length === 0 &&
      identities.size === required.length &&
      unique([...identities]),
    missing.length === 0
      ? `${identities.size}/${required.length} exact unique provider identities.`
      : `Missing: ${missing.join(",")}`,
  );
}

function workerCatalogCheck() {
  const expectedHandlerCount = 26;
  const identities = WORKER_HANDLER_CATALOG.map(
    ({ handlerKey, handlerVersion }) => `${handlerKey}@${handlerVersion}`,
  );
  const complete = WORKER_HANDLER_CATALOG.every(
    (handler) =>
      handler.execution === "IMPLEMENTED" &&
      handler.owner.trim().length > 1 &&
      handler.runbookRef.startsWith("codex-plan/") &&
      handler.sloRef.startsWith("codex-plan/") &&
      handler.schedule.trim().length > 1,
  );
  return check(
    "WORKER_HANDLER_IDENTITIES_UNIQUE",
    identities.length === expectedHandlerCount &&
      unique(identities) &&
      complete,
    `${identities.length}/${expectedHandlerCount} exact versioned handlers; every launch handler must be implemented and owned.`,
  );
}

function runtimeTopologyCheck(compose: string) {
  const requiredServices = [
    "app-contract:",
    "worker-contract:",
    "scheduler-contract:",
    "postgres:",
    "object-store:",
    "scanner:",
    "provider-contract:",
    "tls-proxy:",
  ];
  return check(
    "PRODUCTION_CONTRACT_TOPOLOGY",
    requiredServices.every((service) => compose.includes(`  ${service}`)) &&
      compose.includes('profiles: ["local-mock", "production-contract"]') &&
      compose.includes("internal: true"),
    "App, worker, scheduler, PG16, storage, scanner, provider stub and TLS must be isolated services.",
  );
}

function modeMatrixCheck(source: string) {
  const required = [
    "resend_contract",
    "resend_sandbox",
    "resend_live",
    "stripe_contract",
    "stripe_sandbox",
    "stripe_live",
    "s3_contract",
    "s3_live",
    "clamav_contract",
    "clamav_live",
  ];
  return check(
    "ENVIRONMENT_PROVIDER_MODES",
    required.every((mode) => source.includes(mode)),
    "Every contract, sandbox and live mode must be schema-validated and fail closed.",
  );
}

function phase32EvidenceCheck() {
  const path = "codex-plan/evidence/2026-07-30-phase-32.md";
  const current = readFileSync(resolve(repository, path), "utf8");
  const baseline = git(
    "show",
    `59ed81033d409aac847c55f1da3ecf5370f4f035:${path}`,
  );
  return check(
    "PHASE_32_EVIDENCE_UNCHANGED",
    current === baseline,
    "The historic Phase-32 NO_GO evidence remains byte-identical.",
  );
}

function releaseCommandCheck(value: unknown) {
  const scripts =
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).scripts === "object" &&
    (value as Record<string, unknown>).scripts !== null
      ? ((value as Record<string, unknown>).scripts as Record<string, unknown>)
      : {};
  const required = [
    "phase33:audit",
    "phase33:scale",
    "phase33:e2e",
    "phase33:providers",
    "test:phase33",
    "phase33:manifest",
    "phase33:release:technical",
    "phase33:release:activation",
    "phase33:ci:report-reference",
    "phase33:ci:evidence-verify",
  ];
  const missing = required.filter(
    (name) => typeof scripts[name] !== "string" || scripts[name] === "",
  );
  return check(
    "PHASE_33_RELEASE_COMMANDS",
    missing.length === 0,
    missing.length === 0
      ? `${required.length} fixed Phase-33 commands registered.`
      : `Missing: ${missing.join(",")}`,
  );
}

function phase33CiWorkflowCheck(source: string) {
  const inspected = inspectPhase33CiWorkflow(source);
  return check(
    "PHASE_33_CI_G4_WORKFLOW",
    inspected.status === "PASS",
    inspected.status === "PASS"
      ? "Pinned, read-only 38-command G4 workflow emits LC4/LC5 technical evidence only after full PASS."
      : inspected.issues.join(","),
  );
}

async function findForbiddenTestDirectives() {
  const root = resolve(repository, "tests");
  const findings: string[] = [];
  for (const path of await sourceFiles(root)) {
    const source = await readFile(path, "utf8");
    const lines = source.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (/\b(?:describe|it|test)\.(?:skip|only|todo|fixme)\s*\(/u.test(line)) {
        findings.push(`${path.slice(repository.length + 1)}:${index + 1}`);
      }
    });
  }
  return findings.sort();
}

async function sourceFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) output.push(...(await sourceFiles(path)));
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) {
      output.push(path);
    }
  }
  return output;
}

async function migrationInventory(baseline: Baseline) {
  const migrationRoot = resolve(repository, "prisma/migrations");
  const directories = await readdir(migrationRoot, { withFileTypes: true });
  const byPath: Record<string, string> = {};
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const absolute = resolve(migrationRoot, directory.name, "migration.sql");
    try {
      const body = await readFile(absolute);
      byPath[`${directory.name}/migration.sql`] = `sha256:${createHash("sha256")
        .update(body)
        .digest("hex")}`;
    } catch {
      // A directory without migration.sql is reported as an unexpected layout.
      byPath[`${directory.name}/<missing>`] = "sha256:missing";
    }
  }
  const historicalFiles = Object.keys(baseline.files).sort();
  const newFiles = Object.keys(byPath)
    .filter((path) => baseline.files[path] === undefined)
    .sort();
  const aggregateDigest = digestText(
    historicalFiles
      .map(
        (path) =>
          `${path} ${(byPath[path] ?? "sha256:missing").replace(/^sha256:/u, "")}`,
      )
      .join("\n"),
  );
  return Object.freeze({ aggregateDigest, byPath, historicalFiles, newFiles });
}

function migrationBaselineFromGit(commit: string): Baseline {
  if (commit !== phase33BaselineCommit) {
    throw new Error("MIGRATION_BASELINE_COMMIT_NOT_ALLOWLISTED");
  }
  const prefix = "prisma/migrations/";
  const paths = git(
    "ls-tree",
    "-r",
    "--name-only",
    commit,
    "--",
    "prisma/migrations",
  )
    .split(/\r?\n/u)
    .filter((path) => /^prisma\/migrations\/[^/]+\/migration\.sql$/u.test(path))
    .sort((left, right) => left.localeCompare(right, "en"));
  const files = Object.fromEntries(
    paths.map((path) => {
      const relativePath = path.slice(prefix.length);
      const body = gitBuffer("show", `${commit}:${path}`);
      return [relativePath, digestBuffer(body)];
    }),
  );
  const aggregateDigest = digestText(
    Object.entries(files)
      .map(([path, digest]) => `${path} ${digest.replace(/^sha256:/u, "")}`)
      .join("\n"),
  );
  return Object.freeze({
    schemaVersion: "phase33-historical-migration-baseline-v1",
    baselineCommit: commit,
    historicalMigrationCount: paths.length,
    aggregateDigest,
    files: Object.freeze(files),
  });
}

function isRouteInventory(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length >= 100 &&
    value.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const route = entry as Record<string, unknown>;
      return (
        (route.kind === "page" ||
          route.kind === "handler" ||
          route.kind === "metadata") &&
        typeof route.path === "string" &&
        route.path.startsWith("/") &&
        isNonEmptyStringArray(route.roles)
      );
    })
  );
}

function isServerActionInventory(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    unique(
      value.map((entry) => {
        if (typeof entry !== "object" || entry === null) return "INVALID";
        const action = entry as Record<string, unknown>;
        return `${String(action.source)}:${String(action.action)}`;
      }),
    ) &&
    value.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const action = entry as Record<string, unknown>;
      return (
        typeof action.action === "string" &&
        action.action.length > 0 &&
        typeof action.source === "string" &&
        (action.source.startsWith("app/") ||
          action.source.startsWith("lib/")) &&
        typeof action.routeScope === "string" &&
        action.routeScope.startsWith("/") &&
        typeof action.owner === "string" &&
        action.owner.length > 0 &&
        isNonEmptyStringArray(action.roles) &&
        isNonEmptyStringArray(action.launchClasses) &&
        (action.status === "IMPLEMENTED" || action.status === "LOCAL_CI_ONLY")
      );
    })
  );
}

function isFeatureFlagInventory(value: unknown) {
  const statuses = new Set([
    "CONFIGURATION_CONTRACT_ONLY",
    "DECLARED_FAIL_CLOSED",
    "RUNTIME_CONSUMED",
  ]);
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    unique(
      value.map((entry) =>
        typeof entry === "object" && entry !== null
          ? String((entry as Record<string, unknown>).key)
          : "INVALID",
      ),
    ) &&
    value.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const control = entry as Record<string, unknown>;
      return (
        typeof control.key === "string" &&
        /^[A-Z][A-Z0-9_]+$/u.test(control.key) &&
        (control.kind === "boolean" || control.kind === "mode") &&
        typeof control.defaultValue === "string" &&
        control.source === "lib/config/env-schema.ts" &&
        (control.effectiveProperty === null ||
          typeof control.effectiveProperty === "string") &&
        typeof control.owner === "string" &&
        control.owner.length > 0 &&
        Array.isArray(control.consumers) &&
        control.consumers.every((consumer) => typeof consumer === "string") &&
        isNonEmptyStringArray(control.launchClasses) &&
        typeof control.status === "string" &&
        statuses.has(control.status)
      );
    })
  );
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

type Baseline = Readonly<{
  schemaVersion: "phase33-historical-migration-baseline-v1";
  aggregateDigest: string;
  baselineCommit: string;
  historicalMigrationCount: number;
  files: Readonly<Record<string, string>>;
}>;

function parseBaseline(value: unknown): Baseline {
  if (typeof value !== "object" || value === null) {
    throw new Error("MIGRATION_BASELINE_INVALID");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== "phase33-historical-migration-baseline-v1" ||
    typeof candidate.aggregateDigest !== "string" ||
    typeof candidate.baselineCommit !== "string" ||
    typeof candidate.historicalMigrationCount !== "number" ||
    typeof candidate.files !== "object" ||
    candidate.files === null ||
    Object.keys(candidate.files).length !==
      candidate.historicalMigrationCount ||
    !/^[a-f0-9]{40}$/u.test(candidate.baselineCommit) ||
    !/^sha256:[a-f0-9]{64}$/u.test(candidate.aggregateDigest) ||
    !Object.entries(candidate.files).every(
      ([path, digest]) =>
        /^[^/]+\/migration\.sql$/u.test(path) &&
        typeof digest === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(digest),
    )
  ) {
    throw new Error("MIGRATION_BASELINE_INVALID");
  }
  return candidate as Baseline;
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function digestText(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digestBuffer(value: Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestJson(value: unknown) {
  return digestText(JSON.stringify(value));
}

function git(...args: string[]) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

function gitBuffer(...args: string[]) {
  return execFileSync("git", args, {
    cwd: repository,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

async function readText(path: string) {
  return readFile(resolve(repository, path), "utf8");
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function parseOutput(values: readonly string[]) {
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !values[0]?.startsWith("--output=")) {
    throw new Error("PHASE33_AUDIT_ARGUMENT_INVALID");
  }
  return resolve(repository, values[0].slice("--output=".length));
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "UNKNOWN_FAILURE")
    .replaceAll(/[^A-Za-z0-9_:,./-]/gu, "_")
    .slice(0, 1_024);
}
