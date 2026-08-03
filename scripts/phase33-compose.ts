import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";

import {
  isPhase33RuntimeProfile,
  PHASE33_LONG_RUNNING_SERVICES,
  PHASE33_RUNTIME_LOG_MAX_BYTES,
  validatePhase33RuntimeCleanupInspection,
  validatePhase33RuntimeContract,
  validatePhase33RuntimeStabilityInspection,
  type Phase33RuntimeProfile,
  type Phase33RuntimeStabilityReceipt,
} from "@/lib/release/phase33-runtime-contract";
import {
  normalizePhase33ComposeError,
  PHASE33_CONTRACT_HOST,
  PHASE33_CONTRACT_HOST_HEADER,
  waitForPhase33ContractHost,
} from "@/lib/release/phase33-compose-host";
import { findSensitiveEvidenceFinding } from "@/lib/security/sensitive-data-registry";

type Action = "config" | "down" | "ps" | "smoke" | "up";

const buildAndUpTimeoutMilliseconds = 30 * 60_000;
const controlCommandTimeoutMilliseconds = 5 * 60_000;
const capturedCommandTimeoutMilliseconds = 60_000;
const ONE_SHOT_SERVICES = Object.freeze({
  "local-mock": Object.freeze([
    "migrate-local",
    "seed-local",
    "bootstrap-local",
    "local-smoke",
  ]),
  "production-contract": Object.freeze([
    "migrate-contract",
    "object-store-init",
    "bootstrap-contract",
    "provider-smoke-contract",
    "contract-smoke",
  ]),
} satisfies Record<Phase33RuntimeProfile, readonly string[]>);

try {
  const command = parseArguments(process.argv.slice(2));
  const repository = resolve(import.meta.dirname, "..");
  const environment = phase33Environment(
    repository,
    command.profile,
    command.projectName,
  );
  const base = [
    "compose",
    "--file",
    resolve(repository, "compose.phase33.yml"),
    "--project-name",
    command.projectName,
    "--profile",
    command.profile,
  ];
  let requiredServices: readonly string[] = [];
  let runtimeStability: RuntimeStabilityEvidence | undefined;

  if (command.action !== "down") {
    const rendered = runSensitiveCaptured(
      "docker",
      [...base, "config", "--format", "json"],
      repository,
      environment,
    );
    const contract = validatePhase33RuntimeContract(
      JSON.parse(rendered),
      command.profile,
    );
    if (contract.status !== "PASS") {
      throw new Error(`RUNTIME_CONTRACT_FAILED:${contract.issues.join(",")}`);
    }
    requiredServices = contract.requiredServices;
    if (command.action === "config") {
      writeResult(command, {
        requiredServices: contract.requiredServices,
        status: "PASS",
      });
      process.exit(0);
    }
  }

  if (command.action === "up" || command.action === "smoke") {
    runInherited(
      "docker",
      [
        ...base,
        "up",
        command.build ? "--build" : "--no-build",
        "--detach",
        "--remove-orphans",
      ],
      repository,
      environment,
      buildAndUpTimeoutMilliseconds,
    );
    await waitForProfileReady({
      base,
      environment,
      profile: command.profile,
      repository,
      requiredServices,
    });
    if (command.action === "smoke") {
      if (command.profile !== "production-contract") {
        throw new Error("SMOKE_REQUIRES_PRODUCTION_CONTRACT");
      }
      await verifyProductionContractHost({
        base,
        environment,
        repository,
      });
    }
    runtimeStability = inspectProfileStability({
      base,
      environment,
      profile: command.profile,
      projectName: command.projectName,
      repository,
      requiredServices,
    });
  } else if (command.action === "down") {
    runInherited(
      "docker",
      [
        ...base,
        "down",
        "--remove-orphans",
        ...(command.destroyData ? ["--volumes"] : []),
      ],
      repository,
      environment,
      controlCommandTimeoutMilliseconds,
    );
    const cleanup = inspectProfileCleanup({
      destroyData: command.destroyData,
      environment,
      projectName: command.projectName,
      repository,
    });
    writeResult(command, cleanup);
    process.exit(0);
  } else {
    runInherited(
      "docker",
      [...base, "ps", "--all"],
      repository,
      environment,
      controlCommandTimeoutMilliseconds,
    );
  }

  writeResult(command, {
    dataDestroyed: false,
    ...(runtimeStability === undefined ? {} : { runtimeStability }),
    status: "PASS",
  });
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-compose",
      error: safeError(error),
      status: "FAIL",
    })}\n`,
  );
  process.exitCode = 1;
}

function inspectProfileCleanup(
  input: Readonly<{
    destroyData: boolean;
    environment: NodeJS.ProcessEnv;
    projectName: string;
    repository: string;
  }>,
) {
  const projectFilter = `label=com.docker.compose.project=${input.projectName}`;
  return validatePhase33RuntimeCleanupInspection({
    containers: runCaptured(
      "docker",
      [
        "container",
        "ls",
        "--all",
        "--filter",
        projectFilter,
        "--format",
        "{{.ID}}",
      ],
      input.repository,
      input.environment,
    ),
    destroyData: input.destroyData,
    networks: runCaptured(
      "docker",
      ["network", "ls", "--filter", projectFilter, "--format", "{{.ID}}"],
      input.repository,
      input.environment,
    ),
    volumes: runCaptured(
      "docker",
      ["volume", "ls", "--filter", projectFilter, "--format", "{{.Name}}"],
      input.repository,
      input.environment,
    ),
  });
}

async function waitForProfileReady(
  input: Readonly<{
    base: readonly string[];
    environment: NodeJS.ProcessEnv;
    profile: Phase33RuntimeProfile;
    repository: string;
    requiredServices: readonly string[];
  }>,
) {
  const timeoutMilliseconds = 5 * 60_000;
  const deadline = Date.now() + timeoutMilliseconds;
  const oneShots = new Set(ONE_SHOT_SERVICES[input.profile]);

  while (Date.now() < deadline) {
    const renderedState = runCaptured(
      "docker",
      [...input.base, "ps", "--all", "--format", "json"],
      input.repository,
      input.environment,
    );
    const containers = parseComposeState(renderedState);
    let pending = false;
    for (const service of input.requiredServices) {
      const state = containers.find((entry) => entry.Service === service);
      if (state === undefined) {
        pending = true;
        continue;
      }
      if (oneShots.has(service)) {
        if (state.State === "exited") {
          if (state.ExitCode !== 0) {
            throw new Error(`COMPOSE_ONE_SHOT_FAILED:${service}`);
          }
        } else {
          pending = true;
        }
        continue;
      }
      if (state.State === "exited" || state.State === "dead") {
        throw new Error(`COMPOSE_RUNTIME_EXITED:${service}`);
      }
      if (state.State !== "running" || state.Health !== "healthy") {
        pending = true;
      }
    }
    if (!pending) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`COMPOSE_PROFILE_READY_TIMEOUT:${input.profile}`);
}

type RuntimeStabilityEvidence = Readonly<{
  services: readonly Phase33RuntimeStabilityReceipt[];
  status: "PASS";
}>;

function inspectProfileStability(
  input: Readonly<{
    base: readonly string[];
    environment: NodeJS.ProcessEnv;
    profile: Phase33RuntimeProfile;
    projectName: string;
    repository: string;
    requiredServices: readonly string[];
  }>,
): RuntimeStabilityEvidence {
  const classifiedServices = input.requiredServices
    .filter((service) => !ONE_SHOT_SERVICES[input.profile].includes(service))
    .sort();
  const declaredServices = [
    ...PHASE33_LONG_RUNNING_SERVICES[input.profile],
  ].sort();
  if (classifiedServices.join("|") !== declaredServices.join("|")) {
    throw new Error(
      `PHASE33_RUNTIME_SERVICE_CLASSIFICATION_INVALID:${input.profile}`,
    );
  }

  const renderedState = runCaptured(
    "docker",
    [...input.base, "ps", "--all", "--format", "json"],
    input.repository,
    input.environment,
  );
  const containers = parseComposeState(renderedState);
  const receipts = PHASE33_LONG_RUNNING_SERVICES[input.profile].map(
    (service) => {
      const composeState = requireComposeService(
        containers,
        service,
        "running",
      );
      if (composeState.Health !== "healthy") {
        throw new Error(`COMPOSE_SERVICE_HEALTH_INVALID:${service}`);
      }

      const logEvidence = captureContainerLogEvidence({
        containerId: composeState.ID,
        environment: input.environment,
        repository: input.repository,
        service,
      });
      // Inspect after bounded log capture so a restart that happens while the
      // evidence is collected cannot be hidden by an earlier healthy sample.
      const renderedInspection = runSensitiveCaptured(
        "docker",
        ["container", "inspect", composeState.ID],
        input.repository,
        input.environment,
      );
      let inspection: unknown;
      try {
        inspection = JSON.parse(renderedInspection);
      } catch {
        throw new Error(`PHASE33_RUNTIME_INSPECTION_JSON_INVALID:${service}`);
      }
      return validatePhase33RuntimeStabilityInspection(inspection, {
        expectedContainerReference: composeState.ID,
        logByteCount: logEvidence.byteCount,
        logDigestSha256: logEvidence.digestSha256,
        profile: input.profile,
        projectName: input.projectName,
        service,
      });
    },
  );

  return Object.freeze({
    services: Object.freeze(receipts),
    status: "PASS",
  });
}

function captureContainerLogEvidence(
  input: Readonly<{
    containerId: string;
    environment: NodeJS.ProcessEnv;
    repository: string;
    service: string;
  }>,
): Readonly<{ byteCount: number; digestSha256: string }> {
  const result = spawnSync(
    "docker",
    ["logs", "--timestamps", "--tail", "2000", input.containerId],
    {
      cwd: input.repository,
      encoding: null,
      env: input.environment,
      killSignal: "SIGTERM",
      maxBuffer: PHASE33_RUNTIME_LOG_MAX_BYTES,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: capturedCommandTimeoutMilliseconds,
      windowsHide: true,
    },
  );
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (errorCode === "ETIMEDOUT") {
    throw new Error(`PHASE33_RUNTIME_LOG_CAPTURE_TIMEOUT:${input.service}`);
  }
  if (errorCode === "ENOBUFS") {
    throw new Error(`PHASE33_RUNTIME_LOG_CAPTURE_TOO_LARGE:${input.service}`);
  }
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`PHASE33_RUNTIME_LOG_CAPTURE_FAILED:${input.service}`);
  }

  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr)
    ? result.stderr
    : Buffer.alloc(0);
  const byteCount = stdout.byteLength + stderr.byteLength;
  if (byteCount > PHASE33_RUNTIME_LOG_MAX_BYTES) {
    throw new Error(`PHASE33_RUNTIME_LOG_CAPTURE_TOO_LARGE:${input.service}`);
  }
  const sensitiveFinding = findSensitiveEvidenceFinding(
    Buffer.concat([stdout, stderr], byteCount).toString("utf8"),
    input.environment,
  );
  if (sensitiveFinding !== null) {
    throw new Error(
      `PHASE33_RUNTIME_LOG_SENSITIVE_OUTPUT:${input.service}:${sensitiveFinding}`,
    );
  }
  const digest = createHash("sha256");
  digest.update("phase33-runtime-log-evidence-v1\0", "utf8");
  digest.update(`stdout:${stdout.byteLength}\0`, "utf8");
  digest.update(stdout);
  digest.update(`\0stderr:${stderr.byteLength}\0`, "utf8");
  digest.update(stderr);

  return Object.freeze({
    byteCount,
    digestSha256: `sha256:${digest.digest("hex")}`,
  });
}

function parseArguments(values: readonly string[]) {
  let action: Action = "config";
  let actionObserved = false;
  let build = true;
  let destroyData = false;
  let profile: Phase33RuntimeProfile = "production-contract";
  let projectName: string | undefined;

  for (const value of values) {
    if (/^(?:config|down|ps|smoke|up)$/u.test(value)) {
      if (actionObserved) throw new Error("ACTION_DUPLICATE");
      action = value as Action;
      actionObserved = true;
      continue;
    }
    const profileMatch = /^--profile=(.+)$/u.exec(value);
    if (profileMatch !== null) {
      const candidate = profileMatch[1] ?? "";
      if (!isPhase33RuntimeProfile(candidate)) {
        throw new Error("PROFILE_INVALID");
      }
      profile = candidate;
      continue;
    }
    const projectMatch = /^--project-name=([a-z0-9][a-z0-9-]{0,62})$/u.exec(
      value,
    );
    if (projectMatch !== null) {
      projectName = projectMatch[1];
      continue;
    }
    if (value === "--destroy-data") {
      destroyData = true;
      continue;
    }
    if (value === "--no-build") {
      build = false;
      continue;
    }
    throw new Error("ARGUMENT_INVALID");
  }

  if (destroyData && action !== "down") {
    throw new Error("DESTROY_DATA_REQUIRES_DOWN");
  }
  if (!build && action !== "up" && action !== "smoke") {
    throw new Error("NO_BUILD_REQUIRES_UP_OR_SMOKE");
  }
  const safeProjectName =
    projectName ??
    `swisstalenthub-phase33-${profile.replaceAll(/[^a-z0-9]/gu, "-")}`;
  if (!safeProjectName.startsWith("swisstalenthub-phase33-")) {
    throw new Error("PROJECT_NAME_OUT_OF_SCOPE");
  }
  return Object.freeze({
    action,
    build,
    destroyData,
    profile,
    projectName: safeProjectName,
  });
}

function phase33Environment(
  repository: string,
  profile: Phase33RuntimeProfile,
  projectName: string,
): NodeJS.ProcessEnv {
  // Local-mock volumes intentionally survive `up` invocations. Their fixture
  // ciphertext therefore needs stable, project-scoped test keys. These values
  // are predictable by design, never qualify for live modes, and are not
  // written to disk. Production-contract material remains fresh per run.
  const secret = (label: string) =>
    profile === "local-mock"
      ? createHash("sha256")
          .update(`phase33-local-only:${projectName}:${label}`, "utf8")
          .digest("base64")
      : randomBytes(32).toString("base64");
  const token = (bytes = 16) => randomBytes(bytes).toString("hex");
  const currentCommit = runCaptured(
    "git",
    ["rev-parse", "HEAD"],
    repository,
    process.env,
  ).trim();
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(currentCommit)) {
    throw new Error("GIT_COMMIT_INVALID");
  }
  return {
    ...process.env,
    COMPOSE_ANSI: "never",
    PHASE33_APP_BUILD_ID: process.env.PHASE33_APP_BUILD_ID || currentCommit,
    PHASE33_SESSION_SECRET:
      process.env.PHASE33_SESSION_SECRET || secret("session"),
    PHASE33_AUDIT_IP_HASH_KEYS:
      process.env.PHASE33_AUDIT_IP_HASH_KEYS ||
      `phase33-audit-v1:${secret("audit-ip")}`,
    PHASE33_RADAR_OPAQUE_LOOKUP_KEYS:
      process.env.PHASE33_RADAR_OPAQUE_LOOKUP_KEYS ||
      `phase33-radar-lookup-v1:${secret("radar-lookup")}`,
    PHASE33_RADAR_OPAQUE_ENCRYPTION_KEYS:
      process.env.PHASE33_RADAR_OPAQUE_ENCRYPTION_KEYS ||
      `phase33-radar-encryption-v1:${secret("radar-encryption")}`,
    PHASE33_REVEAL_CONFIRMATION_KEYS:
      process.env.PHASE33_REVEAL_CONFIRMATION_KEYS ||
      `phase33-confirm-v1:${secret("reveal-confirmation")}`,
    PHASE33_PII_REVEAL_KEYS:
      process.env.PHASE33_PII_REVEAL_KEYS ||
      `phase33-reveal-v1:${secret("pii-reveal")}`,
    PHASE33_NOTIFICATION_DELIVERY_KEYS:
      process.env.PHASE33_NOTIFICATION_DELIVERY_KEYS ||
      `phase33-notification-v1:${secret("notification-delivery")}`,
    PHASE33_NOTIFICATION_RECIPIENT_HASH_KEYS:
      process.env.PHASE33_NOTIFICATION_RECIPIENT_HASH_KEYS ||
      `phase33-recipient-hash-v1:${secret("notification-recipient-hash")}`,
    PHASE33_DEV_MAILBOX_SECRET:
      process.env.PHASE33_DEV_MAILBOX_SECRET || secret("dev-mailbox"),
    PHASE33_DOCUMENT_STORAGE_KEYS:
      process.env.PHASE33_DOCUMENT_STORAGE_KEYS ||
      `phase33-document-v1:${secret("document-storage")}`,
    PHASE33_PRIVACY_EXPORT_KEYS:
      process.env.PHASE33_PRIVACY_EXPORT_KEYS ||
      `phase33-privacy-v1:${secret("privacy-export")}`,
    PHASE33_RESEND_API_KEY:
      process.env.PHASE33_RESEND_API_KEY || `re_phase33_${token()}`,
    PHASE33_RESEND_WEBHOOK_SECRET:
      process.env.PHASE33_RESEND_WEBHOOK_SECRET ||
      `whsec_${secret("resend-webhook")}`,
    PHASE33_RESEND_SECRET_VERSION:
      process.env.PHASE33_RESEND_SECRET_VERSION || `resend-${token(6)}`,
    PHASE33_RESEND_WEBHOOK_SECRET_VERSION:
      process.env.PHASE33_RESEND_WEBHOOK_SECRET_VERSION ||
      `resend-webhook-${token(6)}`,
    PHASE33_STRIPE_SECRET_KEY:
      process.env.PHASE33_STRIPE_SECRET_KEY || `sk_test_phase33${token()}`,
    PHASE33_STRIPE_WEBHOOK_SECRET:
      process.env.PHASE33_STRIPE_WEBHOOK_SECRET || `whsec_phase33${token()}`,
    PHASE33_STRIPE_SECRET_VERSION:
      process.env.PHASE33_STRIPE_SECRET_VERSION || `stripe-${token(6)}`,
    PHASE33_MINIO_ROOT_USER:
      process.env.PHASE33_MINIO_ROOT_USER || `phase33${token(8)}`,
    PHASE33_MINIO_ROOT_PASSWORD:
      process.env.PHASE33_MINIO_ROOT_PASSWORD || secret("minio-root"),
    PHASE33_MINIO_KMS_SECRET_KEY:
      process.env.PHASE33_MINIO_KMS_SECRET_KEY || secret("minio-kms"),
    PHASE33_STORAGE_SECRET_VERSION:
      process.env.PHASE33_STORAGE_SECRET_VERSION || `storage-${token(6)}`,
  };
}

async function verifyProductionContractHost(
  input: Readonly<{
    base: readonly string[];
    environment: NodeJS.ProcessEnv;
    repository: string;
  }>,
) {
  const port = parsePort(input.environment.PHASE33_TLS_PORT ?? "3443");
  await waitForPhase33ContractHost({
    buildId: input.environment.PHASE33_APP_BUILD_ID ?? "",
    request: (path) => requestContractHealth(port, path),
  });

  const renderedState = runCaptured(
    "docker",
    [...input.base, "ps", "--all", "--format", "json"],
    input.repository,
    input.environment,
  );
  const containers = parseComposeState(renderedState);
  const worker = requireComposeService(
    containers,
    "worker-contract",
    "running",
  );
  const scheduler = requireComposeService(
    containers,
    "scheduler-contract",
    "running",
  );
  requireComposeService(containers, "bootstrap-contract", "exited", 0);
  requireComposeService(containers, "provider-smoke-contract", "exited", 0);
  requireComposeService(containers, "contract-smoke", "exited", 0);
  if (
    worker.ID === scheduler.ID ||
    worker.Health !== "healthy" ||
    scheduler.Health !== "healthy"
  ) {
    throw new Error("PRODUCTION_CONTRACT_ROLE_SEPARATION_FAILED");
  }
}

function requestContractHealth(
  port: number,
  path: string,
): Promise<
  Readonly<{
    headers: Readonly<Record<string, string | string[] | undefined>>;
    json: Readonly<Record<string, unknown>>;
    status: number;
  }>
> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsRequest(
      {
        hostname: PHASE33_CONTRACT_HOST,
        headers: { host: PHASE33_CONTRACT_HOST_HEADER },
        method: "GET",
        path,
        port,
        rejectUnauthorized: false,
        servername: PHASE33_CONTRACT_HOST_HEADER,
        timeout: 5_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > 64 * 1024) {
            request.destroy(
              new Error("PRODUCTION_CONTRACT_HEALTH_BODY_TOO_LARGE"),
            );
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.once("end", () => {
          try {
            const parsed: unknown = JSON.parse(
              Buffer.concat(chunks, size).toString("utf8"),
            );
            if (
              typeof parsed !== "object" ||
              parsed === null ||
              Array.isArray(parsed)
            ) {
              throw new Error("PRODUCTION_CONTRACT_HEALTH_JSON_INVALID");
            }
            resolveRequest(
              Object.freeze({
                headers: Object.freeze({ ...response.headers }),
                json: Object.freeze(parsed as Record<string, unknown>),
                status: response.statusCode ?? 0,
              }),
            );
          } catch {
            rejectRequest(new Error("PRODUCTION_CONTRACT_HEALTH_JSON_INVALID"));
          }
        });
      },
    );
    request.once("timeout", () =>
      request.destroy(new Error("PRODUCTION_CONTRACT_HEALTH_TIMEOUT")),
    );
    request.once("error", rejectRequest);
    request.end();
  });
}

type ComposeState = Readonly<{
  ExitCode?: number;
  Health?: string;
  ID?: string;
  Service?: string;
  State?: string;
}>;

function parseComposeState(value: string): readonly ComposeState[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error("COMPOSE_STATE_EMPTY");
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as ComposeState[];
    if (typeof parsed === "object" && parsed !== null) {
      return Object.freeze([parsed as ComposeState]);
    }
  } catch {
    const values = trimmed.split(/\r?\n/u).map((line) => JSON.parse(line));
    if (values.every((entry) => typeof entry === "object" && entry !== null)) {
      return Object.freeze(values as ComposeState[]);
    }
  }
  throw new Error("COMPOSE_STATE_INVALID");
}

function requireComposeService(
  states: readonly ComposeState[],
  service: string,
  state: "exited" | "running",
  exitCode?: number,
): ComposeState & Readonly<{ ID: string }> {
  const matches = states.filter((entry) => entry.Service === service);
  const matched = matches[0];
  if (
    matches.length !== 1 ||
    matched === undefined ||
    matched.State !== state ||
    typeof matched.ID !== "string" ||
    !/^[a-f0-9]{12,64}$/u.test(matched.ID) ||
    (exitCode !== undefined && matched.ExitCode !== exitCode)
  ) {
    throw new Error(`COMPOSE_SERVICE_STATE_INVALID:${service}`);
  }
  return matched as ComposeState & Readonly<{ ID: string }>;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_024 || parsed > 65_535) {
    throw new Error("PHASE33_TLS_PORT_INVALID");
  }
  return parsed;
}

function runCaptured(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
) {
  try {
    return execFileSync(executable, [...args], {
      cwd,
      encoding: "utf8",
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
      timeout: capturedCommandTimeoutMilliseconds,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`PROCESS_FAILED:${executable}:${safeError(error)}`);
  }
}

function runSensitiveCaptured(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
) {
  try {
    return execFileSync(executable, [...args], {
      cwd,
      encoding: "utf8",
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
      timeout: capturedCommandTimeoutMilliseconds,
      windowsHide: true,
    });
  } catch {
    // A Docker inspect response contains container environment variables. Its
    // stdout/stderr must therefore never be reflected into the evidence or
    // error path, even when the subprocess fails or exceeds its bound.
    throw new Error(`SENSITIVE_PROCESS_CAPTURE_FAILED:${executable}`);
  }
}

function runInherited(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMilliseconds: number,
) {
  const result = spawnSync(executable, [...args], {
    cwd,
    env: environment,
    killSignal: "SIGTERM",
    shell: false,
    stdio: "inherit",
    timeout: timeoutMilliseconds,
    windowsHide: true,
  });
  if (
    (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT"
  ) {
    throw new Error(`PROCESS_TIMEOUT:${executable}`);
  }
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`PROCESS_FAILED:${executable}:EXIT_${result.status ?? 1}`);
  }
}

function writeResult(
  command: ReturnType<typeof parseArguments>,
  extra: Readonly<Record<string, unknown>>,
) {
  process.stdout.write(
    `${JSON.stringify({
      command: "phase33-compose",
      action: command.action,
      profile: command.profile,
      projectName: command.projectName,
      ...extra,
    })}\n`,
  );
}

function safeError(error: unknown) {
  return normalizePhase33ComposeError(error);
}
