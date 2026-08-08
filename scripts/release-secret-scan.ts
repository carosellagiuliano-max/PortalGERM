import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { config, parse } from "dotenv";

import {
  scanPhase32ArtifactSecrets,
  type Phase32SecretCandidate,
} from "@/lib/release/phase32-artifact-secret-scan";
import { SENSITIVE_ENVIRONMENT_VARIABLES } from "@/lib/security/sensitive-data-registry";
import { isSafeTrackedEnvironmentTemplateMatch } from "@/lib/security/release-secret-scan-policy";

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
    (/(?:^|\/)\.env(?:\.|$)/u.test(path) && path !== ".env.example") ||
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
const secretVariables = SENSITIVE_ENVIRONMENT_VARIABLES;
const environmentTemplate = parse(trackedText.get(".env.example") ?? "");
for (const variable of ["DATABASE_URL", "TEST_DATABASE_URL"] as const) {
  const value = environmentTemplate[variable]?.trim();
  if (
    value !== undefined &&
    !isSafeTrackedEnvironmentTemplateMatch(variable, value, ".env.example")
  ) {
    failures.push(
      `.env.example contains an unsafe non-loopback ${variable} template.`,
    );
  }
}
for (const variable of secretVariables) {
  const value = process.env[variable]?.trim();
  if (value === undefined || value.length < 12) continue;
  for (const candidate of secretCandidates(variable, value)) {
    const leaked = tracked.find(
      (path) =>
        (trackedText.get(path)?.includes(candidate) ?? false) &&
        !isSafeTrackedEnvironmentTemplateMatch(
          variable,
          candidate,
          path,
          environmentTemplate[variable]?.trim(),
        ),
    );
    if (leaked !== undefined) {
      failures.push(`${variable} exact value appears in ${leaked}.`);
      break;
    }
  }
}

let artifactScannedFileCount = 0;
let artifactBinaryFileCount = 0;
const artifactRoot = process.env.PHASE32_ARTIFACT_SCAN_ROOT?.trim();
if (artifactRoot !== undefined && artifactRoot !== "") {
  const artifactCandidates: Phase32SecretCandidate[] = [
    ...secretVariables,
    "STRIPE_SECRET_VERSION",
    "RESEND_SECRET_VERSION",
    "RESEND_WEBHOOK_SECRET_VERSION",
    "DOCUMENT_STORAGE_SECRET_VERSION",
    "DOCUMENT_SCANNER_SECRET_VERSION",
    "PHASE33_STRIPE_SECRET_VERSION",
    "PHASE33_RESEND_SECRET_VERSION",
    "PHASE33_RESEND_WEBHOOK_SECRET_VERSION",
    "PHASE33_STORAGE_SECRET_VERSION",
  ].flatMap((variable) => {
    const value = process.env[variable]?.trim();
    if (value === undefined || value.length < 12) return [];
    return [...secretCandidates(variable, value)].map((candidate) => ({
      name: variable,
      value: candidate,
    }));
  });
  const artifactResult = await scanPhase32ArtifactSecrets(
    artifactRoot,
    artifactCandidates,
  );
  artifactScannedFileCount = artifactResult.scannedFileCount;
  artifactBinaryFileCount = artifactResult.binaryFileCount;
  failures.push(...artifactResult.failures);
}

if (failures.length > 0) {
  console.error(`Release secret scan failed:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.info(
    `Release secret scan passed across ${tracked.length} tracked files` +
      (artifactRoot === undefined || artifactRoot === ""
        ? ""
        : ` and ${artifactScannedFileCount} deployable artifact files` +
          ` (${artifactBinaryFileCount} binary files byte-scanned)`) +
      "; no private key, backup artifact, provider token or exact configured secret was found.",
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
