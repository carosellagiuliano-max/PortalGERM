import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { parseEnvironment } from "@/lib/config/env-schema";

const argumentsSet = new Set(process.argv.slice(2));
const ciMode = process.env.CI === "true" || argumentsSet.has("--ci");
const nonInteractive = argumentsSet.has("--non-interactive") || ciMode;

if (ciMode) {
  parseEnvironment(process.env);
  console.info("CI environment validated; no file was written.");
  process.exit(0);
}

if (
  process.env.NODE_ENV === "production" ||
  (process.env.APP_ENV !== undefined && process.env.APP_ENV !== "local")
) {
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

const defaults = {
  databaseUrl:
    "postgresql://swisstalenthub:local-development-only@127.0.0.1:5434/swisstalenthub?schema=public",
  testDatabaseUrl:
    "postgresql://swisstalenthub_test:local-test-only@127.0.0.1:5435/swisstalenthub_test?schema=public",
  appUrl: "http://127.0.0.1:3000",
};

if (!nonInteractive && stdin.isTTY && stdout.isTTY) {
  const prompt = createInterface({ input: stdin, output: stdout });
  const confirmation = await prompt.question(
    "Lokale DATABASE_URL, TEST_DATABASE_URL und APP_URL übernehmen? [J/n] ",
  );
  prompt.close();
  if (confirmation.trim().toLowerCase() === "n") {
    throw new Error(
      "env:init was cancelled. Create the local file deliberately if different endpoints are required.",
    );
  }
}

const secret = () => randomBytes(32).toString("base64");
const values: Record<string, string> = {
  APP_ENV: "local",
  NODE_ENV: "development",
  DATABASE_URL: defaults.databaseUrl,
  TEST_DATABASE_URL: defaults.testDatabaseUrl,
  APP_URL: defaults.appUrl,
  NEXT_PUBLIC_APP_NAME: "SwissTalentHub",
  SESSION_SECRET: secret(),
  AUDIT_IP_HASH_KEYS: `v1:${secret()}`,
  RADAR_OPAQUE_LOOKUP_KEYS: `v1:${secret()}`,
  RADAR_OPAQUE_ENCRYPTION_KEYS: `v1:${secret()}`,
  REVEAL_CONFIRMATION_KEYS: `v1:${secret()}`,
  PII_REVEAL_KEYS: `v1:${secret()}`,
  RATE_LIMIT_BACKEND: "postgres",
  TRUSTED_PROXY_HOPS: "0",
  ENABLE_LOCAL_MOCK_MAILBOX: "false",
  DEV_MAILBOX_SECRET: randomBytes(32).toString("base64url"),
  LOG_LEVEL: "info",
  BACKUP_AGE_RECIPIENT: "",
  BACKUP_AGE_IDENTITY_FILE: "",
  STRIPE_SECRET_KEY: "",
  EMAIL_PROVIDER_API_KEY: "",
  OPENAI_API_KEY: "",
  STORAGE_ENDPOINT: "",
  JOBROOM_API_URL: "",
  MAPS_API_KEY: "",
};

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
