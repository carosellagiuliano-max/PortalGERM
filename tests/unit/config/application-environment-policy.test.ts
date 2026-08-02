import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isCompanyVerificationSandboxAllowed } from "@/lib/companies/verification/composition";
import {
  environmentClass,
  isIsolatedSandboxEnvironment,
  type ApplicationEnvironment,
} from "@/lib/config/application-environment";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { resolveDocumentRuntime } from "@/lib/documents/runtime-policy";
import type { OperationsActivationMode } from "@/lib/generated/prisma/client";
import { getWorkerHandlerDefinition } from "@/lib/ops/handler-catalog";
import {
  resolveWorkerHandlerActivation,
  type WorkerHandlerActivationRecord,
  type WorkerRuntimeMode,
} from "@/lib/ops/worker-activation-policy";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";

const NOW = new Date("2026-08-02T08:00:00.000Z");
const ENVIRONMENT_MATRIX = [
  ["local", "LOCAL_DEVELOPMENT", true],
  ["ci", "CI_VERIFICATION", true],
  ["preview", "PUBLIC_PREVIEW", false],
  ["staging", "CONTROLLED_STAGING", false],
  ["production", "LIVE_PRODUCTION", false],
] as const satisfies readonly (readonly [
  ApplicationEnvironment,
  ReturnType<typeof environmentClass>,
  boolean,
])[];

describe("application environment policy", () => {
  it.each(ENVIRONMENT_MATRIX)(
    "classifies %s explicitly as %s",
    (environment, classification, isolatedSandbox) => {
      expect(environmentClass(environment)).toBe(classification);
      expect(isIsolatedSandboxEnvironment(environment)).toBe(isolatedSandbox);
    },
  );

  it("fails closed for an impossible runtime value", () => {
    const impossible = "qa" as ApplicationEnvironment;
    expect(() => environmentClass(impossible)).toThrow(
      "Unsupported application environment: qa",
    );
    expect(() => isIsolatedSandboxEnvironment(impossible)).toThrow(
      "Unsupported application environment: qa",
    );
  });

  it.each(ENVIRONMENT_MATRIX)(
    "allows deterministic company providers in %s only when the runtime is isolated",
    (environment, _classification, isolatedSandbox) => {
      expect(
        isCompanyVerificationSandboxAllowed({
          APP_ENV: environment,
          COMPANY_VERIFICATION_COHORT: "test",
        }),
      ).toBe(isolatedSandbox);
      expect(
        isCompanyVerificationSandboxAllowed({
          APP_ENV: environment,
          COMPANY_VERIFICATION_COHORT: "none",
        }),
      ).toBe(false);
    },
  );

  it("keeps filesystem documents disabled in public preview and later tiers", () => {
    const sandbox = documentSandboxEnvironment();

    for (const [
      environment,
      _classification,
      isolatedSandbox,
    ] of ENVIRONMENT_MATRIX) {
      const decision = resolveDocumentRuntime(
        Object.freeze({ ...sandbox, APP_ENV: environment }),
      );
      expect(decision.available, environment).toBe(isolatedSandbox);
      if (decision.available) expect(decision.mode).toBe("SANDBOX");
    }
  });

  it.each([
    ["local", "SANDBOX", "sandbox_command", true],
    ["ci", "SANDBOX", "sandbox_command", true],
    ["preview", "SANDBOX", "autonomous", false],
    ["preview", "ALLOWLIST", "autonomous", false],
    ["preview", "LIVE", "autonomous", false],
    ["staging", "SANDBOX", "autonomous", true],
    ["staging", "ALLOWLIST", "autonomous", true],
    ["staging", "LIVE", "autonomous", false],
    ["production", "SANDBOX", "autonomous", false],
    ["production", "ALLOWLIST", "autonomous", true],
    ["production", "LIVE", "autonomous", true],
  ] as const satisfies readonly (readonly [
    ApplicationEnvironment,
    Exclude<OperationsActivationMode, "DISABLED">,
    Exclude<WorkerRuntimeMode, "paused">,
    boolean,
  ])[])(
    "resolves %s / %s / %s with active=%s",
    (environment, mode, runtimeMode, active) => {
      const decision = resolveWorkerHandlerActivation({
        activation: workerActivation(environment, mode),
        deploymentDigest: "build-a",
        environment,
        handler: workerHandler(),
        now: NOW,
        runtimeMode,
      });

      expect(decision.active).toBe(active);
      if (!active) {
        expect(decision).toEqual({
          active: false,
          reason: "ENVIRONMENT_MODE_FORBIDDEN",
        });
      }
    },
  );
});

function documentSandboxEnvironment(): ServerEnvironment {
  return parseEnvironment(
    createValidEnvironment({
      DOCUMENT_VAULT_WRITES: "true",
      DOCUMENT_STORAGE_MODE: "filesystem_sandbox",
      DOCUMENT_SCANNER_MODE: "sandbox",
      DOCUMENT_CLEAN_READS: "true",
      DOCUMENT_RECONCILIATION: "command",
      DOCUMENT_VAULT_COHORT: "test",
      DOCUMENT_STORAGE_ROOT: resolve(
        process.cwd(),
        "..",
        "phase33-environment-policy-vault",
      ),
      DOCUMENT_STORAGE_KEYS: `document-policy-v1:${keyMaterial(10)}`,
    }),
  );
}

function workerHandler() {
  const handler = getWorkerHandlerDefinition("ops.diagnostic-effect", "v1");
  if (handler === null) throw new Error("Missing worker test handler.");
  return handler;
}

function workerActivation(
  environment: ApplicationEnvironment,
  mode: Exclude<OperationsActivationMode, "DISABLED">,
): WorkerHandlerActivationRecord {
  return Object.freeze({
    id: "0196f82d-3fb4-4f1a-8c9d-123456789abc",
    generation: 1,
    environment,
    handlerKey: "ops.diagnostic-effect",
    handlerVersion: "v1",
    payloadVersion: "v1",
    mode,
    configurationDigest: "a".repeat(64),
    deploymentDigest: "build-a",
    owner: "Platform",
    runbookRef: "runbook:worker",
    sloRef: "slo:worker",
    evidenceDigest: "b".repeat(64),
    providerUseCase: null,
    leaseMilliseconds: 60_000,
    heartbeatMilliseconds: 20_000,
    batchSize: 25,
    maxAttempts: 8,
    maxConcurrency: 1,
    killSwitchEngaged: false,
    effectiveAt: NOW,
    expiresAt: null,
    revokedAt: null,
  });
}
