import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const PHASE32_ARTIFACT_DIGEST_VERSION =
  "phase32-artifact-digest-v1" as const;

/**
 * Build caches are not deployable release content. Callers must opt in to
 * every exclusion so a newly added directory can never disappear silently
 * from the release digest.
 */
export const PHASE32_NEXT_BUILD_CACHE_EXCLUSIONS = Object.freeze([
  ".next/cache",
] as const);

export type Phase32FileDigest = Readonly<{
  schemaVersion: typeof PHASE32_ARTIFACT_DIGEST_VERSION;
  sha256: string;
  sizeBytes: number;
}>;

export type Phase32DirectoryDigest = Readonly<{
  schemaVersion: typeof PHASE32_ARTIFACT_DIGEST_VERSION;
  sha256: string;
  fileCount: number;
  sizeBytes: number;
  excludedPaths: readonly string[];
}>;

export type Phase32ContainedCopyObserver = Readonly<{
  /**
   * Observability hook used by deterministic race tests. Release assembly
   * never supplies it; source identity is rechecked after it returns.
   */
  onSourceFileOpened?: (relativePath: string) => Promise<void> | void;
}>;

export async function copyPhase32ContainedTree(
  sourceRoot: string,
  destinationRoot: string,
  allowedRoot: string,
  observer: Phase32ContainedCopyObserver = {},
) {
  const absoluteSourceRoot = resolve(sourceRoot);
  const absoluteDestinationRoot = resolve(destinationRoot);
  const absoluteAllowedRoot = await realpath(resolve(allowedRoot));
  const realSourceRoot = await realpath(absoluteSourceRoot);
  assertContainedSource(
    absoluteAllowedRoot,
    realSourceRoot,
    "PHASE32_COPY_SOURCE_ROOT_ESCAPE",
  );
  if (
    samePath(realSourceRoot, absoluteDestinationRoot) ||
    pathIsWithin(realSourceRoot, absoluteDestinationRoot)
  ) {
    throw new Error("PHASE32_COPY_DESTINATION_INSIDE_SOURCE");
  }
  await assertPathMissing(absoluteDestinationRoot);
  await mkdir(dirname(absoluteDestinationRoot), { recursive: true });
  let destinationCreated = false;
  try {
    await copyContainedDirectory(
      realSourceRoot,
      absoluteDestinationRoot,
      Object.freeze({
        allowedRoot: absoluteAllowedRoot,
        logicalRoot: realSourceRoot,
        observer,
      }),
      new Set(),
    );
    destinationCreated = true;
    const sourceAfter = await realpath(absoluteSourceRoot);
    if (!samePath(sourceAfter, realSourceRoot)) {
      throw new Error("PHASE32_COPY_SOURCE_ROOT_CHANGED");
    }
  } catch (error) {
    if (
      destinationCreated ||
      (await pathExistsWithoutFollowing(absoluteDestinationRoot))
    ) {
      await rm(absoluteDestinationRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function copyPhase32ContainedFile(
  sourcePath: string,
  destinationPath: string,
  allowedRoot: string,
) {
  const absoluteAllowedRoot = await realpath(resolve(allowedRoot));
  const absoluteDestinationPath = resolve(destinationPath);
  await mkdir(dirname(absoluteDestinationPath), { recursive: true });
  await assertPathMissing(absoluteDestinationPath);
  try {
    await copyContainedRegularFile(
      resolve(sourcePath),
      absoluteDestinationPath,
      Object.freeze({
        allowedRoot: absoluteAllowedRoot,
        logicalRoot: await realpath(resolve(sourcePath)),
        observer: Object.freeze({}),
      }),
      "",
    );
  } catch (error) {
    await rm(absoluteDestinationPath, { force: true });
    throw error;
  }
}

type ContainedCopyContext = Readonly<{
  allowedRoot: string;
  logicalRoot: string;
  observer: Phase32ContainedCopyObserver;
}>;

async function copyContainedDirectory(
  sourceDirectory: string,
  destinationDirectory: string,
  context: ContainedCopyContext,
  ancestorIdentities: ReadonlySet<string>,
): Promise<void> {
  const realSourceDirectory = await realpath(sourceDirectory);
  const logicalPath = normalizedRelativePath(
    context.logicalRoot,
    realSourceDirectory,
  );
  assertContainedSource(
    context.allowedRoot,
    realSourceDirectory,
    `PHASE32_COPY_SOURCE_SYMLINK_ESCAPE:${logicalPath}`,
  );
  const before = await lstat(realSourceDirectory, { bigint: true });
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error(`PHASE32_COPY_SOURCE_DIRECTORY_REQUIRED:${logicalPath}`);
  }
  const directoryIdentity = identity(before);
  const directoryKey = `${directoryIdentity.dev}:${directoryIdentity.ino}`;
  if (ancestorIdentities.has(directoryKey)) {
    throw new Error(`PHASE32_COPY_SOURCE_CYCLE:${logicalPath}`);
  }
  const nextAncestors = new Set(ancestorIdentities);
  nextAncestors.add(directoryKey);

  await mkdir(destinationDirectory);
  const entries = await readdir(realSourceDirectory, { withFileTypes: true });
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const entry of entries) {
    const sourceChild = resolve(realSourceDirectory, entry.name);
    const destinationChild = resolve(destinationDirectory, entry.name);
    const childStats = await lstat(sourceChild, { bigint: true });
    const childLogicalPath = normalizedRelativePath(
      context.logicalRoot,
      sourceChild,
    );
    if (childStats.isSymbolicLink()) {
      const target = await realpath(sourceChild);
      assertContainedSource(
        context.allowedRoot,
        target,
        `PHASE32_COPY_SOURCE_SYMLINK_ESCAPE:${childLogicalPath}`,
      );
      const targetStats = await lstat(target, { bigint: true });
      if (targetStats.isDirectory()) {
        await copyContainedDirectory(
          target,
          destinationChild,
          context,
          nextAncestors,
        );
      } else if (targetStats.isFile()) {
        await copyContainedRegularFile(
          target,
          destinationChild,
          context,
          childLogicalPath,
        );
      } else {
        throw new Error(
          `PHASE32_COPY_SOURCE_SPECIAL_FILE_DENIED:${childLogicalPath}`,
        );
      }
      continue;
    }
    if (childStats.isDirectory()) {
      await copyContainedDirectory(
        sourceChild,
        destinationChild,
        context,
        nextAncestors,
      );
      continue;
    }
    if (childStats.isFile()) {
      await copyContainedRegularFile(
        sourceChild,
        destinationChild,
        context,
        childLogicalPath,
      );
      continue;
    }
    throw new Error(
      `PHASE32_COPY_SOURCE_SPECIAL_FILE_DENIED:${childLogicalPath}`,
    );
  }

  const sourceAfter = await realpath(realSourceDirectory);
  const after = await lstat(realSourceDirectory, { bigint: true });
  if (
    !samePath(sourceAfter, realSourceDirectory) ||
    !sameIdentity(directoryIdentity, identity(after))
  ) {
    throw new Error(`PHASE32_COPY_SOURCE_DIRECTORY_CHANGED:${logicalPath}`);
  }
}

async function copyContainedRegularFile(
  sourcePath: string,
  destinationPath: string,
  context: ContainedCopyContext,
  suppliedLogicalPath: string,
) {
  const realSourcePath = await realpath(sourcePath);
  const logicalPath =
    suppliedLogicalPath ||
    normalizedRelativePath(context.logicalRoot, realSourcePath);
  assertContainedSource(
    context.allowedRoot,
    realSourcePath,
    `PHASE32_COPY_SOURCE_SYMLINK_ESCAPE:${logicalPath}`,
  );
  const before = await lstat(realSourcePath, { bigint: true });
  assertRegularFile(before, `PHASE32_COPY_SOURCE_FILE_REQUIRED:${logicalPath}`);
  const sourceHandle = await open(
    realSourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const opened = await sourceHandle.stat({ bigint: true });
    assertRegularFile(
      opened,
      `PHASE32_COPY_SOURCE_FILE_CHANGED_BEFORE_READ:${logicalPath}`,
    );
    if (!sameIdentity(identity(before), identity(opened))) {
      throw new Error(
        `PHASE32_COPY_SOURCE_FILE_CHANGED_BEFORE_READ:${logicalPath}`,
      );
    }
    const resolvedAfterOpen = await realpath(sourcePath);
    assertContainedSource(
      context.allowedRoot,
      resolvedAfterOpen,
      `PHASE32_COPY_SOURCE_SYMLINK_ESCAPE:${logicalPath}`,
    );
    if (!samePath(resolvedAfterOpen, realSourcePath)) {
      throw new Error(
        `PHASE32_COPY_SOURCE_FILE_CHANGED_BEFORE_READ:${logicalPath}`,
      );
    }
    await context.observer.onSourceFileOpened?.(logicalPath);

    destinationHandle = await open(destinationPath, "wx");
    const buffer = Buffer.allocUnsafe(64 * 1_024);
    let position = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(
        buffer,
        0,
        buffer.byteLength,
        position,
      );
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
        if (result.bytesWritten === 0) {
          throw new Error(
            `PHASE32_COPY_DESTINATION_WRITE_STALLED:${logicalPath}`,
          );
        }
        written += result.bytesWritten;
      }
      position += bytesRead;
      if (!Number.isSafeInteger(position)) {
        throw new Error(`PHASE32_COPY_SOURCE_SIZE_UNSAFE:${logicalPath}`);
      }
    }
    await destinationHandle.chmod(Number(opened.mode & 0o777n));

    const openedAfter = await sourceHandle.stat({ bigint: true });
    const pathAfter = await lstat(realSourcePath, { bigint: true });
    const resolvedAfter = await realpath(sourcePath);
    if (
      !samePath(resolvedAfter, realSourcePath) ||
      !sameIdentity(identity(opened), identity(openedAfter)) ||
      !sameIdentity(identity(openedAfter), identity(pathAfter)) ||
      position !== safeByteCount(openedAfter.size)
    ) {
      throw new Error(
        `PHASE32_COPY_SOURCE_FILE_CHANGED_DURING_READ:${logicalPath}`,
      );
    }
  } finally {
    await destinationHandle?.close();
    await sourceHandle.close();
  }
}

function assertContainedSource(root: string, candidate: string, code: string) {
  if (!samePath(root, candidate) && !pathIsWithin(root, candidate)) {
    throw new Error(code);
  }
}

async function assertPathMissing(path: string) {
  if (await pathExistsWithoutFollowing(path)) {
    throw new Error("PHASE32_COPY_DESTINATION_EXISTS");
  }
}

async function pathExistsWithoutFollowing(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function normalizedRelativePath(root: string, path: string) {
  const value = relative(root, path).replaceAll("\\", "/").normalize("NFC");
  return value === "" ? "." : value;
}

function samePath(left: string, right: string) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

type InventoryEntry = Readonly<{
  absolutePath: string;
  relativePath: string;
  identity: FileIdentity;
}>;

type FileIdentity = Readonly<{
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}>;

export async function digestPhase32File(
  path: string,
): Promise<Phase32FileDigest> {
  const absolutePath = resolve(path);
  const pathStats = await lstat(absolutePath, { bigint: true });
  assertRegularFile(pathStats, "PHASE32_ARTIFACT_FILE_REQUIRED");
  const result = await digestStableFile(absolutePath, identity(pathStats));
  return Object.freeze({
    schemaVersion: PHASE32_ARTIFACT_DIGEST_VERSION,
    sha256: result.sha256,
    sizeBytes: safeByteCount(pathStats.size),
  });
}

export async function digestPhase32Directory(
  path: string,
  options: Readonly<{ exclude?: readonly string[] }> = {},
): Promise<Phase32DirectoryDigest> {
  const absoluteRoot = resolve(path);
  const rootStats = await lstat(absoluteRoot, { bigint: true });
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("PHASE32_ARTIFACT_DIRECTORY_REQUIRED");
  }

  const exclusions = normalizeExclusions(options.exclude ?? []);
  const before = await collectInventory(absoluteRoot, exclusions);
  if (before.entries.length === 0) {
    throw new Error("PHASE32_ARTIFACT_DIRECTORY_EMPTY");
  }

  const aggregate = createHash("sha256");
  aggregate.update(`${PHASE32_ARTIFACT_DIGEST_VERSION}\0directory\0`, "utf8");
  let sizeBytes = 0;
  for (const entry of before.entries) {
    const file = await digestStableFile(entry.absolutePath, entry.identity);
    const relativeBytes = Buffer.from(entry.relativePath, "utf8");
    aggregate.update(`file\0${relativeBytes.byteLength}\0`, "utf8");
    aggregate.update(relativeBytes);
    aggregate.update(`\0${file.sizeBytes}\0${file.sha256}\0`, "utf8");
    sizeBytes += file.sizeBytes;
    if (!Number.isSafeInteger(sizeBytes)) {
      throw new Error("PHASE32_ARTIFACT_SIZE_UNSAFE");
    }
  }

  const after = await collectInventory(absoluteRoot, exclusions);
  if (
    inventoryFingerprint(before.entries) !== inventoryFingerprint(after.entries)
  ) {
    throw new Error("PHASE32_ARTIFACT_CHANGED_DURING_DIGEST");
  }
  if (before.excludedPaths.join("\0") !== after.excludedPaths.join("\0")) {
    throw new Error("PHASE32_ARTIFACT_EXCLUSIONS_CHANGED_DURING_DIGEST");
  }

  const finalRootStats = await lstat(absoluteRoot, { bigint: true });
  if (
    finalRootStats.isSymbolicLink() ||
    !finalRootStats.isDirectory() ||
    identity(rootStats).dev !== identity(finalRootStats).dev ||
    identity(rootStats).ino !== identity(finalRootStats).ino
  ) {
    throw new Error("PHASE32_ARTIFACT_ROOT_CHANGED_DURING_DIGEST");
  }

  return Object.freeze({
    schemaVersion: PHASE32_ARTIFACT_DIGEST_VERSION,
    sha256: aggregate.digest("hex"),
    fileCount: before.entries.length,
    sizeBytes,
    excludedPaths: Object.freeze(before.excludedPaths),
  });
}

async function collectInventory(
  absoluteRoot: string,
  exclusions: ReadonlySet<string>,
) {
  const entries: InventoryEntry[] = [];
  const excludedPaths = new Set<string>();
  const normalizedPaths = new Set<string>();

  async function visit(absoluteDirectory: string, relativeDirectory: string) {
    const children = await readdir(absoluteDirectory, { withFileTypes: true });
    children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const child of children) {
      const relativePath = normalizeArtifactPath(
        relativeDirectory === ""
          ? child.name
          : `${relativeDirectory}/${child.name}`,
      );
      const absolutePath = resolve(absoluteDirectory, child.name);
      if (isExcluded(relativePath, exclusions)) {
        excludedPaths.add(relativePath);
        continue;
      }
      const stats = await lstat(absolutePath, { bigint: true });
      if (stats.isSymbolicLink()) {
        throw new Error(`PHASE32_ARTIFACT_SYMLINK_DENIED:${relativePath}`);
      }
      if (stats.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`PHASE32_ARTIFACT_SPECIAL_FILE_DENIED:${relativePath}`);
      }
      if (normalizedPaths.has(relativePath)) {
        throw new Error(
          `PHASE32_ARTIFACT_NORMALIZED_PATH_COLLISION:${relativePath}`,
        );
      }
      normalizedPaths.add(relativePath);
      entries.push(
        Object.freeze({
          absolutePath,
          relativePath,
          identity: identity(stats),
        }),
      );
    }
  }

  await visit(absoluteRoot, "");
  entries.sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  );
  return Object.freeze({
    entries: Object.freeze(entries),
    excludedPaths: Object.freeze([...excludedPaths].sort()),
  });
}

async function digestStableFile(
  absolutePath: string,
  expectedIdentity: FileIdentity,
) {
  const handle = await open(absolutePath, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    assertRegularFile(opened, "PHASE32_ARTIFACT_FILE_CHANGED_BEFORE_READ");
    if (!sameIdentity(expectedIdentity, identity(opened))) {
      throw new Error("PHASE32_ARTIFACT_FILE_CHANGED_BEFORE_READ");
    }

    const hash = createHash("sha256");
    let bytesRead = 0;
    const stream = handle.createReadStream({ autoClose: false, start: 0 });
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      bytesRead += bytes.byteLength;
      if (!Number.isSafeInteger(bytesRead)) {
        throw new Error("PHASE32_ARTIFACT_SIZE_UNSAFE");
      }
    }

    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolutePath, { bigint: true });
    assertRegularFile(pathAfter, "PHASE32_ARTIFACT_FILE_CHANGED_DURING_READ");
    if (
      !sameIdentity(identity(opened), identity(openedAfter)) ||
      !sameIdentity(identity(openedAfter), identity(pathAfter)) ||
      bytesRead !== safeByteCount(openedAfter.size)
    ) {
      throw new Error("PHASE32_ARTIFACT_FILE_CHANGED_DURING_READ");
    }
    return Object.freeze({ sha256: hash.digest("hex"), sizeBytes: bytesRead });
  } finally {
    await handle.close();
  }
}

function normalizeExclusions(values: readonly string[]) {
  const normalized = new Set<string>();
  for (const value of values) {
    const candidate = value.replaceAll("\\", "/");
    if (
      candidate === "" ||
      candidate.startsWith("/") ||
      isAbsolute(value) ||
      candidate
        .split("/")
        .some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error(`PHASE32_ARTIFACT_EXCLUSION_INVALID:${value}`);
    }
    normalized.add(normalizeArtifactPath(candidate));
  }
  return normalized;
}

function normalizeArtifactPath(value: string) {
  return value.replaceAll("\\", "/").normalize("NFC");
}

function isExcluded(path: string, exclusions: ReadonlySet<string>) {
  for (const exclusion of exclusions) {
    if (path === exclusion || path.startsWith(`${exclusion}/`)) return true;
  }
  return false;
}

function assertRegularFile(stats: BigIntStats, code: string): void {
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(code);
}

function identity(stats: BigIntStats): FileIdentity {
  return Object.freeze({
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString(),
  });
}

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function inventoryFingerprint(entries: readonly InventoryEntry[]) {
  return entries
    .map(
      ({ relativePath, identity: fileIdentity }) =>
        `${relativePath}\0${fileIdentity.dev}\0${fileIdentity.ino}\0` +
        `${fileIdentity.size}\0${fileIdentity.mtimeNs}\0${fileIdentity.ctimeNs}`,
    )
    .join("\n");
}

function safeByteCount(value: bigint) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("PHASE32_ARTIFACT_SIZE_UNSAFE");
  }
  return count;
}

function pathIsWithin(root: string, candidate: string) {
  const path = relative(resolve(root), resolve(candidate));
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}
