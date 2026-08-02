import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  PHASE33_APPLICATION_ARTIFACT_KIND,
  assemblePhase33ApplicationArtifact,
  assertPhase33ArtifactUnchanged,
  digestPhase33ApplicationArtifact,
  phase33StandaloneBuildEnvironment,
} from "@/lib/release/phase33-artifact";
import { parsePhase33RenderedComposeEvidence } from "@/lib/release/phase33-compose-evidence";
import {
  PHASE33_GENERATED_EVIDENCE_BASENAMES,
  invalidatePhase33EvidenceOutput,
  resolvePhase33EvidencePath,
  writePhase33EvidenceAtomic,
} from "@/lib/release/phase33-release-files";
import { parsePhase33RecoveryEvidence } from "@/lib/release/phase33-recovery-evidence";
import {
  parsePhase33ComposeImageBinding,
  parsePhase33OciImageIdentity,
} from "@/lib/release/phase33-oci-identity";
import {
  PHASE33_CLEAN_TREE_GIT_ARGUMENTS,
  phase33NpmArguments,
  resolvePhase33NpmRuntime,
  type Phase33NpmRuntime,
} from "@/lib/release/phase33-process-invocation";
import {
  PHASE33_COMMAND_LOG_MAX_BYTES,
  PHASE33_TEST_COMMAND_IDS,
  phase33TestReportSchema,
  type Phase33TestReport,
} from "@/lib/release/phase33-test-report-contract";
import { assertPhase33TestCommandOutput } from "@/lib/release/phase33-test-output-policy";
import {
  PHASE33_RELEASE_POLICY_VERSION,
  PHASE33_TECHNICAL_GATE_IDS,
} from "@/lib/release/phase33-release-verdict";
import { findSensitiveEvidenceFinding } from "@/lib/security/sensitive-data-registry";
import {
  safeToolEnvironment,
  terminateRecoveryChild,
  type RecoveryChild,
} from "@/scripts/ops/process-tools";

type CommandId = (typeof PHASE33_TEST_COMMAND_IDS)[number];
type CommandReceipt = Phase33TestReport["commands"][number];

const repository = process.cwd();
const postgresImage =
  "postgres:16.13-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50";
const gateTimeoutMilliseconds = 45 * 60_000;

async function run(command: ReturnType<typeof parseArguments>) {
  for (const basename of PHASE33_GENERATED_EVIDENCE_BASENAMES) {
    await invalidatePhase33EvidenceOutput(
      repository,
      resolve(repository, "test-results", "phase33", basename),
    );
  }
  const npmRuntime = resolvePhase33NpmRuntime();
  const npmExecutable = npmRuntime.executable;
  assertCandidateTreeClean(repository);
  const candidateCommitSha = await capture(
    "git",
    ["rev-parse", "HEAD"],
    repository,
    safeToolEnvironment(),
  );
  assertCommit(candidateCommitSha);

  const runtimeToken = randomBytes(4).toString("hex");
  const localProject = `swisstalenthub-phase33-run-${process.pid}-${runtimeToken}-local`;
  const contractProject = `swisstalenthub-phase33-run-${process.pid}-${runtimeToken}-contract`;
  const localPort = await allocateLoopbackPort();
  let contractPort = await allocateLoopbackPort();
  while (contractPort === localPort)
    contractPort = await allocateLoopbackPort();
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "swisstalenthub-phase33-gate-"),
  );
  const clone = join(temporaryRoot, "candidate");
  const logDirectory = resolve(dirname(command.outputPath), "logs");
  const databaseContainer = `swisstalenthub-phase33-gate-${process.pid}-${randomBytes(4).toString("hex")}`;
  let databaseStarted = false;
  let temporaryRootPresent = true;

  try {
    await rm(logDirectory, { recursive: true, force: true });
    await mkdir(logDirectory, { recursive: true });
    await requireProcess(
      "git",
      ["clone", "--no-local", "--no-checkout", repository, clone],
      repository,
      safeToolEnvironment(),
      gateTimeoutMilliseconds,
    );
    await requireProcess(
      "git",
      ["checkout", "--detach", candidateCommitSha],
      clone,
      safeToolEnvironment(),
      5 * 60_000,
    );
    const cloneCommit = await capture(
      "git",
      ["rev-parse", "HEAD"],
      clone,
      safeToolEnvironment(),
    );
    if (cloneCommit !== candidateCommitSha) {
      throw new Error("CLEAN_CLONE_CANDIDATE_MISMATCH");
    }

    databaseStarted = true;
    await startEphemeralPostgres(databaseContainer);
    const port = await postgresPort(databaseContainer);
    const environment = gateEnvironment(candidateCommitSha, port);
    const localRuntimeEnvironment = {
      ...environment,
      PHASE33_LOCAL_PORT: String(localPort),
    } satisfies NodeJS.ProcessEnv;
    const contractRuntimeEnvironment = {
      ...environment,
      PHASE33_TLS_PORT: String(contractPort),
    } satisfies NodeJS.ProcessEnv;
    await requireProcess(
      "docker",
      [
        "exec",
        databaseContainer,
        "createdb",
        "-U",
        "phase33",
        "swisstalenthub_app",
      ],
      clone,
      environment,
      60_000,
    );
    await requireProcess(
      "docker",
      [
        "exec",
        databaseContainer,
        "createdb",
        "-U",
        "phase33",
        "swisstalenthub",
      ],
      clone,
      environment,
      60_000,
    );

    const receipts: CommandReceipt[] = [];
    const runCommand = async (
      id: CommandId,
      executable: string,
      args: readonly string[],
      options: Readonly<{ environment?: Partial<NodeJS.ProcessEnv> }> = {},
    ) => {
      const receipt = await runRecordedCommand({
        id,
        executable,
        args,
        cwd: clone,
        environment: {
          ...environment,
          ...options.environment,
        },
        logPath: join(logDirectory, `${id}.log`),
      });
      receipts.push(receipt);
      return receipt;
    };
    const runNpm = (
      id: CommandId,
      args: readonly string[],
      options: Readonly<{ environment?: Partial<NodeJS.ProcessEnv> }> = {},
    ) =>
      runCommand(
        id,
        npmExecutable,
        phase33NpmArguments(npmRuntime, args),
        options,
      );

    await runNpm("dependency-install", ["ci"]);
    await runNpm("environment", ["run", "env:validate"]);
    await runNpm("db-generate", ["run", "db:generate"]);
    await runNpm("db-validate", ["run", "db:validate"]);
    await runNpm("db-migrate", ["run", "db:migrate"]);
    await runNpm("db-migrate-status", ["run", "db:migrate:status"]);
    await runNpm("db-seed-first", ["run", "db:seed"]);
    await runNpm("db-seed-second", ["run", "db:seed"]);
    await runNpm("seed-verify", ["run", "seed:verify"]);
    await runNpm("db-smoke", ["run", "db:smoke"]);
    await runNpm("phase33-scale", ["run", "phase33:scale"]);
    await runNpm("phase33-audit", ["run", "phase33:audit"]);
    await runNpm("plan-audit", ["run", "plan:audit"]);
    await runNpm("route-audit", ["run", "route:audit"]);
    await runNpm("license-audit", ["run", "license:audit"]);
    await runNpm("lint", ["run", "lint"]);
    await runNpm("typecheck", ["run", "typecheck"]);
    await runNpm("unit", ["test"]);
    await runNpm("integration", ["run", "test:integration"]);
    assertCandidateTreeClean(clone);
    await runNpm("build", ["run", "build"], {
      environment: phase33StandaloneBuildEnvironment(environment),
    });
    const standaloneArtifactRoot = join(
      temporaryRoot,
      "standalone-application-artifact",
    );
    await assemblePhase33ApplicationArtifact(clone, standaloneArtifactRoot);
    const standaloneArtifactBefore = await digestPhase33ApplicationArtifact(
      standaloneArtifactRoot,
    );
    await runNpm("security-release-scan", ["run", "security:release-scan"], {
      environment: {
        PHASE32_ARTIFACT_SCAN_ROOT: standaloneArtifactRoot,
      },
    });
    const artifactRuntimeEnvironment = {
      APP_ARTIFACT_ROOT: standaloneArtifactRoot,
    } satisfies Partial<NodeJS.ProcessEnv>;
    await runNpm("http", ["run", "test:e2e:http"], {
      environment: artifactRuntimeEnvironment,
    });
    await runNpm("hsts", ["run", "test:e2e:hsts"], {
      environment: artifactRuntimeEnvironment,
    });
    await runNpm("phase33-e2e", ["run", "phase33:e2e"], {
      environment: artifactRuntimeEnvironment,
    });
    await runNpm("browser", ["run", "test:e2e:browser"], {
      environment: artifactRuntimeEnvironment,
    });
    assertPhase33ArtifactUnchanged(
      standaloneArtifactBefore,
      await digestPhase33ApplicationArtifact(standaloneArtifactRoot),
    );
    await runNpm("worker-chaos", ["run", "worker:chaos"]);
    await runNpm("worker-benchmark", ["run", "worker:benchmark"]);
    await runNpm("providers", ["run", "phase33:providers"]);
    await runNpm("documents-smoke", ["run", "documents:smoke"]);
    const recoveryReceipt = await runNpm(
      "recovery",
      ["run", "test:release:recovery"],
      {
        environment: {
          DATABASE_URL: databaseUrlWithName(
            environment.DATABASE_URL,
            "swisstalenthub",
          ),
          OPS_POSTGRES_DOCKER_CONTAINER: databaseContainer,
          OPS_POSTGRES_TOOL_MODE: "docker-container",
        },
      },
    );
    const retainedRecovery = parsePhase33RecoveryEvidence(
      await readFile(
        resolve(clone, "test-results/phase18/run-manifest.json"),
        "utf8",
      ),
      candidateCommitSha,
      recoveryReceipt,
    );
    assertCandidateTreeClean(clone);

    await cleanupProfile(
      clone,
      localRuntimeEnvironment,
      "local-mock",
      localProject,
      true,
      npmRuntime,
    );
    const localRuntimeConfiguration = await captureRenderedComposeConfiguration(
      clone,
      localRuntimeEnvironment,
      "local-mock",
      localProject,
    );
    await runNpm(
      "compose-local-config",
      [
        "run",
        "phase33:runtime:config:local",
        "--",
        `--project-name=${localProject}`,
      ],
      { environment: localRuntimeEnvironment },
    );
    await runNpm(
      "compose-local-up",
      [
        "run",
        "phase33:runtime:up:local",
        "--",
        `--project-name=${localProject}`,
      ],
      { environment: localRuntimeEnvironment },
    );
    await runNpm(
      "compose-local-repeat",
      [
        "run",
        "phase33:runtime:up:local",
        "--",
        `--project-name=${localProject}`,
        "--no-build",
      ],
      { environment: localRuntimeEnvironment },
    );
    await cleanupProfile(
      clone,
      localRuntimeEnvironment,
      "local-mock",
      localProject,
      true,
      npmRuntime,
    );

    await cleanupProfile(
      clone,
      contractRuntimeEnvironment,
      "production-contract",
      contractProject,
      true,
      npmRuntime,
    );
    const contractRuntimeConfiguration =
      await captureRenderedComposeConfiguration(
        clone,
        contractRuntimeEnvironment,
        "production-contract",
        contractProject,
      );
    await runNpm(
      "compose-contract-config",
      [
        "run",
        "phase33:runtime:config:contract",
        "--",
        `--project-name=${contractProject}`,
      ],
      { environment: contractRuntimeEnvironment },
    );
    await runNpm(
      "compose-contract-smoke",
      [
        "run",
        "phase33:runtime:smoke:contract",
        "--",
        `--project-name=${contractProject}`,
      ],
      { environment: contractRuntimeEnvironment },
    );
    await runCommand(
      "providers-smoke",
      "docker",
      [
        "compose",
        "--file",
        resolve(clone, "compose.phase33.yml"),
        "--project-name",
        contractProject,
        "--profile",
        "production-contract",
        "run",
        "--rm",
        "--no-deps",
        "provider-smoke-contract",
      ],
      { environment: contractRuntimeEnvironment },
    );
    await runNpm(
      "compose-contract-repeat",
      [
        "run",
        "phase33:runtime:smoke:contract",
        "--",
        `--project-name=${contractProject}`,
        "--no-build",
      ],
      { environment: contractRuntimeEnvironment },
    );
    const ociImage = await inspectPhase33OciImage(
      contractProject,
      candidateCommitSha,
      clone,
      contractRuntimeEnvironment,
    );
    await cleanupProfile(
      clone,
      contractRuntimeEnvironment,
      "production-contract",
      contractProject,
      true,
      npmRuntime,
    );
    await runNpm("dependency-security", [
      "audit",
      "--omit=dev",
      "--audit-level=high",
    ]);
    assertCandidateTreeClean(clone);

    const tools = {
      node: process.version,
      npm: await capture(
        npmExecutable,
        phase33NpmArguments(npmRuntime, ["--version"]),
        clone,
        environment,
      ),
      docker: await capture(
        "docker",
        ["version", "--format", "{{.Server.Version}}"],
        clone,
        environment,
      ),
      compose: await capture(
        "docker",
        ["compose", "version", "--short"],
        clone,
        environment,
      ),
      postgresql: await capture(
        "docker",
        ["exec", databaseContainer, "postgres", "--version"],
        clone,
        environment,
      ),
      playwright: await capture(
        npmExecutable,
        phase33NpmArguments(npmRuntime, [
          "exec",
          "--",
          "playwright",
          "--version",
        ]),
        clone,
        environment,
      ),
    } as const;
    const artifacts = Object.freeze({
      recovery: retainedRecovery.artifact,
      standalone: Object.freeze({
        kind: PHASE33_APPLICATION_ARTIFACT_KIND,
        digest: `sha256:${standaloneArtifactBefore.sha256}` as const,
        fileCount: standaloneArtifactBefore.fileCount,
        sizeBytes: standaloneArtifactBefore.sizeBytes,
      }),
      ociImage,
      runtimeConfiguration: Object.freeze({
        localMock: localRuntimeConfiguration,
        productionContract: contractRuntimeConfiguration,
      }),
    });
    const gates = PHASE33_TECHNICAL_GATE_IDS.map((gateId) => ({
      gateId,
      outcome: "PASS" as const,
      evidenceDigest: digestJson({
        artifacts,
        gateId,
        receipts: receiptsForGate(gateId, receipts),
      }),
    }));
    const report = phase33TestReportSchema.parse({
      schemaVersion: "phase33-test-report-v1",
      policyVersion: PHASE33_RELEASE_POLICY_VERSION,
      candidateCommitSha,
      coveredTechnicalTargets: ["LC4", "LC5"],
      isolatedCleanClone: true,
      generatedAt: new Date().toISOString(),
      tools,
      artifacts,
      summary: {
        candidateTreeChecks: 4,
        commands: receipts.length,
        failedCommands: 0,
        unexplainedSkips: 0,
      },
      commands: receipts,
      gates,
    });

    await removeEphemeralPostgres(databaseContainer, environment);
    databaseStarted = false;
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRootPresent = false;

    const recoveryOutputPath = resolve(
      repository,
      "test-results",
      "phase33",
      retainedRecovery.artifact.fileName,
    );
    try {
      await writePhase33EvidenceAtomic(
        repository,
        recoveryOutputPath,
        retainedRecovery.serialized,
      );
      await writePhase33EvidenceAtomic(
        repository,
        command.outputPath,
        `${JSON.stringify(report, null, 2)}\n`,
      );
    } catch (error) {
      await invalidatePhase33EvidenceOutput(
        repository,
        recoveryOutputPath,
      ).catch(() => undefined);
      await invalidatePhase33EvidenceOutput(
        repository,
        command.outputPath,
      ).catch(() => undefined);
      throw error;
    }
    process.stdout.write(
      `${JSON.stringify({
        command: "phase33-test-report",
        candidateCommitSha,
        output: command.outputPath,
        status: "PASS",
        commands: receipts.length,
      })}\n`,
    );
  } finally {
    await cleanupProfile(
      clone,
      { ...process.env, PHASE33_LOCAL_PORT: String(localPort) },
      "local-mock",
      localProject,
      false,
      npmRuntime,
    ).catch(() => undefined);
    await cleanupProfile(
      clone,
      { ...process.env, PHASE33_TLS_PORT: String(contractPort) },
      "production-contract",
      contractProject,
      false,
      npmRuntime,
    ).catch(() => undefined);
    if (databaseStarted) {
      await requireProcess(
        "docker",
        ["rm", "--force", databaseContainer],
        repository,
        safeToolEnvironment(),
        60_000,
      ).catch(() => undefined);
    }
    if (temporaryRootPresent) {
      await rm(temporaryRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

function parseArguments(values: readonly string[]) {
  let outputPath = resolve(repository, "test-results/phase33/test-report.json");
  for (const value of values) {
    const outputMatch = /^--output=(.+)$/u.exec(value);
    if (outputMatch !== null) {
      outputPath = resolvePhase33EvidencePath(
        repository,
        outputMatch[1] ?? "",
        ["test-report.json"],
      );
      continue;
    }
    throw new Error("PHASE33_TEST_REPORT_ARGUMENT_INVALID");
  }
  outputPath = resolvePhase33EvidencePath(repository, outputPath, [
    "test-report.json",
  ]);
  return Object.freeze({ outputPath });
}

function gateEnvironment(candidateCommitSha: string, port: number) {
  const secret = () => randomBytes(32).toString("base64");
  const token = (bytes = 16) => randomBytes(bytes).toString("hex");
  const databaseBase = `postgresql://phase33:phase33-local-only@127.0.0.1:${port}`;
  const sessionSecret = secret();
  const auditIpHashKeys = `phase33-audit-v1:${secret()}`;
  const radarLookupKeys = `phase33-lookup-v1:${secret()}`;
  const radarEncryptionKeys = `phase33-radar-v1:${secret()}`;
  const revealConfirmationKeys = `phase33-confirm-v1:${secret()}`;
  const piiRevealKeys = `phase33-reveal-v1:${secret()}`;
  const notificationDeliveryKeys = `phase33-notification-v1:${secret()}`;
  const notificationRecipientHashKeys = `phase33-recipient-hash-v1:${secret()}`;
  return {
    ...safeToolEnvironment({ ...process.env, NODE_ENV: "test", CI: "true" }),
    APP_ENV: "local",
    NODE_ENV: "test",
    CI: "true",
    DATABASE_URL: `${databaseBase}/swisstalenthub_app?schema=public`,
    TEST_DATABASE_URL: `${databaseBase}/swisstalenthub_test?schema=public`,
    APP_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_APP_NAME: "SwissTalentHub Phase 33 Gate",
    APP_BUILD_ID: candidateCommitSha,
    PHASE33_APP_BUILD_ID: candidateCommitSha,
    SESSION_SECRET: sessionSecret,
    AUDIT_IP_HASH_KEYS: auditIpHashKeys,
    RADAR_OPAQUE_LOOKUP_KEYS: radarLookupKeys,
    RADAR_OPAQUE_ENCRYPTION_KEYS: radarEncryptionKeys,
    REVEAL_CONFIRMATION_KEYS: revealConfirmationKeys,
    PII_REVEAL_KEYS: piiRevealKeys,
    NOTIFICATION_DELIVERY_KEYS: notificationDeliveryKeys,
    NOTIFICATION_RECIPIENT_HASH_KEYS: notificationRecipientHashKeys,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    EMAIL_PROVIDER_MODE: "disabled",
    NOTIFICATION_OUTBOX_PRODUCERS: "false",
    NOTIFICATION_DISPATCH: "paused",
    PAYMENT_PROVIDER_MODE: "disabled",
    WORKER_RUNTIME: "sandbox_command",
    ENABLE_DEMO_SEED: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    LOG_LEVEL: "warn",
    PHASE33_SESSION_SECRET: sessionSecret,
    PHASE33_AUDIT_IP_HASH_KEYS: auditIpHashKeys,
    PHASE33_RADAR_OPAQUE_LOOKUP_KEYS: radarLookupKeys,
    PHASE33_RADAR_OPAQUE_ENCRYPTION_KEYS: radarEncryptionKeys,
    PHASE33_REVEAL_CONFIRMATION_KEYS: revealConfirmationKeys,
    PHASE33_PII_REVEAL_KEYS: piiRevealKeys,
    PHASE33_NOTIFICATION_DELIVERY_KEYS: notificationDeliveryKeys,
    PHASE33_NOTIFICATION_RECIPIENT_HASH_KEYS: notificationRecipientHashKeys,
    PHASE33_DEV_MAILBOX_SECRET: secret(),
    PHASE33_DOCUMENT_STORAGE_KEYS: `phase33-document-v1:${secret()}`,
    PHASE33_PRIVACY_EXPORT_KEYS: `phase33-privacy-v1:${secret()}`,
    PHASE33_RESEND_API_KEY: `re_phase33_${token()}`,
    PHASE33_RESEND_WEBHOOK_SECRET: `whsec_${secret()}`,
    PHASE33_RESEND_SECRET_VERSION: `resend-${token(6)}`,
    PHASE33_RESEND_WEBHOOK_SECRET_VERSION: `resend-webhook-${token(6)}`,
    PHASE33_STRIPE_SECRET_KEY: `sk_test_phase33${token()}`,
    PHASE33_STRIPE_WEBHOOK_SECRET: `whsec_phase33${token()}`,
    PHASE33_STRIPE_SECRET_VERSION: `stripe-${token(6)}`,
    PHASE33_MINIO_ROOT_USER: `phase33${token(8)}`,
    PHASE33_MINIO_ROOT_PASSWORD: secret(),
    PHASE33_MINIO_KMS_SECRET_KEY: secret(),
    PHASE33_STORAGE_SECRET_VERSION: `storage-${token(6)}`,
  } satisfies NodeJS.ProcessEnv;
}

function databaseUrlWithName(value: string, databaseName: "swisstalenthub") {
  const url = new URL(value);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

async function startEphemeralPostgres(container: string) {
  await requireProcess(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "--health-cmd",
      "pg_isready -U phase33 -d swisstalenthub_test",
      "--health-interval",
      "2s",
      "--health-timeout",
      "2s",
      "--health-retries",
      "30",
      "--env",
      "POSTGRES_USER=phase33",
      "--env",
      "POSTGRES_PASSWORD=phase33-local-only",
      "--env",
      "POSTGRES_DB=swisstalenthub_test",
      "--publish",
      "127.0.0.1::5432",
      postgresImage,
    ],
    repository,
    safeToolEnvironment(),
    5 * 60_000,
  );
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const health = await capture(
      "docker",
      ["inspect", "--format", "{{.State.Health.Status}}", container],
      repository,
      safeToolEnvironment(),
    ).catch(() => "missing");
    if (health === "healthy") return;
    if (health === "unhealthy") throw new Error("PHASE33_POSTGRES_UNHEALTHY");
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error("PHASE33_POSTGRES_START_TIMEOUT");
}

async function postgresPort(container: string) {
  const output = await capture(
    "docker",
    ["port", container, "5432/tcp"],
    repository,
    safeToolEnvironment(),
  );
  const match = /:(\d{4,5})$/u.exec(output);
  const port = Number(match?.[1]);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("PHASE33_POSTGRES_PORT_INVALID");
  }
  return port;
}

async function removeEphemeralPostgres(
  container: string,
  environment: NodeJS.ProcessEnv,
) {
  await requireProcess(
    "docker",
    ["rm", "--force", container],
    repository,
    environment,
    60_000,
  );
  const remaining = await capture(
    "docker",
    [
      "ps",
      "--all",
      "--filter",
      `name=^/${container}$`,
      "--format",
      "{{.Names}}",
    ],
    repository,
    environment,
    60_000,
  );
  if (remaining !== "") {
    throw new Error("PHASE33_POSTGRES_CLEANUP_UNPROVEN");
  }
}

async function captureRenderedComposeConfiguration(
  cwd: string,
  environment: NodeJS.ProcessEnv,
  profile: "local-mock" | "production-contract",
  projectName: string,
) {
  const serialized = await capture(
    "docker",
    [
      "compose",
      "--file",
      resolve(cwd, "compose.phase33.yml"),
      "--project-name",
      projectName,
      "--profile",
      profile,
      "config",
      "--format",
      "json",
    ],
    cwd,
    environment,
    60_000,
  );
  return parsePhase33RenderedComposeEvidence(serialized, profile, projectName);
}

async function runRecordedCommand(
  input: Readonly<{
    id: CommandId;
    executable: string;
    args: readonly string[];
    cwd: string;
    environment: NodeJS.ProcessEnv;
    logPath: string;
  }>,
): Promise<CommandReceipt> {
  const started = new Date();
  const exitCode = await streamProcess(
    input.executable,
    input.args,
    input.cwd,
    input.environment,
    input.logPath,
    gateTimeoutMilliseconds,
  );
  const completed = new Date();
  if (exitCode !== 0) {
    throw new Error(`PHASE33_GATE_COMMAND_FAILED:${input.id}:EXIT_${exitCode}`);
  }
  const output = await readFile(input.logPath);
  if (TEST_COMMAND_IDS.has(input.id)) {
    assertPhase33TestCommandOutput(input.id, output.toString("utf8"));
  }
  return Object.freeze({
    id: input.id,
    command: [input.executable, ...input.args].join(" "),
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMilliseconds: completed.getTime() - started.getTime(),
    exitCode: 0 as const,
    outputDigest: digestBuffer(output),
  });
}

const TEST_COMMAND_IDS = new Set<CommandId>([
  "unit",
  "integration",
  "http",
  "hsts",
  "phase33-e2e",
  "browser",
  "providers",
  "providers-smoke",
  "documents-smoke",
  "recovery",
]);

function streamProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  logPath: string,
  timeoutMilliseconds: number,
) {
  return new Promise<number>((resolveExit, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    let interrupted = false;
    let outputBytes = 0;
    const outputChunks: Buffer[] = [];
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      interrupted = true;
      void terminateRecoveryChild(child as unknown as RecoveryChild).then(
        () =>
          finish(() =>
            reject(
              new Error(
                `PROCESS_TIMEOUT:${executable}:${String(timeoutMilliseconds)}`,
              ),
            ),
          ),
        (error: unknown) => finish(() => reject(error)),
      );
    }, timeoutMilliseconds);
    timer.unref();
    const copy = (chunk: Buffer) => {
      if (settled || interrupted) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > PHASE33_COMMAND_LOG_MAX_BYTES) {
        interrupted = true;
        void terminateRecoveryChild(child as unknown as RecoveryChild).then(
          () =>
            finish(() =>
              reject(new Error(`PROCESS_LOG_LIMIT_EXCEEDED:${executable}`)),
            ),
          (error: unknown) => finish(() => reject(error)),
        );
        return;
      }
      outputChunks.push(Buffer.from(chunk));
    };
    child.stdout.on("data", copy);
    child.stderr.on("data", copy);
    child.once("error", (error) => {
      if (!interrupted) finish(() => reject(error));
    });
    child.once("close", (code) => {
      if (interrupted) return;
      // The process is closed, so stop the execution timer before the
      // bounded secret scan and exclusive evidence write. A slow filesystem
      // must not turn an already-completed command into a timeout race.
      interrupted = true;
      clearTimeout(timer);
      const output = Buffer.concat(outputChunks, outputBytes);
      const finding = findSensitiveEvidenceFinding(
        output.toString("utf8"),
        environment,
      );
      if (finding !== null) {
        finish(() =>
          reject(new Error(`PROCESS_SENSITIVE_OUTPUT_REJECTED:${finding}`)),
        );
        return;
      }
      void writeFile(logPath, output, { flag: "wx" }).then(
        () => finish(() => resolveExit(code ?? 1)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  });
}

async function requireProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMilliseconds: number,
) {
  const child = spawn(executable, [...args], {
    cwd,
    env: environment,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const exit = await waitForBoundedChild(
    child as unknown as RecoveryChild,
    executable,
    timeoutMilliseconds,
  );
  if (exit !== 0) {
    throw new Error(`PROCESS_FAILED:${executable}:EXIT_${exit}`);
  }
}

async function capture(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMilliseconds = 60_000,
) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderrSize = 0;
    let settled = false;
    let timedOut = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateRecoveryChild(child as unknown as RecoveryChild).then(
        () =>
          finish(() =>
            reject(
              new Error(
                `CAPTURE_TIMEOUT:${executable}:${String(timeoutMilliseconds)}`,
              ),
            ),
          ),
        (error: unknown) => finish(() => reject(error)),
      );
    }, timeoutMilliseconds);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size <= 1024 * 1024) chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrSize += chunk.byteLength;
    });
    child.once("error", (error) => {
      if (!timedOut) finish(() => reject(error));
    });
    child.once("close", (code) => {
      if (timedOut) return;
      if (code !== 0 || size > 1024 * 1024 || stderrSize > 1024 * 1024) {
        finish(() =>
          reject(new Error(`CAPTURE_FAILED:${executable}:EXIT_${code ?? 1}`)),
        );
        return;
      }
      finish(() =>
        resolveOutput(Buffer.concat(chunks, size).toString("utf8").trim()),
      );
    });
  });
}

function waitForBoundedChild(
  child: RecoveryChild,
  label: string,
  timeoutMilliseconds: number,
) {
  return new Promise<number>((resolveExit, reject) => {
    let settled = false;
    let timedOut = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateRecoveryChild(child).then(
        () =>
          finish(() =>
            reject(
              new Error(
                `PROCESS_TIMEOUT:${label}:${String(timeoutMilliseconds)}`,
              ),
            ),
          ),
        (error: unknown) => finish(() => reject(error)),
      );
    }, timeoutMilliseconds);
    timer.unref();
    child.once("error", (error) => {
      if (!timedOut) finish(() => reject(error));
    });
    child.once("close", (code) => {
      if (!timedOut) finish(() => resolveExit(code ?? 1));
    });
  });
}

async function inspectPhase33OciImage(
  projectName: string,
  candidateCommitSha: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
) {
  const containerId = await capture(
    "docker",
    [
      "compose",
      "--file",
      resolve(cwd, "compose.phase33.yml"),
      "--project-name",
      projectName,
      "--profile",
      "production-contract",
      "ps",
      "--quiet",
      "app-contract",
    ],
    cwd,
    environment,
    60_000,
  );
  const binding = parsePhase33ComposeImageBinding(
    JSON.parse(
      await capture(
        "docker",
        ["container", "inspect", containerId],
        cwd,
        environment,
        60_000,
      ),
    ) as unknown,
    { projectName, service: "app-contract" },
  );
  const inspected: unknown = JSON.parse(
    await capture(
      "docker",
      ["image", "inspect", binding.reference],
      cwd,
      environment,
      60_000,
    ),
  );
  const identity = parsePhase33OciImageIdentity(inspected, {
    candidateCommitSha,
    projectName,
    reference: binding.reference,
  });
  if (identity.imageId !== binding.imageId) {
    throw new Error("PHASE33_COMPOSE_IMAGE_DIGEST_MISMATCH");
  }
  return identity;
}

function allocateLoopbackPort() {
  return new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close((error) => {
        if (error !== undefined) {
          rejectPort(error);
          return;
        }
        if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
          rejectPort(new Error("PHASE33_LOOPBACK_PORT_INVALID"));
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function cleanupProfile(
  cwd: string,
  environment: NodeJS.ProcessEnv,
  profile: "local-mock" | "production-contract",
  projectName: string,
  required: boolean,
  npmRuntime: Phase33NpmRuntime,
) {
  const exists = await readFile(resolve(cwd, "scripts/phase33-compose.ts"))
    .then(() => true)
    .catch(() => false);
  if (!exists) return;
  await requireProcess(
    npmRuntime.executable,
    phase33NpmArguments(npmRuntime, [
      "exec",
      "--",
      "tsx",
      "scripts/phase33-compose.ts",
      "down",
      `--profile=${profile}`,
      `--project-name=${projectName}`,
      "--destroy-data",
    ]),
    cwd,
    environment,
    5 * 60_000,
  ).catch((error) => {
    if (required) throw error;
  });
}

function receiptsForGate(
  gateId: (typeof PHASE33_TECHNICAL_GATE_IDS)[number],
  receipts: readonly CommandReceipt[],
) {
  const selected = new Set<CommandId>(gateCommandIds(gateId));
  return receipts.filter(({ id }) => selected.has(id));
}

function gateCommandIds(
  gateId: (typeof PHASE33_TECHNICAL_GATE_IDS)[number],
): readonly CommandId[] {
  switch (gateId) {
    case "BASELINE_GOVERNANCE":
      return [
        "dependency-install",
        "phase33-audit",
        "plan-audit",
        "route-audit",
        "security-release-scan",
        "license-audit",
      ];
    case "HISTORICAL_MIGRATIONS":
      return [
        "db-generate",
        "db-validate",
        "db-migrate",
        "db-migrate-status",
        "phase33-audit",
        "integration",
      ];
    case "PROVIDER_MODE_MATRIX":
      return [
        "environment",
        "unit",
        "integration",
        "providers",
        "providers-smoke",
        "documents-smoke",
      ];
    case "RUNTIME_CONTRACT":
      return [
        "build",
        "phase33-scale",
        "compose-local-config",
        "compose-local-up",
        "compose-local-repeat",
        "compose-contract-config",
        "compose-contract-smoke",
        "compose-contract-repeat",
      ];
    case "ROLE_JOURNEYS":
      return ["phase33-e2e", "integration"];
    case "FAILURE_RECOVERY":
      return [
        "worker-chaos",
        "worker-benchmark",
        "providers",
        "providers-smoke",
        "documents-smoke",
        "recovery",
      ];
    case "BROWSER_ACCESSIBILITY":
      return ["http", "hsts", "phase33-e2e", "browser"];
    case "ARTIFACT_IDENTITY":
      return ["build", "compose-contract-smoke", "compose-contract-repeat"];
    case "FULL_REGRESSION":
      return PHASE33_TEST_COMMAND_IDS;
    case "LC4_PAYMENT_CLOSED":
    case "LC5_PAYMENT_CONTRACT":
      return [
        "unit",
        "integration",
        "phase33-e2e",
        "providers",
        "providers-smoke",
      ];
  }
}

function assertCandidateTreeClean(cwd: string) {
  const output = requireCapture("git", PHASE33_CLEAN_TREE_GIT_ARGUMENTS, cwd);
  const unsafe = output.split(/\r?\n/u).filter((line) => line.length > 0);
  if (unsafe.length > 0) throw new Error("PHASE33_CANDIDATE_TREE_NOT_CLEAN");
}

function requireCapture(
  executable: string,
  args: readonly string[],
  cwd: string,
) {
  const result = runSync(executable, args, cwd);
  if (result.exitCode !== 0) throw new Error(`PROCESS_FAILED:${executable}`);
  return result.stdout.trim();
}

function runSync(executable: string, args: readonly string[], cwd: string) {
  const result = spawnSync(executable, [...args], {
    cwd,
    env: safeToolEnvironment(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  return {
    exitCode: result.error === undefined ? (result.status ?? 1) : 1,
    stdout: result.stdout ?? "",
  };
}

function assertCommit(value: string) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) {
    throw new Error("PHASE33_CANDIDATE_COMMIT_INVALID");
  }
}

function digestJson(value: unknown) {
  return digestBuffer(Buffer.from(JSON.stringify(value), "utf8"));
}

function digestBuffer(value: Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "UNKNOWN_FAILURE")
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(/[^A-Za-z0-9_:,./-]/gu, "_")
    .slice(0, 1_024);
}

try {
  await run(parseArguments(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-test-report",
      status: "FAIL",
      error: safeError(error),
    })}\n`,
  );
  process.exitCode = 1;
}
