import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

const repository = process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repository,
  encoding: "utf8",
  windowsHide: true,
})
  .split("\0")
  .filter(Boolean);
const trackedText = new Map<string, string | undefined>(
  tracked.map((path) => [
    path,
    isBinaryOrGenerated(path) ? undefined : readSafe(path),
  ]),
);

const failures: string[] = [];
const forbiddenFiles = tracked.filter(
  (path) =>
    /(?:^|\/)\.env(?:\.|$)/u.test(path) && path !== ".env.example" ||
    /\.(?:dump|dump\.age|pem|key|p12|pfx)$/iu.test(path) ||
    /\.sha256$/iu.test(path),
);
if (forbiddenFiles.length > 0) {
  failures.push(
    `Tracked operational/secret artifacts: ${forbiddenFiles.join(", ")}.`,
  );
}

const highConfidencePatterns = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u,
  /AGE-SECRET-KEY-[A-Z0-9]+/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/u,
  /\bsk_live_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
] as const;
for (const path of tracked) {
  const content = trackedText.get(path);
  if (
    content !== undefined &&
    highConfidencePatterns.some((pattern) => pattern.test(content))
  ) {
    failures.push(`${path} matches a high-confidence secret pattern.`);
  }
}

config({
  path: resolve(repository, ".env.local"),
  override: false,
  quiet: true,
});
const secretVariables = [
  "SESSION_SECRET",
  "AUDIT_IP_HASH_KEYS",
  "RADAR_OPAQUE_LOOKUP_KEYS",
  "RADAR_OPAQUE_ENCRYPTION_KEYS",
  "REVEAL_CONFIRMATION_KEYS",
  "PII_REVEAL_KEYS",
  "NOTIFICATION_DELIVERY_KEYS",
  "DEV_MAILBOX_SECRET",
  "BACKUP_AGE_IDENTITY_FILE",
  "STRIPE_SECRET_KEY",
  "EMAIL_PROVIDER_API_KEY",
  "OPENAI_API_KEY",
] as const;
for (const variable of secretVariables) {
  const value = process.env[variable]?.trim();
  if (value === undefined || value.length < 12) continue;
  for (const candidate of secretCandidates(variable, value)) {
    const leaked = tracked.find(
      (path) => trackedText.get(path)?.includes(candidate) ?? false,
    );
    if (leaked !== undefined) {
      failures.push(`${variable} exact value appears in ${leaked}.`);
      break;
    }
  }
}

if (failures.length > 0) {
  console.error(`Release secret scan failed:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.info(
    `Release secret scan passed across ${tracked.length} tracked files; no private key, backup artifact, provider token or exact configured secret was found.`,
  );
}

function isBinaryOrGenerated(path: string) {
  return /\.(?:ico|png|jpe?g|gif|webp|woff2?|ttf|pdf|zip|gz)$/iu.test(path);
}

function readSafe(path: string) {
  try {
    return readFileSync(resolve(repository, path), "utf8");
  } catch {
    return undefined;
  }
}

function secretCandidates(variable: string, value: string) {
  const candidates = new Set([value]);
  if (variable.endsWith("_KEYS")) {
    for (const entry of value.split(",")) {
      const separator = entry.indexOf(":");
      if (separator < 0) continue;
      const key = entry.slice(separator + 1).trim();
      if (key.length >= 12) candidates.add(key);
    }
  }
  return candidates;
}
