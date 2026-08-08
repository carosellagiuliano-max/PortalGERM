import { Buffer } from "node:buffer";

const keyMaterial = (seed: number) => Buffer.alloc(32, seed).toString("base64");

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
    NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(8)}`,
    NOTIFICATION_RECIPIENT_HASH_KEYS: `recipient-hash-v1:${keyMaterial(29)}`,
    DOCUMENT_STORAGE_KEYS: "",
    PRIVACY_EXPORT_KEYS: "",
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "0",
    IDENTITY_VERIFICATION_ENFORCEMENT:
      overrides.IDENTITY_VERIFICATION_ENFORCEMENT ??
      (["preview", "staging", "production"].includes(
        overrides.APP_ENV ?? "local",
      )
        ? "true"
        : "false"),
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    ABUSE_REPORT_ADMIN_EMAILS: "admin@demo.ch",
    LOG_LEVEL: "info",
    DOCUMENT_VAULT_WRITES: "false",
    DOCUMENT_STORAGE_MODE: "disabled",
    DOCUMENT_SCANNER_MODE: "disabled",
    DOCUMENT_CLEAN_READS: "false",
    DOCUMENT_RECONCILIATION: "disabled",
    DOCUMENT_BULK_ACCESS: "false",
    DOCUMENT_VAULT_COHORT: "none",
    DOCUMENT_STORAGE_ROOT: "",
    DOCUMENT_STORAGE_REGION: "local-test",
    COMPANY_TRUST_V2: "disabled",
    COMPANY_DOMAIN_CHALLENGE: "false",
    COMPANY_REGISTER_CHECK: "false",
    COMPANY_VERIFICATION_DOCUMENT: "false",
    COMPANY_STRONG_BADGE: "false",
    COMPANY_TRUST_PUBLIC_ELIGIBILITY: "false",
    COMPANY_TRUST_RAPID_REVOKE: "false",
    LEGACY_COMPANY_REVERIFY: "false",
    COMPANY_REGISTER_PROVIDER_MODE: "disabled",
    COMPANY_DOMAIN_PROVIDER_MODE: "disabled",
    COMPANY_VERIFICATION_COHORT: "none",
    IDENTITY_PERSONA_V2: "disabled",
    EXTERNAL_APPLICATION_TRACKER: "disabled",
    INTERVIEW_SCHEDULER: "disabled",
    EXISTING_IDENTITY_INVITATION: "false",
    PERSONA_PORTAL_SWITCH: "false",
    PERSONA_PRIVACY_V2: "false",
    PERSONA_LEGACY_CONTRACT: "false",
    LEGAL_PUBLICATION_PRIVACY: "false",
    LEGAL_PUBLICATION_TERMS: "false",
    LEGAL_PUBLICATION_IMPRINT: "false",
    PRIVACY_EXPORT_V2: "false",
    PRIVACY_CORRECTION_EXECUTION: "false",
    PRIVACY_ERASURE_EXECUTION: "false",
    PRIVACY_PROCESSING_MODE: "disabled",
    PRIVACY_PROCESSING_COHORT: "none",
    PRIVACY_EXPORT_STORAGE_MODE: "disabled",
    PRIVACY_EXPORT_STORAGE_ROOT: "",
    PRIVACY_EXPORT_STORAGE_REGION: "local-test",
    PRIVACY_PROVIDER_POSTGRES: "false",
    PRIVACY_PROVIDER_DOCUMENTS: "false",
    PRIVACY_PROVIDER_EMAIL: "false",
    PRIVACY_PROVIDER_PAYMENT: "false",
    PRIVACY_PROVIDER_ANALYTICS: "false",
    PRIVACY_PROVIDER_BACKUP: "false",
    OPTIONAL_ANALYTICS_NAVIGATION: "false",
    OPTIONAL_ANALYTICS_CONVERSION: "false",
    SEARCH_LEARNING_COLLECTION: "false",
    SEARCH_LEARNING_HASH_SECRET: "",
    PAYMENT_PROVIDER_MODE: "disabled",
    PAYMENT_SANDBOX_COHORT: "none",
    REAL_PAYMENT_INGESTION: "false",
    REAL_PAYMENT_PROJECTION: "false",
    PAID_SELF_SERVICE: "false",
    FINANCE_REPAIR_ACTIONS: "false",
    PAID_SERVICE_RECOVERY: "false",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_ACCOUNT_ID: "",
    STRIPE_SECRET_VERSION: "",
    ...overrides,
  } satisfies Record<string, string | undefined>;
}

export function createRotatedAuditKeyring() {
  return `audit-v2:${keyMaterial(7)},audit-v1:${keyMaterial(2)}`;
}

export { keyMaterial };
