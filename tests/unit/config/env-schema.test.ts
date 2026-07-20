import {
  EnvironmentValidationError,
  getSafeEnvironmentSummary,
  parseEnvironment,
} from "@/lib/config/env-schema";
import { resolve } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createRotatedAuditKeyring,
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";

describe("parseEnvironment", () => {
  it("parses a valid environment into typed values and key handles", () => {
    const environment = parseEnvironment(createValidEnvironment());

    expect(environment).toMatchObject({
      APP_ENV: "local",
      NODE_ENV: "test",
      RATE_LIMIT_BACKEND: "postgres",
      TRUSTED_PROXY_HOPS: 0,
      ENABLE_LOCAL_MOCK_MAILBOX: false,
    });
    const auditKeyring = environment.secrets.keyrings.AUDIT_IP_HASH_KEYS;
    expect(auditKeyring.map(({ version }) => version)).toEqual(["audit-v1"]);
    expect(auditKeyring[0]?.key.withValue((value) => value)).toBe(
      keyMaterial(2),
    );
    expect(
      environment.secrets.database.withValue((value) => value),
    ).toContain("swisstalenthub");
    expect(Object.isFrozen(auditKeyring[0]?.key)).toBe(true);
    expect(environment).not.toHaveProperty("AUDIT_IP_HASH_KEYS");
    expect(environment).not.toHaveProperty("DATABASE_URL");
    expect(environment).not.toHaveProperty("SESSION_SECRET");
    expect(Object.isFrozen(auditKeyring)).toBe(true);
    expectTypeOf(environment.secrets.database).not.toEqualTypeOf(
      environment.secrets.session,
    );
  });

  it("keeps the first keyring entry as writer and older entries readable", () => {
    const environment = parseEnvironment(
      createValidEnvironment({
        AUDIT_IP_HASH_KEYS: createRotatedAuditKeyring(),
      }),
    );

    const auditKeyring = environment.secrets.keyrings.AUDIT_IP_HASH_KEYS;
    expect(auditKeyring.map(({ version }) => version)).toEqual([
      "audit-v2",
      "audit-v1",
    ]);
    expect(
      auditKeyring.map(({ key }) => key.withValue((value) => value)),
    ).toEqual([keyMaterial(7), keyMaterial(2)]);
    expect(
      getSafeEnvironmentSummary(environment).keyringWriterVersions,
    ).toMatchObject({ AUDIT_IP_HASH_KEYS: "audit-v2" });
  });

  it.each([
    ["missing application environment", { APP_ENV: undefined }, "APP_ENV"],
    ["missing database URL", { DATABASE_URL: undefined }, "DATABASE_URL"],
    ["non-PostgreSQL database URL", { DATABASE_URL: "https://db.invalid" }, "DATABASE_URL"],
    ["malformed database URL", { DATABASE_URL: "not-a-url" }, "DATABASE_URL"],
    [
      "malformed encoded database path",
      { DATABASE_URL: "postgresql://db.invalid/%E0%A4%A" },
      "DATABASE_URL",
    ],
    [
      "malformed test database URL",
      { TEST_DATABASE_URL: "not-a-url" },
      "TEST_DATABASE_URL",
    ],
    [
      "malformed encoded test database path",
      { TEST_DATABASE_URL: "postgresql://db.invalid/%E0%A4%A" },
      "TEST_DATABASE_URL",
    ],
    [
      "application URL with credentials",
      { APP_URL: "https://user:secret@swisstalenthub.test/?token=leak" },
      "APP_URL",
    ],
    ["non-canonical session secret", { SESSION_SECRET: "not-base64" }, "SESSION_SECRET"],
    ["wrong session-secret byte length", { SESSION_SECRET: Buffer.alloc(31).toString("base64") }, "SESSION_SECRET"],
    ["malformed keyring entry", { AUDIT_IP_HASH_KEYS: keyMaterial(2) }, "AUDIT_IP_HASH_KEYS"],
    ["invalid key version", { AUDIT_IP_HASH_KEYS: `bad version:${keyMaterial(2)}` }, "AUDIT_IP_HASH_KEYS"],
    ["placeholder secret", { SESSION_SECRET: "REPLACE_WITH_BASE64_32_BYTES" }, "SESSION_SECRET"],
  ])(
    "rejects %s",
    (
      _name: string,
      overrides: Record<string, string | undefined>,
      expectedVariable: string,
    ) => {
    expectValidationFailure(overrides, expectedVariable);
    },
  );

  it("rejects duplicate versions within a keyring", () => {
    expectValidationFailure(
      {
        AUDIT_IP_HASH_KEYS: `audit-v1:${keyMaterial(2)},audit-v1:${keyMaterial(7)}`,
      },
      "contains duplicate version audit-v1",
    );
  });

  it("rejects reused key material across every secret and keyring", () => {
    expectValidationFailure(
      { RADAR_OPAQUE_LOOKUP_KEYS: `lookup-v1:${keyMaterial(2)}` },
      "must not reuse key material from AUDIT_IP_HASH_KEYS.audit-v1",
    );
    expectValidationFailure(
      { PII_REVEAL_KEYS: `reveal-v1:${keyMaterial(1)}` },
      "must not reuse key material from SESSION_SECRET",
    );
  });

  it.each(["production", "staging"] as const)(
    "enforces the shared rate-limit backend in %s",
    (appEnvironment: "production" | "staging") => {
      expectValidationFailure(
        {
          APP_ENV: appEnvironment,
          APP_URL: "https://swisstalenthub.test",
          RATE_LIMIT_BACKEND: "memory",
        },
        "RATE_LIMIT_BACKEND",
      );
    },
  );

  it.each(["production", "staging"] as const)(
    "requires an explicit trusted proxy topology in %s",
    (appEnvironment: "production" | "staging") => {
      expectValidationFailure(
        {
          APP_ENV: appEnvironment,
          APP_URL: "https://swisstalenthub.test",
          TRUSTED_PROXY_HOPS: "0",
        },
        "TRUSTED_PROXY_HOPS",
      );
      const environment = parseEnvironment(
        createValidEnvironment({
          APP_ENV: appEnvironment,
          APP_URL: "https://swisstalenthub.test",
          TRUSTED_PROXY_HOPS: "2",
          TEST_DATABASE_URL: undefined,
        }),
      );
      expect(environment.TRUSTED_PROXY_HOPS).toBe(2);
    },
  );

  it("reports a malformed production APP_URL as a validation error", () => {
    expectValidationFailure(
      {
        APP_ENV: "production",
        APP_URL: "not-a-url",
        TEST_DATABASE_URL: undefined,
      },
      "APP_URL",
    );
  });

  it.each(["production", "staging"] as const)(
    "requires HTTPS and disables the local mailbox in %s",
    (appEnvironment: "production" | "staging") => {
      expectValidationFailure(
        { APP_ENV: appEnvironment, APP_URL: "http://swisstalenthub.test" },
        "must use https",
      );
      expectValidationFailure(
        {
          APP_ENV: appEnvironment,
          APP_URL: "https://swisstalenthub.test",
          ENABLE_LOCAL_MOCK_MAILBOX: "true",
          DEV_MAILBOX_SECRET: Buffer.alloc(40, 10).toString("base64"),
        },
        "must be false",
      );
    },
  );

  it("requires a guarded secret when the local mailbox is enabled", () => {
    expectValidationFailure(
      {
        ENABLE_LOCAL_MOCK_MAILBOX: "true",
        DEV_MAILBOX_SECRET: "short",
      },
      "DEV_MAILBOX_SECRET",
    );

    const environment = parseEnvironment(
      createValidEnvironment({
        ENABLE_LOCAL_MOCK_MAILBOX: "true",
        DEV_MAILBOX_SECRET: Buffer.alloc(40, 11).toString("base64"),
      }),
    );
    expect(environment.ENABLE_LOCAL_MOCK_MAILBOX).toBe(true);
  });

  it("keeps the local mailbox closed in a production Node runtime", () => {
    expectValidationFailure(
      {
        APP_ENV: "local",
        NODE_ENV: "production",
        ENABLE_LOCAL_MOCK_MAILBOX: "true",
        DEV_MAILBOX_SECRET: Buffer.alloc(40, 11).toString("base64"),
      },
      "must be false in a production runtime",
    );

    const environment = parseEnvironment(
      createValidEnvironment({
        APP_ENV: "local",
        NODE_ENV: "production",
        ENABLE_LOCAL_MOCK_MAILBOX: "false",
      }),
    );
    expect(environment.APP_URL).toBe("http://127.0.0.1:3000");
  });

  it.each([
    "STRIPE_SECRET_KEY",
    "EMAIL_PROVIDER_API_KEY",
    "OPENAI_API_KEY",
    "STORAGE_ENDPOINT",
    "JOBROOM_API_URL",
    "MAPS_API_KEY",
  ])("keeps the future provider gate closed for %s", (variable: string) => {
    expectValidationFailure({ [variable]: "not-approved-yet" }, variable);
  });

  it("requires an isolated, explicitly labelled test database in CI", () => {
    expectValidationFailure(
      {
        APP_ENV: "ci",
        DATABASE_URL:
          "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub_ci?schema=public",
        TEST_DATABASE_URL: undefined,
      },
      "TEST_DATABASE_URL: is required in CI",
    );
    expectValidationFailure(
      {
        APP_ENV: "ci",
        DATABASE_URL:
          "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub?schema=public",
      },
      "DATABASE_URL: must name an explicitly CI- or test-labelled database in CI",
    );
    expectValidationFailure(
      {
        APP_ENV: "ci",
        DATABASE_URL:
          "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub_ci?schema=public",
        TEST_DATABASE_URL:
          "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub_ci?schema=public",
      },
      "TEST_DATABASE_URL: must be different from DATABASE_URL",
    );
    expectValidationFailure(
      {
        APP_ENV: "ci",
        DATABASE_URL:
          "postgresql://first:first@127.0.0.1:5432/swisstalenthub_ci?schema=public",
        TEST_DATABASE_URL:
          "postgresql://second:second@localhost:5432/swisstalenthub_ci?schema=public",
      },
      "TEST_DATABASE_URL: must be different from DATABASE_URL",
    );

    const environment = parseEnvironment(
      createValidEnvironment({
        APP_ENV: "ci",
        DATABASE_URL:
          "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub_ci?schema=public",
        TEST_DATABASE_URL:
          "postgresql://test:test-only@127.0.0.1:5435/swisstalenthub_test?schema=public",
      }),
    );
    expect(environment.APP_ENV).toBe("ci");
  });

  it("forbids test database credentials in staging and production", () => {
    expectValidationFailure(
      {
        APP_ENV: "production",
        APP_URL: "https://swisstalenthub.test",
      },
      "TEST_DATABASE_URL: must remain empty",
    );
  });

  it("requires an absolute backup identity path outside the repository", () => {
    expectValidationFailure(
      { BACKUP_AGE_IDENTITY_FILE: "ops/backup-identity.txt" },
      "BACKUP_AGE_IDENTITY_FILE",
    );
    expectValidationFailure(
      { BACKUP_AGE_IDENTITY_FILE: resolve("ops", "backup-identity.txt") },
      "BACKUP_AGE_IDENTITY_FILE",
    );

    const outsideRepository = resolve(
      process.cwd(),
      "..",
      "swisstalenthub-ops-keys",
      "backup-identity.txt",
    );
    const environment = parseEnvironment(
      createValidEnvironment({ BACKUP_AGE_IDENTITY_FILE: outsideRepository }),
    );
    expect(environment.BACKUP_AGE_IDENTITY_FILE).toBe(outsideRepository);
  });

  it("never includes supplied secret material in validation errors", () => {
    const secretCanary = "replace-this-secret-canary-verbatim";

    try {
      parseEnvironment(
        createValidEnvironment({
          SESSION_SECRET: secretCanary,
          AUDIT_IP_HASH_KEYS: `audit-v1:${secretCanary}`,
        }),
      );
      expect.unreachable("invalid secrets must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect(String(error)).not.toContain(secretCanary);
      expect(JSON.stringify(error)).not.toContain(secretCanary);
    }
  });

  it("returns a safe summary without raw secrets or connection strings", () => {
    const environment = parseEnvironment(createValidEnvironment());
    const summary = getSafeEnvironmentSummary(environment);
    const serialized = JSON.stringify(summary);
    const serializedEnvironment = JSON.stringify(environment);

    expect(summary.keyringWriterVersions).toMatchObject({
      AUDIT_IP_HASH_KEYS: "audit-v1",
      RADAR_OPAQUE_LOOKUP_KEYS: "lookup-v1",
      RADAR_OPAQUE_ENCRYPTION_KEYS: "opaque-v1",
      REVEAL_CONFIRMATION_KEYS: "confirm-v1",
      PII_REVEAL_KEYS: "reveal-v1",
    });
    expect(serialized).not.toContain(keyMaterial(1));
    expect(serialized).not.toContain("postgresql://");
    expect(serializedEnvironment).not.toContain(keyMaterial(1));
    expect(serializedEnvironment).not.toContain(keyMaterial(2));
    expect(serializedEnvironment).not.toContain("postgresql://");
    expect(serializedEnvironment).toContain("[secret-handle]");
  });
});

function expectValidationFailure(
  overrides: Record<string, string | undefined>,
  expectedMessage: string,
) {
  try {
    parseEnvironment(createValidEnvironment(overrides));
    expect.unreachable("environment validation should have failed");
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentValidationError);
    expect((error as EnvironmentValidationError).issues.join("; ")).toContain(
      expectedMessage,
    );
  }
}
