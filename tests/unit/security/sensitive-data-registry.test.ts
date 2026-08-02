import { describe, expect, it } from "vitest";

import {
  APPLICATION_SENSITIVE_ENVIRONMENT_VARIABLES,
  collectSensitiveValues,
  findSensitiveEvidenceFinding,
  redactSensitiveEvidenceText,
  SENSITIVE_ENVIRONMENT_VARIABLES,
} from "@/lib/security/sensitive-data-registry";

describe("Phase 33 sensitive evidence registry", () => {
  it("keeps every current provider, keyring and Phase-33 runtime secret in one registry", () => {
    expect(new Set(APPLICATION_SENSITIVE_ENVIRONMENT_VARIABLES).size).toBe(
      APPLICATION_SENSITIVE_ENVIRONMENT_VARIABLES.length,
    );
    expect(SENSITIVE_ENVIRONMENT_VARIABLES).toEqual(
      expect.arrayContaining([
        "DOCUMENT_STORAGE_KEYS",
        "PRIVACY_EXPORT_KEYS",
        "DOCUMENT_STORAGE_ACCESS_KEY_ID",
        "DOCUMENT_STORAGE_SECRET_ACCESS_KEY",
        "DOCUMENT_STORAGE_SESSION_TOKEN",
        "RESEND_WEBHOOK_SECRET",
        "PHASE33_PRIVACY_EXPORT_KEYS",
        "PHASE33_RESEND_WEBHOOK_SECRET",
        "PHASE33_MINIO_ROOT_PASSWORD",
        "PHASE33_MINIO_KMS_SECRET_KEY",
      ]),
    );
    expect(new Set(SENSITIVE_ENVIRONMENT_VARIABLES).size).toBe(
      SENSITIVE_ENVIRONMENT_VARIABLES.length,
    );
  });

  it("extracts key material and detects exact configured values without returning it", () => {
    const environment = {
      PRIVACY_EXPORT_KEYS:
        "privacy-v1:phase33-privacy-material-canary-000000000001",
      RESEND_WEBHOOK_SECRET: "whsec_phase33-resend-canary-000000000001",
    } satisfies Readonly<Record<string, string | undefined>>;
    const values = collectSensitiveValues(environment);
    expect(values.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "PRIVACY_EXPORT_KEYS",
        "PRIVACY_EXPORT_KEYS:material",
        "RESEND_WEBHOOK_SECRET",
      ]),
    );
    expect(
      findSensitiveEvidenceFinding(
        `provider said ${environment.RESEND_WEBHOOK_SECRET}`,
        environment,
      ),
    ).toBe("configured:RESEND_WEBHOOK_SECRET");
  });

  it("redacts configured secrets, provider tokens and PII canaries before diagnostics", () => {
    const environment = {
      DOCUMENT_STORAGE_SECRET_ACCESS_KEY:
        "phase33-storage-secret-canary-000000000001",
    } satisfies Readonly<Record<string, string | undefined>>;
    const output = redactSensitiveEvidenceText(
      [
        environment.DOCUMENT_STORAGE_SECRET_ACCESS_KEY,
        "sk_live_phase33providersecret",
        "re_phase33ResendProviderSecret000001",
        "PII_EMAIL_CANARY@example.invalid",
      ].join(" "),
      environment,
    );
    expect(output).not.toContain(
      environment.DOCUMENT_STORAGE_SECRET_ACCESS_KEY,
    );
    expect(output).not.toContain("sk_live_phase33providersecret");
    expect(output).not.toContain("re_phase33ResendProviderSecret000001");
    expect(output).not.toContain("PII_EMAIL_CANARY@example.invalid");
    expect(findSensitiveEvidenceFinding(output, environment)).toBeNull();
  });
});
