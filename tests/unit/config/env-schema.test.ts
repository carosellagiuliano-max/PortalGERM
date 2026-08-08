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
      APP_BUILD_ID: "test-build",
    });
    const auditKeyring = environment.secrets.keyrings.AUDIT_IP_HASH_KEYS;
    expect(auditKeyring.map(({ version }) => version)).toEqual(["audit-v1"]);
    expect(auditKeyring[0]?.key.withValue((value) => value)).toBe(
      keyMaterial(2),
    );
    expect(environment.secrets.database.withValue((value) => value)).toContain(
      "swisstalenthub",
    );
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
    [
      "non-PostgreSQL database URL",
      { DATABASE_URL: "https://db.invalid" },
      "DATABASE_URL",
    ],
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
    [
      "non-canonical session secret",
      { SESSION_SECRET: "not-base64" },
      "SESSION_SECRET",
    ],
    [
      "wrong session-secret byte length",
      { SESSION_SECRET: Buffer.alloc(31).toString("base64") },
      "SESSION_SECRET",
    ],
    [
      "malformed keyring entry",
      { AUDIT_IP_HASH_KEYS: keyMaterial(2) },
      "AUDIT_IP_HASH_KEYS",
    ],
    [
      "invalid key version",
      { AUDIT_IP_HASH_KEYS: `bad version:${keyMaterial(2)}` },
      "AUDIT_IP_HASH_KEYS",
    ],
    [
      "placeholder secret",
      { SESSION_SECRET: "REPLACE_WITH_BASE64_32_BYTES" },
      "SESSION_SECRET",
    ],
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

  it("bounds retained notification keys so a 50-recipient webhook fits the inbox contract", () => {
    expectValidationFailure(
      {
        NOTIFICATION_RECIPIENT_HASH_KEYS: Array.from(
          { length: 6 },
          (_, index) =>
            `recipient-hash-v${index + 1}:${keyMaterial(index + 20)}`,
        ).join(","),
      },
      "must contain at most 5 retained keys",
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

  it("validates the non-secret build identifier", () => {
    expectValidationFailure({ APP_BUILD_ID: "bad build/id" }, "APP_BUILD_ID");

    const environment = parseEnvironment(
      createValidEnvironment({ APP_BUILD_ID: "git-abc1234" }),
    );
    expect(environment.APP_BUILD_ID).toBe("git-abc1234");
    expect(getSafeEnvironmentSummary(environment).buildIdentifier).toBe(
      "git-abc1234",
    );
  });

  it.each(["production", "staging"] as const)(
    "requires a commit-unique build identifier in %s",
    (appEnvironment: "production" | "staging") => {
      expectValidationFailure(
        {
          APP_ENV: appEnvironment,
          APP_URL: "https://swisstalenthub.test",
          TRUSTED_PROXY_HOPS: "2",
          TEST_DATABASE_URL: undefined,
          APP_BUILD_ID: undefined,
        },
        "must be a commit-unique non-secret identifier",
      );
    },
  );

  it.each(["preview", "production", "staging"] as const)(
    "requires an explicit trusted proxy topology in %s",
    (appEnvironment: "preview" | "production" | "staging") => {
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
          NOTIFICATION_OUTBOX_PRODUCERS: "true",
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

  it("fails closed when identity gates could lock users without durable delivery", () => {
    expectValidationFailure(
      {
        IDENTITY_VERIFICATION_ENFORCEMENT: "true",
        NOTIFICATION_OUTBOX_PRODUCERS: "false",
      },
      "IDENTITY_VERIFICATION_ENFORCEMENT",
    );
    expectValidationFailure(
      {
        LOGIN_EMAIL_CHANGE: "true",
        IDENTITY_VERIFICATION_ENFORCEMENT: "false",
        NOTIFICATION_OUTBOX_PRODUCERS: "true",
      },
      "LOGIN_EMAIL_CHANGE",
    );
    for (const appEnvironment of ["preview", "staging", "production"]) {
      expectValidationFailure(
        {
          APP_ENV: appEnvironment,
          APP_URL: "https://swisstalenthub.test",
          TRUSTED_PROXY_HOPS: "1",
          IDENTITY_VERIFICATION_ENFORCEMENT: "false",
        },
        "IDENTITY_VERIFICATION_ENFORCEMENT",
      );
    }
  });

  it("normalizes, freezes and safely summarizes the abuse-report distribution", () => {
    const environment = parseEnvironment(
      createValidEnvironment({
        ABUSE_REPORT_ADMIN_EMAILS: " Security@Example.Test,ops@example.test ",
      }),
    );

    expect(environment.ABUSE_REPORT_ADMIN_EMAILS).toEqual([
      "security@example.test",
      "ops@example.test",
    ]);
    expect(Object.isFrozen(environment.ABUSE_REPORT_ADMIN_EMAILS)).toBe(true);
    expect(
      getSafeEnvironmentSummary(environment).abuseReportAdminRecipientCount,
    ).toBe(2);
  });

  it("rejects duplicate abuse-report recipients after normalization", () => {
    expectValidationFailure(
      {
        ABUSE_REPORT_ADMIN_EMAILS:
          "security@example.test,SECURITY@example.test",
      },
      "must not contain duplicate recipients",
    );
  });

  it.each(["production", "staging"] as const)(
    "requires an abuse-report distribution in %s",
    (appEnvironment: "production" | "staging") => {
      expectValidationFailure(
        {
          APP_ENV: appEnvironment,
          APP_URL: "https://swisstalenthub.test",
          TRUSTED_PROXY_HOPS: "2",
          TEST_DATABASE_URL: undefined,
          ABUSE_REPORT_ADMIN_EMAILS: undefined,
        },
        "must configure at least one abuse-report recipient",
      );
    },
  );

  it("keeps the local mailbox closed while allowing a digest-bound local provider sink in a production Node runtime", () => {
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
        APP_BUILD_ID: "a".repeat(64),
        ENABLE_LOCAL_MOCK_MAILBOX: "false",
        DEV_MAILBOX_SECRET: "",
        EMAIL_PROVIDER_MODE: "local_mock",
        NOTIFICATION_DISPATCH: "command",
        PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT: "false",
      }),
    );
    expect(environment.APP_URL).toBe("http://127.0.0.1:3000");
    expect(environment.ENABLE_LOCAL_MOCK_MAILBOX).toBe(false);
    expect(environment.EMAIL_PROVIDER_MODE).toBe("local_mock");
    expect(environment.PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT).toBe(false);
  });

  it("permits only the exact loopback-bound Phase-33 local/mock production-build contract", () => {
    const exact = parseEnvironment(
      createValidEnvironment({
        APP_ENV: "local",
        NODE_ENV: "production",
        APP_URL: "http://127.0.0.1:3300",
        APP_BUILD_ID: "a".repeat(40),
        ENABLE_LOCAL_MOCK_MAILBOX: "true",
        PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT: "true",
        DEV_MAILBOX_SECRET: Buffer.alloc(40, 33).toString("base64"),
        EMAIL_PROVIDER_MODE: "local_mock",
        NOTIFICATION_OUTBOX_PRODUCERS: "true",
        NOTIFICATION_DISPATCH: "command",
        NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(33)}`,
      }),
    );
    expect(exact.PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT).toBe(true);

    for (const override of [
      { APP_URL: "http://192.0.2.10:3300" },
      { APP_BUILD_ID: "not-a-full-candidate" },
      { PAYMENT_PROVIDER_MODE: "stripe_sandbox" },
    ]) {
      expectValidationFailure(
        {
          APP_ENV: "local",
          NODE_ENV: "production",
          APP_URL: "http://127.0.0.1:3300",
          APP_BUILD_ID: "a".repeat(40),
          ENABLE_LOCAL_MOCK_MAILBOX: "true",
          PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT: "true",
          DEV_MAILBOX_SECRET: Buffer.alloc(40, 33).toString("base64"),
          EMAIL_PROVIDER_MODE: "local_mock",
          NOTIFICATION_OUTBOX_PRODUCERS: "true",
          NOTIFICATION_DISPATCH: "command",
          NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(33)}`,
          ...override,
        },
        "requires the exact loopback-only Phase-33 Local production-build contract",
      );
    }
  });

  it("keeps the Phase-23 worker and replay gates paused by default", () => {
    const environment = parseEnvironment(createValidEnvironment());
    expect(environment.WORKER_RUNTIME).toBe("paused");
    expect(environment.WORKER_SANDBOX_REPLAY).toBe(false);
    expect(getSafeEnvironmentSummary(environment)).toMatchObject({
      workerRuntime: "paused",
      workerSandboxReplayEnabled: false,
    });
  });

  it("allows worker sandbox replay only in an explicit Local/CI command runtime", () => {
    expectValidationFailure(
      {
        WORKER_SANDBOX_REPLAY: "true",
        WORKER_RUNTIME: "paused",
      },
      "WORKER_SANDBOX_REPLAY",
    );
    expectValidationFailure(
      {
        APP_ENV: "staging",
        APP_URL: "https://swisstalenthub.test",
        TRUSTED_PROXY_HOPS: "2",
        TEST_DATABASE_URL: undefined,
        WORKER_RUNTIME: "sandbox_command",
      },
      "WORKER_RUNTIME",
    );
    const environment = parseEnvironment(
      createValidEnvironment({
        WORKER_RUNTIME: "sandbox_command",
        WORKER_SANDBOX_REPLAY: "true",
      }),
    );
    expect(environment.WORKER_SANDBOX_REPLAY).toBe(true);
  });

  it.each([
    "EMAIL_PROVIDER_API_KEY",
    "OPENAI_API_KEY",
    "STORAGE_ENDPOINT",
    "JOBROOM_API_URL",
    "MAPS_API_KEY",
  ])("keeps the future provider gate closed for %s", (variable: string) => {
    expectValidationFailure({ [variable]: "not-approved-yet" }, variable);
  });

  it("requires a purpose-separated secret before Phase-30 search learning can collect", () => {
    expectValidationFailure(
      { SEARCH_LEARNING_COLLECTION: "true" },
      "SEARCH_LEARNING_HASH_SECRET",
    );
    expectValidationFailure(
      {
        SEARCH_LEARNING_COLLECTION: "true",
        SEARCH_LEARNING_HASH_SECRET: keyMaterial(1),
      },
      "SEARCH_LEARNING_HASH_SECRET",
    );

    const environment = parseEnvironment(
      createValidEnvironment({
        SEARCH_LEARNING_COLLECTION: "true",
        SEARCH_LEARNING_HASH_SECRET: keyMaterial(9),
      }),
    );
    expect(environment.SEARCH_LEARNING_COLLECTION).toBe(true);
    expect(
      environment.secrets.searchLearningHash?.withValue((value) => value),
    ).toBe(keyMaterial(9));
    expect(JSON.stringify(environment)).not.toContain(keyMaterial(9));
  });

  it("keeps payments disabled by default and permits only an isolated Stripe test sandbox", () => {
    const disabled = parseEnvironment(createValidEnvironment());
    expect(disabled.PAYMENT_PROVIDER_MODE).toBe("disabled");
    expect(disabled.REAL_PAYMENT_INGESTION).toBe(false);
    expect(disabled.REAL_PAYMENT_PROJECTION).toBe(false);
    expect(disabled.PAID_SELF_SERVICE).toBe(false);
    expect(disabled.secrets.stripeSecretKey).toBeUndefined();
    expect(disabled.secrets.stripeWebhookSecret).toBeUndefined();

    expectValidationFailure(
      { STRIPE_SECRET_KEY: "sk_test_not_configured" },
      "PAYMENT_PROVIDER_MODE",
    );
    expectValidationFailure(
      {
        PAYMENT_PROVIDER_MODE: "stripe_sandbox",
        STRIPE_SECRET_KEY: "sk_live_forbidden123",
        STRIPE_WEBHOOK_SECRET: "whsec_12345678",
        STRIPE_ACCOUNT_ID: "acct_12345678",
        STRIPE_SECRET_VERSION: "test-v1",
      },
      "STRIPE_SECRET_KEY",
    );
    expectValidationFailure(
      {
        PAYMENT_PROVIDER_MODE: "stripe_sandbox",
        STRIPE_SECRET_KEY: "sk_test_12345678",
        STRIPE_WEBHOOK_SECRET: "whsec_12345678",
        STRIPE_ACCOUNT_ID: "acct_12345678",
        STRIPE_SECRET_VERSION: "test-v1",
        REAL_PAYMENT_PROJECTION: "true",
      },
      "REAL_PAYMENT_PROJECTION",
    );
    expectValidationFailure(
      {
        APP_ENV: "production",
        NODE_ENV: "production",
        APP_URL: "https://swisstalenthub.test",
        TRUSTED_PROXY_HOPS: "2",
        TEST_DATABASE_URL: undefined,
        PAYMENT_PROVIDER_MODE: "stripe_sandbox",
        STRIPE_SECRET_KEY: "sk_test_12345678",
        STRIPE_WEBHOOK_SECRET: "whsec_12345678",
        STRIPE_ACCOUNT_ID: "acct_12345678",
        STRIPE_SECRET_VERSION: "test-v1",
      },
      "PAYMENT_PROVIDER_MODE",
    );

    const sandbox = parseEnvironment(
      createValidEnvironment({
        PAYMENT_PROVIDER_MODE: "stripe_sandbox",
        PAYMENT_SANDBOX_COHORT: "test",
        STRIPE_SECRET_KEY: "sk_test_12345678",
        STRIPE_WEBHOOK_SECRET: "whsec_12345678",
        STRIPE_ACCOUNT_ID: "acct_12345678",
        STRIPE_SECRET_VERSION: "test-v1",
        REAL_PAYMENT_INGESTION: "true",
        REAL_PAYMENT_PROJECTION: "true",
        PAID_SELF_SERVICE: "true",
        PAID_SERVICE_RECOVERY: "true",
      }),
    );
    expect(sandbox.PAYMENT_PROVIDER_MODE).toBe("stripe_sandbox");
    expect(sandbox.PAID_SELF_SERVICE).toBe(true);
    expect(String(sandbox.secrets.stripeSecretKey)).toBe("[secret-handle]");
    expect(String(sandbox.secrets.stripeWebhookSecret)).toBe("[secret-handle]");
  });

  it("keeps every Phase-31 commercial switch default-closed and Local/CI-only", () => {
    const disabled = parseEnvironment(createValidEnvironment());
    expect(disabled.COMMERCIAL_PRODUCTION_OFFERS).toBe(false);
    expect(disabled.COMMERCIAL_MANAGED_IMPORT).toBe(false);
    expect(disabled.COMMERCIAL_BOOST).toBe(false);
    expect(disabled.COMMERCIAL_PAID_RADAR).toBe(false);
    expect(disabled.COMMERCIAL_SALARY).toBe(false);

    expectValidationFailure(
      {
        APP_ENV: "production",
        NODE_ENV: "production",
        APP_URL: "https://swisstalenthub.test",
        TRUSTED_PROXY_HOPS: "2",
        TEST_DATABASE_URL: undefined,
        COMMERCIAL_PRODUCTION_OFFERS: "true",
      },
      "COMMERCIAL_PRODUCTION_OFFERS",
    );
    expectValidationFailure(
      { COMMERCIAL_BOOST: "true" },
      "COMMERCIAL_PRODUCTION_OFFERS",
    );

    const technical = parseEnvironment(
      createValidEnvironment({
        COMMERCIAL_PRODUCTION_OFFERS: "true",
        COMMERCIAL_MANAGED_IMPORT: "true",
        COMMERCIAL_BOOST: "true",
        COMMERCIAL_PAID_RADAR: "true",
        COMMERCIAL_SALARY: "true",
      }),
    );
    expect(getSafeEnvironmentSummary(technical)).toMatchObject({
      commercialProductionOffersEnabled: true,
      commercialManagedImportEnabled: true,
      commercialBoostEnabled: true,
      commercialPaidRadarEnabled: true,
      commercialSalaryEnabled: true,
    });
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
