import {
  canonicalJson,
  type CanonicalJsonValue,
} from "@/prisma/seed/canonical-json";

export class SeedDataDriftError extends Error {
  readonly entity: string;
  readonly naturalKey: string;

  constructor(entity: string, naturalKey: string) {
    super(
      `Seed data drift detected for ${entity} (${naturalKey}); rotate the seed version instead of rewriting released demo evidence.`,
    );
    this.name = "SeedDataDriftError";
    this.entity = entity;
    this.naturalKey = naturalKey;
  }
}

export type CreateOrVerifyInput<TRecord> = Readonly<{
  create: () => Promise<TRecord>;
  entity: string;
  findExisting: () => Promise<TRecord | null>;
  naturalKey: string;
  project: (record: TRecord) => CanonicalJsonValue;
  expected: CanonicalJsonValue;
}>;

export type CreateOrVerifyResult<TRecord> = Readonly<{
  created: boolean;
  record: TRecord;
}>;

/**
 * Seed rows are append-only evidence in several domains. This helper therefore
 * never performs an update: an existing row must match the closed projection,
 * otherwise the caller must rotate the versioned seed contract.
 */
export async function createOrVerifySeedRecord<TRecord>(
  input: CreateOrVerifyInput<TRecord>,
): Promise<CreateOrVerifyResult<TRecord>> {
  const existing = await input.findExisting();
  if (existing !== null) {
    assertSeedProjection(input, existing);
    return Object.freeze({ created: false, record: existing });
  }

  // Do not catch a unique violation and issue another query here. Most callers
  // run inside an interactive PostgreSQL transaction, where a failed INSERT
  // aborts the transaction until it is rolled back. Concurrency recovery must
  // therefore serialize or retry the complete run at its orchestration boundary.
  const created = await input.create();
  assertSeedProjection(input, created);
  return Object.freeze({ created: true, record: created });
}

export function assertSeedProjection<TRecord>(
  input: Pick<
    CreateOrVerifyInput<TRecord>,
    "entity" | "naturalKey" | "project" | "expected"
  >,
  record: TRecord,
): void {
  if (canonicalJson(input.project(record)) !== canonicalJson(input.expected)) {
    throw new SeedDataDriftError(input.entity, input.naturalKey);
  }
}
