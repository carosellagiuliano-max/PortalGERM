import { randomBytes } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const PHASE33_EVIDENCE_DIRECTORY = "test-results/phase33" as const;
export const PHASE33_EVIDENCE_LOG_DIRECTORY =
  `${PHASE33_EVIDENCE_DIRECTORY}/logs` as const;
export const PHASE33_GENERATED_EVIDENCE_BASENAMES = Object.freeze([
  "test-report.json",
  "recovery-manifest.json",
  "technical-manifest-lc4.json",
  "technical-manifest-lc5.json",
  "release-verdict.json",
  "release-verdict-lc4.json",
  "release-verdict-lc5.json",
] as const);
const PHASE33_ABSOLUTE_READ_LIMIT_BYTES = 64 * 1024 * 1024;

/** Resolve a caller-supplied evidence file while denying path traversal. */
export function resolvePhase33EvidencePath(
  repository: string,
  suppliedPath: string,
  allowedBasenames: readonly string[],
) {
  const root = resolve(repository, PHASE33_EVIDENCE_DIRECTORY);
  const path = isAbsolute(suppliedPath)
    ? resolve(suppliedPath)
    : resolve(repository, suppliedPath);
  if (
    dirname(path) !== root ||
    !allowedBasenames.includes(basename(path).toLocaleLowerCase("en"))
  ) {
    throw new Error("PHASE33_EVIDENCE_PATH_OUT_OF_SCOPE");
  }
  return path;
}

export function resolvePhase33CommandLogPath(
  repository: string,
  suppliedPath: string,
  allowedBasenames: readonly string[],
) {
  const root = resolve(repository, PHASE33_EVIDENCE_LOG_DIRECTORY);
  const path = isAbsolute(suppliedPath)
    ? resolve(suppliedPath)
    : resolve(repository, suppliedPath);
  if (dirname(path) !== root || !allowedBasenames.includes(basename(path))) {
    throw new Error("PHASE33_COMMAND_LOG_PATH_OUT_OF_SCOPE");
  }
  return path;
}

/** Remove stale success evidence before any validation or long-running work. */
export async function invalidatePhase33EvidenceOutput(
  repository: string,
  outputPath: string,
) {
  await assertSafeEvidenceLocation(repository, outputPath);
  const existing = await lstat(outputPath).catch(() => undefined);
  if (existing?.isSymbolicLink()) {
    throw new Error("PHASE33_EVIDENCE_OUTPUT_SYMLINK_DENIED");
  }
  await rm(outputPath, { force: true });
}

/**
 * Publish complete JSON with one no-overwrite hard-link operation. The final
 * name is either absent or references the fully flushed temporary inode. A
 * failed best-effort temp cleanup after publication must not turn valid,
 * already-visible evidence into a false command failure.
 */
export async function writePhase33EvidenceAtomic(
  repository: string,
  outputPath: string,
  serialized: string,
) {
  await assertSafeEvidenceLocation(repository, outputPath);
  const existing = await lstat(outputPath).catch(() => undefined);
  if (existing !== undefined) {
    throw new Error("PHASE33_EVIDENCE_OUTPUT_ALREADY_EXISTS");
  }
  const temporaryPath = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      flush: true,
      mode: 0o600,
    });
    await link(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await rm(temporaryPath, { force: true }).catch(() => undefined);
}

/** Read an evidence input without following links or accepting an in-read swap. */
export async function readPhase33EvidenceFile(
  repository: string,
  inputPath: string,
  maxBytes = 16 * 1024 * 1024,
) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > PHASE33_ABSOLUTE_READ_LIMIT_BYTES
  ) {
    throw new Error("PHASE33_EVIDENCE_INPUT_LIMIT_INVALID");
  }
  await assertSafeEvidenceLocation(repository, inputPath);
  return readStableRegularFile(resolve(inputPath), maxBytes);
}

export async function readPhase33CommandLogFile(
  repository: string,
  inputPath: string,
  maxBytes: number,
) {
  const evidenceSentinel = resolve(
    repository,
    PHASE33_EVIDENCE_DIRECTORY,
    "test-report.json",
  );
  await assertSafeEvidenceLocation(repository, evidenceSentinel);
  const repositoryRoot = await realpath(resolve(repository));
  const logRoot = resolve(repositoryRoot, PHASE33_EVIDENCE_LOG_DIRECTORY);
  if (!samePath(dirname(resolve(inputPath)), logRoot)) {
    throw new Error("PHASE33_COMMAND_LOG_PATH_OUT_OF_SCOPE");
  }
  await denySymlinkIfPresent(logRoot);
  const realLogRoot = await realpath(logRoot);
  if (!samePath(realLogRoot, logRoot)) {
    throw new Error("PHASE33_COMMAND_LOG_ROOT_ESCAPE");
  }
  return readStableRegularFile(resolve(inputPath), maxBytes);
}

/** Read an operator-supplied external gate ledger without links or TOCTOU. */
export async function readPhase33ExternalLedgerFile(
  inputPath: string,
  maxBytes = 1024 * 1024,
) {
  return readStableRegularFile(resolve(inputPath), maxBytes);
}

async function readStableRegularFile(resolvedInput: string, maxBytes: number) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > PHASE33_ABSOLUTE_READ_LIMIT_BYTES
  ) {
    throw new Error("PHASE33_EVIDENCE_INPUT_LIMIT_INVALID");
  }
  const before = await lstat(resolvedInput).catch(() => undefined);
  if (before?.isSymbolicLink()) {
    throw new Error("PHASE33_EVIDENCE_INPUT_SYMLINK_DENIED");
  }
  if (before === undefined || !before.isFile()) {
    throw new Error("PHASE33_EVIDENCE_INPUT_NOT_REGULAR_FILE");
  }
  if (before.size > maxBytes) {
    throw new Error("PHASE33_EVIDENCE_INPUT_TOO_LARGE");
  }
  const realInput = await realpath(resolvedInput);
  if (!samePath(realInput, resolvedInput)) {
    throw new Error("PHASE33_EVIDENCE_INPUT_LINK_ESCAPE");
  }
  const handle = await open(resolvedInput, "r");
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.size > maxBytes ||
      !sameFileIdentity(before, opened)
    ) {
      throw new Error("PHASE33_EVIDENCE_INPUT_CHANGED_DURING_READ");
    }
    const bounded = Buffer.alloc(Math.min(maxBytes + 1, opened.size + 1));
    let offset = 0;
    while (offset < bounded.byteLength) {
      const { bytesRead } = await handle.read(
        bounded,
        offset,
        bounded.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      offset > maxBytes ||
      after.size !== offset ||
      !sameFileIdentity(opened, after)
    ) {
      throw new Error("PHASE33_EVIDENCE_INPUT_CHANGED_DURING_READ");
    }
    return bounded.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function assertSafeEvidenceLocation(
  repository: string,
  outputPath: string,
) {
  const repositoryRoot = await realpath(resolve(repository));
  const evidenceRoot = resolve(repositoryRoot, PHASE33_EVIDENCE_DIRECTORY);
  if (!samePath(dirname(resolve(outputPath)), evidenceRoot)) {
    throw new Error("PHASE33_EVIDENCE_PATH_OUT_OF_SCOPE");
  }
  const testResultsRoot = resolve(repositoryRoot, "test-results");
  await denySymlinkIfPresent(testResultsRoot);
  await mkdir(evidenceRoot, { recursive: true });
  await denySymlinkIfPresent(evidenceRoot);
  const realEvidenceRoot = await realpath(evidenceRoot);
  const fromRepository = relative(repositoryRoot, realEvidenceRoot);
  if (
    fromRepository === "" ||
    fromRepository.startsWith("..") ||
    isAbsolute(fromRepository)
  ) {
    throw new Error("PHASE33_EVIDENCE_ROOT_ESCAPE");
  }
}

function samePath(left: string, right: string) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase("en") ===
        normalizedRight.toLocaleLowerCase("en")
    : normalizedLeft === normalizedRight;
}

function sameFileIdentity(
  left: Readonly<{
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
  }>,
  right: Readonly<{
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
  }>,
) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function denySymlinkIfPresent(path: string) {
  const stats = await lstat(path).catch(() => undefined);
  if (stats?.isSymbolicLink()) {
    throw new Error("PHASE33_EVIDENCE_DIRECTORY_SYMLINK_DENIED");
  }
  if (stats !== undefined && !stats.isDirectory()) {
    throw new Error("PHASE33_EVIDENCE_DIRECTORY_INVALID");
  }
}
