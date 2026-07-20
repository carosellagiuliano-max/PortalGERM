import { createHash } from "node:crypto";

import {
  SEED_COMPATIBILITY_BASE_VERSION,
  type SeedIdentityRecord,
} from "@/prisma/seed/contract";

// A repository-owned namespace. Changing it is an intentional identity break.
export const SEED_UUID_NAMESPACE = "0cd6561d-6bb7-5bf0-9b26-814c5829f5ad";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENTITY_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type SeedIdentityErrorCode =
  | "DUPLICATE_ID"
  | "DUPLICATE_NATURAL_KEY"
  | "ID_DRIFT"
  | "INVALID_ENTITY"
  | "INVALID_ID"
  | "INVALID_NATURAL_KEY";

export class SeedIdentityError extends Error {
  readonly code: SeedIdentityErrorCode;

  constructor(code: SeedIdentityErrorCode, message: string) {
    super(message);
    this.name = "SeedIdentityError";
    this.code = code;
  }
}

export function canonicalizeSeedNaturalKey(naturalKey: string): string {
  if (typeof naturalKey !== "string") {
    throw new SeedIdentityError(
      "INVALID_NATURAL_KEY",
      "A seed natural key must be a string.",
    );
  }

  const canonical = naturalKey.trim().normalize("NFC").toLowerCase();
  if (
    canonical.length === 0 ||
    canonical.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(canonical)
  ) {
    throw new SeedIdentityError(
      "INVALID_NATURAL_KEY",
      "A seed natural key must contain 1 to 512 visible characters.",
    );
  }

  return canonical;
}

export function stableSeedId(entity: string, naturalKey: string): string {
  const canonicalEntity = validateEntity(entity);
  const canonicalNaturalKey = canonicalizeSeedNaturalKey(naturalKey);
  const semanticIdentity = encodeSemanticIdentity(
    canonicalEntity,
    canonicalNaturalKey,
  );

  return uuidV5(semanticIdentity, SEED_UUID_NAMESPACE);
}

export function createSeedIdentity(
  entity: string,
  naturalKey: string,
): SeedIdentityRecord {
  const canonicalEntity = validateEntity(entity);
  const canonicalNaturalKey = canonicalizeSeedNaturalKey(naturalKey);

  return Object.freeze({
    entity: canonicalEntity,
    id: stableSeedId(canonicalEntity, canonicalNaturalKey),
    naturalKey: canonicalNaturalKey,
  });
}

/**
 * Detects duplicate natural keys, duplicate UUIDs and accidental UUID drift.
 * The returned snapshot is sorted so seed execution order cannot change a
 * manifest hash.
 */
export function assertSeedIdentityIntegrity(
  records: readonly SeedIdentityRecord[],
): readonly SeedIdentityRecord[] {
  if (!Array.isArray(records)) {
    throw new SeedIdentityError(
      "INVALID_NATURAL_KEY",
      "Seed identities must be provided as an array.",
    );
  }

  const normalized = records.map(normalizeIdentityRecord);
  const seenSemanticKeys = new Set<string>();
  const seenIds = new Set<string>();

  for (const record of normalized) {
    const semanticKey = encodeSemanticIdentity(record.entity, record.naturalKey);
    if (seenSemanticKeys.has(semanticKey)) {
      throw new SeedIdentityError(
        "DUPLICATE_NATURAL_KEY",
        `Duplicate seed natural key for entity ${record.entity}.`,
      );
    }
    seenSemanticKeys.add(semanticKey);

    if (seenIds.has(record.id)) {
      throw new SeedIdentityError(
        "DUPLICATE_ID",
        "Duplicate seed UUID detected across semantic identities.",
      );
    }
    seenIds.add(record.id);
  }

  for (const record of normalized) {
    const expected = stableSeedId(record.entity, record.naturalKey);
    if (record.id !== expected) {
      throw new SeedIdentityError(
        "ID_DRIFT",
        `Stable seed UUID drift detected for entity ${record.entity}.`,
      );
    }
  }

  return Object.freeze(
    [...normalized].sort(
      (left, right) =>
        compareText(left.entity, right.entity) ||
        compareText(left.naturalKey, right.naturalKey) ||
        compareText(left.id, right.id),
    ),
  );
}

export class SeedIdentityRegistry {
  readonly #records: SeedIdentityRecord[] = [];

  register(
    entity: string,
    naturalKey: string,
    id = stableSeedId(entity, naturalKey),
  ): SeedIdentityRecord {
    const record = Object.freeze({ entity, id, naturalKey });
    assertSeedIdentityIntegrity([...this.#records, record]);
    const normalized = createNormalizedIdentity(record);
    this.#records.push(normalized);
    return normalized;
  }

  snapshot(): readonly SeedIdentityRecord[] {
    return assertSeedIdentityIntegrity(this.#records);
  }
}

function normalizeIdentityRecord(record: SeedIdentityRecord): SeedIdentityRecord {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new SeedIdentityError(
      "INVALID_NATURAL_KEY",
      "Every seed identity must be a data object.",
    );
  }

  return createNormalizedIdentity(record);
}

function createNormalizedIdentity(
  record: SeedIdentityRecord,
): SeedIdentityRecord {
  const entity = validateEntity(record.entity);
  const naturalKey = canonicalizeSeedNaturalKey(record.naturalKey);
  const id = validateId(record.id);

  return Object.freeze({ entity, id, naturalKey });
}

function validateEntity(entity: string): string {
  if (typeof entity !== "string" || !ENTITY_PATTERN.test(entity)) {
    throw new SeedIdentityError(
      "INVALID_ENTITY",
      "A seed entity must use a lowercase stable identifier.",
    );
  }
  return entity;
}

function validateId(id: string): string {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw new SeedIdentityError(
      "INVALID_ID",
      "A seed identity must use a canonical lowercase UUID.",
    );
  }
  return id;
}

function encodeSemanticIdentity(entity: string, naturalKey: string): string {
  return [SEED_COMPATIBILITY_BASE_VERSION, entity, naturalKey]
    .map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`)
    .join("");
}

function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  if (namespaceBytes.length !== 16) {
    throw new SeedIdentityError(
      "INVALID_ID",
      "The seed UUID namespace is invalid.",
    );
  }

  const bytes = createHash("sha1")
    .update(namespaceBytes)
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
