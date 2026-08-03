import { describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createProductionHstsEnvironment } from "@/scripts/ops/production-hsts-environment";
import { createValidEnvironment } from "@/tests/fixtures/environment";

describe("production HSTS smoke environment", () => {
  it("does not inherit Local/CI sandbox capabilities", () => {
    const sourceEnvironment = createValidEnvironment({
      WORKER_RUNTIME: "sandbox_command",
      WORKER_SANDBOX_REPLAY: "true",
      DELIVERY_REPLAY: "true",
      EMAIL_PROVIDER_MODE: "local_mock",
      NOTIFICATION_DISPATCH: "command",
      DOCUMENT_STORAGE_MODE: "filesystem_sandbox",
      DOCUMENT_SCANNER_MODE: "sandbox",
      PRIVACY_PROCESSING_MODE: "sandbox_command",
      PRIVACY_EXPORT_STORAGE_MODE: "filesystem_sandbox",
    }) as NodeJS.ProcessEnv;

    const environment = createProductionHstsEnvironment({
      sourceEnvironment,
      databaseUrl:
        "postgresql://phase33:phase33-local-only@127.0.0.1:5432/hsts?schema=public",
      buildId: "a".repeat(40),
      secretCanary: "hsts-regression-canary",
    });

    expect(environment).toMatchObject({
      APP_ENV: "production",
      NODE_ENV: "production",
      WORKER_RUNTIME: "paused",
      WORKER_SANDBOX_REPLAY: "false",
      EMAIL_PROVIDER_MODE: "disabled",
      NOTIFICATION_DISPATCH: "paused",
      DOCUMENT_STORAGE_MODE: "disabled",
      DOCUMENT_SCANNER_MODE: "disabled",
      PRIVACY_PROCESSING_MODE: "disabled",
      PRIVACY_EXPORT_STORAGE_MODE: "disabled",
      HTTP_SMOKE_SECRET_CANARY: "hsts-regression-canary",
    });
    expect(environment).not.toHaveProperty("DELIVERY_REPLAY");
    expect(() => parseEnvironment(environment)).not.toThrow();
  });
});
