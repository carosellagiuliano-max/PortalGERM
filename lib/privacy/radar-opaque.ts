import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const LOOKUP_HMAC = /^[a-f0-9]{64}$/;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const UUID = z.string().uuid();

export const RADAR_OPAQUE_POLICY_V1 = Object.freeze({
  schemaVersion: "v1" as const,
  algorithm: "aes-256-gcm" as const,
  tokenBytes: 16,
  nonceBytes: 12,
  authTagBytes: 16,
});

export type RadarOpaqueKey = Readonly<{
  version: string;
  secret: string;
}>;

export type RadarOpaqueLookupScope = Readonly<{
  companyId: string;
  epoch: Date;
}>;

export type RadarOpaqueBinding = RadarOpaqueLookupScope &
  Readonly<{
    mappingId: string;
    candidateProfileId: string;
  }>;

export type RadarOpaqueEnvelope = Readonly<{
  lookupHmac: string;
  encryptedToken: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
  lookupKeyVersion: string;
  encryptionKeyVersion: string;
}>;

export type RadarOpaqueLookup = Readonly<{
  lookupHmac: string;
  lookupKeyVersion: string;
}>;

/**
 * Creates a fresh, unpadded canonical base64url token carrying 128 bits of
 * CSPRNG entropy, plus its scope-bound lookup and encryption envelope.
 */
export function encryptRadarOpaqueToken(
  lookupKeyring: readonly RadarOpaqueKey[],
  encryptionKeyring: readonly RadarOpaqueKey[],
  binding: RadarOpaqueBinding,
): Readonly<{ token: string; envelope: RadarOpaqueEnvelope }> {
  assertBinding(binding);
  const lookupKey = requireActiveKey(lookupKeyring, "Radar lookup");
  const encryptionKey = requireActiveKey(encryptionKeyring, "Radar encryption");
  const token = randomBytes(RADAR_OPAQUE_POLICY_V1.tokenBytes).toString("base64url");
  assertOpaqueToken(token);

  const lookupHmac = calculateLookupHmac(token, lookupKey, binding);
  const nonce = randomBytes(RADAR_OPAQUE_POLICY_V1.nonceBytes);
  const cipher = createCipheriv(
    RADAR_OPAQUE_POLICY_V1.algorithm,
    deriveKey(keyBytes(encryptionKey, "Radar encryption"), "encryption"),
    nonce,
  );
  cipher.setAAD(
    associatedData(
      binding,
      lookupHmac,
      lookupKey.version,
      encryptionKey.version,
    ),
  );
  const encryptedToken = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  return Object.freeze({
    token,
    envelope: Object.freeze({
      lookupHmac,
      encryptedToken: Uint8Array.from(encryptedToken),
      nonce: Uint8Array.from(nonce),
      authTag: Uint8Array.from(cipher.getAuthTag()),
      lookupKeyVersion: lookupKey.version,
      encryptionKeyVersion: encryptionKey.version,
    }),
  });
}

/**
 * Produces the real database lookup for an opaque token in its company/epoch
 * scope. The active keyring entry is always the writer key.
 */
export function buildRadarOpaqueLookup(
  token: string,
  lookupKeyring: readonly RadarOpaqueKey[],
  scope: RadarOpaqueLookupScope,
): RadarOpaqueLookup {
  assertOpaqueToken(token);
  assertLookupScope(scope);
  const key = requireActiveKey(lookupKeyring, "Radar lookup");
  return Object.freeze({
    lookupHmac: calculateLookupHmac(token, key, scope),
    lookupKeyVersion: key.version,
  });
}

/**
 * Authenticates the complete mapping binding and returns only the canonical
 * opaque token. Every failure is intentionally collapsed to one safe error.
 */
export function decryptRadarOpaqueToken(
  envelope: RadarOpaqueEnvelope,
  lookupKeyring: readonly RadarOpaqueKey[],
  encryptionKeyring: readonly RadarOpaqueKey[],
  binding: RadarOpaqueBinding,
): string {
  try {
    assertBinding(binding);
    assertEnvelope(envelope);
    const lookupKey = lookupKeyring.find(
      ({ version }) => version === envelope.lookupKeyVersion,
    );
    const encryptionKey = encryptionKeyring.find(
      ({ version }) => version === envelope.encryptionKeyVersion,
    );
    if (lookupKey === undefined || encryptionKey === undefined) {
      throw new Error("missing-key");
    }

    const decipher = createDecipheriv(
      RADAR_OPAQUE_POLICY_V1.algorithm,
      deriveKey(keyBytes(encryptionKey, "Radar encryption"), "encryption"),
      envelope.nonce,
    );
    decipher.setAAD(
      associatedData(
        binding,
        envelope.lookupHmac,
        envelope.lookupKeyVersion,
        envelope.encryptionKeyVersion,
      ),
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag));
    const token = Buffer.concat([
      decipher.update(envelope.encryptedToken),
      decipher.final(),
    ]).toString("utf8");
    assertOpaqueToken(token);

    const expectedLookupHmac = calculateLookupHmac(token, lookupKey, binding);
    if (!constantTimeTextEqual(expectedLookupHmac, envelope.lookupHmac)) {
      throw new Error("lookup-integrity");
    }
    return token;
  } catch {
    throw new Error("Radar opaque token is unavailable.");
  }
}

function calculateLookupHmac(
  token: string,
  key: RadarOpaqueKey,
  scope: RadarOpaqueLookupScope,
): string {
  return createHmac(
    "sha256",
    deriveKey(keyBytes(key, "Radar lookup"), "lookup"),
  )
    .update(
      [
        "radar-opaque-lookup-v1",
        key.version,
        scope.companyId,
        scope.epoch.toISOString(),
        token,
      ].join("\0"),
      "utf8",
    )
    .digest("hex");
}

function associatedData(
  binding: RadarOpaqueBinding,
  lookupHmac: string,
  lookupKeyVersion: string,
  encryptionKeyVersion: string,
): Buffer {
  return Buffer.from(
    [
      "radar-opaque-envelope-v1",
      binding.mappingId,
      binding.candidateProfileId,
      binding.companyId,
      binding.epoch.toISOString(),
      lookupHmac,
      lookupKeyVersion,
      encryptionKeyVersion,
      RADAR_OPAQUE_POLICY_V1.schemaVersion,
    ].join("\0"),
    "utf8",
  );
}

function requireActiveKey(
  keyring: readonly RadarOpaqueKey[],
  label: string,
): RadarOpaqueKey {
  const key = keyring[0];
  if (key === undefined) {
    throw new TypeError(`${label} keyring requires an active writer key.`);
  }
  keyBytes(key, label);
  return key;
}

function keyBytes(key: RadarOpaqueKey, label: string): Buffer {
  if (!KEY_VERSION.test(key.version)) {
    throw new TypeError(`${label} key version is invalid.`);
  }
  const decoded = Buffer.from(key.secret, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== key.secret) {
    throw new TypeError(`${label} key must be canonical base64 for exactly 32 bytes.`);
  }
  return decoded;
}

function deriveKey(key: Buffer, purpose: "lookup" | "encryption"): Buffer {
  return createHmac("sha256", key)
    .update(`swisstalenthub:radar-opaque:${purpose}:v1`, "utf8")
    .digest();
}

function assertEnvelope(envelope: RadarOpaqueEnvelope): void {
  if (
    !LOOKUP_HMAC.test(envelope.lookupHmac) ||
    !KEY_VERSION.test(envelope.lookupKeyVersion) ||
    !KEY_VERSION.test(envelope.encryptionKeyVersion) ||
    envelope.encryptedToken.byteLength === 0 ||
    envelope.nonce.byteLength !== RADAR_OPAQUE_POLICY_V1.nonceBytes ||
    envelope.authTag.byteLength !== RADAR_OPAQUE_POLICY_V1.authTagBytes
  ) {
    throw new Error("invalid-envelope");
  }
}

function assertOpaqueToken(token: string): void {
  if (!OPAQUE_TOKEN.test(token)) {
    throw new TypeError("Radar opaque token must be an unpadded 128-bit base64url value.");
  }
  const decoded = Buffer.from(token, "base64url");
  if (
    decoded.byteLength !== RADAR_OPAQUE_POLICY_V1.tokenBytes ||
    decoded.toString("base64url") !== token
  ) {
    throw new TypeError("Radar opaque token must be canonical base64url.");
  }
}

function assertLookupScope(scope: RadarOpaqueLookupScope): void {
  if (!UUID.safeParse(scope.companyId).success || !isValidDate(scope.epoch)) {
    throw new TypeError("Radar opaque lookup scope is invalid.");
  }
}

function assertBinding(binding: RadarOpaqueBinding): void {
  assertLookupScope(binding);
  if (
    !UUID.safeParse(binding.mappingId).success ||
    !UUID.safeParse(binding.candidateProfileId).success
  ) {
    throw new TypeError("Radar opaque mapping binding is invalid.");
  }
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
