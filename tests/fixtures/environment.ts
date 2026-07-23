import { Buffer } from "node:buffer";

const keyMaterial = (seed: number) =>
  Buffer.alloc(32, seed).toString("base64");

export function createValidEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    APP_ENV: "local",
    NODE_ENV: "test",
    DATABASE_URL:
      "postgresql://app:local-only@127.0.0.1:5434/swisstalenthub?schema=public",
    TEST_DATABASE_URL:
      "postgresql://app_test:test-only@127.0.0.1:5435/swisstalenthub_test?schema=public",
    APP_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_APP_NAME: "SwissTalentHub",
    APP_BUILD_ID: "test-build",
    SESSION_SECRET: keyMaterial(1),
    AUDIT_IP_HASH_KEYS: `audit-v1:${keyMaterial(2)}`,
    RADAR_OPAQUE_LOOKUP_KEYS: `lookup-v1:${keyMaterial(3)}`,
    RADAR_OPAQUE_ENCRYPTION_KEYS: `opaque-v1:${keyMaterial(4)}`,
    REVEAL_CONFIRMATION_KEYS: `confirm-v1:${keyMaterial(5)}`,
    PII_REVEAL_KEYS: `reveal-v1:${keyMaterial(6)}`,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    ABUSE_REPORT_ADMIN_EMAILS: "admin@demo.ch",
    LOG_LEVEL: "info",
    ...overrides,
  } satisfies Record<string, string | undefined>;
}

export function createRotatedAuditKeyring() {
  return `audit-v2:${keyMaterial(7)},audit-v1:${keyMaterial(2)}`;
}

export { keyMaterial };
