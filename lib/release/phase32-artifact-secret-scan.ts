import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const PHASE32_ARTIFACT_SECRET_SCAN_VERSION =
  "phase32-artifact-secret-scan-v1" as const;

export type Phase32SecretCandidate = Readonly<{
  name: string;
  value: string;
}>;

export type Phase32ArtifactSecretScanResult = Readonly<{
  schemaVersion: typeof PHASE32_ARTIFACT_SECRET_SCAN_VERSION;
  scannedFileCount: number;
  binaryFileCount: number;
  failures: readonly string[];
}>;

const HIGH_CONFIDENCE_PATTERNS = Object.freeze([
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u,
  /AGE-SECRET-KEY-[A-Z0-9-]+/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/u,
  /\bsk_live_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
] as const);

const BINARY_EXTENSIONS =
  /\.(?:avif|bin|bmp|br|eot|gif|gz|ico|jpe?g|node|pdf|png|tar|ttf|wasm|webp|woff2?|zip)$/iu;
const FORBIDDEN_ARTIFACT_PATH =
  /(?:^|\/)\.env(?:\.|$)|\.(?:dump|dump\.age|key|p12|pfx)$/iu;
const MINIMUM_SECRET_LENGTH = 12;
const PATTERN_OVERLAP_BYTES = 4_096;

/**
 * Scans the exact deployable artifact rather than trusting a source-only
 * secret scan. Paths and configured secret values are reported by name only;
 * secret bytes are never returned or logged.
 */
export async function scanPhase32ArtifactSecrets(
  artifactRoot: string,
  candidates: readonly Phase32SecretCandidate[],
): Promise<Phase32ArtifactSecretScanResult> {
  if (!isAbsolute(artifactRoot)) {
    throw new Error("PHASE32_ARTIFACT_SECRET_SCAN_ABSOLUTE_ROOT_REQUIRED");
  }
  const absoluteRoot = resolve(artifactRoot);
  const rootStats = await lstat(absoluteRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("PHASE32_ARTIFACT_SECRET_SCAN_DIRECTORY_REQUIRED");
  }

  const normalizedCandidates = normalizeCandidates(candidates);
  const failures: string[] = [];
  let scannedFileCount = 0;
  let binaryFileCount = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const relativePath = normalizePath(relative(absoluteRoot, path));
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `PHASE32_ARTIFACT_SECRET_SCAN_SYMLINK_DENIED:${relativePath}`,
        );
      }
      if (stats.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(
          `PHASE32_ARTIFACT_SECRET_SCAN_SPECIAL_FILE_DENIED:${relativePath}`,
        );
      }
      if (FORBIDDEN_ARTIFACT_PATH.test(relativePath)) {
        failures.push(`${relativePath} is a forbidden operational artifact.`);
      }
      const fileResult = await scanRegularFile(
        path,
        relativePath,
        normalizedCandidates,
        BINARY_EXTENSIONS.test(relativePath),
      );
      scannedFileCount += 1;
      if (fileResult.binary) binaryFileCount += 1;
      failures.push(...fileResult.failures);
    }
  }

  await visit(absoluteRoot);
  if (scannedFileCount === 0) {
    throw new Error("PHASE32_ARTIFACT_SECRET_SCAN_NO_FILES");
  }

  return Object.freeze({
    schemaVersion: PHASE32_ARTIFACT_SECRET_SCAN_VERSION,
    scannedFileCount,
    binaryFileCount,
    failures: Object.freeze([...new Set(failures)].sort()),
  });
}

async function scanRegularFile(
  path: string,
  relativePath: string,
  candidates: readonly NormalizedCandidate[],
  binaryHint: boolean,
) {
  const failures = new Set<string>();
  const longestCandidate = candidates.reduce(
    (longest, candidate) => Math.max(longest, candidate.bytes.byteLength),
    0,
  );
  const overlapBytes = Math.max(PATTERN_OVERLAP_BYTES, longestCandidate);
  let tail = Buffer.alloc(0);
  let firstChunk = true;
  let binary = binaryHint;

  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (firstChunk) {
      firstChunk = false;
      if (bytes.includes(0)) binary = true;
    }
    const window = Buffer.concat([tail, bytes]);
    const text = window.toString("utf8");
    if (HIGH_CONFIDENCE_PATTERNS.some((pattern) => pattern.test(text))) {
      failures.add(`${relativePath} matches a high-confidence secret pattern.`);
    }
    for (const candidate of candidates) {
      if (window.includes(candidate.bytes)) {
        failures.add(
          `${candidate.name} exact value appears in ${relativePath}.`,
        );
      }
    }
    tail =
      window.byteLength <= overlapBytes
        ? window
        : window.subarray(window.byteLength - overlapBytes);
  }

  return Object.freeze({
    binary,
    failures: Object.freeze([...failures]),
  });
}

type NormalizedCandidate = Readonly<{
  name: string;
  bytes: Buffer;
}>;

function normalizeCandidates(
  candidates: readonly Phase32SecretCandidate[],
): readonly NormalizedCandidate[] {
  const unique = new Map<string, NormalizedCandidate>();
  for (const candidate of candidates) {
    const name = candidate.name.trim();
    const value = candidate.value.trim();
    if (name === "" || value.length < MINIMUM_SECRET_LENGTH) continue;
    const key = `${name}\0${value}`;
    unique.set(
      key,
      Object.freeze({
        name,
        bytes: Buffer.from(value, "utf8"),
      }),
    );
  }
  return Object.freeze([...unique.values()]);
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").normalize("NFC");
}
