import {
  canonicalJson,
  sha256CanonicalJson,
  type CanonicalJsonValue,
} from "@/prisma/seed/canonical-json";
import {
  SEED_COUNT_KEYS,
  SEED_DATA_PROVENANCE,
  SEED_GOLDEN_COUNTS,
  SEED_MANIFEST_SCHEMA_VERSION,
  SEED_NAMESPACE,
  type SeedBlockDigest,
  type SeedContractHeader,
  type SeedCounts,
  type SeedIdentityRecord,
  type SeedManifest,
  type SeedManifestEnvelope,
} from "@/prisma/seed/contract";
import {
  SEED_UUID_NAMESPACE,
  assertSeedIdentityIntegrity,
} from "@/prisma/seed/ids";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEED_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const BLOCK_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const SENSITIVE_PROPERTY_PATTERN =
  /(password|secret|credential|token|ciphertext|auth.?tag|nonce|private.?key|api.?key)/i;

export class SeedManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedManifestError";
  }
}

export type BuildSeedManifestInput = Readonly<{
  anchorAt: string;
  blocks?: readonly SeedBlockDigest[];
  counts: SeedCounts;
  identities: readonly SeedIdentityRecord[];
  seedVersion: string;
}>;

export type BuildSeedContractInput = Readonly<{
  anchorAt: string;
  identities: readonly SeedIdentityRecord[];
  seedVersion: string;
}>;

export function assertGoldenSeedCounts(counts: SeedCounts): SeedCounts {
  assertClosedDataObject(counts, SEED_COUNT_KEYS, "Seed counts");

  const normalized = {} as Record<keyof SeedCounts, number>;
  for (const key of SEED_COUNT_KEYS) {
    const value = counts[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SeedManifestError(
        `Seed count ${key} must be a non-negative safe integer.`,
      );
    }

    const expected = SEED_GOLDEN_COUNTS[key];
    if (value !== expected) {
      throw new SeedManifestError(
        `Seed count ${key} must be exactly ${expected}; received ${value}.`,
      );
    }
    normalized[key] = value;
  }

  return Object.freeze(normalized);
}

/**
 * Creates a digest from an explicitly allowlisted, secret-free projection.
 * Property names associated with credentials are rejected before hashing.
 */
export function createSeedBlockDigest(
  name: string,
  recordCount: number,
  safeProjection: CanonicalJsonValue,
): SeedBlockDigest {
  validateBlockName(name);
  validateRecordCount(recordCount, name);
  assertSecretFreeProjection(safeProjection, `$block.${name}`, new Set<object>());

  return Object.freeze({
    digestSha256: sha256CanonicalJson(safeProjection),
    name,
    recordCount,
  });
}

/**
 * Builds the immutable header that is persisted before domain writes. Its hash
 * covers only the static contract, never observed/result counts.
 */
export function buildSeedContractHeader(
  input: BuildSeedContractInput,
): SeedContractHeader {
  validateSeedVersion(input.seedVersion);
  validateAnchorTime(input.anchorAt);
  const identities = assertSeedIdentityIntegrity(input.identities);
  const identityDigestSha256 = digestIdentities(identities);

  return Object.freeze({
    anchorAt: input.anchorAt,
    contractHash: computeContractHash(
      input.seedVersion,
      identities.length,
      identityDigestSha256,
    ),
    namespace: SEED_NAMESPACE,
    schemaVersion: SEED_MANIFEST_SCHEMA_VERSION,
    seedVersion: input.seedVersion,
  });
}

export function buildSeedManifest(
  input: BuildSeedManifestInput,
): SeedManifestEnvelope {
  validateSeedVersion(input.seedVersion);
  validateAnchorTime(input.anchorAt);

  const counts = assertGoldenSeedCounts(input.counts);
  const identities = assertSeedIdentityIntegrity(input.identities);
  const blocks = normalizeBlocks(input.blocks ?? []);
  const identityDigestSha256 = digestIdentities(identities);
  const contract = buildSeedContractHeader({
    anchorAt: input.anchorAt,
    identities,
    seedVersion: input.seedVersion,
  });

  const manifest: SeedManifest = Object.freeze({
    anchorAt: contract.anchorAt,
    blocks,
    contractHash: contract.contractHash,
    counts,
    dataProvenance: SEED_DATA_PROVENANCE,
    identityCount: identities.length,
    identityDigestSha256,
    namespace: contract.namespace,
    schemaVersion: contract.schemaVersion,
    seedVersion: contract.seedVersion,
  });

  return Object.freeze({
    manifest,
    manifestSha256: sha256CanonicalJson(
      manifest as unknown as CanonicalJsonValue,
    ),
  });
}

/** Validates a persisted/second-run envelope and rejects hidden extra fields. */
export function assertSeedManifestEnvelope(
  envelope: SeedManifestEnvelope,
): SeedManifestEnvelope {
  assertClosedDataObject(
    envelope,
    ["manifest", "manifestSha256"],
    "Seed manifest envelope",
  );
  assertSha256(envelope.manifestSha256, "manifestSha256");

  const manifest = envelope.manifest;
  assertClosedDataObject(
    manifest,
    [
      "anchorAt",
      "blocks",
      "contractHash",
      "counts",
      "dataProvenance",
      "identityCount",
      "identityDigestSha256",
      "namespace",
      "schemaVersion",
      "seedVersion",
    ],
    "Seed manifest",
  );

  if (manifest.schemaVersion !== SEED_MANIFEST_SCHEMA_VERSION) {
    throw new SeedManifestError("Seed manifest schema version is unsupported.");
  }
  if (manifest.dataProvenance !== SEED_DATA_PROVENANCE) {
    throw new SeedManifestError("Seed manifest provenance must be DEMO.");
  }
  if (manifest.namespace !== SEED_NAMESPACE) {
    throw new SeedManifestError("Seed manifest namespace is unsupported.");
  }

  validateSeedVersion(manifest.seedVersion);
  validateAnchorTime(manifest.anchorAt);
  assertGoldenSeedCounts(manifest.counts);
  assertSha256(manifest.contractHash, "contractHash");
  assertSha256(manifest.identityDigestSha256, "identityDigestSha256");
  if (!Number.isSafeInteger(manifest.identityCount) || manifest.identityCount < 0) {
    throw new SeedManifestError(
      "Seed manifest identityCount must be a non-negative safe integer.",
    );
  }
  normalizeBlocks(manifest.blocks);

  const expectedContractHash = computeContractHash(
    manifest.seedVersion,
    manifest.identityCount,
    manifest.identityDigestSha256,
  );
  if (manifest.contractHash !== expectedContractHash) {
    throw new SeedManifestError(
      "Seed contract hash does not match the static fixture contract.",
    );
  }

  const expectedHash = sha256CanonicalJson(
    manifest as unknown as CanonicalJsonValue,
  );
  if (envelope.manifestSha256 !== expectedHash) {
    throw new SeedManifestError("Seed manifest hash does not match its contents.");
  }

  return envelope;
}

export function formatSeedManifestLog(envelope: SeedManifestEnvelope): string {
  const validated = assertSeedManifestEnvelope(envelope);
  return `Seed manifest ${canonicalJson(
    validated as unknown as CanonicalJsonValue,
  )}`;
}

function normalizeBlocks(
  blocks: readonly SeedBlockDigest[],
): readonly SeedBlockDigest[] {
  if (!Array.isArray(blocks)) {
    throw new SeedManifestError("Seed manifest blocks must be an array.");
  }

  const seenNames = new Set<string>();
  const normalized = blocks.map((block) => {
    assertClosedDataObject(
      block,
      ["digestSha256", "name", "recordCount"],
      "Seed block digest",
    );
    validateBlockName(block.name);
    validateRecordCount(block.recordCount, block.name);
    assertSha256(block.digestSha256, `block ${block.name}`);

    if (seenNames.has(block.name)) {
      throw new SeedManifestError(`Duplicate seed block ${block.name}.`);
    }
    seenNames.add(block.name);

    return Object.freeze({
      digestSha256: block.digestSha256,
      name: block.name,
      recordCount: block.recordCount,
    });
  });

  return Object.freeze(
    normalized.sort((left, right) => compareText(left.name, right.name)),
  );
}

function validateSeedVersion(value: string): void {
  if (typeof value !== "string" || !SEED_VERSION_PATTERN.test(value)) {
    throw new SeedManifestError("Seed version must be a stable lowercase label.");
  }
}

function validateAnchorTime(value: string): void {
  if (typeof value !== "string") {
    throw new SeedManifestError("Seed anchor time must be a canonical UTC instant.");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new SeedManifestError(
      "Seed anchor time must use canonical ISO-8601 UTC milliseconds.",
    );
  }
}

function digestIdentities(
  identities: readonly SeedIdentityRecord[],
): string {
  return sha256CanonicalJson(
    identities.map(({ entity, id, naturalKey }) => [entity, naturalKey, id]),
  );
}

function computeContractHash(
  seedVersion: string,
  identityCount: number,
  identityDigestSha256: string,
): string {
  return sha256CanonicalJson({
    dataProvenance: SEED_DATA_PROVENANCE,
    exactGoldenCounts: SEED_GOLDEN_COUNTS,
    expectedIdentityCount: identityCount,
    expectedIdentityDigestSha256: identityDigestSha256,
    identityAlgorithm: "rfc4122-uuid-v5-sha1",
    identityNamespace: SEED_UUID_NAMESPACE,
    namespace: SEED_NAMESPACE,
    rules: [
      "guard-before-client",
      "idempotent-natural-keys",
      "exact-golden-counts",
      "canonical-sha256-manifest",
      "demo-data-never-market-evidence",
    ],
    schemaVersion: SEED_MANIFEST_SCHEMA_VERSION,
    seedVersion,
  });
}

function validateBlockName(value: string): void {
  if (typeof value !== "string" || !BLOCK_NAME_PATTERN.test(value)) {
    throw new SeedManifestError("Seed block name must be a stable lowercase label.");
  }
}

function validateRecordCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SeedManifestError(
      `Seed block ${name} recordCount must be a non-negative safe integer.`,
    );
  }
}

function assertSha256(value: string, label: string): void {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new SeedManifestError(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertClosedDataObject(
  value: object,
  expectedKeys: readonly string[],
  label: string,
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SeedManifestError(`${label} must be a plain data object.`);
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SeedManifestError(`${label} must be a plain data object.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new SeedManifestError(`${label} must not have symbol properties.`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Object.keys(descriptors).sort(compareText);
  const sortedExpectedKeys = [...expectedKeys].sort(compareText);
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new SeedManifestError(`${label} contains missing or unknown fields.`);
  }

  for (const key of actualKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new SeedManifestError(`${label}.${key} must be a data property.`);
    }
  }
}

function assertSecretFreeProjection(
  value: CanonicalJsonValue,
  path: string,
  ancestors: Set<object>,
): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      assertCredentialFreeUrl(value, path);
    }
    return;
  }

  if (ancestors.has(value)) {
    throw new SeedManifestError(`${path} contains a circular reference.`);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      value.forEach((entry, index) =>
        assertSecretFreeProjection(entry, `${path}[${index}]`, ancestors),
      );
      return;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (SENSITIVE_PROPERTY_PATTERN.test(key)) {
        throw new SeedManifestError(
          `${path}.${key} is not allowed in a manifest projection.`,
        );
      }
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new SeedManifestError(`${path}.${key} must be a data property.`);
      }
      assertSecretFreeProjection(
        descriptor.value as CanonicalJsonValue,
        `${path}.${key}`,
        ancestors,
      );
    }
  } finally {
    ancestors.delete(value);
  }
}

function assertCredentialFreeUrl(value: string, path: string): void {
  if (!value.includes("://")) {
    return;
  }

  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") {
      throw new SeedManifestError(
        `${path} must not contain URL credentials in a manifest projection.`,
      );
    }
  } catch (error) {
    if (error instanceof SeedManifestError) {
      throw error;
    }
    // It is ordinary fixture text containing ://, not a valid URL.
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
