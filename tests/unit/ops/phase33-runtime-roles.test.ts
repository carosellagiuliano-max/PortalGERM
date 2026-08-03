import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PHASE33_LONG_RUNNING_SERVICES,
  PHASE33_PINNED_IMAGES,
  PHASE33_RUNTIME_LOG_MAX_BYTES,
  validatePhase33RuntimeCleanupInspection,
  validatePhase33RuntimeContract,
  validatePhase33RuntimeStabilityInspection,
  type Phase33RuntimeProfile,
} from "@/lib/release/phase33-runtime-contract";

describe("Phase 33 runtime-role contract", () => {
  it.each(["local-mock", "production-contract"] as const)(
    "accepts the isolated %s topology",
    (profile) => {
      expect(validatePhase33RuntimeContract(model(profile), profile)).toEqual(
        expect.objectContaining({ status: "PASS", issues: [] }),
      );
    },
  );

  it("defines the complete closed set of long-running services per profile", () => {
    expect(PHASE33_LONG_RUNNING_SERVICES).toEqual({
      "local-mock": [
        "postgres",
        "app-local",
        "worker-local",
        "scheduler-local",
      ],
      "production-contract": [
        "postgres",
        "object-store",
        "scanner",
        "provider-contract",
        "app-contract",
        "worker-contract",
        "scheduler-contract",
        "tls-proxy",
      ],
    });
  });

  it("uses the shared fenced consumer path in the Docker worker runtime", () => {
    const runtime = readFileSync(
      resolve(import.meta.dirname, "../../../scripts/phase33-runtime.ts"),
      "utf8",
    );

    expect(runtime).toContain(
      'import { runWorkerConsumerCycle } from "@/lib/ops/worker-service";',
    );
    expect(runtime).toContain("return runWorkerConsumerCycle({");
    expect(runtime).not.toContain("claimWorkBatch(");
    expect(runtime).not.toContain("executeRegisteredHandler(");
    expect(runtime).not.toContain("WORKER_HANDLER_CATALOG");
  });

  it("retains only bounded digest evidence for a stable Compose container", () => {
    const secret = "must-not-cross-the-runtime-evidence-boundary";
    const receipt = validatePhase33RuntimeStabilityInspection(
      stableInspection({ secret }),
      stabilityExpectation(),
    );

    expect(receipt).toEqual({
      containerId: "a".repeat(64),
      health: "healthy",
      logByteCount: 412,
      logDigestSha256: `sha256:${"b".repeat(64)}`,
      projectName: "swisstalenthub-phase33-contract-test",
      restartCount: 0,
      service: "worker-contract",
      state: "running",
    });
    expect(JSON.stringify(receipt)).not.toContain(secret);
  });

  it("proves project-scoped container, network and requested volume cleanup", () => {
    expect(
      validatePhase33RuntimeCleanupInspection({
        containers: "",
        destroyData: true,
        networks: "",
        volumes: "",
      }),
    ).toEqual({
      dataDestroyed: true,
      remainingContainerCount: 0,
      remainingNetworkCount: 0,
      remainingVolumeCount: 0,
      status: "PASS",
    });
    expect(() =>
      validatePhase33RuntimeCleanupInspection({
        containers: "abc123",
        destroyData: true,
        networks: "",
        volumes: "",
      }),
    ).toThrow("PHASE33_RUNTIME_CLEANUP_UNPROVEN");
    expect(() =>
      validatePhase33RuntimeCleanupInspection({
        containers: "",
        destroyData: true,
        networks: "",
        volumes: "leftover-volume",
      }),
    ).toThrow("PHASE33_RUNTIME_CLEANUP_UNPROVEN");
  });

  it("fails closed on restarts, unhealthy state, and mismatched Compose labels", () => {
    const restarted = stableInspection();
    restarted[0]!.RestartCount = 1;
    expect(() =>
      validatePhase33RuntimeStabilityInspection(
        restarted,
        stabilityExpectation(),
      ),
    ).toThrow("PHASE33_RUNTIME_RESTARTED:worker-contract");

    const stopped = stableInspection();
    stopped[0]!.State.Running = false;
    expect(() =>
      validatePhase33RuntimeStabilityInspection(
        stopped,
        stabilityExpectation(),
      ),
    ).toThrow("PHASE33_RUNTIME_STATE_INVALID:worker-contract");

    const unhealthy = stableInspection();
    unhealthy[0]!.State.Health.Status = "unhealthy";
    expect(() =>
      validatePhase33RuntimeStabilityInspection(
        unhealthy,
        stabilityExpectation(),
      ),
    ).toThrow("PHASE33_RUNTIME_HEALTH_INVALID:worker-contract");

    const wrongProject = stableInspection();
    wrongProject[0]!.Config.Labels["com.docker.compose.project"] =
      "swisstalenthub-phase33-wrong-project";
    expect(() =>
      validatePhase33RuntimeStabilityInspection(
        wrongProject,
        stabilityExpectation(),
      ),
    ).toThrow("PHASE33_RUNTIME_LABEL_MISMATCH:worker-contract");

    const wrongService = stableInspection();
    wrongService[0]!.Config.Labels["com.docker.compose.service"] =
      "scheduler-contract";
    expect(() =>
      validatePhase33RuntimeStabilityInspection(
        wrongService,
        stabilityExpectation(),
      ),
    ).toThrow("PHASE33_RUNTIME_LABEL_MISMATCH:worker-contract");
  });

  it("rejects unbounded or malformed log evidence", () => {
    expect(() =>
      validatePhase33RuntimeStabilityInspection(stableInspection(), {
        ...stabilityExpectation(),
        logByteCount: PHASE33_RUNTIME_LOG_MAX_BYTES + 1,
      }),
    ).toThrow("PHASE33_RUNTIME_LOG_EVIDENCE_INVALID:worker-contract");
    expect(() =>
      validatePhase33RuntimeStabilityInspection(stableInspection(), {
        ...stabilityExpectation(),
        logDigestSha256: "raw container log text",
      }),
    ).toThrow("PHASE33_RUNTIME_LOG_EVIDENCE_INVALID:worker-contract");
  });

  it("rejects a live provider, front-network escape, and mutable image", () => {
    const input = model("production-contract");
    input.services["app-contract"]!.environment = {
      ...input.services["app-contract"]!.environment,
      EMAIL_PROVIDER_MODE: "resend_live",
    };
    input.services["app-contract"]!.networks = {
      ...input.services["app-contract"]!.networks,
      front: null,
    };
    input.services["migrate-contract"]!.environment = {
      ...input.services["migrate-contract"]!.environment,
      DATABASE_URL:
        "postgresql://contract:contract@postgres:5432/swisstalenthub_contract?schema=public",
    };
    input.services.postgres!.image = "postgres:16-alpine";

    const inspected = validatePhase33RuntimeContract(
      input,
      "production-contract",
    );

    expect(inspected.status).toBe("FAIL");
    expect(inspected.issues).toEqual(
      expect.arrayContaining([
        "LIVE_PROVIDER_FORBIDDEN:app-contract:EMAIL_PROVIDER_MODE",
        "CONTRACT_PROVIDER_MODE_MISMATCH:app-contract:EMAIL_PROVIDER_MODE",
        "NETWORK_BOUNDARY_MISMATCH:app-contract",
        "CONTRACT_DATABASE_TARGET_MISMATCH:migrate-contract",
        "IMAGE_NOT_EXACTLY_PINNED:postgres",
        "IMAGE_DIGEST_MISSING:postgres",
      ]),
    );
  });

  it("requires a host-ingress bridge while all sensitive networks remain internal", () => {
    for (const profile of ["local-mock", "production-contract"] as const) {
      const input = model(profile);
      input.networks.front = { driver: "bridge", internal: true };

      expect(validatePhase33RuntimeContract(input, profile).issues).toContain(
        "HOST_INGRESS_NETWORK_REQUIRED:front",
      );
      input.networks.front = { driver: "host", internal: false };
      expect(validatePhase33RuntimeContract(input, profile).issues).toContain(
        "HOST_INGRESS_NETWORK_REQUIRED:front",
      );
      input.networks.front = { driver: "bridge", internal: false };
      expect(
        validatePhase33RuntimeContract(input, profile).issues,
      ).not.toContain("HOST_INGRESS_NETWORK_REQUIRED:front");
    }
  });

  it("rejects co-located or weakened worker and scheduler roles", () => {
    const input = model("production-contract");
    input.services["worker-contract"]!.build = { target: "scheduler" };
    input.services["scheduler-contract"]!.read_only = false;
    input.services["scheduler-contract"]!.cap_drop = [];

    const inspected = validatePhase33RuntimeContract(
      input,
      "production-contract",
    );

    expect(inspected.issues).toEqual(
      expect.arrayContaining([
        "BUILD_TARGET_MISMATCH:worker-contract",
        "READ_ONLY_ROOT_REQUIRED:scheduler-contract",
        "CAP_DROP_ALL_REQUIRED:scheduler-contract",
      ]),
    );
  });

  it.each(["", "phase33-sse:not-base64", `wrong-key:${"A".repeat(43)}=`])(
    "fails closed for a missing or malformed object-store KMS key (%s)",
    (kmsKey) => {
      const input = model("production-contract");
      input.services["object-store"]!.environment = {
        MINIO_KMS_SECRET_KEY: kmsKey,
      };

      const inspected = validatePhase33RuntimeContract(
        input,
        "production-contract",
      );

      expect(inspected.status).toBe("FAIL");
      expect(inspected.issues).toContain(
        "OBJECT_STORE_KMS_KEY_INVALID:object-store",
      );
    },
  );

  it("keeps each Dockerfile base immutable and defines separate rootless roles", () => {
    const dockerfile = readFileSync(
      resolve(import.meta.dirname, "../../../Dockerfile"),
      "utf8",
    );
    const fromLines = dockerfile
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("FROM "));

    const externalBaseLines = fromLines.filter((line) =>
      line.startsWith("FROM node:"),
    );
    expect(externalBaseLines).toHaveLength(5);
    expect(
      externalBaseLines.every((line) => /@sha256:[a-f0-9]{64}/u.test(line)),
    ).toBe(true);
    expect(dockerfile).toContain("FROM phase33-runtime AS worker");
    expect(dockerfile).toContain("FROM phase33-runtime AS scheduler");
    expect(dockerfile).toContain('CMD ["--role=worker"');
    expect(dockerfile).toContain('CMD ["--role=scheduler"');
    expect(
      (dockerfile.match(/^USER node$/gmu) ?? []).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("uses detached Compose startup with its own bounded readiness contract", () => {
    const wrapper = readFileSync(
      resolve(import.meta.dirname, "../../../scripts/phase33-compose.ts"),
      "utf8",
    );

    expect(wrapper).toContain('"--detach"');
    expect(wrapper).not.toContain('"--wait"');
    expect(wrapper).toContain('command.build ? "--build" : "--no-build"');
    expect(wrapper).toContain("COMPOSE_PROFILE_READY_TIMEOUT");
    expect(wrapper).toContain("COMPOSE_ONE_SHOT_FAILED");
    expect(wrapper).toContain("COMPOSE_RUNTIME_EXITED");
    expect(wrapper).toContain("buildAndUpTimeoutMilliseconds = 30 * 60_000");
    expect(wrapper).toContain("controlCommandTimeoutMilliseconds = 5 * 60_000");
    expect(wrapper).toContain("capturedCommandTimeoutMilliseconds = 60_000");
    expect(wrapper).toContain("PROCESS_TIMEOUT");
    expect(
      wrapper.indexOf("runtimeStability = inspectProfileStability"),
    ).toBeGreaterThan(wrapper.indexOf("await waitForProfileReady"));
    expect(wrapper).toContain('"logs", "--timestamps", "--tail", "2000"');
    expect(wrapper).toContain("PHASE33_RUNTIME_LOG_MAX_BYTES");
  });
});

function stabilityExpectation() {
  return {
    expectedContainerReference: "a".repeat(12),
    logByteCount: 412,
    logDigestSha256: `sha256:${"b".repeat(64)}`,
    profile: "production-contract" as const,
    projectName: "swisstalenthub-phase33-contract-test",
    service: "worker-contract",
  };
}

function stableInspection(input: Readonly<{ secret?: string }> = {}) {
  return [
    {
      Config: {
        Env: [`SECRET=${input.secret ?? "not-retained"}`],
        Labels: {
          "com.docker.compose.project": "swisstalenthub-phase33-contract-test",
          "com.docker.compose.service": "worker-contract",
        },
      },
      Id: "a".repeat(64),
      RestartCount: 0,
      State: {
        Health: { Status: "healthy" },
        Running: true,
        Status: "running",
      },
    },
  ];
}

type MutableService = {
  profiles: string[];
  build?: { target: string };
  image?: string;
  cap_drop?: string[];
  environment?: Record<string, string>;
  healthcheck?: Record<string, unknown>;
  networks?: Record<string, null>;
  ports?: Array<{ host_ip: string; target: number }>;
  read_only?: boolean;
  security_opt?: string[];
  volumes?: Array<{ source: string; target: string; type: string }>;
};

function model(profile: Phase33RuntimeProfile) {
  const names =
    profile === "local-mock"
      ? [
          "postgres",
          "migrate-local",
          "seed-local",
          "bootstrap-local",
          "app-local",
          "worker-local",
          "scheduler-local",
          "local-smoke",
        ]
      : [
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
        ];
  const services = Object.fromEntries(
    names.map((name) => [name, service(name, profile)]),
  ) as Record<string, MutableService>;
  return {
    services,
    networks: {
      database: { internal: true },
      edge: { internal: true },
      front: { driver: "bridge", internal: false },
      providers: { internal: true },
      storage: { internal: true },
    } as Record<string, { driver?: string; internal?: boolean }>,
  };
}

function service(name: string, profile: Phase33RuntimeProfile): MutableService {
  const value: MutableService = { profiles: [profile] };
  const image =
    PHASE33_PINNED_IMAGES[name as keyof typeof PHASE33_PINNED_IMAGES];
  if (image !== undefined) value.image = image;
  if (name === "object-store") {
    value.environment = {
      MINIO_KMS_SECRET_KEY: `phase33-sse:${"A".repeat(43)}=`,
    };
  }
  const target = targetFor(name);
  if (target !== undefined) value.build = { target };
  if (
    /^(?:(?:app|worker|scheduler)(?:-|$)|provider-contract$|tls-proxy$|bootstrap-contract$|provider-smoke-contract$|contract-smoke$|bootstrap-local$|local-smoke$)/u.test(
      name,
    )
  ) {
    value.cap_drop = ["ALL"];
    if (
      name !== "bootstrap-contract" &&
      name !== "provider-smoke-contract" &&
      name !== "contract-smoke" &&
      name !== "bootstrap-local" &&
      name !== "local-smoke"
    ) {
      value.healthcheck = { test: ["CMD", "true"] };
    }
    value.read_only = true;
    value.security_opt = ["no-new-privileges:true"];
  }
  if (name === "app-local") {
    value.networks = { database: null, front: null };
    value.ports = [{ host_ip: "127.0.0.1", target: 3000 }];
  } else if (name === "worker-local" || name === "scheduler-local") {
    value.networks = { database: null };
  } else if (name === "bootstrap-local" || name === "local-smoke") {
    value.networks = { database: null };
  } else if (name === "app-contract") {
    value.networks = {
      database: null,
      edge: null,
      providers: null,
      storage: null,
    };
  } else if (name === "worker-contract") {
    value.networks = { database: null, providers: null, storage: null };
  } else if (name === "scheduler-contract") {
    value.networks = { database: null, providers: null, storage: null };
  } else if (name === "bootstrap-contract") {
    value.networks = {
      database: null,
      providers: null,
      storage: null,
    };
  } else if (name === "provider-smoke-contract") {
    value.networks = { database: null };
  } else if (name === "contract-smoke") {
    value.networks = { database: null, providers: null, storage: null };
  } else if (name === "tls-proxy") {
    value.networks = { edge: null, front: null };
    value.ports = [{ host_ip: "127.0.0.1", target: 8443 }];
  } else if (
    name === "postgres" ||
    name.includes("migrate") ||
    name === "seed-local"
  ) {
    value.networks = { database: null };
  } else if (name === "provider-contract") {
    value.networks = { providers: null };
  } else {
    value.networks = { storage: null };
  }
  if (
    name === "app-local" ||
    name === "worker-local" ||
    name === "scheduler-local" ||
    name === "bootstrap-local" ||
    name === "local-smoke"
  ) {
    value.volumes = [
      {
        source: "swisstalenthub-phase33-local-mock_phase33-local-documents",
        target: "/phase33/document-vault",
        type: "volume",
      },
      {
        source: "swisstalenthub-phase33-local-mock_phase33-local-privacy",
        target: "/phase33/privacy-export",
        type: "volume",
      },
    ];
  }
  if (
    profile === "local-mock" &&
    [
      "app-local",
      "worker-local",
      "scheduler-local",
      "bootstrap-local",
      "local-smoke",
    ].includes(name)
  ) {
    value.environment = {
      APP_ENV: "local",
      NODE_ENV: "production",
      EMAIL_PROVIDER_MODE: "local_mock",
      PAYMENT_PROVIDER_MODE: "disabled",
      DOCUMENT_STORAGE_MODE: "filesystem_sandbox",
      DOCUMENT_SCANNER_MODE: "sandbox",
      PRIVACY_EXPORT_STORAGE_MODE: "filesystem_sandbox",
    };
  }
  if (
    profile === "production-contract" &&
    (/-contract$/u.test(name) || name === "contract-smoke")
  ) {
    value.environment = {
      APP_ENV: "ci",
      DATABASE_URL:
        "postgresql://contract:contract@postgres:5432/swisstalenthub_contract_test?schema=public",
      NODE_ENV: "production",
      EMAIL_PROVIDER_MODE: "resend_contract",
      PAYMENT_PROVIDER_MODE: "stripe_contract",
      DOCUMENT_STORAGE_MODE: "s3_contract",
      DOCUMENT_SCANNER_MODE: "clamav_contract",
      PRIVACY_EXPORT_STORAGE_MODE: "s3_contract",
    };
  }
  return value;
}

function targetFor(name: string) {
  if (
    name.startsWith("migrate") ||
    name === "seed-local" ||
    name === "bootstrap-local" ||
    name === "local-smoke" ||
    name === "bootstrap-contract" ||
    name === "provider-smoke-contract" ||
    name === "contract-smoke"
  ) {
    return "migrator";
  }
  if (name.startsWith("app-")) return "app";
  if (name.startsWith("worker-")) return "worker";
  if (name.startsWith("scheduler-")) return "scheduler";
  if (name === "provider-contract") return "provider-contract";
  return undefined;
}
