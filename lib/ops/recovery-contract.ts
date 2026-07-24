import {
  existsSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { inspectPostgresTarget } from "@/lib/db/database-target";

export const RELEASE_SOURCE_ALIAS = "release-test" as const;
export const RESTORE_TARGET_ALIAS = "restore-test" as const;

const AGE_RECIPIENT_PATTERN = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/u;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;
const RELEASE_DATABASE_PATTERN =
  /^swisstalenthub_release_test_[0-9a-f]{12,32}$/u;
const RESTORE_DATABASE_PATTERN =
  /^swisstalenthub_restore_test_[0-9a-f]{12,32}$/u;
const FORBIDDEN_DATABASE_PATTERN =
  /(?:^|[_-])(?:prod|production|staging|shared)(?:[_-]|$)/iu;

export type RecoveryDatabase = Readonly<{
  databaseName: string;
  identity: string;
  url: string;
}>;

export type RecoveryEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type BackupContract = Readonly<{
  checksumPath: string;
  outputPath: string;
  recipient: string;
  source: RecoveryDatabase;
}>;

export type RestoreContract = Readonly<{
  checksumPath: string;
  identityFile: string;
  inputPath: string;
  source: RecoveryDatabase;
  target: RecoveryDatabase;
}>;

export function resolveBackupContract(
  args: readonly string[],
  environment: RecoveryEnvironment,
  repositoryRoot = process.cwd(),
): BackupContract {
  assertRecoveryRuntime(environment);
  const parsed = parseNamedArguments(args, ["source", "out"]);
  if (parsed.source !== RELEASE_SOURCE_ALIAS) {
    throw new Error(
      `--source must be the allowlisted alias ${RELEASE_SOURCE_ALIAS}.`,
    );
  }

  const source = resolveDatabase(
    "DATABASE_URL",
    environment.DATABASE_URL,
    RELEASE_DATABASE_PATTERN,
  );
  const outputPath = resolveExternalArtifactPath(
    "--out",
    parsed.out,
    ".dump.age",
    repositoryRoot,
  );
  const recipient = environment.BACKUP_AGE_RECIPIENT?.trim();
  if (recipient === undefined || !AGE_RECIPIENT_PATTERN.test(recipient)) {
    throw new Error(
      "BACKUP_AGE_RECIPIENT must be one valid X25519 age recipient.",
    );
  }
  if (existsSync(outputPath) || existsSync(`${outputPath}.sha256`)) {
    throw new Error("Backup output or checksum already exists; refusing overwrite.");
  }

  return Object.freeze({
    source,
    outputPath,
    checksumPath: `${outputPath}.sha256`,
    recipient,
  });
}

export function resolveRestoreContract(
  args: readonly string[],
  environment: RecoveryEnvironment,
  repositoryRoot = process.cwd(),
): RestoreContract {
  assertRecoveryRuntime(environment);
  const parsed = parseNamedArguments(args, ["in", "target"]);
  if (parsed.target !== RESTORE_TARGET_ALIAS) {
    throw new Error(
      `--target must be the allowlisted alias ${RESTORE_TARGET_ALIAS}.`,
    );
  }

  const inputPath = resolveExternalArtifactPath(
    "--in",
    parsed.in,
    ".dump.age",
    repositoryRoot,
  );
  const checksumPath = `${inputPath}.sha256`;
  if (!existsSync(inputPath) || !existsSync(checksumPath)) {
    throw new Error("Encrypted backup and adjacent checksum must both exist.");
  }
  const resolvedInputPath = resolveExternalRegularFile(
    "--in",
    inputPath,
    repositoryRoot,
  );
  const resolvedChecksumPath = resolveExternalRegularFile(
    "checksum",
    checksumPath,
    repositoryRoot,
  );

  const source = resolveDatabase(
    "DATABASE_URL",
    environment.DATABASE_URL,
    RELEASE_DATABASE_PATTERN,
  );
  const target = resolveDatabase(
    "TEST_DATABASE_URL",
    environment.TEST_DATABASE_URL,
    RESTORE_DATABASE_PATTERN,
  );
  if (source.identity === target.identity) {
    throw new Error("Restore target must be distinct from the release source.");
  }

  const identityFile = environment.BACKUP_AGE_IDENTITY_FILE?.trim();
  if (
    identityFile === undefined ||
    !isAbsolute(identityFile) ||
    isInside(repositoryRoot, identityFile)
  ) {
    throw new Error(
      "BACKUP_AGE_IDENTITY_FILE must be an absolute path outside the repository.",
    );
  }
  if (!existsSync(identityFile)) {
    throw new Error("BACKUP_AGE_IDENTITY_FILE does not exist.");
  }
  const resolvedIdentityFile = resolveExternalRegularFile(
    "BACKUP_AGE_IDENTITY_FILE",
    identityFile,
    repositoryRoot,
  );
  const identityStats = statSync(resolvedIdentityFile);
  if (
    process.platform !== "win32" &&
    (identityStats.mode & 0o077) !== 0
  ) {
    throw new Error(
      "BACKUP_AGE_IDENTITY_FILE must not grant group or other permissions.",
    );
  }

  return Object.freeze({
    inputPath: resolvedInputPath,
    checksumPath: resolvedChecksumPath,
    source,
    target,
    identityFile: resolvedIdentityFile,
  });
}

export function parseCiphertextChecksum(value: string) {
  const checksum = value.trim().toLowerCase();
  if (!CHECKSUM_PATTERN.test(checksum)) {
    throw new Error("Backup checksum must contain exactly one SHA-256 digest.");
  }
  return checksum;
}

export function resolveReleaseSmokeDatabase(
  environment: RecoveryEnvironment,
): RecoveryDatabase {
  assertRecoveryRuntime(environment);
  return resolveDatabase(
    "DATABASE_URL",
    environment.DATABASE_URL,
    RESTORE_DATABASE_PATTERN,
  );
}

export function createLibpqEnvironment(
  databaseUrl: string,
): Record<string, string> {
  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get("sslmode");
  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;
  return {
    PGHOST: decodeURIComponent(hostname),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "10",
    ...(sslMode === null ? {} : { PGSSLMODE: sslMode }),
  };
}

function assertRecoveryRuntime(environment: RecoveryEnvironment) {
  if (
    environment.APP_ENV !== "local" &&
    environment.APP_ENV !== "ci"
  ) {
    throw new Error("Recovery drills run only in local or CI environments.");
  }
  if (environment.NODE_ENV === "production") {
    throw new Error("Recovery drills refuse a production Node runtime.");
  }
}

function resolveDatabase(
  variable: string,
  value: string | undefined,
  expectedName: RegExp,
): RecoveryDatabase {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${variable} is required.`);
  }
  const target = inspectPostgresTarget(value);
  if (target === undefined || target.schemaName !== "public") {
    throw new Error(`${variable} must identify a PostgreSQL public schema.`);
  }
  if (
    !expectedName.test(target.databaseName) ||
    FORBIDDEN_DATABASE_PATTERN.test(target.databaseName) ||
    ["postgres", "template0", "template1", "swisstalenthub"].includes(
      target.databaseName.toLowerCase(),
    )
  ) {
    throw new Error(
      `${variable} database name is outside the recovery-drill allowlist.`,
    );
  }
  if (target.hostname !== "loopback") {
    throw new Error(
      `${variable} must use loopback during a recovery drill.`,
    );
  }
  return Object.freeze({
    databaseName: target.databaseName,
    identity: target.identity,
    url: value,
  });
}

function resolveExternalArtifactPath(
  flag: string,
  value: string,
  suffix: string,
  repositoryRoot: string,
) {
  if (!isAbsolute(value)) {
    throw new Error(`${flag} must be an explicit absolute path.`);
  }
  const path = resolve(value);
  if (!path.toLowerCase().endsWith(suffix)) {
    throw new Error(`${flag} must end with ${suffix}.`);
  }
  if (isInside(repositoryRoot, path)) {
    throw new Error(`${flag} must stay outside the repository.`);
  }
  if (flag === "--out") {
    if (!existsSync(dirname(path))) {
      throw new Error("--out parent directory must already exist.");
    }
    const parent = realpathSync(dirname(path));
    if (!statSync(parent).isDirectory()) {
      throw new Error("--out parent must resolve to a directory.");
    }
    if (isInside(realRepositoryRoot(repositoryRoot), parent)) {
      throw new Error("--out parent must resolve outside the repository.");
    }
  }
  return path;
}

function resolveExternalRegularFile(
  label: string,
  path: string,
  repositoryRoot: string,
) {
  const resolved = realpathSync(path);
  if (
    isInside(realRepositoryRoot(repositoryRoot), resolved) ||
    !statSync(resolved).isFile()
  ) {
    throw new Error(`${label} must resolve to a regular file outside the repository.`);
  }
  return resolved;
}

function realRepositoryRoot(repositoryRoot: string) {
  return existsSync(repositoryRoot)
    ? realpathSync(repositoryRoot)
    : resolve(repositoryRoot);
}

function isInside(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function parseNamedArguments<const TName extends string>(
  args: readonly string[],
  names: readonly TName[],
): Record<TName, string> {
  const allowed = new Set(names);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !flag.startsWith("--") ||
      value.startsWith("--")
    ) {
      throw new Error("Arguments must use explicit --name value pairs.");
    }
    const name = flag.slice(2);
    if (!allowed.has(name as TName) || values.has(name)) {
      throw new Error(`Unsupported or duplicate argument ${flag}.`);
    }
    values.set(name, value);
  }
  for (const name of names) {
    if (!values.has(name)) {
      throw new Error(`--${name} is required.`);
    }
  }
  return Object.fromEntries(values) as Record<TName, string>;
}
