import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseEnvironment, type ServerEnvironment } from "@/lib/config/env-schema";
import { WORKER_HANDLER_CATALOG } from "@/lib/ops/handler-catalog";
import { resolvePrivacyExecutionRuntime } from "@/lib/privacy/execution-approval";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";

describe("Phase-33 privacy worker activation policy", () => {
  it("registers all event-driven privacy processors as implemented", () => {
    expect(
      WORKER_HANDLER_CATALOG.filter(({ handlerKey }) =>
        handlerKey.startsWith("privacy."),
      ).map(({ execution, handlerKey, schedule }) => ({
        execution,
        handlerKey,
        schedule,
      })),
    ).toEqual([
      {
        execution: "IMPLEMENTED",
        handlerKey: "privacy.export",
        schedule: "event-driven-after-dual-approval",
      },
      {
        execution: "IMPLEMENTED",
        handlerKey: "privacy.correction",
        schedule: "event-driven-after-dual-approval",
      },
      {
        execution: "IMPLEMENTED",
        handlerKey: "privacy.erasure",
        schedule: "event-driven-after-dual-approval",
      },
    ]);
  });

  it("maps every executable request to one handler only under the exact sandbox contract", () => {
    const environment = sandboxEnvironment();
    expect(resolvePrivacyExecutionRuntime(environment, "EXPORT")).toMatchObject({
      allowed: true,
      handlerKey: "privacy.export",
    });
    expect(resolvePrivacyExecutionRuntime(environment, "CORRECT")).toMatchObject({
      allowed: true,
      handlerKey: "privacy.correction",
    });
    expect(resolvePrivacyExecutionRuntime(environment, "DELETE")).toMatchObject({
      allowed: true,
      handlerKey: "privacy.erasure",
    });
  });

  it.each([
    "PRIVACY_PROVIDER_POSTGRES",
    "PRIVACY_PROVIDER_DOCUMENTS",
    "PRIVACY_PROVIDER_EMAIL",
    "PRIVACY_PROVIDER_PAYMENT",
    "PRIVACY_PROVIDER_ANALYTICS",
    "NOTIFICATION_OUTBOX_PRODUCERS",
  ] as const)("fails closed when %s is revoked", (key) => {
    const environment = sandboxEnvironment();
    expect(
      resolvePrivacyExecutionRuntime(
        Object.freeze({ ...environment, [key]: false }),
        "EXPORT",
      ),
    ).toEqual({ allowed: false });
  });

  it("requires backup authority for correction and erasure but not export", () => {
    const environment = Object.freeze({
      ...sandboxEnvironment(),
      PRIVACY_PROVIDER_BACKUP: false,
    });
    expect(resolvePrivacyExecutionRuntime(environment, "EXPORT").allowed).toBe(
      true,
    );
    expect(resolvePrivacyExecutionRuntime(environment, "CORRECT")).toEqual({
      allowed: false,
    });
    expect(resolvePrivacyExecutionRuntime(environment, "DELETE")).toEqual({
      allowed: false,
    });
  });

  it("separates CI contract authority from staging/production autonomous authority", () => {
    const base = sandboxEnvironment();
    const contract = Object.freeze({
      ...base,
      APP_ENV: "ci" as const,
      NODE_ENV: "production" as const,
      PRIVACY_EXPORT_STORAGE_MODE: "s3_contract" as const,
      PRIVACY_PROCESSING_MODE: "contract_worker" as const,
    });
    expect(resolvePrivacyExecutionRuntime(contract, "EXPORT").allowed).toBe(
      true,
    );
    expect(
      resolvePrivacyExecutionRuntime(
        Object.freeze({ ...contract, APP_ENV: "local" as const }),
        "EXPORT",
      ),
    ).toEqual({ allowed: false });

    const autonomous = Object.freeze({
      ...base,
      APP_ENV: "staging" as const,
      NODE_ENV: "production" as const,
      PRIVACY_EXPORT_STORAGE_MODE: "s3_live" as const,
      PRIVACY_PROCESSING_COHORT: "approved" as const,
      PRIVACY_PROCESSING_MODE: "autonomous_worker" as const,
    });
    expect(resolvePrivacyExecutionRuntime(autonomous, "EXPORT").allowed).toBe(
      true,
    );
    expect(
      resolvePrivacyExecutionRuntime(
        Object.freeze({ ...autonomous, PRIVACY_PROCESSING_COHORT: "test" as const }),
        "EXPORT",
      ),
    ).toEqual({ allowed: false });
  });

  it("rejects a partially enabled privacy environment at configuration parse time", () => {
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          NOTIFICATION_OUTBOX_PRODUCERS: "true",
          PRIVACY_EXPORT_KEYS: `privacy-export-v1:${keyMaterial(22)}`,
          PRIVACY_EXPORT_STORAGE_MODE: "filesystem_sandbox",
          PRIVACY_EXPORT_STORAGE_ROOT: resolve(
            tmpdir(),
            "phase33-privacy-policy-invalid",
          ),
          PRIVACY_EXPORT_V2: "true",
          PRIVACY_PROCESSING_COHORT: "test",
          PRIVACY_PROCESSING_MODE: "sandbox_command",
          PRIVACY_PROVIDER_ANALYTICS: "true",
          PRIVACY_PROVIDER_DOCUMENTS: "true",
          PRIVACY_PROVIDER_EMAIL: "true",
          PRIVACY_PROVIDER_PAYMENT: "true",
          PRIVACY_PROVIDER_POSTGRES: "false",
        }),
      ),
    ).toThrow(/privacy execution requires an explicit mode/iu);
  });
});

function sandboxEnvironment(): ServerEnvironment {
  return parseEnvironment(
    createValidEnvironment({
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      PRIVACY_CORRECTION_EXECUTION: "true",
      PRIVACY_ERASURE_EXECUTION: "true",
      PRIVACY_EXPORT_KEYS: `privacy-export-v1:${keyMaterial(22)}`,
      PRIVACY_EXPORT_STORAGE_MODE: "filesystem_sandbox",
      PRIVACY_EXPORT_STORAGE_REGION: "ch-sandbox",
      PRIVACY_EXPORT_STORAGE_ROOT: resolve(
        tmpdir(),
        "phase33-privacy-worker-policy",
      ),
      PRIVACY_EXPORT_V2: "true",
      PRIVACY_PROCESSING_COHORT: "test",
      PRIVACY_PROCESSING_MODE: "sandbox_command",
      PRIVACY_PROVIDER_ANALYTICS: "true",
      PRIVACY_PROVIDER_BACKUP: "true",
      PRIVACY_PROVIDER_DOCUMENTS: "true",
      PRIVACY_PROVIDER_EMAIL: "true",
      PRIVACY_PROVIDER_PAYMENT: "true",
      PRIVACY_PROVIDER_POSTGRES: "true",
    }),
  );
}
