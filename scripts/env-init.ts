import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { parseEnvironment } from "@/lib/config/env-schema";
import { inspectPostgresTarget } from "@/lib/db/database-target";

const argumentsSet = new Set(process.argv.slice(2));
const ciMode = process.env.CI === "true" || argumentsSet.has("--ci");
const nonInteractive = argumentsSet.has("--non-interactive") || ciMode;

if (
  process.env.NODE_ENV === "production" ||
  process.env.APP_ENV === "production" ||
  process.env.APP_ENV === "staging"
) {
  throw new Error("env:init refuses Production and Staging environments.");
}

if (ciMode) {
  if (process.env.APP_ENV !== "ci") {
    throw new Error("env:init --ci requires APP_ENV=ci.");
  }
  parseEnvironment(process.env);
  console.info("CI environment validated; no file was written.");
  process.exit(0);
}

if (process.env.APP_ENV !== undefined && process.env.APP_ENV !== "local") {
  throw new Error("env:init only runs in an explicitly local environment.");
}

const unsafeOverrides = ["DATABASE_URL", "TEST_DATABASE_URL", "APP_URL"].filter(
  (name) => process.env[name] !== undefined,
);
if (unsafeOverrides.length > 0) {
  throw new Error(
    `env:init does not inherit URL overrides (${unsafeOverrides.join(", ")}); unset them and edit the generated local file deliberately if required.`,
  );
}

const targetPath = resolve(process.cwd(), ".env.local");
if (existsSync(targetPath)) {
  throw new Error(".env.local already exists; env:init never overwrites it.");
}

let urls = {
  databaseUrl:
    "postgresql://swisstalenthub:local-development-only@127.0.0.1:5434/swisstalenthub?schema=public",
  testDatabaseUrl:
    "postgresql://swisstalenthub_test:local-test-only@127.0.0.1:5435/swisstalenthub_test?schema=public",
  appUrl: "http://127.0.0.1:3000",
};

if (!nonInteractive && stdin.isTTY && stdout.isTTY) {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const confirmation = await prompt.question(
      "Sichere lokale PostgreSQL-Ziele auf Loopback 5434/5435 verwenden? [J/n] ",
    );
    if (confirmation.trim().toLowerCase() === "n") {
      throw new Error(
        "env:init was cancelled; it never accepts or echoes a credential-bearing URL.",
      );
    }
    urls = {
      databaseUrl: urls.databaseUrl,
      testDatabaseUrl: urls.testDatabaseUrl,
      appUrl: await askWithDefault(prompt, "Lokale APP_URL", urls.appUrl),
    };
  } finally {
    prompt.close();
  }
}

const secret = () => randomBytes(32).toString("base64");
const values: Record<string, string> = {
  APP_ENV: "local",
  NODE_ENV: "development",
  DATABASE_URL: urls.databaseUrl,
  TEST_DATABASE_URL: urls.testDatabaseUrl,
  APP_URL: urls.appUrl,
  NEXT_PUBLIC_APP_NAME: "SwissTalentHub",
  APP_BUILD_ID: "local-development",
  SESSION_SECRET: secret(),
  AUDIT_IP_HASH_KEYS: `v1:${secret()}`,
  RADAR_OPAQUE_LOOKUP_KEYS: `v1:${secret()}`,
  RADAR_OPAQUE_ENCRYPTION_KEYS: `v1:${secret()}`,
  REVEAL_CONFIRMATION_KEYS: `v1:${secret()}`,
  PII_REVEAL_KEYS: `v1:${secret()}`,
  NOTIFICATION_DELIVERY_KEYS: `v1:${secret()}`,
  DOCUMENT_STORAGE_KEYS: "",
  PRIVACY_EXPORT_KEYS: "",
  RATE_LIMIT_BACKEND: "postgres",
  TRUSTED_PROXY_HOPS: "0",
  ENABLE_LOCAL_MOCK_MAILBOX: "false",
  DEV_MAILBOX_SECRET: randomBytes(32).toString("base64url"),
  IDENTITY_VERIFICATION_ENFORCEMENT: "false",
  LOGIN_EMAIL_CHANGE: "false",
  ADMIN_MFA_REQUIRED: "false",
  PRIVILEGED_STEP_UP_MODE: "disabled",
  TRUST_RISK_MODE: "observe",
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
  BREAK_GLASS_ENABLED: "false",
  NOTIFICATION_OUTBOX_PRODUCERS: "false",
  EMAIL_PROVIDER_MODE: "disabled",
  NOTIFICATION_DISPATCH: "paused",
  OPTIONAL_EMAIL: "false",
  DELIVERY_REPLAY: "false",
  WORKER_RUNTIME: "paused",
  WORKER_SANDBOX_REPLAY: "false",
  EMAIL_FROM: "",
  ABUSE_REPORT_ADMIN_EMAILS: "admin@demo.ch",
  LOG_LEVEL: "info",
  BACKUP_AGE_RECIPIENT: "",
  BACKUP_AGE_IDENTITY_FILE: "",
  STRIPE_SECRET_KEY: "",
  EMAIL_PROVIDER_API_KEY: "",
  OPENAI_API_KEY: "",
  STORAGE_ENDPOINT: "",
  DOCUMENT_VAULT_WRITES: "false",
  DOCUMENT_STORAGE_MODE: "disabled",
  DOCUMENT_SCANNER_MODE: "disabled",
  DOCUMENT_CLEAN_READS: "false",
  DOCUMENT_RECONCILIATION: "disabled",
  DOCUMENT_BULK_ACCESS: "false",
  DOCUMENT_VAULT_COHORT: "none",
  DOCUMENT_STORAGE_ROOT: "",
  DOCUMENT_STORAGE_REGION: "local-test",
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
  JOBROOM_API_URL: "",
  MAPS_API_KEY: "",
};

assertSafeLocalDatabaseUrls(urls.databaseUrl, urls.testDatabaseUrl);
parseEnvironment(values);

const file = `${Object.entries(values)
  .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
  .join("\n")}\n`;

await writeFile(targetPath, file, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});

console.info(
  `Created ignored .env.local with ${Object.keys(values).join(", ")}. Values were not printed.`,
);

async function askWithDefault(
  prompt: ReturnType<typeof createInterface>,
  label: string,
  fallback: string,
) {
  const answer = await prompt.question(`${label} [Enter = Standard]: `);
  return answer.trim() === "" ? fallback : answer.trim();
}

function assertSafeLocalDatabaseUrls(
  databaseUrl: string,
  testDatabaseUrl: string,
) {
  const application = inspectPostgresTarget(databaseUrl);
  const test = inspectPostgresTarget(testDatabaseUrl);
  if (
    application === undefined ||
    test === undefined ||
    application.hostname !== "loopback" ||
    test.hostname !== "loopback" ||
    application.identity === test.identity ||
    !/test/iu.test(test.databaseName) ||
    /prod|production|staging|shared/iu.test(application.databaseName) ||
    /prod|production|staging|shared/iu.test(test.databaseName)
  ) {
    throw new Error(
      "env:init requires distinct, non-production loopback DATABASE_URL and TEST_DATABASE_URL targets.",
    );
  }
}
