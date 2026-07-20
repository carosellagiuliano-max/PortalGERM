import type { DatabaseClient } from "@/lib/db/factory";
import {
  SEED_COMPATIBILITY_BASE_VERSION,
  SEED_DATASET_VERSION,
  SEED_MANIFEST_SCHEMA_VERSION,
  SEED_NAMESPACE,
  type SeedIdentityRecord,
  type SeedManifestEnvelope,
} from "@/prisma/seed/contract";
import { buildSeedContractHeader } from "@/prisma/seed/manifest";

export type SeedRunLifecycle = Readonly<{
  anchorAt: Date;
  completed: boolean;
  manifestHash: string | null;
}>;

export class SeedLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedLifecycleError";
  }
}

/**
 * Persists the first attempt's clock before any domain write. A failed run can
 * safely resume with the same anchor; a changed fixture contract must rotate
 * SEED_DATASET_VERSION and can never repurpose the old evidence row.
 */
export async function beginSeedRun(
  database: DatabaseClient,
  identities: readonly SeedIdentityRecord[],
  clock: () => Date = () => new Date(),
): Promise<SeedRunLifecycle> {
  const key = {
    namespace: SEED_NAMESPACE,
    seedVersion: SEED_DATASET_VERSION,
  } as const;
  const existing = await database.demoSeedManifest.findUnique({
    where: { namespace_seedVersion: key },
  });

  if (existing !== null) {
    return verifyPersistedLifecycle(existing, identities);
  }

  const anchorAt = await resolveInitialAnchor(database, clock);
  const header = buildSeedContractHeader({
    anchorAt: anchorAt.toISOString(),
    identities,
    seedVersion: SEED_DATASET_VERSION,
  });

  try {
    const created = await database.demoSeedManifest.create({
      data: {
        anchorAt,
        contractHash: header.contractHash,
        namespace: header.namespace,
        schemaVersion: header.schemaVersion,
        seedVersion: header.seedVersion,
      },
    });
    return verifyPersistedLifecycle(created, identities);
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const raced = await database.demoSeedManifest.findUnique({
      where: { namespace_seedVersion: key },
    });
    if (raced === null) {
      throw error;
    }
    return verifyPersistedLifecycle(raced, identities);
  }
}

/**
 * An additive release must evaluate the already-published fixture rows against
 * the same clock that created them. A sealed compatibility manifest is the
 * authoritative source; on a genuinely fresh database the regular clock is
 * used instead.
 */
async function resolveInitialAnchor(
  database: DatabaseClient,
  clock: () => Date,
): Promise<Date> {
  const compatibilityManifest = await database.demoSeedManifest.findUnique({
    where: {
      namespace_seedVersion: {
        namespace: SEED_NAMESPACE,
        seedVersion: SEED_COMPATIBILITY_BASE_VERSION,
      },
    },
  });
  if (compatibilityManifest === null) {
    return canonicalClockInstant(clock());
  }

  if (
    compatibilityManifest.namespace !== SEED_NAMESPACE ||
    compatibilityManifest.seedVersion !== SEED_COMPATIBILITY_BASE_VERSION ||
    compatibilityManifest.schemaVersion !== SEED_MANIFEST_SCHEMA_VERSION ||
    compatibilityManifest.completedAt === null ||
    compatibilityManifest.manifestHash === null ||
    !isSha256(compatibilityManifest.contractHash) ||
    !isSha256(compatibilityManifest.manifestHash)
  ) {
    throw new SeedLifecycleError(
      "The Phase-05 compatibility manifest must be valid and sealed before Phase-06 can inherit its anchor.",
    );
  }

  return canonicalClockInstant(compatibilityManifest.anchorAt);
}

/** Seals an incomplete run exactly once, or verifies a concurrent completion. */
export async function completeSeedRun(
  database: DatabaseClient,
  envelope: SeedManifestEnvelope,
  clock: () => Date = () => new Date(),
): Promise<void> {
  const manifest = envelope.manifest;
  if (
    manifest.namespace !== SEED_NAMESPACE ||
    manifest.seedVersion !== SEED_DATASET_VERSION ||
    manifest.schemaVersion !== SEED_MANIFEST_SCHEMA_VERSION
  ) {
    throw new SeedLifecycleError(
      "Refusing to complete a manifest outside the active seed contract.",
    );
  }

  const anchorAt = new Date(manifest.anchorAt);
  const observedCompletion = canonicalClockInstant(clock());
  const completedAt =
    observedCompletion.valueOf() < anchorAt.valueOf()
      ? anchorAt
      : observedCompletion;

  const result = await database.demoSeedManifest.updateMany({
    data: {
      completedAt,
      manifestHash: envelope.manifestSha256,
    },
    where: {
      completedAt: null,
      contractHash: manifest.contractHash,
      manifestHash: null,
      namespace: manifest.namespace,
      schemaVersion: manifest.schemaVersion,
      seedVersion: manifest.seedVersion,
    },
  });

  if (result.count === 1) {
    return;
  }

  const persisted = await database.demoSeedManifest.findUnique({
    where: {
      namespace_seedVersion: {
        namespace: SEED_NAMESPACE,
        seedVersion: SEED_DATASET_VERSION,
      },
    },
  });
  if (
    persisted?.manifestHash !== envelope.manifestSha256 ||
    persisted.completedAt === null ||
    persisted.contractHash !== manifest.contractHash
  ) {
    throw new SeedLifecycleError(
      "The seed manifest could not be sealed with the verified result hash.",
    );
  }
}

function verifyPersistedLifecycle(
  persisted: Readonly<{
    anchorAt: Date;
    completedAt: Date | null;
    contractHash: string;
    manifestHash: string | null;
    namespace: string;
    schemaVersion: string;
    seedVersion: string;
  }>,
  identities: readonly SeedIdentityRecord[],
): SeedRunLifecycle {
  const header = buildSeedContractHeader({
    anchorAt: persisted.anchorAt.toISOString(),
    identities,
    seedVersion: SEED_DATASET_VERSION,
  });

  if (
    persisted.namespace !== header.namespace ||
    persisted.seedVersion !== header.seedVersion ||
    persisted.schemaVersion !== header.schemaVersion ||
    persisted.contractHash !== header.contractHash
  ) {
    throw new SeedLifecycleError(
      "The persisted seed header does not match the active fixture contract; rotate the seed version.",
    );
  }
  if ((persisted.completedAt === null) !== (persisted.manifestHash === null)) {
    throw new SeedLifecycleError(
      "The persisted seed completion projection is inconsistent.",
    );
  }

  return Object.freeze({
    anchorAt: new Date(persisted.anchorAt),
    completed: persisted.completedAt !== null,
    manifestHash: persisted.manifestHash,
  });
}

function canonicalClockInstant(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new SeedLifecycleError("The seed clock returned an invalid instant.");
  }
  return new Date(value.toISOString());
}

function isUniqueConstraintError(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const candidate = error as Readonly<{ code?: unknown }>;
  return candidate.code === "P2002" || candidate.code === "23505";
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}
