import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_KEY_INFO = Buffer.from("swisstalenthub:totp:v1", "utf8");
const RECOVERY_KEY_INFO = Buffer.from("swisstalenthub:recovery:v1", "utf8");

export const TOTP_POLICY_V1 = Object.freeze({
  algorithm: "SHA1" as const,
  digits: 6,
  periodSeconds: 30,
  acceptedWindow: 1,
  secretBytes: 20,
  enrollmentTtlMilliseconds: 10 * 60 * 1_000,
  sessionAssuranceTtlMilliseconds: 12 * 60 * 60 * 1_000,
  recoveryCodeCount: 10,
});

export type EncryptedTotpSecret = Readonly<{
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  keyVersion: "session-hkdf-v1";
}>;

export function createTotpSecret(): Readonly<{
  bytes: Buffer;
  base32: string;
}> {
  const bytes = randomBytes(TOTP_POLICY_V1.secretBytes);
  return Object.freeze({ bytes, base32: encodeBase32(bytes) });
}

export function buildTotpUri(input: Readonly<{
  accountName: string;
  issuer: string;
  secretBase32: string;
}>): string {
  const label = `${input.issuer}:${input.accountName}`;
  const query = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: TOTP_POLICY_V1.algorithm,
    digits: String(TOTP_POLICY_V1.digits),
    period: String(TOTP_POLICY_V1.periodSeconds),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function encryptTotpSecret(
  secret: Uint8Array,
  sessionSecret: string,
): EncryptedTotpSecret {
  const key = deriveKey(sessionSecret, TOTP_KEY_INFO);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(TOTP_KEY_INFO);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(secret)),
    cipher.final(),
  ]);
  return Object.freeze({
    ciphertext,
    nonce,
    tag: cipher.getAuthTag(),
    keyVersion: "session-hkdf-v1",
  });
}

export function decryptTotpSecret(
  encrypted: Readonly<{
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    tag: Uint8Array;
    keyVersion: string;
  }>,
  sessionSecret: string,
): Buffer {
  if (encrypted.keyVersion !== "session-hkdf-v1") {
    throw new Error("Unsupported TOTP key version.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(sessionSecret, TOTP_KEY_INFO),
    Buffer.from(encrypted.nonce),
  );
  decipher.setAAD(TOTP_KEY_INFO);
  decipher.setAuthTag(Buffer.from(encrypted.tag));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext)),
    decipher.final(),
  ]);
}

export function verifyTotp(
  code: string,
  secret: Uint8Array,
  now: Date,
  lastAcceptedStep: bigint | null,
): Readonly<{ valid: boolean; acceptedStep: bigint | null }> {
  if (!/^\d{6}$/u.test(code) || !Number.isFinite(now.getTime())) {
    return Object.freeze({ valid: false, acceptedStep: null });
  }
  const currentStep = BigInt(
    Math.floor(now.getTime() / 1_000 / TOTP_POLICY_V1.periodSeconds),
  );
  for (
    let offset = -TOTP_POLICY_V1.acceptedWindow;
    offset <= TOTP_POLICY_V1.acceptedWindow;
    offset += 1
  ) {
    const step = currentStep + BigInt(offset);
    if (step < 0n || (lastAcceptedStep !== null && step <= lastAcceptedStep)) {
      continue;
    }
    const expected = Buffer.from(createTotpCode(secret, step), "ascii");
    const supplied = Buffer.from(code, "ascii");
    if (
      expected.length === supplied.length &&
      timingSafeEqual(expected, supplied)
    ) {
      return Object.freeze({ valid: true, acceptedStep: step });
    }
  }
  return Object.freeze({ valid: false, acceptedStep: null });
}

export function createRecoveryCodes(
  sessionSecret: string,
): readonly Readonly<{ raw: string; hash: string }>[] {
  const pepper = deriveKey(sessionSecret, RECOVERY_KEY_INFO);
  return Object.freeze(
    Array.from({ length: TOTP_POLICY_V1.recoveryCodeCount }, () => {
      const compact = randomBytes(8).toString("hex").toUpperCase();
      const raw = `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}`;
      return Object.freeze({
        raw,
        hash: hashRecoveryCode(raw, pepper),
      });
    }),
  );
}

export function hashRecoveryCodeForLookup(
  raw: string,
  sessionSecret: string,
): string {
  return hashRecoveryCode(
    normalizeRecoveryCode(raw),
    deriveKey(sessionSecret, RECOVERY_KEY_INFO),
  );
}

function createTotpCode(secret: Uint8Array, step: bigint): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac("sha1", Buffer.from(secret))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_POLICY_V1.digits).padStart(
    TOTP_POLICY_V1.digits,
    "0",
  );
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function normalizeRecoveryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/u.test(normalized)) {
    throw new TypeError("Recovery code is malformed.");
  }
  return normalized;
}

function hashRecoveryCode(value: string, pepper: Uint8Array): string {
  const normalized = normalizeRecoveryCode(value);
  return createHmac("sha256", Buffer.from(pepper))
    .update(normalized, "utf8")
    .digest("hex");
}

function deriveKey(sessionSecret: string, info: Buffer): Buffer {
  if (sessionSecret.length < 32) {
    throw new TypeError("Session secret cannot derive an authenticator key.");
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(sessionSecret, "utf8"),
      Buffer.from("swisstalenthub:phase25", "utf8"),
      info,
      32,
    ),
  );
}
