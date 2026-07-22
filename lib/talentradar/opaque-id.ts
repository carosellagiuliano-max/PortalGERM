import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  buildRadarOpaqueLookup,
  decryptRadarOpaqueToken,
  encryptRadarOpaqueToken,
  type RadarOpaqueBinding,
  type RadarOpaqueEnvelope,
  type RadarOpaqueKey,
  type RadarOpaqueLookup,
} from "@/lib/privacy/radar-opaque";

const MILLISECONDS_PER_DAY = 86_400_000;
const ZURICH_TIME_ZONE = "Europe/Zurich";
const ANCHOR_CIVIL_DAY = Date.UTC(2026, 0, 1);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const zurichDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZURICH_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const zurichDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZURICH_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export const RADAR_OPAQUE_EPOCH_POLICY_V1 = Object.freeze({
  version: "v1" as const,
  timeZone: ZURICH_TIME_ZONE,
  anchorCalendarDate: "2026-01-01" as const,
  calendarDays: 30,
});

export type RadarOpaqueEpoch = Readonly<{
  index: number;
  /** UTC-midnight label persisted in the schema's `@db.Date` epoch column. */
  epoch: Date;
  /** Exact instant of the epoch's Zurich-local midnight. */
  validFrom: Date;
  /** Half-open end: the next epoch's Zurich-local midnight. */
  validTo: Date;
}>;

export type RadarOpaqueMappingRecord = Readonly<{
  id: string;
  candidateProfileId: string;
  companyId: string;
  epoch: Date;
  lookupHmac: string;
  encryptedToken: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
  lookupKeyVersion: string;
  encryptionKeyVersion: string;
  validFrom: Date;
  validTo: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
}>;

export type RadarOpaqueMappingWrite = RadarOpaqueMappingRecord;

export type RadarOpaqueIssuedId = Readonly<{
  /** Raw value may be copied only into an already-authorized Safe DTO. */
  opaqueId: string;
  mapping: RadarOpaqueMappingWrite;
}>;

export type RadarOpaqueLookupCandidate = RadarOpaqueLookup;

export interface RadarOpaqueResolutionRepository {
  /**
   * The adapter must scope by companyId and epoch and return all matches for
   * the supplied version/HMAC pairs. Returning anything but exactly one row
   * fails closed.
   */
  findByScopedLookups(input: Readonly<{
    companyId: string;
    epoch: Date;
    lookups: readonly RadarOpaqueLookupCandidate[];
  }>): Promise<readonly RadarOpaqueMappingRecord[]>;
}

export type RadarOpaqueResolution =
  | Readonly<{
      ok: true;
      mappingId: string;
      candidateProfileId: string;
      validTo: Date;
    }>
  | Readonly<{ ok: false; code: "NOT_FOUND" }>;

export type RadarOpaqueRevocationReason =
  | "CANDIDATE_OPTED_OUT"
  | "CANDIDATE_PROFILE_INCOMPLETE"
  | "CANDIDATE_USER_UNAVAILABLE"
  | "COMPANY_INACTIVE"
  | "COMPANY_VERIFICATION_LOST";

export function getRadarOpaqueEpoch(now: Date): RadarOpaqueEpoch {
  assertValidDate(now, "Radar opaque epoch time");
  const localDate = zurichDateParts(now);
  const localCivilDay = Date.UTC(
    localDate.year,
    localDate.month - 1,
    localDate.day,
  );
  const elapsedDays = Math.floor(
    (localCivilDay - ANCHOR_CIVIL_DAY) / MILLISECONDS_PER_DAY,
  );
  if (elapsedDays < 0) {
    throw new RangeError("Radar opaque epochs start on 2026-01-01 Europe/Zurich.");
  }

  const index = Math.floor(
    elapsedDays / RADAR_OPAQUE_EPOCH_POLICY_V1.calendarDays,
  );
  const startCivilDay =
    ANCHOR_CIVIL_DAY +
    index * RADAR_OPAQUE_EPOCH_POLICY_V1.calendarDays * MILLISECONDS_PER_DAY;
  const endCivilDay =
    startCivilDay +
    RADAR_OPAQUE_EPOCH_POLICY_V1.calendarDays * MILLISECONDS_PER_DAY;
  const start = utcCivilParts(startCivilDay);
  const end = utcCivilParts(endCivilDay);

  return Object.freeze({
    index,
    epoch: new Date(startCivilDay),
    validFrom: zurichLocalMidnightToInstant(start.year, start.month, start.day),
    validTo: zurichLocalMidnightToInstant(end.year, end.month, end.day),
  });
}

/**
 * Mints a random company/candidate/epoch-scoped mapping. The raw token is
 * returned only under the explicit `opaqueId` name for immediate Safe-DTO use;
 * callers persist `mapping`, never the raw value.
 */
export function mintRadarOpaqueIdForAuthorizedDto(input: Readonly<{
  mappingId?: string;
  candidateProfileId: string;
  companyId: string;
  now: Date;
  lookupKeyring: readonly RadarOpaqueKey[];
  encryptionKeyring: readonly RadarOpaqueKey[];
}>): RadarOpaqueIssuedId {
  const epoch = getRadarOpaqueEpoch(input.now);
  const binding: RadarOpaqueBinding = {
    mappingId: input.mappingId ?? randomUUID(),
    candidateProfileId: input.candidateProfileId,
    companyId: input.companyId,
    epoch: epoch.epoch,
  };
  const { token, envelope } = encryptRadarOpaqueToken(
    input.lookupKeyring,
    input.encryptionKeyring,
    binding,
  );

  return Object.freeze({
    opaqueId: token,
    mapping: mappingFromEnvelope(binding, envelope, epoch, input.now),
  });
}

/**
 * A revoked mapping is never revived with its old token. Within the same
 * epoch, the existing row id is replaced because the schema intentionally has
 * one `(candidateProfileId, companyId, epoch)` row; in a later epoch a new row
 * id is produced.
 */
export function remintRadarOpaqueIdAfterReoptIn(input: Readonly<{
  previous: Pick<
    RadarOpaqueMappingRecord,
    "id" | "candidateProfileId" | "companyId" | "epoch" | "revokedAt"
  >;
  now: Date;
  lookupKeyring: readonly RadarOpaqueKey[];
  encryptionKeyring: readonly RadarOpaqueKey[];
}>): RadarOpaqueIssuedId & Readonly<{ persistenceMode: "CREATE" | "REPLACE_REVOKED" }> {
  if (
    input.previous.revokedAt === null ||
    !isValidDate(input.previous.revokedAt) ||
    input.previous.revokedAt.getTime() > input.now.getTime()
  ) {
    throw new TypeError("Radar opaque re-opt-in requires a revoked mapping.");
  }
  const currentEpoch = getRadarOpaqueEpoch(input.now);
  const replaceCurrentEpoch = sameInstant(
    input.previous.epoch,
    currentEpoch.epoch,
  );
  const issued = mintRadarOpaqueIdForAuthorizedDto({
    mappingId: replaceCurrentEpoch ? input.previous.id : undefined,
    candidateProfileId: input.previous.candidateProfileId,
    companyId: input.previous.companyId,
    now: input.now,
    lookupKeyring: input.lookupKeyring,
    encryptionKeyring: input.encryptionKeyring,
  });
  return Object.freeze({
    ...issued,
    persistenceMode: replaceCurrentEpoch ? "REPLACE_REVOKED" : "CREATE",
  });
}

export function buildRadarOpaqueRevocation(
  reason: RadarOpaqueRevocationReason,
  now: Date,
): Readonly<{ revokedAt: Date; revocationReason: RadarOpaqueRevocationReason }> {
  assertValidDate(now, "Radar opaque revocation time");
  if (!isRevocationReason(reason)) {
    throw new TypeError("Radar opaque revocation reason is invalid.");
  }
  return Object.freeze({
    revokedAt: new Date(now),
    revocationReason: reason,
  });
}

export function buildRadarOpaqueLookupCandidates(
  opaqueId: string,
  companyId: string,
  epoch: Date,
  lookupKeyring: readonly RadarOpaqueKey[],
): readonly RadarOpaqueLookupCandidate[] {
  const candidates = lookupKeyring.map((key) =>
    buildRadarOpaqueLookup(opaqueId, [key], { companyId, epoch }),
  );
  const unique = new Map(
    candidates.map((candidate) => [
      `${candidate.lookupKeyVersion}:${candidate.lookupHmac}`,
      candidate,
    ]),
  );
  return Object.freeze([...unique.values()]);
}

/**
 * Resolves only a current, unrevoked, company-bound mapping. Malformed,
 * expired, revoked, cross-company, cross-epoch, ambiguous and cryptographically
 * invalid values deliberately collapse to the same NOT_FOUND result.
 */
export async function resolveRadarOpaqueId(
  input: Readonly<{
    opaqueId: string;
    companyId: string;
    now: Date;
    lookupKeyring: readonly RadarOpaqueKey[];
    encryptionKeyring: readonly RadarOpaqueKey[];
  }>,
  repository: RadarOpaqueResolutionRepository,
): Promise<RadarOpaqueResolution> {
  let epoch: RadarOpaqueEpoch;
  let lookups: readonly RadarOpaqueLookupCandidate[];
  try {
    if (!UUID_PATTERN.test(input.companyId)) return notFound();
    epoch = getRadarOpaqueEpoch(input.now);
    lookups = buildRadarOpaqueLookupCandidates(
      input.opaqueId,
      input.companyId,
      epoch.epoch,
      input.lookupKeyring,
    );
    if (lookups.length === 0) return notFound();
  } catch {
    return notFound();
  }

  // Infrastructure failures are not token-validity signals and must remain
  // visible to the caller's normal operational error handling.
  const records = await repository.findByScopedLookups({
    companyId: input.companyId,
    epoch: epoch.epoch,
    lookups,
  });
  try {
    if (records.length !== 1) return notFound();
    const record = records[0];
    if (
      record === undefined ||
      record.companyId !== input.companyId ||
      !sameInstant(record.epoch, epoch.epoch) ||
      !sameInstant(record.validTo, epoch.validTo) ||
      record.validFrom.getTime() < epoch.validFrom.getTime() ||
      record.validFrom.getTime() >= epoch.validTo.getTime() ||
      record.revokedAt !== null ||
      input.now.getTime() < record.validFrom.getTime() ||
      input.now.getTime() >= record.validTo.getTime() ||
      !lookups.some(
        (lookup) =>
          lookup.lookupKeyVersion === record.lookupKeyVersion &&
          lookup.lookupHmac === record.lookupHmac,
      )
    ) {
      return notFound();
    }

    const decrypted = decryptRadarOpaqueToken(
      envelopeFromRecord(record),
      input.lookupKeyring,
      input.encryptionKeyring,
      bindingFromRecord(record),
    );
    if (!constantTimeEqual(decrypted, input.opaqueId)) return notFound();

    return Object.freeze({
      ok: true,
      mappingId: record.id,
      candidateProfileId: record.candidateProfileId,
      validTo: new Date(record.validTo),
    });
  } catch {
    return notFound();
  }
}

export function isCurrentRadarOpaqueMapping(
  mapping: Pick<
    RadarOpaqueMappingRecord,
    "companyId" | "epoch" | "validFrom" | "validTo" | "revokedAt"
  >,
  companyId: string,
  now: Date,
): boolean {
  try {
    const epoch = getRadarOpaqueEpoch(now);
    return (
      mapping.companyId === companyId &&
      sameInstant(mapping.epoch, epoch.epoch) &&
      sameInstant(mapping.validTo, epoch.validTo) &&
      mapping.validFrom.getTime() >= epoch.validFrom.getTime() &&
      mapping.validFrom.getTime() < epoch.validTo.getTime() &&
      mapping.revokedAt === null &&
      now.getTime() >= mapping.validFrom.getTime() &&
      now.getTime() < mapping.validTo.getTime()
    );
  } catch {
    return false;
  }
}

function mappingFromEnvelope(
  binding: RadarOpaqueBinding,
  envelope: RadarOpaqueEnvelope,
  epoch: RadarOpaqueEpoch,
  mintedAt: Date,
): RadarOpaqueMappingWrite {
  return Object.freeze({
    id: binding.mappingId,
    candidateProfileId: binding.candidateProfileId,
    companyId: binding.companyId,
    epoch: new Date(epoch.epoch),
    lookupHmac: envelope.lookupHmac,
    encryptedToken: Uint8Array.from(envelope.encryptedToken),
    nonce: Uint8Array.from(envelope.nonce),
    authTag: Uint8Array.from(envelope.authTag),
    lookupKeyVersion: envelope.lookupKeyVersion,
    encryptionKeyVersion: envelope.encryptionKeyVersion,
    validFrom: new Date(mintedAt),
    validTo: new Date(epoch.validTo),
    revokedAt: null,
    revocationReason: null,
  });
}

function bindingFromRecord(record: RadarOpaqueMappingRecord): RadarOpaqueBinding {
  return {
    mappingId: record.id,
    candidateProfileId: record.candidateProfileId,
    companyId: record.companyId,
    epoch: record.epoch,
  };
}

function envelopeFromRecord(record: RadarOpaqueMappingRecord): RadarOpaqueEnvelope {
  return {
    lookupHmac: record.lookupHmac,
    encryptedToken: record.encryptedToken,
    nonce: record.nonce,
    authTag: record.authTag,
    lookupKeyVersion: record.lookupKeyVersion,
    encryptionKeyVersion: record.encryptionKeyVersion,
  };
}

function zurichDateParts(instant: Date): Readonly<{
  year: number;
  month: number;
  day: number;
}> {
  const parts = formatterParts(zurichDateFormatter, instant);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
  };
}

function zurichLocalMidnightToInstant(
  year: number,
  month: number,
  day: number,
): Date {
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatterParts(
      zurichDateTimeFormatter,
      new Date(candidate),
    );
    const observed = Date.UTC(
      numberPart(parts, "year"),
      numberPart(parts, "month") - 1,
      numberPart(parts, "day"),
      numberPart(parts, "hour"),
      numberPart(parts, "minute"),
      numberPart(parts, "second"),
    );
    const correction = desired - observed;
    candidate += correction;
    if (correction === 0) return new Date(candidate);
  }
  throw new Error("Europe/Zurich calendar conversion failed.");
}

function formatterParts(
  formatter: Intl.DateTimeFormat,
  instant: Date,
): Intl.DateTimeFormatPart[] {
  return formatter.formatToParts(instant);
}

function numberPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) throw new Error("Europe/Zurich calendar part missing.");
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error("Europe/Zurich calendar part invalid.");
  }
  return parsed;
}

function utcCivilParts(timestamp: number): Readonly<{
  year: number;
  month: number;
  day: number;
}> {
  const value = new Date(timestamp);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function sameInstant(left: Date, right: Date): boolean {
  return isValidDate(left) && isValidDate(right) && left.getTime() === right.getTime();
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function notFound(): Readonly<{ ok: false; code: "NOT_FOUND" }> {
  return Object.freeze({ ok: false, code: "NOT_FOUND" });
}

function isRevocationReason(value: string): value is RadarOpaqueRevocationReason {
  return (
    value === "CANDIDATE_OPTED_OUT" ||
    value === "CANDIDATE_PROFILE_INCOMPLETE" ||
    value === "CANDIDATE_USER_UNAVAILABLE" ||
    value === "COMPANY_INACTIVE" ||
    value === "COMPANY_VERIFICATION_LOST"
  );
}

function assertValidDate(value: Date, label: string): void {
  if (!isValidDate(value)) throw new TypeError(`${label} is invalid.`);
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
