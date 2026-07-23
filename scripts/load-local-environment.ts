import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

const EXPLICIT_RUNTIME_VARIABLES = [
  "APP_ENV",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "APP_URL",
  "NEXT_PUBLIC_APP_NAME",
  "APP_BUILD_ID",
  "SESSION_SECRET",
  "AUDIT_IP_HASH_KEYS",
  "RADAR_OPAQUE_LOOKUP_KEYS",
  "RADAR_OPAQUE_ENCRYPTION_KEYS",
  "REVEAL_CONFIRMATION_KEYS",
  "PII_REVEAL_KEYS",
  "RATE_LIMIT_BACKEND",
  "ENABLE_LOCAL_MOCK_MAILBOX",
  "DEV_MAILBOX_SECRET",
  "ABUSE_REPORT_ADMIN_EMAILS",
  "LOG_LEVEL",
  "BACKUP_AGE_RECIPIENT",
  "BACKUP_AGE_IDENTITY_FILE",
  "STRIPE_SECRET_KEY",
  "EMAIL_PROVIDER_API_KEY",
  "OPENAI_API_KEY",
  "STORAGE_ENDPOINT",
  "JOBROOM_API_URL",
  "MAPS_API_KEY",
] as const;

export function loadLocalEnvironment() {
  const explicitVariables = EXPLICIT_RUNTIME_VARIABLES.filter(
    (name) => process.env[name] !== undefined,
  );

  if (explicitVariables.length > 0) {
    if (
      process.env.APP_ENV === undefined ||
      process.env.DATABASE_URL === undefined ||
      process.env.APP_URL === undefined
    ) {
      throw new Error(
        "Explicit runtime configuration must provide APP_ENV, DATABASE_URL and APP_URL together; local files were not mixed in.",
      );
    }
    return;
  }

  const localPath = resolve(process.cwd(), ".env.local");
  if (existsSync(localPath)) {
    config({ path: localPath, override: false, quiet: true });
  }

  const defaultPath = resolve(process.cwd(), ".env");
  if (existsSync(defaultPath)) {
    config({ path: defaultPath, override: false, quiet: true });
  }
}
