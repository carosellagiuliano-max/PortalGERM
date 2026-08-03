export const PHASE33_RUNTIME_PROFILES = Object.freeze([
  "local-mock",
  "production-contract",
] as const);

export type Phase33RuntimeProfile = (typeof PHASE33_RUNTIME_PROFILES)[number];

export const PHASE33_LONG_RUNNING_SERVICES = Object.freeze({
  "local-mock": Object.freeze([
    "postgres",
    "app-local",
    "worker-local",
    "scheduler-local",
  ]),
  "production-contract": Object.freeze([
    "postgres",
    "object-store",
    "scanner",
    "provider-contract",
    "app-contract",
    "worker-contract",
    "scheduler-contract",
    "tls-proxy",
  ]),
} satisfies Record<Phase33RuntimeProfile, readonly string[]>);

export const PHASE33_RUNTIME_LOG_MAX_BYTES = 1024 * 1024;

export type Phase33RuntimeStabilityReceipt = Readonly<{
  containerId: string;
  health: "healthy";
  logByteCount: number;
  logDigestSha256: string;
  projectName: string;
  restartCount: 0;
  service: string;
  state: "running";
}>;

export type Phase33RuntimeCleanupReceipt = Readonly<{
  dataDestroyed: boolean;
  remainingContainerCount: 0;
  remainingNetworkCount: 0;
  remainingVolumeCount: number;
  status: "PASS";
}>;

export function validatePhase33RuntimeCleanupInspection(
  input: Readonly<{
    containers: string;
    destroyData: boolean;
    networks: string;
    volumes: string;
  }>,
): Phase33RuntimeCleanupReceipt {
  const remainingContainerCount = resourceCount(input.containers);
  const remainingNetworkCount = resourceCount(input.networks);
  const remainingVolumeCount = resourceCount(input.volumes);
  if (
    remainingContainerCount !== 0 ||
    remainingNetworkCount !== 0 ||
    (input.destroyData && remainingVolumeCount !== 0)
  ) {
    throw new Error("PHASE33_RUNTIME_CLEANUP_UNPROVEN");
  }
  return Object.freeze({
    dataDestroyed: input.destroyData,
    remainingContainerCount: 0,
    remainingNetworkCount: 0,
    remainingVolumeCount,
    status: "PASS",
  });
}

/**
 * Converts Docker's sensitive, unbounded inspect response into the small
 * allowlisted receipt that may be retained as Phase 33 evidence. Container
 * environment variables and log contents never cross this boundary.
 */
export function validatePhase33RuntimeStabilityInspection(
  raw: unknown,
  input: Readonly<{
    expectedContainerReference: string;
    logByteCount: number;
    logDigestSha256: string;
    profile: Phase33RuntimeProfile;
    projectName: string;
    service: string;
  }>,
): Phase33RuntimeStabilityReceipt {
  const allowedServices = PHASE33_LONG_RUNNING_SERVICES[input.profile] as
    readonly string[] | undefined;
  if (
    allowedServices === undefined ||
    !allowedServices.includes(input.service)
  ) {
    throw new Error(`PHASE33_RUNTIME_SERVICE_OUT_OF_PROFILE:${input.service}`);
  }
  if (
    !/^[a-f0-9]{12,64}$/u.test(input.expectedContainerReference) ||
    !/^swisstalenthub-phase33-[a-z0-9-]+$/u.test(input.projectName) ||
    input.projectName.length > 63
  ) {
    throw new Error(`PHASE33_RUNTIME_EXPECTATION_INVALID:${input.service}`);
  }
  if (
    !Number.isSafeInteger(input.logByteCount) ||
    input.logByteCount < 0 ||
    input.logByteCount > PHASE33_RUNTIME_LOG_MAX_BYTES ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.logDigestSha256)
  ) {
    throw new Error(`PHASE33_RUNTIME_LOG_EVIDENCE_INVALID:${input.service}`);
  }

  if (!Array.isArray(raw) || raw.length !== 1) {
    throw new Error(
      `PHASE33_RUNTIME_INSPECTION_CARDINALITY_INVALID:${input.service}`,
    );
  }
  const inspection = asRecord(raw[0]);
  const state = asRecord(inspection?.State);
  const health = asRecord(state?.Health);
  const labels = asRecord(asRecord(inspection?.Config)?.Labels);
  const containerId = inspection?.Id;
  if (
    typeof containerId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(containerId) ||
    (containerId !== input.expectedContainerReference &&
      !containerId.startsWith(input.expectedContainerReference))
  ) {
    throw new Error(`PHASE33_RUNTIME_CONTAINER_ID_MISMATCH:${input.service}`);
  }
  if (inspection?.RestartCount !== 0) {
    throw new Error(`PHASE33_RUNTIME_RESTARTED:${input.service}`);
  }
  if (state?.Status !== "running" || state.Running !== true) {
    throw new Error(`PHASE33_RUNTIME_STATE_INVALID:${input.service}`);
  }
  if (health?.Status !== "healthy") {
    throw new Error(`PHASE33_RUNTIME_HEALTH_INVALID:${input.service}`);
  }
  if (
    labels?.["com.docker.compose.project"] !== input.projectName ||
    labels["com.docker.compose.service"] !== input.service
  ) {
    throw new Error(`PHASE33_RUNTIME_LABEL_MISMATCH:${input.service}`);
  }

  return Object.freeze({
    containerId,
    health: "healthy",
    logByteCount: input.logByteCount,
    logDigestSha256: input.logDigestSha256,
    projectName: input.projectName,
    restartCount: 0,
    service: input.service,
    state: "running",
  });
}

export const PHASE33_PINNED_IMAGES = Object.freeze({
  postgres:
    "postgres:16.13-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50",
  "object-store":
    "minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e",
  "object-store-init":
    "minio/mc:RELEASE.2025-08-13T08-35-41Z@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727",
  scanner:
    "clamav/clamav:1.4.3@sha256:75fb5fd95fcbe1d7e6d240c369c1572b686ee2c95949d1042b5148de8eddebb4",
  "tls-proxy":
    "caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d",
} as const);

const REQUIRED_SERVICES = Object.freeze({
  "local-mock": Object.freeze([
    "postgres",
    "migrate-local",
    "seed-local",
    "bootstrap-local",
    "app-local",
    "worker-local",
    "scheduler-local",
    "local-smoke",
  ]),
  "production-contract": Object.freeze([
    "postgres",
    "migrate-contract",
    "object-store",
    "object-store-init",
    "scanner",
    "provider-contract",
    "bootstrap-contract",
    "provider-smoke-contract",
    "app-contract",
    "worker-contract",
    "scheduler-contract",
    "tls-proxy",
    "contract-smoke",
  ]),
} satisfies Record<Phase33RuntimeProfile, readonly string[]>);

const EXPECTED_BUILD_TARGETS = Object.freeze({
  "migrate-local": "migrator",
  "seed-local": "migrator",
  "bootstrap-local": "migrator",
  "app-local": "app",
  "worker-local": "worker",
  "scheduler-local": "scheduler",
  "local-smoke": "migrator",
  "migrate-contract": "migrator",
  "provider-contract": "provider-contract",
  "bootstrap-contract": "migrator",
  "provider-smoke-contract": "migrator",
  "app-contract": "app",
  "worker-contract": "worker",
  "scheduler-contract": "scheduler",
  "contract-smoke": "migrator",
} as const);

export type Phase33RuntimeContractResult = Readonly<{
  issues: readonly string[];
  profile: Phase33RuntimeProfile;
  requiredServices: readonly string[];
  status: "PASS" | "FAIL";
}>;

/**
 * Validates Docker Compose's rendered JSON rather than trusting source-text
 * conventions. The function intentionally understands only the closed Phase
 * 33 topology and fails on missing or weakened controls.
 */
export function validatePhase33RuntimeContract(
  raw: unknown,
  profile: Phase33RuntimeProfile,
): Phase33RuntimeContractResult {
  const issues: string[] = [];
  const model = asRecord(raw);
  const services = asRecord(model?.services);
  const networks = asRecord(model?.networks);
  const requiredServices = REQUIRED_SERVICES[profile];

  if (model === undefined || services === undefined || networks === undefined) {
    issues.push("COMPOSE_MODEL_INVALID");
    return result(profile, requiredServices, issues);
  }

  const actualServiceNames = Object.keys(services).sort();
  for (const serviceName of requiredServices) {
    if (!(serviceName in services))
      issues.push(`SERVICE_MISSING:${serviceName}`);
  }
  for (const serviceName of actualServiceNames) {
    if (!requiredServices.includes(serviceName)) {
      issues.push(`SERVICE_OUT_OF_PROFILE:${serviceName}`);
    }
  }

  for (const [serviceName, rawService] of Object.entries(services)) {
    const service = asRecord(rawService);
    if (service === undefined) {
      issues.push(`SERVICE_INVALID:${serviceName}`);
      continue;
    }
    const profiles = stringArray(service.profiles);
    if (!profiles.includes(profile)) {
      issues.push(`PROFILE_BINDING_MISSING:${serviceName}`);
    }
    if (service.privileged === true || service.network_mode === "host") {
      issues.push(`UNSAFE_RUNTIME_PRIVILEGE:${serviceName}`);
    }
    if (isHardenedRuntime(serviceName)) {
      if (service.read_only !== true) {
        issues.push(`READ_ONLY_ROOT_REQUIRED:${serviceName}`);
      }
      if (!stringArray(service.cap_drop).includes("ALL")) {
        issues.push(`CAP_DROP_ALL_REQUIRED:${serviceName}`);
      }
      if (
        !stringArray(service.security_opt).includes("no-new-privileges:true")
      ) {
        issues.push(`NO_NEW_PRIVILEGES_REQUIRED:${serviceName}`);
      }
      if (
        isLongRunningRuntime(serviceName) &&
        asRecord(service.healthcheck) === undefined
      ) {
        issues.push(`HEALTHCHECK_REQUIRED:${serviceName}`);
      }
    }
    const expectedTarget =
      EXPECTED_BUILD_TARGETS[
        serviceName as keyof typeof EXPECTED_BUILD_TARGETS
      ];
    if (expectedTarget !== undefined) {
      const build = asRecord(service.build);
      if (build?.target !== expectedTarget) {
        issues.push(`BUILD_TARGET_MISMATCH:${serviceName}`);
      }
    }
    const expectedImage =
      PHASE33_PINNED_IMAGES[serviceName as keyof typeof PHASE33_PINNED_IMAGES];
    if (expectedImage !== undefined && service.image !== expectedImage) {
      issues.push(`IMAGE_NOT_EXACTLY_PINNED:${serviceName}`);
    }
    if (service.image !== undefined && !isDigestPinnedImage(service.image)) {
      issues.push(`IMAGE_DIGEST_MISSING:${serviceName}`);
    }
  }

  requireInternalNetwork(networks, "database", issues);
  requireHostIngressNetwork(networks, "front", issues);
  if (profile === "production-contract") {
    requireInternalNetwork(networks, "edge", issues);
    requireInternalNetwork(networks, "providers", issues);
    requireInternalNetwork(networks, "storage", issues);
    requireNetworkBoundary(
      services,
      "app-contract",
      ["database", "edge", "providers", "storage"],
      issues,
    );
    requireNetworkBoundary(services, "tls-proxy", ["edge", "front"], issues);
    requireNetworkBoundary(
      services,
      "worker-contract",
      ["database", "providers", "storage"],
      issues,
    );
    requireNetworkBoundary(
      services,
      "scheduler-contract",
      ["database", "providers", "storage"],
      issues,
    );
    requireNetworkBoundary(
      services,
      "bootstrap-contract",
      ["database", "providers", "storage"],
      issues,
    );
    requireNetworkBoundary(
      services,
      "provider-smoke-contract",
      ["database"],
      issues,
    );
    requireNetworkBoundary(
      services,
      "contract-smoke",
      ["database", "providers", "storage"],
      issues,
    );
    requireLoopbackPublishedPort(services, "tls-proxy", 8443, issues);
    assertContractEnvironment(services, issues);
    assertObjectStoreKmsEnvironment(services, issues);
  } else {
    requireNetworkBoundary(
      services,
      "app-local",
      ["database", "front"],
      issues,
    );
    requireNetworkBoundary(services, "worker-local", ["database"], issues);
    requireNetworkBoundary(services, "scheduler-local", ["database"], issues);
    requireNetworkBoundary(services, "bootstrap-local", ["database"], issues);
    requireNetworkBoundary(services, "local-smoke", ["database"], issues);
    for (const name of [
      "app-local",
      "worker-local",
      "scheduler-local",
      "bootstrap-local",
      "local-smoke",
    ]) {
      requireLocalDocumentVolume(services, name, issues);
    }
    requireLoopbackPublishedPort(services, "app-local", 3000, issues);
    assertLocalMockEnvironment(services, issues);
  }

  return result(profile, requiredServices, issues);
}

function assertObjectStoreKmsEnvironment(
  services: Record<string, unknown>,
  issues: string[],
) {
  const environment = asRecord(asRecord(services["object-store"])?.environment);
  const value = environment?.MINIO_KMS_SECRET_KEY;

  // MinIO's static KMS contract is `<key-name>:<base64-32-byte-key>`. Requiring
  // the closed Phase 33 key name and a canonical 32-byte payload prevents an
  // empty interpolation or malformed key from silently weakening the SSE-S3
  // contract. The secret itself is intentionally never included in an issue.
  if (
    typeof value !== "string" ||
    !/^phase33-sse:[A-Za-z0-9+/]{43}=$/u.test(value)
  ) {
    issues.push("OBJECT_STORE_KMS_KEY_INVALID:object-store");
  }
}

export function isPhase33RuntimeProfile(
  value: string,
): value is Phase33RuntimeProfile {
  return PHASE33_RUNTIME_PROFILES.includes(value as Phase33RuntimeProfile);
}

function assertContractEnvironment(
  services: Record<string, unknown>,
  issues: string[],
) {
  const expectedProviderModes = Object.freeze({
    EMAIL_PROVIDER_MODE: "resend_contract",
    PAYMENT_PROVIDER_MODE: "stripe_contract",
    DOCUMENT_STORAGE_MODE: "s3_contract",
    DOCUMENT_SCANNER_MODE: "clamav_contract",
    PRIVACY_EXPORT_STORAGE_MODE: "s3_contract",
  });
  for (const name of [
    "app-contract",
    "worker-contract",
    "scheduler-contract",
    "bootstrap-contract",
    "provider-smoke-contract",
    "contract-smoke",
  ]) {
    const environment = asRecord(asRecord(services[name])?.environment);
    if (
      environment?.APP_ENV !== "ci" ||
      environment.NODE_ENV !== "production"
    ) {
      issues.push(`CONTRACT_ENVIRONMENT_MISMATCH:${name}`);
    }
    for (const [key, expected] of Object.entries(expectedProviderModes)) {
      if (environment?.[key] !== expected) {
        issues.push(`CONTRACT_PROVIDER_MODE_MISMATCH:${name}:${key}`);
      }
    }
    for (const [key, value] of Object.entries(environment ?? {})) {
      if (
        /_MODE$/u.test(key) &&
        typeof value === "string" &&
        (value.toLowerCase() === "live" ||
          value.toLowerCase().endsWith("_live"))
      ) {
        issues.push(`LIVE_PROVIDER_FORBIDDEN:${name}:${key}`);
      }
    }
  }
  for (const name of [
    "migrate-contract",
    "app-contract",
    "worker-contract",
    "scheduler-contract",
    "bootstrap-contract",
    "provider-smoke-contract",
    "contract-smoke",
  ]) {
    const environment = asRecord(asRecord(services[name])?.environment);
    if (
      postgresDatabaseName(environment?.DATABASE_URL) !==
      "swisstalenthub_contract_test"
    ) {
      issues.push(`CONTRACT_DATABASE_TARGET_MISMATCH:${name}`);
    }
  }
}

function postgresDatabaseName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return undefined;
    }
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    return databaseName.length > 0 ? databaseName : undefined;
  } catch {
    return undefined;
  }
}

function assertLocalMockEnvironment(
  services: Record<string, unknown>,
  issues: string[],
) {
  const expected = Object.freeze({
    APP_ENV: "local",
    NODE_ENV: "production",
    EMAIL_PROVIDER_MODE: "local_mock",
    PAYMENT_PROVIDER_MODE: "disabled",
    DOCUMENT_STORAGE_MODE: "filesystem_sandbox",
    DOCUMENT_SCANNER_MODE: "sandbox",
    PRIVACY_EXPORT_STORAGE_MODE: "filesystem_sandbox",
  });
  for (const name of [
    "app-local",
    "worker-local",
    "scheduler-local",
    "bootstrap-local",
    "local-smoke",
  ]) {
    const environment = asRecord(asRecord(services[name])?.environment);
    for (const [key, value] of Object.entries(expected)) {
      if (environment?.[key] !== value) {
        issues.push(`LOCAL_MOCK_ENVIRONMENT_MISMATCH:${name}:${key}`);
      }
    }
  }
}

function isHardenedRuntime(name: string): boolean {
  return /^(?:(?:app|worker|scheduler)(?:-|$)|provider-contract$|tls-proxy$|bootstrap-contract$|provider-smoke-contract$|contract-smoke$|bootstrap-local$|local-smoke$)/u.test(
    name,
  );
}

function requireLocalDocumentVolume(
  services: Record<string, unknown>,
  name: string,
  issues: string[],
) {
  const volumes = Array.isArray(asRecord(services[name])?.volumes)
    ? (asRecord(services[name])?.volumes as unknown[])
    : [];
  const validDocument = volumes.some((rawVolume) => {
    const volume = asRecord(rawVolume);
    return (
      volume?.type === "volume" &&
      volume.target === "/phase33/document-vault" &&
      typeof volume.source === "string" &&
      /(?:^|_)phase33-local-documents$/u.test(volume.source)
    );
  });
  const validPrivacy = volumes.some((rawVolume) => {
    const volume = asRecord(rawVolume);
    return (
      volume?.type === "volume" &&
      volume.target === "/phase33/privacy-export" &&
      typeof volume.source === "string" &&
      /(?:^|_)phase33-local-privacy$/u.test(volume.source)
    );
  });
  if (!validDocument) issues.push(`LOCAL_DOCUMENT_VOLUME_REQUIRED:${name}`);
  if (!validPrivacy) issues.push(`LOCAL_PRIVACY_VOLUME_REQUIRED:${name}`);
}

function isLongRunningRuntime(name: string): boolean {
  return /^(?:(?:app|worker|scheduler)(?:-|$)|provider-contract$|tls-proxy$)/u.test(
    name,
  );
}

function requireInternalNetwork(
  networks: Record<string, unknown>,
  name: string,
  issues: string[],
) {
  if (asRecord(networks[name])?.internal !== true) {
    issues.push(`INTERNAL_NETWORK_REQUIRED:${name}`);
  }
}

function requireHostIngressNetwork(
  networks: Record<string, unknown>,
  name: string,
  issues: string[],
) {
  const network = asRecord(networks[name]);
  if (
    network === undefined ||
    network.internal === true ||
    network.driver !== "bridge"
  ) {
    issues.push(`HOST_INGRESS_NETWORK_REQUIRED:${name}`);
  }
}

function requireNetworkBoundary(
  services: Record<string, unknown>,
  name: string,
  expected: readonly string[],
  issues: string[],
) {
  const actual = Object.keys(
    asRecord(asRecord(services[name])?.networks) ?? {},
  ).sort();
  const wanted = [...expected].sort();
  if (actual.join("|") !== wanted.join("|")) {
    issues.push(`NETWORK_BOUNDARY_MISMATCH:${name}`);
  }
}

function requireLoopbackPublishedPort(
  services: Record<string, unknown>,
  name: string,
  target: number,
  issues: string[],
) {
  const ports = Array.isArray(asRecord(services[name])?.ports)
    ? (asRecord(services[name])?.ports as unknown[])
    : [];
  const valid = ports.some((rawPort) => {
    const port = asRecord(rawPort);
    return port?.host_ip === "127.0.0.1" && port.target === target;
  });
  if (!valid) issues.push(`LOOPBACK_PORT_REQUIRED:${name}:${target}`);
}

function isDigestPinnedImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /@sha256:[a-f0-9]{64}$/u.test(value) &&
    !value.includes("${")
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function resourceCount(value: string) {
  if (Buffer.byteLength(value, "utf8") > 1024 * 1024) {
    throw new Error("PHASE33_RUNTIME_CLEANUP_OUTPUT_TOO_LARGE");
  }
  return value.split(/\r?\n/u).filter((line) => line.trim() !== "").length;
}

function result(
  profile: Phase33RuntimeProfile,
  requiredServices: readonly string[],
  issues: string[],
): Phase33RuntimeContractResult {
  return Object.freeze({
    issues: Object.freeze([...issues].sort()),
    profile,
    requiredServices,
    status: issues.length === 0 ? "PASS" : "FAIL",
  });
}
