import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { inspectPostgresTarget } from "@/lib/db/database-target";
import {
  applyPhase32DisabledServerGates,
  assertPhase32DisabledServerGates,
  resolvePhase32CandidateEvidence,
} from "@/lib/release/phase32-candidate-evidence";
import {
  PHASE32_GATE_IDS,
  PHASE32_POLICY_VERSION,
  type Phase32GateId,
  type Phase32GateOutcome,
} from "@/lib/release/phase32-contract";
import {
  copyPhase32ContainedFile,
  copyPhase32ContainedTree,
  digestPhase32Directory,
  digestPhase32File,
} from "@/lib/release/phase32-artifact-digest";
import {
  parsePhase32FindingsLedger,
  type Phase32FindingRecord,
} from "@/lib/release/phase32-findings-ledger";
import {
  PHASE32_G4_MANIFEST_VERSION,
  PHASE32_REQUIRED_REPORT_KINDS,
  phase32G4ApprovalFromVerifiedAttestation,
  requiredPhase32ApprovalScopes,
  validatePhase32G4Manifest,
  type Phase32G4Manifest,
} from "@/lib/release/phase32-g4-manifest";
import { phase32IsolatedHarnessEnvironment } from "@/lib/release/phase32-isolated-harness";
import {
  parsePhase32ApprovalRootTrustAnchor,
  parsePhase32ApprovalAttestation,
  phase32ApprovalRootTrustAnchorSha256,
  verifyPhase32Lc1ApprovalSet,
} from "@/lib/release/phase32-approval-attestation";
import { evaluatePhase32LaunchClassPolicy } from "@/lib/release/phase32-launch-class-policy";
import { waitForPhase32ProcessExit } from "@/lib/release/phase32-process-termination";
import {
  PHASE32_REPORT_EVIDENCE_VERSION,
  validatePhase32ReportEvidence,
  type Phase32ReportEvidence,
} from "@/lib/release/phase32-report-evidence";
import { createPhase32PreApprovalEvidenceRoot } from "@/lib/release/phase32-pre-approval-evidence";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";
import { phase32InheritedReleaseEnvironment } from "@/scripts/phase32-release-environment";

type RequestedLaunchClass = "LC1";
type ReportKind = (typeof PHASE32_REQUIRED_REPORT_KINDS)[number];

type CommandResult = Readonly<{
  id: string;
  command: string;
  logPath: string;
  startedAt: string;
  completedAt: string;
  durationMilliseconds: number;
  exitCode: number;
}>;

type CommandInput = Readonly<{
  id: string;
  label: string;
  executable: string;
  args: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  logPath: string;
  timeoutMilliseconds: number;
}>;

type ParsedArguments = Readonly<{
  finalizeOnly: boolean;
  internal: boolean;
  verifyOnly: boolean;
  requestedClass: RequestedLaunchClass;
  manifestPath?: string;
  outputDirectory?: string;
  expectedCommit?: string;
}>;

type ExternalG4Bundle = Readonly<{
  walkthrough: NonNullable<Phase32G4Manifest["walkthrough"]>;
  rollbackDrill: NonNullable<Phase32G4Manifest["rollbackDrill"]>;
  approvals: Phase32G4Manifest["approvals"];
  evidenceSha256: string;
  preApprovalEvidenceSha256: string;
  rootTrustAnchorSha256: string;
  trustedKeyRegistrySha256: string;
}>;

type PreApprovalEvidenceBase = Readonly<{
  candidate: Omit<Phase32G4Manifest["candidate"], "cleanTree">;
  runtime: Phase32G4Manifest["runtime"];
  reports: Phase32G4Manifest["reports"];
  deployment: NonNullable<Phase32G4Manifest["deployment"]>;
  findingsLedgerSha256: string;
  findingAliasBindingsSha256: string;
}>;

type RawEvidenceAttachment = Readonly<{
  path: string;
  sha256: string;
  fileCount: number;
  sizeBytes: number;
}>;

const PHASE32_LC1_CONFIGURATION_KEYS = Object.freeze([
  "APP_ENV",
  "APP_BUILD_ID",
  "APP_URL",
  "NEXT_PUBLIC_APP_NAME",
  "RATE_LIMIT_BACKEND",
  "TRUSTED_PROXY_HOPS",
  "ENABLE_LOCAL_MOCK_MAILBOX",
  "IDENTITY_VERIFICATION_ENFORCEMENT",
  "LOGIN_EMAIL_CHANGE",
  "ADMIN_MFA_REQUIRED",
  "PRIVILEGED_STEP_UP_MODE",
  "TRUST_RISK_MODE",
  "EMAIL_PROVIDER_MODE",
  "NOTIFICATION_DISPATCH",
  "OPTIONAL_EMAIL",
  "DELIVERY_REPLAY",
  "WORKER_RUNTIME",
  "WORKER_SANDBOX_REPLAY",
  "PAYMENT_PROVIDER_MODE",
  "PAYMENT_SANDBOX_COHORT",
  "REAL_PAYMENT_INGESTION",
  "REAL_PAYMENT_PROJECTION",
  "PAID_SELF_SERVICE",
  "FINANCE_REPAIR_ACTIONS",
  "PAID_SERVICE_RECOVERY",
  "COMMERCIAL_PRODUCTION_OFFERS",
  "COMMERCIAL_MANAGED_IMPORT",
  "COMMERCIAL_BOOST",
  "COMMERCIAL_PAID_RADAR",
  "COMMERCIAL_SALARY",
  "DOCUMENT_VAULT_WRITES",
  "DOCUMENT_STORAGE_MODE",
  "DOCUMENT_SCANNER_MODE",
  "DOCUMENT_CLEAN_READS",
  "DOCUMENT_RECONCILIATION",
  "DOCUMENT_BULK_ACCESS",
  "DOCUMENT_VAULT_COHORT",
  "PRIVACY_EXPORT_V2",
  "PRIVACY_CORRECTION_EXECUTION",
  "PRIVACY_ERASURE_EXECUTION",
  "PRIVACY_PROCESSING_MODE",
  "PRIVACY_PROCESSING_COHORT",
  "PRIVACY_EXPORT_STORAGE_MODE",
  "IDENTITY_PERSONA_V2",
  "EXISTING_IDENTITY_INVITATION",
  "PERSONA_PORTAL_SWITCH",
  "PERSONA_PRIVACY_V2",
  "PERSONA_LEGACY_CONTRACT",
  "EXTERNAL_APPLICATION_TRACKER",
  "INTERVIEW_SCHEDULER",
  "COMPANY_TRUST_V2",
  "COMPANY_DOMAIN_CHALLENGE",
  "COMPANY_REGISTER_CHECK",
  "COMPANY_VERIFICATION_DOCUMENT",
  "COMPANY_STRONG_BADGE",
  "COMPANY_TRUST_PUBLIC_ELIGIBILITY",
  "COMPANY_TRUST_RAPID_REVOKE",
  "LEGACY_COMPANY_REVERIFY",
  "COMPANY_REGISTER_PROVIDER_MODE",
  "COMPANY_DOMAIN_PROVIDER_MODE",
  "COMPANY_VERIFICATION_COHORT",
  "PHASE32_STANDALONE_BUILD",
  "NEXT_TELEMETRY_DISABLED",
] as const);

const REPORT_STEP_MAPPINGS = Object.freeze({
  DEPENDENCY_INSTALL: "dependency-install",
  ENVIRONMENT: "environment",
  PLAN_AUDIT: "plan-audit",
  ROUTE_AUDIT: "route-audit",
  LICENSE: "license-audit",
  SECRET_SCAN: "secret-scan",
  LINT: "lint",
  TYPECHECK: "typecheck",
  UNIT: "unit",
  INTEGRATION: "integration",
  MIGRATION: "recovery",
  SEED: "recovery",
  BUILD: "hsts-build",
  HTTP: "http",
  HSTS: "hsts-build",
  BROWSER: "browser",
  SECURITY: "dependency-security",
  PRIVACY: "integration",
  PROVIDER_WORKER: "provider-worker",
  RECOVERY: "recovery",
} satisfies Record<ReportKind, string>);
const repository = process.cwd();
const argumentsValue = parseArguments(process.argv.slice(2));

try {
  if (argumentsValue.verifyOnly) {
    await verifyExistingManifest(argumentsValue);
  } else if (argumentsValue.finalizeOnly) {
    await finalizeExistingManifest(argumentsValue);
  } else if (argumentsValue.internal) {
    await runInternalAudit(argumentsValue);
  } else {
    await runOuterAudit(argumentsValue);
  }
} catch (error) {
  process.stderr.write(
    `Phase 32 release audit failed: ${redact(
      error instanceof Error ? error.message : "unknown failure",
    )}\n`,
  );
  process.exitCode = 1;
}

async function runOuterAudit(command: ParsedArguments) {
  loadLocalEnvironment();
  const outputDirectory = phase32OutputDirectory(repository);
  await resetOutputDirectory(outputDirectory);

  const commitSha = await gitOutput(["rev-parse", "HEAD"], repository);
  assertGitObjectId(commitSha, "candidate commit");
  await assertCleanCandidate(repository);
  const ledger = await loadPhase32FindingsLedger(repository);

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "swisstalenthub-phase32-"),
  );
  const clone = join(temporaryRoot, "clean-clone");
  const reportsDirectory = join(outputDirectory, "reports");
  await mkdir(reportsDirectory, { recursive: true });

  try {
    await requireSuccessfulCommand({
      id: "clean-clone",
      label: "Clean clone",
      executable: "git",
      args: ["clone", "--no-local", "--no-checkout", repository, clone],
      cwd: repository,
      environment: process.env,
      logPath: join(reportsDirectory, "clean-clone.log"),
      timeoutMilliseconds: 10 * 60_000,
    });
    await requireSuccessfulCommand({
      id: "detached-checkout",
      label: "Detached candidate checkout",
      executable: "git",
      args: ["checkout", "--detach", commitSha],
      cwd: clone,
      environment: process.env,
      logPath: join(reportsDirectory, "detached-checkout.log"),
      timeoutMilliseconds: 5 * 60_000,
    });
    await assertCleanCandidate(clone);

    const releaseEnvironment: NodeJS.ProcessEnv = {
      ...lc1Environment(commitSha, ledger),
      PHASE32_EPHEMERAL_ROOT: temporaryRoot,
    };
    assertSafeLc1DatabaseEnvironment(releaseEnvironment);
    const dependencyResult = await requireSuccessfulCommand({
      id: "dependency-install",
      label: "Deterministic dependency install",
      executable: process.execPath,
      args: [requireNpmCli(), "ci"],
      cwd: clone,
      environment: releaseEnvironment,
      logPath: join(reportsDirectory, "dependency-install.log"),
      timeoutMilliseconds: 30 * 60_000,
    });
    await writeJson(
      join(outputDirectory, "dependency-step.json"),
      dependencyResult,
    );

    const internalResult = await runCommand({
      id: "phase32-internal",
      label: "Candidate-bound Phase 32 audit",
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        "scripts/phase32-release-gate.ts",
        "--internal",
        `--requested-class=${command.requestedClass}`,
        `--expected-commit=${commitSha}`,
        `--output-dir=${outputDirectory}`,
      ],
      cwd: clone,
      environment: releaseEnvironment,
      logPath: join(reportsDirectory, "phase32-internal.log"),
      timeoutMilliseconds: 4 * 60 * 60_000,
    });
    if (internalResult.exitCode !== 0) {
      throw new Error(
        `candidate-bound audit exited with ${internalResult.exitCode}; inspect ${relative(
          repository,
          internalResult.logPath,
        )}`,
      );
    }

    const manifestPath = join(outputDirectory, "g4-manifest.json");
    const validation = validatePhase32G4Manifest(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    process.stdout.write(
      `Phase 32 audit completed for ${commitSha}: technical=${validation.technicalAuditStatus}, launch=${validation.launchDecision}. Manifest: ${relative(
        repository,
        manifestPath,
      )}\n`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runInternalAudit(command: ParsedArguments) {
  if (
    command.outputDirectory === undefined ||
    command.expectedCommit === undefined
  ) {
    throw new Error(
      "internal audit requires --output-dir and --expected-commit",
    );
  }
  const outputDirectory = resolve(command.outputDirectory);
  if (!isAbsolute(outputDirectory)) {
    throw new Error("internal output directory must be absolute");
  }
  const commitSha = await gitOutput(["rev-parse", "HEAD"], repository);
  const treeSha = await gitOutput(["rev-parse", "HEAD^{tree}"], repository);
  if (commitSha !== command.expectedCommit) {
    throw new Error(
      "candidate commit changed between outer and internal audit",
    );
  }
  assertGitObjectId(commitSha, "candidate commit");
  assertGitObjectId(treeSha, "candidate tree");
  await assertCleanCandidate(repository);

  const reportsDirectory = join(outputDirectory, "reports");
  await mkdir(reportsDirectory, { recursive: true });
  const dependencyResult = parseCommandResult(
    JSON.parse(
      await readFile(join(outputDirectory, "dependency-step.json"), "utf8"),
    ),
  );
  const npmCli = requireNpmCli();
  const ledger = await loadPhase32FindingsLedger(repository);
  const environment = lc1Environment(commitSha, ledger);
  assertSafeLc1DatabaseEnvironment(environment);
  const configurationPath = join(
    outputDirectory,
    "lc1-runtime-configuration.json",
  );
  await writeJson(
    configurationPath,
    buildLc1RuntimeConfiguration(commitSha, ledger, environment),
  );
  const configuration = await digestPhase32File(configurationPath);
  const steps = new Map<string, CommandResult>([
    [dependencyResult.id, dependencyResult],
  ]);

  await requireSuccessfulCommand({
    id: "environment-init",
    label: "CI environment initialization without file writes",
    executable: process.execPath,
    args: [npmCli, "run", "env:init", "--", "--ci"],
    cwd: repository,
    environment: ciEnvironmentInitializationEnvironment(environment),
    logPath: join(reportsDirectory, "environment-init.log"),
    timeoutMilliseconds: 10 * 60_000,
  });
  const environmentStep = await runCompositeNpmStep({
    id: "environment",
    label: "Environment and schema validation",
    npmCli,
    cwd: repository,
    environment,
    logPath: join(reportsDirectory, "environment.log"),
    commands: [
      ["run", "env:validate"],
      ["run", "db:generate"],
      ["run", "db:validate"],
    ],
    timeoutMilliseconds: 20 * 60_000,
  });
  steps.set(environmentStep.id, environmentStep);

  for (const specification of [
    commandSpecification(
      "plan-audit",
      "Plan and evidence audit",
      ["run", "plan:audit"],
      10 * 60_000,
    ),
    commandSpecification(
      "route-audit",
      "Route and role inventory audit",
      ["run", "route:audit"],
      10 * 60_000,
    ),
    commandSpecification(
      "secret-scan",
      "Release secret scan",
      ["run", "security:release-scan"],
      10 * 60_000,
    ),
    commandSpecification(
      "license-audit",
      "License policy audit",
      ["run", "license:audit"],
      10 * 60_000,
    ),
    commandSpecification(
      "dependency-security",
      "Production dependency vulnerability audit",
      ["audit", "--omit=dev", "--audit-level=high"],
      10 * 60_000,
    ),
    commandSpecification("lint", "Lint", ["run", "lint"], 30 * 60_000),
    commandSpecification(
      "typecheck",
      "Typecheck",
      ["run", "typecheck"],
      30 * 60_000,
    ),
    commandSpecification("unit", "Complete unit suite", ["test"], 45 * 60_000),
    commandSpecification(
      "integration",
      "Complete PostgreSQL integration suite",
      ["run", "test:integration"],
      90 * 60_000,
    ),
  ]) {
    const result = await requireSuccessfulCommand({
      id: specification.id,
      label: specification.label,
      executable: process.execPath,
      args: [npmCli, ...specification.args],
      cwd: repository,
      environment,
      logPath: join(reportsDirectory, `${specification.id}.log`),
      timeoutMilliseconds: specification.timeoutMilliseconds,
    });
    steps.set(result.id, result);
    if (
      (result.id === "unit" || result.id === "integration") &&
      (await summarizedSkippedCount(result.logPath)) !== 0
    ) {
      throw new Error(`${result.id} suite reported skipped tests`);
    }
  }

  const hsts = await requireSuccessfulCommand({
    id: "hsts-build",
    label: "Production-like HSTS build and smoke",
    executable: process.execPath,
    args: [npmCli, "run", "test:e2e:hsts"],
    cwd: repository,
    environment: phase32IsolatedHarnessEnvironment(environment),
    logPath: join(reportsDirectory, "hsts-build.log"),
    timeoutMilliseconds: 45 * 60_000,
  });
  steps.set(hsts.id, hsts);

  const ephemeralRoot = resolve(
    environment.PHASE32_EPHEMERAL_ROOT ??
      fail("PHASE32_EPHEMERAL_ROOT is missing"),
  );
  const runtimeArtifactRoot = resolve(ephemeralRoot, "candidate-artifact");
  if (
    !isAbsolute(ephemeralRoot) ||
    !isWithin(ephemeralRoot, runtimeArtifactRoot) ||
    isWithin(repository, runtimeArtifactRoot)
  ) {
    throw new Error(
      "candidate artifact execution root must be an isolated external temporary directory",
    );
  }
  await assembleCandidateArtifact(repository, runtimeArtifactRoot);
  const artifact = await digestPhase32Directory(runtimeArtifactRoot);
  const buildIdentifier = commitSha;
  const artifactEnvironment = phase32IsolatedHarnessEnvironment({
    ...environment,
    APP_ARTIFACT_ROOT: runtimeArtifactRoot,
    APP_BUILD_ID: buildIdentifier,
  });
  const rawEvidence = new Map<string, RawEvidenceAttachment>();
  const artifactSecretScan = await requireSuccessfulCommand({
    id: "artifact-secret-scan",
    label: "Deployable candidate artifact secret scan",
    executable: process.execPath,
    args: [npmCli, "run", "security:release-scan"],
    cwd: repository,
    environment: {
      ...environment,
      PHASE32_ARTIFACT_SCAN_ROOT: runtimeArtifactRoot,
    },
    logPath: join(reportsDirectory, "artifact-secret-scan.log"),
    timeoutMilliseconds: 15 * 60_000,
  });
  const artifactSecretScanEvidence = await persistRawEvidenceLogDirectory({
    logPath: artifactSecretScan.logPath,
    outputDirectory,
    path: "raw-evidence/artifact-secret-scan-log",
  });
  rawEvidence.set(artifactSecretScanEvidence.path, artifactSecretScanEvidence);

  const http = await requireSuccessfulCommand({
    id: "http",
    label: "Candidate artifact HTTP smoke",
    executable: process.execPath,
    args: [npmCli, "run", "test:e2e:http"],
    cwd: repository,
    environment: artifactEnvironment,
    logPath: join(reportsDirectory, "http.log"),
    timeoutMilliseconds: 30 * 60_000,
  });
  steps.set(http.id, http);

  const browserRegression = await requireSuccessfulCommand({
    id: "browser-regression",
    label: "Candidate artifact complete three-engine browser regression",
    executable: process.execPath,
    args: [npmCli, "run", "test:e2e:browser"],
    cwd: repository,
    environment: artifactEnvironment,
    logPath: join(reportsDirectory, "browser-regression.log"),
    timeoutMilliseconds: 90 * 60_000,
  });
  await assertBrowserManifest(commitSha, repository);
  for (const [path, attachment] of await persistRawEvidenceDirectories({
    allowedRoot: repository,
    outputDirectory,
    sources: [
      {
        source: resolve(repository, "test-results", "phase17"),
        path: "raw-evidence/phase17-regression",
      },
      {
        source: resolve(repository, "playwright-report", "phase17"),
        path: "raw-evidence/playwright-phase17-regression",
      },
    ],
  })) {
    rawEvidence.set(path, attachment);
  }
  const regressionLog = await persistRawEvidenceLogDirectory({
    logPath: browserRegression.logPath,
    outputDirectory,
    path: "raw-evidence/browser-regression-log",
  });
  rawEvidence.set(regressionLog.path, regressionLog);

  const browser = await requireSuccessfulCommand({
    id: "browser",
    label: "Candidate artifact LC1-disabled three-engine browser gate",
    executable: process.execPath,
    args: [
      npmCli,
      "run",
      "test:e2e:browser",
      "--",
      "tests/e2e/flows/phase17-security-search.spec.ts",
      "tests/e2e/flows/phase31-production-offer.spec.ts",
      "tests/e2e/quality/phase29-critical-journeys.spec.ts",
    ],
    cwd: repository,
    environment: {
      ...artifactEnvironment,
      PHASE32_LC1_BROWSER_MODE: "true",
    },
    logPath: join(reportsDirectory, "browser.log"),
    timeoutMilliseconds: 45 * 60_000,
  });
  steps.set(browser.id, browser);
  await assertBrowserManifest(commitSha, repository);
  for (const [path, attachment] of await persistRawEvidenceDirectories({
    allowedRoot: repository,
    outputDirectory,
    sources: [
      {
        source: resolve(repository, "test-results", "phase17"),
        path: "raw-evidence/phase32-lc1-browser",
      },
      {
        source: resolve(repository, "playwright-report", "phase17"),
        path: "raw-evidence/playwright-phase32-lc1",
      },
    ],
  })) {
    rawEvidence.set(path, attachment);
  }

  const providerWorker = await requireSuccessfulCommand({
    id: "provider-worker",
    label: "Worker failure and recovery matrix",
    executable: process.execPath,
    args: [npmCli, "run", "worker:chaos"],
    cwd: repository,
    environment,
    logPath: join(reportsDirectory, "provider-worker.log"),
    timeoutMilliseconds: 30 * 60_000,
  });
  steps.set(providerWorker.id, providerWorker);

  const recovery = await requireSuccessfulCommand({
    id: "recovery",
    label: "Clean-clone migration, seed, backup and restore drill",
    executable: process.execPath,
    args: [npmCli, "run", "test:release:recovery"],
    cwd: repository,
    environment,
    logPath: join(reportsDirectory, "recovery.log"),
    timeoutMilliseconds: 45 * 60_000,
  });
  steps.set(recovery.id, recovery);
  await assertRecoveryManifest(commitSha, repository);
  for (const [path, attachment] of await persistRawEvidenceDirectories({
    allowedRoot: repository,
    outputDirectory,
    sources: [
      {
        source: resolve(repository, "test-results", "phase18"),
        path: "raw-evidence/phase18",
      },
    ],
  })) {
    rawEvidence.set(path, attachment);
  }

  const runtimeArtifactAfter =
    await digestPhase32Directory(runtimeArtifactRoot);
  if (runtimeArtifactAfter.sha256 !== artifact.sha256) {
    throw new Error("candidate artifact changed while it was running");
  }
  await assertCleanCandidate(repository);

  const storedArtifactRoot = join(outputDirectory, "candidate-artifact");
  await rm(storedArtifactRoot, { recursive: true, force: true });
  await copyPhase32ContainedTree(
    runtimeArtifactRoot,
    storedArtifactRoot,
    runtimeArtifactRoot,
  );
  const storedArtifact = await digestPhase32Directory(storedArtifactRoot);
  if (storedArtifact.sha256 !== artifact.sha256) {
    throw new Error("persisted candidate artifact digest mismatch");
  }

  const sbomPath = join(outputDirectory, "sbom.cyclonedx.json");
  await generateSbom({
    npmCli,
    cwd: repository,
    environment,
    outputPath: sbomPath,
    logPath: join(reportsDirectory, "sbom.log"),
  });

  const [lockfile, migrations, schema, sbom] = await Promise.all([
    digestPhase32File(resolve(repository, "package-lock.json")),
    digestPhase32Directory(resolve(repository, "prisma", "migrations")),
    digestPhase32File(resolve(repository, "prisma", "schema.prisma")),
    digestPhase32File(sbomPath),
  ]);

  const runtimeEvidencePath = join(outputDirectory, "runtime-identity.json");
  const runtimeObservedAt = new Date().toISOString();
  await writeJson(runtimeEvidencePath, {
    schemaVersion: "phase32-runtime-identity-v1",
    environment: "local",
    commitSha,
    treeSha,
    artifactSha256: artifact.sha256,
    configurationSha256: configuration.sha256,
    buildIdentifier,
    healthContract: "/health/live",
    observedBy: "candidate-artifact-http-smoke",
    observedAt: runtimeObservedAt,
  });
  const runtimeEvidence = await digestPhase32File(runtimeEvidencePath);

  const deploymentEvidencePath = join(
    outputDirectory,
    "local-deployment-evidence.json",
  );
  const deploymentId = `phase32-local-${commitSha.slice(0, 16)}`;
  await writeJson(deploymentEvidencePath, {
    schemaVersion: "phase32-local-deployment-evidence-v1",
    environment: "local",
    commitSha,
    artifactSha256: artifact.sha256,
    configurationSha256: configuration.sha256,
    runtimeSha256: runtimeEvidence.sha256,
    buildIdentifier,
    smokeReport: relative(outputDirectory, http.logPath).replaceAll("\\", "/"),
    status: "PASSED",
    deployedAt: http.completedAt,
  });
  const deploymentEvidence = await digestPhase32File(deploymentEvidencePath);
  const sourceEvidenceDigests = await digestFindingSourceEvidence(
    ledger.records,
    repository,
  );
  const reports = await createReports({
    artifactSha256: artifact.sha256,
    commitSha,
    configurationSha256: configuration.sha256,
    outputDirectory,
    rawEvidence,
    steps,
  });
  const createdAt = new Date().toISOString();
  const decisionAt = createdAt;
  assertFindingReviewsCurrent(ledger.records, decisionAt);
  externalG4EvidenceConfigured();
  const candidateEvidenceBindings = resolvePhase32CandidateEvidence(
    ledger,
    reports,
  );
  const candidateEvidenceBindingsPath = join(
    outputDirectory,
    "finding-alias-bindings.json",
  );
  await writeJson(candidateEvidenceBindingsPath, {
    schemaVersion: "phase32-finding-alias-bindings-v1",
    commitSha,
    artifactSha256: artifact.sha256,
    configurationSha256: configuration.sha256,
    bindings: candidateEvidenceBindings,
  });
  const candidateEvidenceBindingsDigest = await digestPhase32File(
    candidateEvidenceBindingsPath,
  );
  const findingsLedgerDigest = await digestPhase32File(
    resolve(
      repository,
      "codex-plan",
      "release",
      "phase32-lc1-findings-ledger.json",
    ),
  );
  const candidateIdentity = {
    commitSha,
    treeSha,
    lockfileSha256: lockfile.sha256,
    migrationSha256: migrations.sha256,
    schemaSha256: schema.sha256,
    artifactSha256: artifact.sha256,
    configurationSha256: configuration.sha256,
    sbomSha256: sbom.sha256,
    runtimeSha256: runtimeEvidence.sha256,
  };
  const runtimeIdentity: Phase32G4Manifest["runtime"] = {
    environment: "local",
    buildIdentifier,
    commitSha,
    artifactSha256: artifact.sha256,
    configurationSha256: configuration.sha256,
    runtimeSha256: runtimeEvidence.sha256,
    observedAt: runtimeObservedAt,
  };
  const deployment: NonNullable<Phase32G4Manifest["deployment"]> = {
    id: deploymentId,
    status: "PASSED",
    environment: "local",
    commitSha,
    artifactSha256: artifact.sha256,
    configurationSha256: configuration.sha256,
    runtimeSha256: runtimeEvidence.sha256,
    buildIdentifier,
    evidenceSha256: deploymentEvidence.sha256,
    deployedAt: http.completedAt,
  };
  const externalBundle = await loadExternalG4Bundle({
    artifactSha256: artifact.sha256,
    commitSha,
    decisionAt,
    deploymentId,
    preApprovalEvidenceBase: {
      candidate: candidateIdentity,
      runtime: runtimeIdentity,
      reports,
      deployment,
      findingsLedgerSha256: findingsLedgerDigest.sha256,
      findingAliasBindingsSha256: candidateEvidenceBindingsDigest.sha256,
    },
  });
  const findings = ledger.records.map((finding) => {
    const bindings = candidateEvidenceBindings.filter(
      (binding) => binding.findingId === finding.id,
    );
    const walkthroughBlocked =
      externalBundle === null &&
      bindings.some((binding) => binding.externalWalkthroughBlocked);
    const sourceEvidence =
      sourceEvidenceDigests.get(finding.id) ??
      fail(`missing source evidence digest for ${finding.id}`);
    return {
      id: finding.id,
      status:
        finding.status === "DEFERRED_MONITORED"
          ? ("DEFERRED / MONITORED" as const)
          : finding.status,
      ownerRef: finding.ownerRole,
      scopeRef: `phase32.lc1.${finding.id}`,
      evidenceSha256: [
        ...new Set([
          ...sourceEvidence,
          ...bindings.map(({ reportSha256 }) => reportSha256),
          candidateEvidenceBindingsDigest.sha256,
          ...(finding.id === "STH-024" && externalBundle !== null
            ? [externalBundle.walkthrough.evidenceSha256]
            : []),
        ]),
      ],
      resolution: walkthroughBlocked
        ? ("BLOCKING" as const)
        : ("SATISFIED" as const),
      launchClassValid: !walkthroughBlocked,
    };
  });

  const approvalsComplete =
    externalBundle !== null &&
    externalBundle.approvals.length ===
      requiredPhase32ApprovalScopes("LC1").length;
  const technicalAuditComplete = externalBundle !== null;
  const findingsComplete = findings.every(
    (finding) => finding.resolution === "SATISFIED" && finding.launchClassValid,
  );
  const gates = lc1GateRecords({
    approvalsComplete,
    findingsComplete,
    rollbackComplete: technicalAuditComplete,
  });
  const classDecision = evaluatePhase32LaunchClassPolicy({
    policyVersion: PHASE32_POLICY_VERSION,
    scope: lc1PolicyScope(),
    gates,
  });
  const expectedClassDecision =
    technicalAuditComplete && findingsComplete && approvalsComplete
      ? "LC1"
      : "NO_GO";
  if (classDecision.decision !== expectedClassDecision) {
    throw new Error(
      "LC1 policy decision disagrees with walkthrough, rollback or approvals",
    );
  }
  const candidateInventory = {
    schemaVersion: "phase32-candidate-inventory-v1",
    requestedLaunchClass: command.requestedClass,
    commitSha,
    treeSha,
    cleanTree: true,
    lockfile,
    migrations,
    schema,
    artifact,
    configuration,
    findingAliasBindings: candidateEvidenceBindingsDigest,
    buildOutput: artifact,
    sbom,
    runtime: runtimeEvidence,
    externalG4BundleSha256: externalBundle?.evidenceSha256 ?? null,
    preApprovalEvidenceSha256:
      externalBundle?.preApprovalEvidenceSha256 ?? null,
    approvalRootTrustAnchorSha256:
      externalBundle?.rootTrustAnchorSha256 ?? null,
    trustedApprovalKeyRegistrySha256:
      externalBundle?.trustedKeyRegistrySha256 ?? null,
    generatedAt: new Date().toISOString(),
  };
  await writeJson(
    join(outputDirectory, "candidate-inventory.json"),
    candidateInventory,
  );

  const manifest: Phase32G4Manifest = {
    schemaVersion: PHASE32_G4_MANIFEST_VERSION,
    manifestId: `phase32-g4-${commitSha.slice(0, 16)}`,
    createdAt,
    operatorRef: "codex.local-release-operator",
    requestedLaunchClass: command.requestedClass,
    candidate: {
      ...candidateIdentity,
      cleanTree: true,
    },
    runtime: runtimeIdentity,
    reports,
    deployment,
    walkthrough: externalBundle?.walkthrough ?? null,
    rollbackDrill: externalBundle?.rollbackDrill ?? null,
    findings,
    externalApprovalEvidence:
      externalBundle === null
        ? null
        : {
            externalBundleSha256: externalBundle.evidenceSha256,
            preApprovalEvidenceSha256: externalBundle.preApprovalEvidenceSha256,
            rootTrustAnchorSha256: externalBundle.rootTrustAnchorSha256,
            trustedKeyRegistrySha256: externalBundle.trustedKeyRegistrySha256,
          },
    approvals: externalBundle?.approvals ?? [],
    technicalAudit: {
      status: technicalAuditComplete ? "PASS" : "FAIL",
      failureCodes: technicalAuditComplete
        ? []
        : ["ROLLBACK_DRILL_MISSING", "WALKTHROUGH_MISSING"],
    },
    launchDecision: {
      status: expectedClassDecision === "LC1" ? "APPROVED" : "NO_GO",
      approvedLaunchClass: expectedClassDecision === "LC1" ? "LC1" : null,
      reasonCodes:
        expectedClassDecision === "LC1"
          ? []
          : [
              ...(technicalAuditComplete
                ? []
                : (["TECHNICAL_AUDIT_FAILED"] as const)),
              ...(findingsComplete ? [] : (["FINDINGS_BLOCKING"] as const)),
              ...(approvalsComplete ? [] : (["APPROVALS_INCOMPLETE"] as const)),
            ],
      decidedAt: decisionAt,
    },
  };
  const validation = validatePhase32G4Manifest(manifest);
  if (
    validation.launchDecision !==
      (expectedClassDecision === "LC1" ? "APPROVED" : "NO_GO") ||
    validation.launchEligible !== (expectedClassDecision === "LC1") ||
    validation.blockingFindingIds.join(",") !==
      (findingsComplete ? "" : "STH-024")
  ) {
    throw new Error("derived G4 decision does not match the frozen LC1 audit");
  }
  await writeJson(join(outputDirectory, "g4-manifest.json"), manifest);
  await writeJson(
    join(outputDirectory, "launch-class-decision.json"),
    classDecision,
  );
  await writeJson(join(outputDirectory, "g4-validation.json"), {
    technicalAuditStatus: validation.technicalAuditStatus,
    launchDecision: validation.launchDecision,
    launchEligible: validation.launchEligible,
    technicalFailureCodes: validation.technicalFailureCodes,
    blockingFindingIds: validation.blockingFindingIds,
    missingApprovalScopes: validation.missingApprovalScopes,
    validatedAt: new Date().toISOString(),
  });

  process.stdout.write(
    `Candidate-bound audit manifest is valid: commit=${commitSha}, artifact=${artifact.sha256}, decision=${validation.launchDecision}.\n`,
  );
}

async function verifyExistingManifest(command: ParsedArguments) {
  loadLocalEnvironment();
  const manifestPath = resolve(
    command.manifestPath ??
      resolve(repository, "test-results", "phase32", "g4-manifest.json"),
  );
  const validation = validatePhase32G4Manifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  assertLc1ManifestScope(validation.manifest);
  assertFindingReviewsCurrent(
    (await loadPhase32FindingsLedger(repository)).records,
    new Date().toISOString(),
  );
  const commitSha = await gitOutput(["rev-parse", "HEAD"], repository);
  const treeSha = await gitOutput(["rev-parse", "HEAD^{tree}"], repository);
  if (
    commitSha !== validation.manifest.candidate.commitSha ||
    treeSha !== validation.manifest.candidate.treeSha
  ) {
    throw new Error(
      "manifest candidate differs from the current repository commit or tree",
    );
  }
  await assertCleanCandidate(repository);
  await verifyStoredCandidateEvidence(
    validation.manifest,
    dirname(manifestPath),
  );
  await assertStoredExternalApprovalEvidence(
    validation.manifest,
    dirname(manifestPath),
  );
  await assertStoredLc1PolicyDecision(validation, dirname(manifestPath));
  process.stdout.write(
    `Phase 32 manifest: technical=${validation.technicalAuditStatus}, launch=${validation.launchDecision}, eligible=${String(validation.launchEligible)}.\n`,
  );
  if (!validation.launchEligible) {
    process.exitCode = 2;
  }
}

async function finalizeExistingManifest(command: ParsedArguments) {
  loadLocalEnvironment();
  const manifestPath =
    command.manifestPath ??
    resolve(repository, "test-results", "phase32", "g4-manifest.json");
  const outputDirectory = dirname(manifestPath);
  const currentValidation = validatePhase32G4Manifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const current = currentValidation.manifest;
  assertLc1ManifestScope(current);
  const commitSha = await gitOutput(["rev-parse", "HEAD"], repository);
  const treeSha = await gitOutput(["rev-parse", "HEAD^{tree}"], repository);
  if (commitSha !== current.candidate.commitSha) {
    throw new Error("finalize candidate differs from the current repository");
  }
  if (treeSha !== current.candidate.treeSha) {
    throw new Error("finalize tree differs from the frozen candidate");
  }
  await assertCleanCandidate(repository);
  await verifyStoredCandidateEvidence(current, outputDirectory);
  await assertStoredLc1PolicyDecision(currentValidation, outputDirectory);

  const decisionAt = new Date().toISOString();
  assertFindingReviewsCurrent(
    (await loadPhase32FindingsLedger(repository)).records,
    decisionAt,
  );
  const bundle = await loadExternalG4Bundle({
    artifactSha256: current.candidate.artifactSha256,
    commitSha,
    decisionAt,
    deploymentId:
      current.deployment?.id ??
      fail("cannot finalize a manifest without its deployment"),
    preApprovalEvidenceBase: await storedPreApprovalEvidenceBase(
      current,
      outputDirectory,
    ),
  });
  if (bundle === null) {
    throw new Error(
      "finalize requires PHASE32_EXTERNAL_G4_BUNDLE_PATH and its SHA-256",
    );
  }

  const approvalsComplete =
    bundle.approvals.length === requiredPhase32ApprovalScopes("LC1").length;
  const expectedDecision = approvalsComplete ? "APPROVED" : "NO_GO";
  const finalized: Phase32G4Manifest = {
    ...current,
    walkthrough: bundle.walkthrough,
    rollbackDrill: bundle.rollbackDrill,
    findings: current.findings.map((finding) =>
      finding.id === "STH-024"
        ? {
            ...finding,
            evidenceSha256: [
              ...new Set([
                ...finding.evidenceSha256,
                bundle.walkthrough.evidenceSha256,
              ]),
            ],
            resolution: "SATISFIED",
            launchClassValid: true,
          }
        : finding,
    ),
    externalApprovalEvidence: {
      externalBundleSha256: bundle.evidenceSha256,
      preApprovalEvidenceSha256: bundle.preApprovalEvidenceSha256,
      rootTrustAnchorSha256: bundle.rootTrustAnchorSha256,
      trustedKeyRegistrySha256: bundle.trustedKeyRegistrySha256,
    },
    approvals: bundle.approvals,
    technicalAudit: {
      status: "PASS",
      failureCodes: [],
    },
    launchDecision: {
      status: expectedDecision,
      approvedLaunchClass: approvalsComplete ? "LC1" : null,
      reasonCodes: approvalsComplete ? [] : ["APPROVALS_INCOMPLETE"],
      decidedAt: decisionAt,
    },
  };
  const validation = validatePhase32G4Manifest(finalized);
  if (
    validation.launchDecision !== expectedDecision ||
    validation.launchEligible !== approvalsComplete
  ) {
    throw new Error("finalized G4 decision is inconsistent");
  }

  const classDecision = evaluatePhase32LaunchClassPolicy({
    policyVersion: PHASE32_POLICY_VERSION,
    scope: lc1PolicyScope(),
    gates: lc1GateRecords({
      approvalsComplete,
      findingsComplete: true,
      rollbackComplete: true,
    }),
  });
  if (classDecision.decision !== (approvalsComplete ? "LC1" : "NO_GO")) {
    throw new Error("finalized policy and G4 manifest disagree");
  }

  await writeJson(manifestPath, finalized);
  await writeJson(
    join(outputDirectory, "launch-class-decision.json"),
    classDecision,
  );
  await writeJson(join(outputDirectory, "g4-validation.json"), {
    technicalAuditStatus: validation.technicalAuditStatus,
    launchDecision: validation.launchDecision,
    launchEligible: validation.launchEligible,
    technicalFailureCodes: validation.technicalFailureCodes,
    blockingFindingIds: validation.blockingFindingIds,
    missingApprovalScopes: validation.missingApprovalScopes,
    externalG4BundleSha256: bundle.evidenceSha256,
    validatedAt: new Date().toISOString(),
  });
  process.stdout.write(
    `Phase 32 manifest finalized without rebuild: commit=${commitSha}, launch=${validation.launchDecision}.\n`,
  );
}

async function verifyStoredCandidateEvidence(
  manifest: Phase32G4Manifest,
  outputDirectory: string,
) {
  const artifact = await digestPhase32Directory(
    join(outputDirectory, "candidate-artifact"),
  );
  if (artifact.sha256 !== manifest.candidate.artifactSha256) {
    throw new Error("stored candidate artifact digest mismatch");
  }
  const [
    lockfile,
    migrations,
    schema,
    configuration,
    sbom,
    runtime,
    deployment,
  ] = await Promise.all([
    digestPhase32File(resolve(repository, "package-lock.json")),
    digestPhase32Directory(resolve(repository, "prisma", "migrations")),
    digestPhase32File(resolve(repository, "prisma", "schema.prisma")),
    digestPhase32File(join(outputDirectory, "lc1-runtime-configuration.json")),
    digestPhase32File(join(outputDirectory, "sbom.cyclonedx.json")),
    digestPhase32File(join(outputDirectory, "runtime-identity.json")),
    digestPhase32File(join(outputDirectory, "local-deployment-evidence.json")),
  ]);
  if (
    lockfile.sha256 !== manifest.candidate.lockfileSha256 ||
    migrations.sha256 !== manifest.candidate.migrationSha256 ||
    schema.sha256 !== manifest.candidate.schemaSha256 ||
    configuration.sha256 !== manifest.candidate.configurationSha256 ||
    sbom.sha256 !== manifest.candidate.sbomSha256 ||
    runtime.sha256 !== manifest.candidate.runtimeSha256 ||
    deployment.sha256 !== manifest.deployment?.evidenceSha256
  ) {
    throw new Error("stored candidate identity evidence digest mismatch");
  }
  await assertStoredLc1Configuration(manifest, outputDirectory);

  const runtimeRecord = JSON.parse(
    await readFile(join(outputDirectory, "runtime-identity.json"), "utf8"),
  ) as unknown;
  if (
    !isRecord(runtimeRecord) ||
    runtimeRecord.commitSha !== manifest.candidate.commitSha ||
    runtimeRecord.treeSha !== manifest.candidate.treeSha ||
    runtimeRecord.artifactSha256 !== manifest.candidate.artifactSha256 ||
    runtimeRecord.configurationSha256 !==
      manifest.candidate.configurationSha256 ||
    runtimeRecord.buildIdentifier !== manifest.runtime.buildIdentifier ||
    runtimeRecord.observedAt !== manifest.runtime.observedAt ||
    runtimeRecord.environment !== manifest.runtime.environment
  ) {
    throw new Error("stored runtime identity content mismatch");
  }
  const deploymentRecord = JSON.parse(
    await readFile(
      join(outputDirectory, "local-deployment-evidence.json"),
      "utf8",
    ),
  ) as unknown;
  if (
    manifest.deployment === null ||
    !isRecord(deploymentRecord) ||
    deploymentRecord.status !== "PASSED" ||
    deploymentRecord.commitSha !== manifest.deployment.commitSha ||
    deploymentRecord.artifactSha256 !== manifest.deployment.artifactSha256 ||
    deploymentRecord.configurationSha256 !==
      manifest.deployment.configurationSha256 ||
    deploymentRecord.runtimeSha256 !== manifest.deployment.runtimeSha256 ||
    deploymentRecord.buildIdentifier !== manifest.deployment.buildIdentifier ||
    deploymentRecord.deployedAt !== manifest.deployment.deployedAt
  ) {
    throw new Error("stored deployment identity content mismatch");
  }

  for (const report of manifest.reports) {
    const step = REPORT_STEP_MAPPINGS[report.kind];
    const primaryLogPath = `reports/${step}.log`;
    const primaryLog = await digestPhase32File(
      join(outputDirectory, ...primaryLogPath.split("/")),
    );
    const attachments = await Promise.all(
      reportAttachmentPaths(report.kind).map(async (path) => {
        const digest = await digestPhase32Directory(
          join(outputDirectory, ...path.split("/")),
        );
        return Object.freeze({
          path,
          sha256: digest.sha256,
          fileCount: digest.fileCount,
          sizeBytes: digest.sizeBytes,
        });
      }),
    );
    const descriptorPath = join(
      outputDirectory,
      "report-evidence",
      `${report.kind.toLowerCase().replaceAll("_", "-")}.json`,
    );
    const descriptor = validatePhase32ReportEvidence(
      JSON.parse(await readFile(descriptorPath, "utf8")),
      {
        reportKind: report.kind,
        commitSha: manifest.candidate.commitSha,
        artifactSha256: manifest.candidate.artifactSha256,
        primaryLog: {
          path: primaryLogPath,
          sha256: primaryLog.sha256,
        },
        attachments,
      },
    );
    const descriptorDigest = await digestPhase32File(descriptorPath);
    if (
      descriptor.reportKind !== report.kind ||
      descriptorDigest.sha256 !== report.reportSha256
    ) {
      throw new Error(`stored report digest mismatch: ${report.kind}`);
    }
  }

  const ledgerPath = resolve(
    repository,
    "codex-plan",
    "release",
    "phase32-lc1-findings-ledger.json",
  );
  const ledger = parsePhase32FindingsLedger(
    JSON.parse(await readFile(ledgerPath, "utf8")),
  );
  const expectedEvidence = await digestFindingSourceEvidence(
    ledger.records,
    repository,
  );
  const expectedBindings = resolvePhase32CandidateEvidence(
    ledger,
    manifest.reports,
  );
  const bindingsPath = join(outputDirectory, "finding-alias-bindings.json");
  const bindingsDigest = await digestPhase32File(bindingsPath);
  const storedBindings = JSON.parse(
    await readFile(bindingsPath, "utf8"),
  ) as unknown;
  const expectedBindingsDocument = {
    schemaVersion: "phase32-finding-alias-bindings-v1",
    commitSha: manifest.candidate.commitSha,
    artifactSha256: manifest.candidate.artifactSha256,
    configurationSha256: manifest.candidate.configurationSha256,
    bindings: expectedBindings,
  };
  if (
    JSON.stringify(storedBindings) !== JSON.stringify(expectedBindingsDocument)
  ) {
    throw new Error("stored finding alias bindings mismatch");
  }
  const ledgerById = new Map(
    ledger.records.map((record) => [record.id, record]),
  );
  for (const finding of manifest.findings) {
    const ledgerFinding = ledgerById.get(finding.id);
    const sourceEvidence = expectedEvidence.get(finding.id);
    const bindingEvidence = expectedBindings
      .filter((binding) => binding.findingId === finding.id)
      .map((binding) => binding.reportSha256);
    const evidence =
      sourceEvidence === undefined
        ? undefined
        : [
            ...new Set([
              ...sourceEvidence,
              ...bindingEvidence,
              bindingsDigest.sha256,
              ...(finding.id === "STH-024" && manifest.walkthrough !== null
                ? [manifest.walkthrough.evidenceSha256]
                : []),
            ]),
          ];
    const expectedStatus =
      ledgerFinding?.status === "DEFERRED_MONITORED"
        ? "DEFERRED / MONITORED"
        : ledgerFinding?.status;
    const shouldBlock =
      finding.id === "STH-024" && manifest.walkthrough === null;
    if (
      ledgerFinding === undefined ||
      evidence === undefined ||
      finding.status !== expectedStatus ||
      finding.ownerRef !== ledgerFinding.ownerRole ||
      finding.scopeRef !== `phase32.lc1.${finding.id}` ||
      finding.resolution !== (shouldBlock ? "BLOCKING" : "SATISFIED") ||
      finding.launchClassValid !== !shouldBlock ||
      finding.evidenceSha256.length !== evidence.length ||
      finding.evidenceSha256.some((digest, index) => digest !== evidence[index])
    ) {
      throw new Error(`stored finding evidence mismatch: ${finding.id}`);
    }
  }
}

async function assertStoredExternalApprovalEvidence(
  manifest: Phase32G4Manifest,
  outputDirectory: string,
) {
  if (manifest.externalApprovalEvidence === null) {
    if (manifest.approvals.length !== 0) {
      throw new Error(
        "manifest approvals exist without bound external approval evidence",
      );
    }
    if (externalG4EvidenceConfigured()) {
      throw new Error(
        "external approval evidence is configured but is not bound into this NO_GO manifest; run release:finalize explicitly",
      );
    }
    return;
  }
  if (
    manifest.deployment === null ||
    manifest.walkthrough === null ||
    manifest.rollbackDrill === null
  ) {
    throw new Error(
      "external approval evidence requires deployment, walkthrough and rollback evidence",
    );
  }
  const bundle = await loadExternalG4Bundle({
    artifactSha256: manifest.candidate.artifactSha256,
    commitSha: manifest.candidate.commitSha,
    decisionAt: new Date().toISOString(),
    deploymentId: manifest.deployment.id,
    preApprovalEvidenceBase: await storedPreApprovalEvidenceBase(
      manifest,
      outputDirectory,
    ),
  });
  if (
    bundle === null ||
    bundle.evidenceSha256 !==
      manifest.externalApprovalEvidence.externalBundleSha256 ||
    bundle.preApprovalEvidenceSha256 !==
      manifest.externalApprovalEvidence.preApprovalEvidenceSha256 ||
    bundle.rootTrustAnchorSha256 !==
      manifest.externalApprovalEvidence.rootTrustAnchorSha256 ||
    bundle.trustedKeyRegistrySha256 !==
      manifest.externalApprovalEvidence.trustedKeyRegistrySha256 ||
    JSON.stringify(bundle.walkthrough) !==
      JSON.stringify(manifest.walkthrough) ||
    JSON.stringify(bundle.rollbackDrill) !==
      JSON.stringify(manifest.rollbackDrill) ||
    JSON.stringify(bundle.approvals) !== JSON.stringify(manifest.approvals)
  ) {
    throw new Error(
      "stored external approval evidence does not match the signed bundle and trusted registry",
    );
  }
}

async function storedPreApprovalEvidenceBase(
  manifest: Phase32G4Manifest,
  outputDirectory: string,
): Promise<PreApprovalEvidenceBase> {
  if (manifest.deployment === null) {
    throw new Error(
      "pre-approval evidence cannot be reconstructed without deployment evidence",
    );
  }
  const [findingsLedger, findingAliasBindings] = await Promise.all([
    digestPhase32File(
      resolve(
        repository,
        "codex-plan",
        "release",
        "phase32-lc1-findings-ledger.json",
      ),
    ),
    digestPhase32File(join(outputDirectory, "finding-alias-bindings.json")),
  ]);
  const { cleanTree: _cleanTree, ...candidate } = manifest.candidate;
  return Object.freeze({
    candidate,
    runtime: manifest.runtime,
    reports: manifest.reports,
    deployment: manifest.deployment,
    findingsLedgerSha256: findingsLedger.sha256,
    findingAliasBindingsSha256: findingAliasBindings.sha256,
  });
}

async function assertStoredLc1Configuration(
  manifest: Phase32G4Manifest,
  outputDirectory: string,
) {
  const raw = JSON.parse(
    await readFile(
      join(outputDirectory, "lc1-runtime-configuration.json"),
      "utf8",
    ),
  ) as unknown;
  const ledger = await loadPhase32FindingsLedger(repository);
  const expected = buildLc1RuntimeConfiguration(
    manifest.candidate.commitSha,
    ledger,
    lc1Environment(manifest.candidate.commitSha, ledger),
  );
  if (JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error(
      "stored LC1 runtime configuration is not the exact current fail-closed configuration",
    );
  }
}

async function createReports(
  input: Readonly<{
    artifactSha256: string;
    commitSha: string;
    configurationSha256: string;
    outputDirectory: string;
    rawEvidence: ReadonlyMap<string, RawEvidenceAttachment>;
    steps: ReadonlyMap<string, CommandResult>;
  }>,
): Promise<Phase32G4Manifest["reports"]> {
  const browserCounts = await readBrowserCounts(repository);
  const reportEvidenceDirectory = join(
    input.outputDirectory,
    "report-evidence",
  );
  await mkdir(reportEvidenceDirectory, { recursive: true });
  const reports = [];
  for (const kind of PHASE32_REQUIRED_REPORT_KINDS) {
    const step = input.steps.get(REPORT_STEP_MAPPINGS[kind]);
    if (step === undefined) {
      throw new Error(`missing completed command for report ${kind}`);
    }
    const primaryLog = await digestPhase32File(step.logPath);
    const primaryLogPath = relative(
      input.outputDirectory,
      step.logPath,
    ).replaceAll("\\", "/");
    if (
      primaryLogPath.startsWith("../") ||
      primaryLogPath === ".." ||
      isAbsolute(primaryLogPath)
    ) {
      throw new Error(`report log escaped the Phase 32 output: ${kind}`);
    }
    const attachments = reportAttachmentPaths(kind).map(
      (path) =>
        input.rawEvidence.get(path) ??
        fail(`raw evidence attachment missing for ${kind}: ${path}`),
    );
    const descriptor: Phase32ReportEvidence = validatePhase32ReportEvidence({
      schemaVersion: PHASE32_REPORT_EVIDENCE_VERSION,
      reportKind: kind,
      commitSha: input.commitSha,
      artifactSha256: input.artifactSha256,
      primaryLog: {
        path: primaryLogPath,
        sha256: primaryLog.sha256,
      },
      attachments,
    });
    const descriptorPath = join(
      reportEvidenceDirectory,
      `${kind.toLowerCase().replaceAll("_", "-")}.json`,
    );
    await writeJson(descriptorPath, descriptor);
    const reportDigest = await digestPhase32File(descriptorPath);
    const counts =
      kind === "BROWSER"
        ? browserCounts
        : {
            failedCount: 0,
            skippedCount:
              kind === "UNIT" || kind === "INTEGRATION"
                ? await summarizedSkippedCount(step.logPath)
                : 0,
            retryCount: 0,
          };
    reports.push({
      id: `phase32.${kind.toLowerCase().replaceAll("_", "-")}`,
      kind,
      status: "PASSED" as const,
      reportSha256: reportDigest.sha256,
      commitSha: input.commitSha,
      artifactSha256: input.artifactSha256,
      configurationSha256: input.configurationSha256,
      ...counts,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
    });
  }
  return reports;
}

async function persistRawEvidenceDirectories(
  input: Readonly<{
    allowedRoot: string;
    outputDirectory: string;
    sources: readonly Readonly<{ source: string; path: string }>[];
  }>,
): Promise<ReadonlyMap<string, RawEvidenceAttachment>> {
  const attachments = new Map<string, RawEvidenceAttachment>();
  for (const source of input.sources) {
    if (!existsSync(source.source)) {
      throw new Error(`required raw evidence is missing: ${source.path}`);
    }
    const target = resolve(input.outputDirectory, source.path);
    if (!isWithin(input.outputDirectory, target)) {
      throw new Error(`raw evidence target escaped output: ${source.path}`);
    }
    await rm(target, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true });
    await copyPhase32ContainedTree(source.source, target, input.allowedRoot);
    const digest = await digestPhase32Directory(target);
    attachments.set(
      source.path,
      Object.freeze({
        path: source.path,
        sha256: digest.sha256,
        fileCount: digest.fileCount,
        sizeBytes: digest.sizeBytes,
      }),
    );
  }
  return attachments;
}

async function persistRawEvidenceLogDirectory(
  input: Readonly<{
    logPath: string;
    outputDirectory: string;
    path: string;
  }>,
): Promise<RawEvidenceAttachment> {
  const target = resolve(input.outputDirectory, input.path);
  if (!isWithin(input.outputDirectory, target)) {
    throw new Error(`raw evidence log target escaped output: ${input.path}`);
  }
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await copyPhase32ContainedFile(
    input.logPath,
    resolve(target, "command.log"),
    input.outputDirectory,
  );
  const digest = await digestPhase32Directory(target);
  return Object.freeze({
    path: input.path,
    sha256: digest.sha256,
    fileCount: digest.fileCount,
    sizeBytes: digest.sizeBytes,
  });
}

function reportAttachmentPaths(kind: ReportKind): readonly string[] {
  if (kind === "SECRET_SCAN") {
    return Object.freeze(["raw-evidence/artifact-secret-scan-log"]);
  }
  if (kind === "BROWSER") {
    return Object.freeze([
      "raw-evidence/browser-regression-log",
      "raw-evidence/phase17-regression",
      "raw-evidence/phase32-lc1-browser",
      "raw-evidence/playwright-phase17-regression",
      "raw-evidence/playwright-phase32-lc1",
    ]);
  }
  if (kind === "MIGRATION" || kind === "SEED" || kind === "RECOVERY") {
    return Object.freeze(["raw-evidence/phase18"]);
  }
  return Object.freeze([]);
}

async function loadPhase32FindingsLedger(root: string) {
  const path = resolve(
    root,
    "codex-plan",
    "release",
    "phase32-lc1-findings-ledger.json",
  );
  return parsePhase32FindingsLedger(JSON.parse(await readFile(path, "utf8")));
}

async function digestFindingSourceEvidence(
  records: readonly Phase32FindingRecord[],
  root: string,
) {
  const fileDigests = new Map<string, string>();
  for (const path of [
    ...new Set(records.flatMap((record) => record.sourceEvidence)),
  ]) {
    const absolutePath = resolve(root, path);
    if (!isWithin(root, absolutePath) || !existsSync(absolutePath)) {
      throw new Error(`finding source evidence is missing or unsafe: ${path}`);
    }
    fileDigests.set(path, (await digestPhase32File(absolutePath)).sha256);
  }
  return new Map(
    records.map((record) => [
      record.id,
      [
        ...new Set(
          record.sourceEvidence.map(
            (path) =>
              fileDigests.get(path) ??
              fail(`source evidence digest missing for ${path}`),
          ),
        ),
      ],
    ]),
  );
}

function assertFindingReviewsCurrent(
  records: readonly Phase32FindingRecord[],
  decisionAt: string,
) {
  const decisionDate = decisionAt.slice(0, 10);
  for (const record of records) {
    const reviewAt =
      record.status === "EXTERNAL"
        ? record.externalGate.reviewAt
        : record.status === "DEFERRED_MONITORED"
          ? record.monitoring.reviewAt
          : undefined;
    if (reviewAt !== undefined && reviewAt <= decisionDate) {
      throw new Error(
        `${record.id} external or monitored review expired before the candidate decision`,
      );
    }
  }
}

async function loadExternalG4Bundle(
  input: Readonly<{
    artifactSha256: string;
    commitSha: string;
    decisionAt: string;
    deploymentId: string;
    preApprovalEvidenceBase: PreApprovalEvidenceBase;
  }>,
): Promise<ExternalG4Bundle | null> {
  const bundlePath = process.env.PHASE32_EXTERNAL_G4_BUNDLE_PATH;
  const expectedBundleSha256 =
    process.env.PHASE32_EXTERNAL_G4_BUNDLE_SHA256?.toLowerCase();
  const registryPath = process.env.PHASE32_APPROVAL_KEY_REGISTRY_PATH;
  const expectedRegistrySha256 =
    process.env.PHASE32_APPROVAL_KEY_REGISTRY_SHA256?.toLowerCase();
  if (!externalG4EvidenceConfigured()) {
    return null;
  }
  if (
    bundlePath === undefined ||
    expectedBundleSha256 === undefined ||
    registryPath === undefined ||
    expectedRegistrySha256 === undefined ||
    !/^[a-f0-9]{64}$/u.test(expectedBundleSha256) ||
    !/^[a-f0-9]{64}$/u.test(expectedRegistrySha256)
  ) {
    throw new Error(
      "external G4 approval evidence requires bundle and trusted key registry paths with exact SHA-256 values",
    );
  }
  const bundleSnapshot = await readBoundJsonFile(
    bundlePath,
    expectedBundleSha256,
    "external G4 bundle",
  );
  const registrySnapshot = await readBoundJsonFile(
    registryPath,
    expectedRegistrySha256,
    "trusted approval key registry",
  );
  const rootTrustAnchorPath = resolve(
    repository,
    "codex-plan",
    "release",
    "phase32-approval-root-trust-anchor.json",
  );
  const rawRootTrustAnchor = JSON.parse(
    await readFile(rootTrustAnchorPath, "utf8"),
  ) as unknown;
  let rootTrustAnchor;
  try {
    rootTrustAnchor = parsePhase32ApprovalRootTrustAnchor(rawRootTrustAnchor);
  } catch {
    throw new Error(
      "Phase 32 independent approval root trust anchor is not provisioned in the frozen candidate",
    );
  }
  const rootTrustAnchorSha256 =
    phase32ApprovalRootTrustAnchorSha256(rootTrustAnchor);
  const raw = bundleSnapshot.value;
  if (
    !isRecord(raw) ||
    !sameKeys(raw, [
      "schemaVersion",
      "requestedLaunchClass",
      "candidateCommitSha",
      "candidateArtifactSha256",
      "deploymentId",
      "walkthrough",
      "rollbackDrill",
      "approvalAttestations",
    ]) ||
    raw.schemaVersion !== "phase32-external-g4-bundle-v1" ||
    raw.requestedLaunchClass !== "LC1" ||
    raw.candidateCommitSha !== input.commitSha ||
    raw.candidateArtifactSha256 !== input.artifactSha256 ||
    raw.deploymentId !== input.deploymentId ||
    !isRecord(raw.walkthrough) ||
    !isRecord(raw.rollbackDrill) ||
    !Array.isArray(raw.approvalAttestations) ||
    typeof raw.walkthrough.evidenceSha256 !== "string" ||
    typeof raw.rollbackDrill.evidenceSha256 !== "string"
  ) {
    throw new Error("external G4 bundle envelope is invalid or stale");
  }
  const attestations = raw.approvalAttestations.map((attestation) =>
    parsePhase32ApprovalAttestation(attestation),
  );
  const preApprovalEvidence = createPhase32PreApprovalEvidenceRoot({
    schemaVersion: "phase32-pre-approval-evidence-v1",
    ...input.preApprovalEvidenceBase,
    launchScope: {
      policyVersion: PHASE32_POLICY_VERSION,
      ...lc1PolicyScope(),
    },
    walkthrough: raw.walkthrough,
    rollbackDrill: raw.rollbackDrill,
  });
  const verified = verifyPhase32Lc1ApprovalSet(
    attestations,
    registrySnapshot.value,
    rootTrustAnchor,
    process.env.PHASE32_APPROVAL_ROOT_PUBLIC_KEY_SHA256,
    {
      candidateCommitSha: input.commitSha,
      artifactSha256: input.artifactSha256,
      deploymentId: input.deploymentId,
      walkthroughEvidenceSha256: raw.walkthrough.evidenceSha256,
      rollbackEvidenceSha256: raw.rollbackDrill.evidenceSha256,
      preApprovalEvidenceSha256: preApprovalEvidence.sha256,
      decisionAt: input.decisionAt,
    },
  );
  const attestationsByKey = new Map(
    attestations.map((attestation) => [attestation.keyId, attestation]),
  );
  const approvals = verified.approvals.map((approval) => {
    const attestation =
      attestationsByKey.get(approval.keyId) ??
      fail(`verified attestation missing for key ${approval.keyId}`);
    return phase32G4ApprovalFromVerifiedAttestation(approval, {
      attestationSha256: sha256Json(attestation),
      preApprovalEvidenceSha256: verified.preApprovalEvidenceSha256,
      rootTrustAnchorSha256: verified.rootTrustAnchorSha256,
      trustedKeyRegistrySha256: registrySnapshot.sha256,
      candidateCommitSha: input.commitSha,
      artifactSha256: input.artifactSha256,
    });
  });
  return Object.freeze({
    walkthrough: raw.walkthrough as ExternalG4Bundle["walkthrough"],
    rollbackDrill: raw.rollbackDrill as ExternalG4Bundle["rollbackDrill"],
    approvals,
    evidenceSha256: bundleSnapshot.sha256,
    preApprovalEvidenceSha256: preApprovalEvidence.sha256,
    rootTrustAnchorSha256,
    trustedKeyRegistrySha256: registrySnapshot.sha256,
  });
}

function externalG4EvidenceConfigured() {
  const values = [
    process.env.PHASE32_EXTERNAL_G4_BUNDLE_PATH,
    process.env.PHASE32_EXTERNAL_G4_BUNDLE_SHA256,
    process.env.PHASE32_APPROVAL_KEY_REGISTRY_PATH,
    process.env.PHASE32_APPROVAL_KEY_REGISTRY_SHA256,
    process.env.PHASE32_APPROVAL_ROOT_PUBLIC_KEY_SHA256,
  ];
  const configuredCount = values.filter((value) => value !== undefined).length;
  if (configuredCount !== 0 && configuredCount !== values.length) {
    throw new Error(
      "external G4 approval evidence requires all bundle, registry and independently protected root-public-key fingerprint variables",
    );
  }
  return configuredCount === values.length;
}

async function readBoundJsonFile(
  configuredPath: string,
  expectedSha256: string,
  label: string,
) {
  const path = resolve(configuredPath);
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha256) {
    throw new Error(`${label} digest mismatch`);
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return Object.freeze({ path, sha256, value });
}

function sha256Json(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function sameKeys(value: object, expected: readonly string[]) {
  const observed = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    observed.length === sortedExpected.length &&
    observed.every((key, index) => key === sortedExpected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lc1GateRecords(
  input: Readonly<{
    approvalsComplete: boolean;
    findingsComplete: boolean;
    rollbackComplete: boolean;
  }>,
): ReadonlyArray<{
  gateId: Phase32GateId;
  outcome: Phase32GateOutcome;
}> {
  const values: Partial<Record<Phase32GateId, Phase32GateOutcome>> = {
    GOVERNANCE_BASELINE: "PASS",
    FINDINGS_LEDGER: input.findingsComplete ? "PASS" : "BLOCKED",
    AUTOMATED_REGRESSION: "PASS",
    ARTIFACT_IDENTITY: "PASS",
    ROLLBACK_PATH: input.rollbackComplete ? "PASS" : "BLOCKED",
    INDEPENDENT_APPROVALS: input.approvalsComplete ? "PASS" : "BLOCKED",
    DEMO_CLASSIFICATION: "PASS",
    LC1_ISOLATION: "PASS",
    PHASE26_COMPANY_TRUST: "DISABLED",
    PHASE27_MULTI_PERSONA: "DISABLED",
    PHASE28_EXTERNAL_TRACKER: "DISABLED",
    PHASE28_INTERVIEW_SCHEDULER: "DISABLED",
  };
  return PHASE32_GATE_IDS.flatMap((gateId) => {
    const outcome = values[gateId];
    return outcome === undefined ? [] : [{ gateId, outcome }];
  });
}

function lc1PolicyScope() {
  return Object.freeze({
    requestedClass: "LC1" as const,
    operatingMode: "LOCAL_DEMO" as const,
    dataMode: "SYNTHETIC_ONLY" as const,
    providerMode: "MOCK_OR_DISABLED" as const,
    moneyMode: "NO_MONEY" as const,
    accessMode: "LOCAL_ONLY" as const,
    acquisitionMode: "NONE" as const,
    publicIndexing: false,
    companyTrustSurfaces: false,
    multiPersonaPromised: false,
    externalTrackerPromised: false,
    interviewSchedulerPromised: false,
    scale30BTriggered: false,
    scale30CTriggered: false,
  });
}

function assertLc1ManifestScope(manifest: Phase32G4Manifest) {
  if (
    manifest.requestedLaunchClass !== "LC1" ||
    manifest.runtime.environment !== "local" ||
    manifest.deployment?.environment !== "local" ||
    manifest.approvals.some((approval) => approval.launchClass !== "LC1")
  ) {
    throw new Error(
      "this frozen ledger and verifier are restricted to LC1 local demo evidence",
    );
  }
}

async function assertStoredLc1PolicyDecision(
  validation: ReturnType<typeof validatePhase32G4Manifest>,
  outputDirectory: string,
) {
  const expected = evaluatePhase32LaunchClassPolicy({
    policyVersion: PHASE32_POLICY_VERSION,
    scope: lc1PolicyScope(),
    gates: lc1GateRecords({
      approvalsComplete: validation.missingApprovalScopes.length === 0,
      findingsComplete: validation.blockingFindingIds.length === 0,
      rollbackComplete: validation.technicalAuditStatus === "PASS",
    }),
  });
  const stored = JSON.parse(
    await readFile(join(outputDirectory, "launch-class-decision.json"), "utf8"),
  ) as unknown;
  if (JSON.stringify(stored) !== JSON.stringify(expected)) {
    throw new Error(
      "stored launch-class decision differs from the derived LC1 policy",
    );
  }
  const expectedDecision =
    validation.launchDecision === "APPROVED" ? "LC1" : "NO_GO";
  if (expected.decision !== expectedDecision) {
    throw new Error("G4 manifest and LC1 launch policy disagree");
  }
}

async function assertBrowserManifest(commitSha: string, root: string) {
  const manifest = JSON.parse(
    await readFile(
      resolve(root, "test-results", "phase17", "run-manifest.json"),
      "utf8",
    ),
  ) as {
    commit?: unknown;
    status?: unknown;
    retryPolicy?: unknown;
    counts?: {
      failed?: unknown;
      timedOut?: unknown;
      skipped?: unknown;
      interrupted?: unknown;
    };
    cases?: Array<{ results?: Array<{ retry?: unknown }> }>;
    quality?: Array<{ retry?: unknown }>;
    unclassified?: unknown[];
  };
  const counts = manifest.counts;
  const retries = [
    ...(manifest.cases ?? []).flatMap((entry) => entry.results ?? []),
    ...(manifest.quality ?? []),
  ].reduce(
    (sum, result) =>
      sum + (typeof result.retry === "number" ? result.retry : 0),
    0,
  );
  if (
    manifest.commit !== commitSha ||
    manifest.status !== "passed" ||
    manifest.retryPolicy !== 0 ||
    counts?.failed !== 0 ||
    counts.timedOut !== 0 ||
    counts.skipped !== 0 ||
    counts.interrupted !== 0 ||
    retries !== 0 ||
    !Array.isArray(manifest.unclassified) ||
    manifest.unclassified.length !== 0
  ) {
    throw new Error(
      "Phase 17 browser manifest is not an exact zero-retry pass",
    );
  }
}

async function readBrowserCounts(root: string) {
  const manifest = JSON.parse(
    await readFile(
      resolve(root, "test-results", "phase17", "run-manifest.json"),
      "utf8",
    ),
  ) as {
    counts: {
      failed: number;
      timedOut: number;
      skipped: number;
      interrupted: number;
    };
    cases?: Array<{ results?: Array<{ retry?: number }> }>;
    quality?: Array<{ retry?: number }>;
  };
  return {
    failedCount:
      manifest.counts.failed +
      manifest.counts.timedOut +
      manifest.counts.interrupted,
    skippedCount: manifest.counts.skipped,
    retryCount: [
      ...(manifest.cases ?? []).flatMap((entry) => entry.results ?? []),
      ...(manifest.quality ?? []),
    ].reduce((sum, result) => sum + (result.retry ?? 0), 0),
  };
}

async function assertRecoveryManifest(commitSha: string, root: string) {
  const manifest = JSON.parse(
    await readFile(
      resolve(root, "test-results", "phase18", "run-manifest.json"),
      "utf8",
    ),
  ) as {
    status?: unknown;
    release?: { commit?: unknown };
    cleanup?: Record<string, unknown>;
  };
  if (
    manifest.status !== "passed" ||
    manifest.release?.commit !== commitSha ||
    manifest.cleanup === undefined ||
    Object.values(manifest.cleanup).some((value) => value !== true)
  ) {
    throw new Error("Phase 18 recovery manifest is not an exact clean pass");
  }
}

async function generateSbom(
  input: Readonly<{
    npmCli: string;
    cwd: string;
    environment: NodeJS.ProcessEnv;
    outputPath: string;
    logPath: string;
  }>,
) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const child = spawn(
    process.execPath,
    [input.npmCli, "sbom", "--sbom-format", "cyclonedx"],
    {
      cwd: input.cwd,
      env: input.environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    },
  );
  let errorOutput = "";
  const chunks: Buffer[] = [];
  const recordStdout = (chunk: Buffer) => chunks.push(Buffer.from(chunk));
  child.stdout.on("data", recordStdout);
  child.stderr.setEncoding("utf8");
  const recordStderr = (chunk: string) => {
    errorOutput += chunk;
  };
  child.stderr.on("data", recordStderr);
  child.once("error", (error) => {
    errorOutput += `SBOM process error: ${redact(
      error instanceof Error ? error.message : "unknown process error",
    )}\n`;
  });
  const heartbeat = setInterval(() => {
    process.stdout.write(
      `Phase 32 step running: SBOM generation (${Math.round(
        (performance.now() - started) / 1_000,
      )} s).\n`,
    );
  }, 30_000);
  const processResult = await waitForPhase32ProcessExit(child, {
    timeoutMilliseconds: 10 * 60_000,
  }).finally(() => {
    clearInterval(heartbeat);
  });
  child.stdout.off("data", recordStdout);
  child.stderr.off("data", recordStderr);
  if (processResult.status === "TIMED_OUT_UNCONFIRMED") {
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
  const exitCode = processResult.timedOut ? 124 : (processResult.exitCode ?? 1);
  const completedAt = new Date().toISOString();
  await writeFile(input.logPath, redact(errorOutput), "utf8");
  if (exitCode !== 0) {
    throw new Error(`SBOM generation failed with exit ${exitCode}`);
  }
  const output = Buffer.concat(chunks);
  JSON.parse(output.toString("utf8"));
  await writeFile(input.outputPath, output);
  process.stdout.write(
    `Phase 32 step passed: SBOM generation (${startedAt}..${completedAt}).\n`,
  );
}

async function assembleCandidateArtifact(
  sourceRoot: string,
  artifactRoot: string,
) {
  const nextRoot = resolve(sourceRoot, ".next");
  const standaloneRoot = resolve(nextRoot, "standalone");
  const standaloneEntrypoint = resolve(standaloneRoot, "server.js");
  const staticRoot = resolve(nextRoot, "static");
  if (
    !existsSync(standaloneEntrypoint) ||
    !existsSync(staticRoot) ||
    !existsSync(resolve(sourceRoot, "public"))
  ) {
    throw new Error(
      "phase32 standalone build is incomplete: server.js, static or public is missing",
    );
  }
  await rm(artifactRoot, { recursive: true, force: true });
  await copyPhase32ContainedTree(standaloneRoot, artifactRoot, sourceRoot);
  await mkdir(resolve(artifactRoot, ".next"), { recursive: true });
  await copyPhase32ContainedTree(
    staticRoot,
    resolve(artifactRoot, ".next", "static"),
    sourceRoot,
  );
  await copyPhase32ContainedTree(
    resolve(sourceRoot, "public"),
    resolve(artifactRoot, "public"),
    sourceRoot,
  );
  const harnessRoot = resolve(artifactRoot, ".phase32");
  await mkdir(harnessRoot, { recursive: true });
  await copyPhase32ContainedFile(
    resolve(sourceRoot, "scripts", "e2e", "runtime-guard.cjs"),
    resolve(harnessRoot, "runtime-guard.cjs"),
    sourceRoot,
  );
}

async function runCompositeNpmStep(
  input: Readonly<{
    id: string;
    label: string;
    npmCli: string;
    cwd: string;
    environment: NodeJS.ProcessEnv;
    logPath: string;
    commands: readonly (readonly string[])[];
    timeoutMilliseconds: number;
  }>,
) {
  const startedAt = new Date().toISOString();
  await writeFile(input.logPath, "", "utf8");
  let durationMilliseconds = 0;
  for (const [index, args] of input.commands.entries()) {
    const result = await runCommand({
      id: `${input.id}-${index + 1}`,
      label: `${input.label} (${index + 1}/${input.commands.length})`,
      executable: process.execPath,
      args: [input.npmCli, ...args],
      cwd: input.cwd,
      environment: input.environment,
      logPath: `${input.logPath}.part-${index + 1}`,
      timeoutMilliseconds: input.timeoutMilliseconds,
    });
    durationMilliseconds += result.durationMilliseconds;
    const part = await readFile(result.logPath, "utf8");
    await writeFile(
      input.logPath,
      `${await readFile(input.logPath, "utf8")}${part}`,
      "utf8",
    );
    await rm(result.logPath, { force: true });
    if (result.exitCode !== 0) {
      throw new Error(
        `${input.label} failed at command ${index + 1} with exit ${result.exitCode}`,
      );
    }
  }
  return Object.freeze({
    id: input.id,
    command: input.commands.map((args) => `npm ${args.join(" ")}`).join(" && "),
    logPath: input.logPath,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMilliseconds,
    exitCode: 0,
  });
}

async function requireSuccessfulCommand(input: CommandInput) {
  const result = await runCommand(input);
  if (result.exitCode !== 0) {
    throw new Error(
      `${input.label} failed with exit ${result.exitCode}; inspect ${input.logPath}`,
    );
  }
  return result;
}

async function runCommand(input: CommandInput): Promise<CommandResult> {
  await mkdir(dirname(input.logPath), { recursive: true });
  const log = createWriteStream(input.logPath, {
    encoding: "utf8",
    flags: "w",
  });
  const startedAt = new Date().toISOString();
  const started = performance.now();
  process.stdout.write(`Phase 32 step started: ${input.label}.\n`);
  const child = spawn(input.executable, [...input.args], {
    cwd: input.cwd,
    env: input.environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let tail = "";
  const record = (chunk: Buffer | string) => {
    const safe = redact(chunk.toString());
    tail = `${tail}${safe}`.slice(-8_000);
    log.write(safe);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);

  const heartbeat = setInterval(() => {
    process.stdout.write(
      `Phase 32 step running: ${input.label} (${Math.round(
        (performance.now() - started) / 1_000,
      )} s).\n`,
    );
  }, 30_000);
  child.once("error", (error) => {
    record(
      `Process error: ${
        error instanceof Error ? error.message : "unknown process error"
      }\n`,
    );
  });
  const processResult = await waitForPhase32ProcessExit(child, {
    timeoutMilliseconds: input.timeoutMilliseconds,
  }).finally(() => {
    clearInterval(heartbeat);
  });
  child.stdout.off("data", record);
  child.stderr.off("data", record);
  if (processResult.status === "TIMED_OUT_UNCONFIRMED") {
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
  await new Promise<void>((resolveEnd, reject) => {
    log.once("error", reject);
    log.end(resolveEnd);
  });
  const result = Object.freeze({
    id: input.id,
    command: [input.executable, ...input.args].join(" "),
    logPath: input.logPath,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMilliseconds: Math.round(performance.now() - started),
    exitCode: processResult.timedOut ? 124 : (processResult.exitCode ?? 1),
  });
  process.stdout.write(
    `Phase 32 step ${result.exitCode === 0 ? "passed" : "failed"}: ${input.label} (${Math.round(
      result.durationMilliseconds / 1_000,
    )} s).\n`,
  );
  if (result.exitCode !== 0 && tail !== "") {
    process.stderr.write(`${tail}\n`);
  }
  return result;
}

async function gitOutput(args: readonly string[], cwd: string) {
  const child = spawn("git", [...args], {
    cwd,
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${redact(stderr.trim())}`);
  }
  return stdout.trim();
}

async function assertCleanCandidate(root: string) {
  const status = await gitOutput(
    ["status", "--porcelain", "--untracked-files=all"],
    root,
  );
  if (status !== "") {
    throw new Error(`candidate worktree is not clean:\n${status}`);
  }
}

function lc1Environment(
  commitSha: string,
  ledger: ReturnType<typeof parsePhase32FindingsLedger>,
): NodeJS.ProcessEnv {
  const environment = applyPhase32DisabledServerGates(ledger, {
    ...phase32InheritedReleaseEnvironment(),
    APP_ENV: "local",
    NODE_ENV: "test",
    APP_BUILD_ID: commitSha,
    PHASE32_STANDALONE_BUILD: "true",
    APP_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_APP_NAME: "SwissTalentHub",
    GITHUB_SHA: commitSha,
    CI: "true",
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    DEV_MAILBOX_SECRET: "",
    IDENTITY_VERIFICATION_ENFORCEMENT: "false",
    LOGIN_EMAIL_CHANGE: "false",
    ADMIN_MFA_REQUIRED: "false",
    PRIVILEGED_STEP_UP_MODE: "disabled",
    TRUST_RISK_MODE: "observe",
    EMAIL_PROVIDER_MODE: "disabled",
    EMAIL_PROVIDER_API_KEY: "",
    NOTIFICATION_DISPATCH: "paused",
    OPTIONAL_EMAIL: "false",
    DELIVERY_REPLAY: "false",
    WORKER_RUNTIME: "paused",
    WORKER_SANDBOX_REPLAY: "false",
    PAYMENT_PROVIDER_MODE: "disabled",
    PAYMENT_SANDBOX_COHORT: "none",
    REAL_PAYMENT_INGESTION: "false",
    REAL_PAYMENT_PROJECTION: "false",
    PAID_SELF_SERVICE: "false",
    FINANCE_REPAIR_ACTIONS: "false",
    PAID_SERVICE_RECOVERY: "false",
    COMMERCIAL_PRODUCTION_OFFERS: "false",
    COMMERCIAL_MANAGED_IMPORT: "false",
    COMMERCIAL_BOOST: "false",
    COMMERCIAL_PAID_RADAR: "false",
    COMMERCIAL_SALARY: "false",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_ACCOUNT_ID: "",
    STRIPE_SECRET_VERSION: "",
    DOCUMENT_VAULT_WRITES: "false",
    DOCUMENT_STORAGE_MODE: "disabled",
    DOCUMENT_SCANNER_MODE: "disabled",
    DOCUMENT_CLEAN_READS: "false",
    DOCUMENT_RECONCILIATION: "disabled",
    DOCUMENT_BULK_ACCESS: "false",
    DOCUMENT_VAULT_COHORT: "none",
    DOCUMENT_STORAGE_KEYS: "",
    PRIVACY_EXPORT_V2: "false",
    PRIVACY_CORRECTION_EXECUTION: "false",
    PRIVACY_ERASURE_EXECUTION: "false",
    PRIVACY_PROCESSING_MODE: "disabled",
    PRIVACY_PROCESSING_COHORT: "none",
    PRIVACY_EXPORT_STORAGE_MODE: "disabled",
    PRIVACY_EXPORT_KEYS: "",
    IDENTITY_PERSONA_V2: "disabled",
    EXISTING_IDENTITY_INVITATION: "false",
    PERSONA_PORTAL_SWITCH: "false",
    PERSONA_PRIVACY_V2: "false",
    PERSONA_LEGACY_CONTRACT: "false",
    EXTERNAL_APPLICATION_TRACKER: "disabled",
    INTERVIEW_SCHEDULER: "disabled",
    COMPANY_TRUST_V2: "disabled",
    COMPANY_DOMAIN_CHALLENGE: "false",
    COMPANY_REGISTER_CHECK: "false",
    COMPANY_VERIFICATION_DOCUMENT: "false",
    COMPANY_STRONG_BADGE: "false",
    COMPANY_TRUST_PUBLIC_ELIGIBILITY: "false",
    COMPANY_TRUST_RAPID_REVOKE: "false",
    LEGACY_COMPANY_REVERIFY: "false",
    COMPANY_REGISTER_PROVIDER_MODE: "disabled",
    COMPANY_DOMAIN_PROVIDER_MODE: "disabled",
    COMPANY_VERIFICATION_COHORT: "none",
    STORAGE_ENDPOINT: "",
    OPENAI_API_KEY: "",
    JOBROOM_API_URL: "",
    MAPS_API_KEY: "",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  assertPhase32DisabledServerGates(ledger, environment);
  return environment;
}

function buildLc1RuntimeConfiguration(
  commitSha: string,
  ledger: ReturnType<typeof parsePhase32FindingsLedger>,
  environment: Readonly<NodeJS.ProcessEnv>,
) {
  assertPhase32DisabledServerGates(ledger, environment);
  assertSafeLc1DatabaseEnvironment(environment);
  const application = inspectPostgresTarget(
    environment.DATABASE_URL ?? fail("DATABASE_URL is missing"),
  );
  const test = inspectPostgresTarget(
    environment.TEST_DATABASE_URL ?? fail("TEST_DATABASE_URL is missing"),
  );
  if (application === undefined || test === undefined) {
    throw new Error("Phase 32 database target parsing failed");
  }
  const disabledGateKeys = ledger.records.flatMap((record) =>
    record.status === "DISABLED"
      ? record.disablement.serverGates.map(({ key }) => key)
      : [],
  );
  const keys = [
    ...new Set([...PHASE32_LC1_CONFIGURATION_KEYS, ...disabledGateKeys]),
  ].sort();
  const flags = Object.fromEntries(
    keys.map((key) => {
      const value = environment[key];
      if (value === undefined) {
        throw new Error(`Phase 32 LC1 configuration key is missing: ${key}`);
      }
      return [key, value] as const;
    }),
  );
  return Object.freeze({
    schemaVersion: "phase32-lc1-runtime-configuration-v1",
    candidateCommitSha: commitSha,
    requestedLaunchClass: "LC1",
    launchScope: lc1PolicyScope(),
    deploymentRuntime: {
      appEnvironment: "local",
      nodeEnvironment: "production",
      buildIdentifier: commitSha,
      standaloneEntrypoint: "server.js",
    },
    databasePreflight: {
      application: {
        hostname: application.hostname,
        databaseName: application.databaseName,
        schemaName: application.schemaName,
      },
      test: {
        hostname: test.hostname,
        databaseName: test.databaseName,
        schemaName: test.schemaName,
      },
    },
    flags,
  });
}

function ciEnvironmentInitializationEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const sourceUrl =
    environment.TEST_DATABASE_URL ??
    fail("TEST_DATABASE_URL is missing for CI environment validation");
  const sourceTarget = inspectPostgresTarget(sourceUrl);
  if (sourceTarget === undefined) {
    throw new Error(
      "TEST_DATABASE_URL is invalid for CI environment validation",
    );
  }
  const applicationUrl = new URL(sourceUrl);
  const testUrl = new URL(sourceUrl);
  applicationUrl.pathname = `/${sourceTarget.databaseName}_phase32_ci_app`;
  testUrl.pathname = `/${sourceTarget.databaseName}_phase32_ci_test`;
  return {
    ...environment,
    APP_ENV: "ci",
    NODE_ENV: "test",
    CI: "true",
    DATABASE_URL: applicationUrl.toString(),
    TEST_DATABASE_URL: testUrl.toString(),
  };
}

function assertSafeLc1DatabaseEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
) {
  const applicationUrl = environment.DATABASE_URL;
  const testUrl = environment.TEST_DATABASE_URL;
  const application =
    applicationUrl === undefined
      ? undefined
      : inspectPostgresTarget(applicationUrl);
  const test =
    testUrl === undefined ? undefined : inspectPostgresTarget(testUrl);
  if (
    application === undefined ||
    test === undefined ||
    application.hostname !== "loopback" ||
    test.hostname !== "loopback" ||
    application.databaseName !== "swisstalenthub" ||
    application.schemaName !== "public" ||
    test.databaseName !== "swisstalenthub_test" ||
    test.schemaName !== "public" ||
    application.identity === test.identity
  ) {
    throw new Error(
      "Phase 32 LC1 requires distinct loopback swisstalenthub and swisstalenthub_test PostgreSQL targets before any database-backed step",
    );
  }
}

function commandSpecification(
  id: string,
  label: string,
  args: readonly string[],
  timeoutMilliseconds: number,
) {
  return Object.freeze({ id, label, args, timeoutMilliseconds });
}

function parseArguments(values: readonly string[]): ParsedArguments {
  let finalizeOnly = false;
  let internal = false;
  let verifyOnly = false;
  let requestedClass: RequestedLaunchClass = "LC1";
  let manifestPath: string | undefined;
  let outputDirectory: string | undefined;
  let expectedCommit: string | undefined;
  for (const value of values) {
    if (value === "--internal") {
      internal = true;
      continue;
    }
    if (value === "--finalize-only") {
      finalizeOnly = true;
      continue;
    }
    if (value === "--verify-only") {
      verifyOnly = true;
      continue;
    }
    const classMatch = /^--requested-class=(LC[1-6])$/u.exec(value);
    if (classMatch !== null) {
      if (classMatch[1] !== "LC1") {
        throw new Error(
          "this candidate contains only the frozen LC1 ledger; LC2-LC6 remain disabled",
        );
      }
      requestedClass = "LC1";
      continue;
    }
    const outputMatch = /^--output-dir=(.+)$/u.exec(value);
    if (outputMatch !== null) {
      outputDirectory = resolve(outputMatch[1]!);
      continue;
    }
    const manifestMatch = /^--manifest=(.+)$/u.exec(value);
    if (manifestMatch !== null) {
      manifestPath = resolve(manifestMatch[1]!);
      continue;
    }
    const commitMatch = /^--expected-commit=([a-f0-9]{40}|[a-f0-9]{64})$/u.exec(
      value,
    );
    if (commitMatch !== null) {
      expectedCommit = commitMatch[1];
      continue;
    }
    throw new Error(`unsupported Phase 32 argument: ${value}`);
  }
  if ([internal, verifyOnly, finalizeOnly].filter(Boolean).length > 1) {
    throw new Error(
      "--internal, --verify-only and --finalize-only are mutually exclusive",
    );
  }
  if (manifestPath !== undefined && !verifyOnly && !finalizeOnly) {
    throw new Error(
      "--manifest is valid only with --verify-only or --finalize-only",
    );
  }
  return Object.freeze({
    finalizeOnly,
    internal,
    verifyOnly,
    requestedClass,
    ...(manifestPath === undefined ? {} : { manifestPath }),
    ...(outputDirectory === undefined ? {} : { outputDirectory }),
    ...(expectedCommit === undefined ? {} : { expectedCommit }),
  });
}

function phase32OutputDirectory(root: string) {
  return resolve(root, "test-results", "phase32");
}

async function resetOutputDirectory(path: string) {
  const expected = phase32OutputDirectory(repository);
  if (resolve(path) !== expected || !isWithin(repository, path)) {
    throw new Error("refusing to reset an unexpected evidence directory");
  }
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

function isWithin(root: string, candidate: string) {
  const path = relative(resolve(root), resolve(candidate));
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function requireNpmCli() {
  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined || !existsSync(npmCli)) {
    throw new Error("Phase 32 must be launched through the pinned npm CLI");
  }
  return npmCli;
}

function assertGitObjectId(value: string, label: string) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) {
    throw new Error(`${label} is not a full Git object id`);
  }
}

function parseCommandResult(value: unknown): CommandResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("command" in value) ||
    typeof value.command !== "string" ||
    !("logPath" in value) ||
    typeof value.logPath !== "string" ||
    !("startedAt" in value) ||
    typeof value.startedAt !== "string" ||
    !("completedAt" in value) ||
    typeof value.completedAt !== "string" ||
    !("durationMilliseconds" in value) ||
    typeof value.durationMilliseconds !== "number" ||
    !("exitCode" in value) ||
    value.exitCode !== 0
  ) {
    throw new Error("dependency-step.json is invalid");
  }
  return Object.freeze({
    id: value.id,
    command: value.command,
    logPath: value.logPath,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    durationMilliseconds: value.durationMilliseconds,
    exitCode: value.exitCode,
  });
}

async function summarizedSkippedCount(path: string) {
  const output = stripAnsi(await readFile(path, "utf8"));
  const summary = output
    .split(/\r?\n/u)
    .filter((line) => /^\s*Tests\s+/u.test(line));
  return summary.reduce((count, line) => {
    const match = /(?:^|\s)(\d+)\s+skipped(?:\s|$)/u.exec(line);
    return count + (match === null ? 0 : Number(match[1]));
  }, 0);
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stripAnsi(value: string) {
  return value.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
}

function redact(value: string) {
  return value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(
      /((?:secret|token|password|authorization|cookie|api[_-]?key)[\w.-]*\s*[:=]\s*)[^\s,;]+/giu,
      "$1[REDACTED]",
    );
}

function fail(message: string): never {
  throw new Error(message);
}
