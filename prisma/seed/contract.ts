export const SEED_MANIFEST_SCHEMA_VERSION =
  "20260720120000_phase_05_seed_manifest_contract" as const;
export const SEED_DATASET_VERSION = "phase-09-demo-v6" as const;
/**
 * Phase 09 is an additive release over the sealed Phase-05 dataset. Existing
 * semantic UUIDs and deterministic fixture streams must therefore keep their
 * published derivation input while the active manifest version rotates.
 */
export const SEED_COMPATIBILITY_BASE_VERSION = "phase-05-demo-v1" as const;
export const SEED_DATA_PROVENANCE = "DEMO" as const;
export const SEED_NAMESPACE = "swisstalenthub-demo" as const;

/**
 * Exact Phase-09 fixture contract. The Phase-05 golden business counts stay
 * unchanged; additive workflow evidence is verified in closed seed blocks.
 */
export const SEED_GOLDEN_COUNTS = Object.freeze({
  cantons: 26,
  cities: 29,
  categories: 18,
  skills: 72,
  occupationCodes: 40,
  plans: 5,
  planVersions: 8,
  planEntitlements: 64,
  products: 11,
  companies: 25,
  jobs: 115,
  candidates: 30,
  applications: 80,
  savedJobs: 41,
  jobAlerts: 15,
  employerContactRequests: 6,
  identityRevealGrants: 2,
  privacyRequests: 3,
  conversations: 82,
  orders: 12,
  invoices: 7,
  jobBoosts: 10,
  salesLeads: 4,
  auditLogs: 30,
  analyticsEvents: 300,
  contentPages: 7,
});

export const SEED_COUNT_KEYS = Object.freeze(
  Object.keys(SEED_GOLDEN_COUNTS) as Array<keyof typeof SEED_GOLDEN_COUNTS>,
);

export type SeedCountKey = (typeof SEED_COUNT_KEYS)[number];
export type SeedCounts = Readonly<Record<SeedCountKey, number>>;

export type SeedIdentityRecord = Readonly<{
  entity: string;
  id: string;
  naturalKey: string;
}>;

export type SeedBlockDigest = Readonly<{
  digestSha256: string;
  name: string;
  recordCount: number;
}>;

/** Header persisted before any domain row is written. */
export type SeedContractHeader = Readonly<{
  anchorAt: string;
  contractHash: string;
  namespace: typeof SEED_NAMESPACE;
  schemaVersion: typeof SEED_MANIFEST_SCHEMA_VERSION;
  seedVersion: string;
}>;

/** Log-safe by construction: it contains only closed metadata, counts and hashes. */
export type SeedManifest = Readonly<{
  anchorAt: string;
  blocks: readonly SeedBlockDigest[];
  contractHash: string;
  counts: SeedCounts;
  dataProvenance: typeof SEED_DATA_PROVENANCE;
  identityCount: number;
  identityDigestSha256: string;
  namespace: typeof SEED_NAMESPACE;
  schemaVersion: typeof SEED_MANIFEST_SCHEMA_VERSION;
  seedVersion: string;
}>;

export type SeedManifestEnvelope = Readonly<{
  manifest: SeedManifest;
  manifestSha256: string;
}>;
