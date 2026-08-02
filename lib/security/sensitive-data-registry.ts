const KEYRING_VARIABLES = [
  "AUDIT_IP_HASH_KEYS",
  "RADAR_OPAQUE_LOOKUP_KEYS",
  "RADAR_OPAQUE_ENCRYPTION_KEYS",
  "REVEAL_CONFIRMATION_KEYS",
  "PII_REVEAL_KEYS",
  "NOTIFICATION_DELIVERY_KEYS",
  "NOTIFICATION_RECIPIENT_HASH_KEYS",
  "DOCUMENT_STORAGE_KEYS",
  "PRIVACY_EXPORT_KEYS",
] as const;

const PROVIDER_SECRET_VARIABLES = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "EMAIL_PROVIDER_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "DOCUMENT_STORAGE_ACCESS_KEY_ID",
  "DOCUMENT_STORAGE_SECRET_ACCESS_KEY",
  "DOCUMENT_STORAGE_SESSION_TOKEN",
  "OPENAI_API_KEY",
  "MAPS_API_KEY",
] as const;

/**
 * One canonical registry for values that must never cross a diagnostic,
 * evidence, artifact or child-process boundary. Keep names here even when a
 * provider is disabled so scanners cannot silently drift behind env parsing.
 */
export const APPLICATION_SENSITIVE_ENVIRONMENT_VARIABLES = Object.freeze([
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "SESSION_SECRET",
  "SEARCH_LEARNING_HASH_SECRET",
  "DEV_MAILBOX_SECRET",
  ...KEYRING_VARIABLES,
  ...PROVIDER_SECRET_VARIABLES,
  "STORAGE_ENDPOINT",
  "JOBROOM_API_URL",
] as const);

export const SENSITIVE_ENVIRONMENT_VARIABLES = Object.freeze([
  ...APPLICATION_SENSITIVE_ENVIRONMENT_VARIABLES,
  "BACKUP_AGE_IDENTITY_FILE",
  "PHASE33_SESSION_SECRET",
  "PHASE33_AUDIT_IP_HASH_KEYS",
  "PHASE33_RADAR_OPAQUE_LOOKUP_KEYS",
  "PHASE33_RADAR_OPAQUE_ENCRYPTION_KEYS",
  "PHASE33_REVEAL_CONFIRMATION_KEYS",
  "PHASE33_PII_REVEAL_KEYS",
  "PHASE33_NOTIFICATION_DELIVERY_KEYS",
  "PHASE33_NOTIFICATION_RECIPIENT_HASH_KEYS",
  "PHASE33_DOCUMENT_STORAGE_KEYS",
  "PHASE33_PRIVACY_EXPORT_KEYS",
  "PHASE33_DEV_MAILBOX_SECRET",
  "PHASE33_RESEND_API_KEY",
  "PHASE33_RESEND_WEBHOOK_SECRET",
  "PHASE33_STRIPE_SECRET_KEY",
  "PHASE33_STRIPE_WEBHOOK_SECRET",
  "PHASE33_MINIO_ROOT_USER",
  "PHASE33_MINIO_ROOT_PASSWORD",
  "PHASE33_MINIO_KMS_SECRET_KEY",
] as const);

export const SENSITIVE_KEYRING_VARIABLES = Object.freeze([
  ...KEYRING_VARIABLES,
  ...KEYRING_VARIABLES.map((name) => `PHASE33_${name}` as const),
]);

export type SensitiveEnvironmentVariable =
  (typeof SENSITIVE_ENVIRONMENT_VARIABLES)[number];

export type SensitiveValue = Readonly<{
  name: string;
  value: string;
}>;

type SensitiveEnvironment = Readonly<Record<string, string | undefined>>;

export function collectSensitiveValues(
  environment: SensitiveEnvironment,
  minimumLength = 8,
): readonly SensitiveValue[] {
  const values = new Map<string, string>();
  for (const name of SENSITIVE_ENVIRONMENT_VARIABLES) {
    const value = environment[name]?.trim();
    if (value === undefined || value.length < minimumLength) continue;
    values.set(value, name);
    if (!name.endsWith("_KEYS")) continue;
    for (const entry of value.split(",")) {
      const separator = entry.indexOf(":");
      if (separator < 0) continue;
      const material = entry.slice(separator + 1).trim();
      if (material.length >= minimumLength) {
        values.set(material, `${name}:material`);
      }
    }
  }
  return Object.freeze(
    [...values.entries()]
      .map(([value, name]) => Object.freeze({ name, value }))
      .sort((left, right) => right.value.length - left.value.length),
  );
}

const HIGH_CONFIDENCE_SENSITIVE_PATTERNS = Object.freeze([
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u,
  /AGE-SECRET-KEY-[A-Z0-9-]+/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /postgres(?:ql)?:\/\/[^\s"']+/iu,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/u,
  /\b(?:sk_live_|sk_test_|whsec_)[A-Za-z0-9+/_=-]{8,}\b/u,
  /\bre_[A-Za-z0-9_-]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bPII_[A-Z0-9][A-Z0-9_@.+:-]{2,}\b/u,
]);

export function findSensitiveEvidenceFinding(
  value: string,
  environment: SensitiveEnvironment = process.env,
): string | null {
  const exact = collectSensitiveValues(environment).find(({ value: secret }) =>
    value.includes(secret),
  );
  if (exact !== undefined) return `configured:${exact.name}`;
  const patternIndex = HIGH_CONFIDENCE_SENSITIVE_PATTERNS.findIndex((pattern) =>
    pattern.test(value),
  );
  return patternIndex < 0 ? null : `pattern:${patternIndex + 1}`;
}

export function redactSensitiveEvidenceText(
  value: string,
  environment: SensitiveEnvironment = process.env,
): string {
  let redacted = value;
  for (const { value: secret } of collectSensitiveValues(environment)) {
    redacted = redacted.replaceAll(secret, "[REDACTED_CONFIGURED_SECRET]");
  }
  return redacted
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(/AGE-SECRET-KEY-[A-Z0-9-]+/gu, "[REDACTED_AGE_IDENTITY]")
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replaceAll(
      /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/gu,
      "[REDACTED_PROVIDER_TOKEN]",
    )
    .replaceAll(
      /\b(?:sk_live_|sk_test_|whsec_)[A-Za-z0-9+/_=-]{8,}\b/gu,
      "[REDACTED_PROVIDER_SECRET]",
    )
    .replaceAll(/\bre_[A-Za-z0-9_-]{20,}\b/gu, "[REDACTED_PROVIDER_SECRET]")
    .replaceAll(/\bAKIA[0-9A-Z]{16}\b/gu, "[REDACTED_ACCESS_KEY]")
    .replaceAll(
      /\bPII_[A-Z0-9][A-Z0-9_@.+:-]{2,}\b/gu,
      "[REDACTED_PII_CANARY]",
    );
}
