import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import {
  RevealField,
  type RevealField as RevealFieldType,
} from "@/lib/generated/prisma/enums";
import { trimmedString } from "@/lib/validation/common";

const MAX_CV_BYTES = 5 * 1024 * 1024;
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const UUID = z.string().uuid();
const revealFieldSchema = z.enum(RevealField);
const CV_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
const CV_MIME_CODES = Object.freeze({
  "application/pdf": 1,
  "image/png": 2,
  "image/jpeg": 3,
  "image/webp": 4,
} as const);
type CvMime = keyof typeof CV_MIME_CODES;

export const REVEAL_SNAPSHOT_POLICY_V1 = Object.freeze({
  schemaVersion: "v1" as const,
  noticeVersion: "identity-reveal-v1" as const,
  algorithm: "aes-256-gcm" as const,
  nonceBytes: 12,
  authTagBytes: 16,
  maximumCvBytes: MAX_CV_BYTES,
  previewLifetimeMinutes: 10,
});

const revealValueSchemas = {
  DISPLAY_NAME: trimmedString(1, 120),
  EMAIL: z.string().trim().toLowerCase().min(3).max(254).email(),
  PHONE: z.string().trim().min(8).max(16).regex(/^\+[1-9]\d{6,14}$/),
  CV_METADATA: z
    .object({
      fileName: z
        .string()
        .trim()
        .min(1)
        .max(255)
        .transform((value) => value.normalize("NFC"))
        .refine(
          (value) =>
            !/[\\/\u0000-\u001f\u007f]/.test(value) &&
            value !== "." &&
            value !== "..",
          "CV filename must not contain paths or control characters.",
        ),
      mimeType: z.enum(CV_MIME_TYPES),
      sizeBytes: z.number().int().positive().max(MAX_CV_BYTES),
    })
    .strict(),
} as const satisfies Record<RevealFieldType, z.ZodType>;

export const revealConfirmationSchema = z
  .object({
    contactRequestId: UUID,
    conversationId: UUID.nullable(),
    fields: z
      .array(revealFieldSchema)
      .min(1)
      .max(Object.keys(RevealField).length)
      .refine(
        (fields) => new Set(fields).size === fields.length,
        "Reveal fields must be unique.",
      ),
    noticeVersion: z.literal(REVEAL_SNAPSHOT_POLICY_V1.noticeVersion),
    previewHmac: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: trimmedString(8, 128),
  })
  .strict();

export type RevealConfirmation = z.infer<typeof revealConfirmationSchema>;
export type RevealKey = Readonly<{ version: string; secret: string }>;
export type RevealValue =
  | Readonly<{ field: "DISPLAY_NAME"; value: string }>
  | Readonly<{ field: "EMAIL"; value: string }>
  | Readonly<{ field: "PHONE"; value: string }>
  | Readonly<{
      field: "CV_METADATA";
      value: Readonly<{
        fileName: string;
        mimeType: CvMime;
        sizeBytes: number;
      }>;
    }>;

export type RevealSnapshotBinding = Readonly<{
  grantId: string;
  candidateProfileId: string;
  companyId: string;
  contactRequestId: string;
}>;

export type RevealPreviewScope = Readonly<{
  contactRequestId: string;
  conversationId: string | null;
  candidateProfileId: string;
  companyId: string;
}>;

export type RevealPreviewEvidence = Readonly<{
  contactRequestId: string;
  conversationId: string | null;
  candidateProfileId: string;
  companyId: string;
  fields: readonly RevealFieldType[];
  noticeVersion: typeof REVEAL_SNAPSHOT_POLICY_V1.noticeVersion;
  confirmationKeyVersion: string;
  previewHmac: string;
  expiresAt: Date;
  usedAt: Date | null;
}>;

export type RevealConfirmationAuthorization = Readonly<{
  actorUserId: string;
  candidateOwnerUserId: string;
  candidateUserStatus: "ACTIVE" | "PENDING" | "SUSPENDED" | "DELETED";
  candidateProfileId: string;
  companyId: string;
  companyStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
  companyVerified: boolean;
  requestId: string;
  requestStatus: string;
  requestCandidateProfileId: string;
  requestCompanyId: string;
  requestConversationId: string | null;
  existingGrant: Readonly<{
    contactRequestId: string;
    candidateProfileId: string;
    companyId: string;
    conversationId: string | null;
    revokedAt: Date | null;
  }> | null;
}>;

export type EncryptedRevealField = Readonly<{
  field: RevealFieldType;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
  encryptionKeyVersion: string;
  schemaVersion: "v1";
  integrityHmac: string;
}>;

export type RevealReadScope = Readonly<{
  requestId: string;
  requestStatus: string;
  requestCompanyId: string;
  requestCandidateProfileId: string;
  requestConversationId: string | null;
  grantRequestId: string;
  grantCompanyId: string;
  grantCandidateProfileId: string;
  grantConversationId: string | null;
  viewerCompanyId: string;
  revokedAt: Date | null;
}>;

export type RevealPreviewRecheckResult =
  | Readonly<{
      ok: true;
      confirmation: RevealConfirmation;
      values: readonly RevealValue[];
    }>
  | Readonly<{
      ok: false;
      code: "INVALID_REVEAL_CONFIRMATION" | "STALE_REVEAL_PREVIEW";
    }>;

export function validateRevealConfirmation(input: unknown): RevealConfirmation {
  return revealConfirmationSchema.parse(input);
}

/** Creates exact display values plus server-storable, plaintext-free evidence. */
export function buildRevealPreview(
  values: readonly RevealValue[],
  scope: RevealPreviewScope,
  confirmationKeyring: readonly RevealKey[],
  now: Date,
): Readonly<{ values: readonly RevealValue[]; evidence: RevealPreviewEvidence }> {
  assertValidDate(now);
  assertPreviewScope(scope);
  const keyEntry = confirmationKeyring[0];
  if (!keyEntry) throw new TypeError("Reveal confirmation keyring requires an active writer key.");
  const key = keyBytes(keyEntry, "Reveal confirmation");
  const normalized = normalizeValues(values);
  const fields = Object.freeze(normalized.map(({ field }) => field));
  const previewHmac = calculatePreviewHmac(normalized, scope, keyEntry.version, key);
  return Object.freeze({
    values: normalized,
    evidence: Object.freeze({
      contactRequestId: scope.contactRequestId,
      conversationId: scope.conversationId,
      candidateProfileId: scope.candidateProfileId,
      companyId: scope.companyId,
      fields,
      noticeVersion: REVEAL_SNAPSHOT_POLICY_V1.noticeVersion,
      confirmationKeyVersion: keyEntry.version,
      previewHmac,
      expiresAt: new Date(
        now.getTime() + REVEAL_SNAPSHOT_POLICY_V1.previewLifetimeMinutes * 60 * 1_000,
      ),
      usedAt: null,
    }),
  });
}

/** Re-reads/canonicalizes current values and rejects any changed preview. */
/**
 * `authorization` must be loaded server-side from the candidate-owned request,
 * Company and optional grant under the same transaction lock as persistence;
 * none of its fields are accepted from the confirmation payload.
 */
export function authorizeAndRecheckRevealConfirmation(
  input: unknown,
  currentValues: readonly RevealValue[],
  evidence: RevealPreviewEvidence,
  confirmationKeyring: readonly RevealKey[],
  authorization: RevealConfirmationAuthorization,
  now: Date,
): RevealPreviewRecheckResult {
  const parsed = revealConfirmationSchema.safeParse(input);
  if (!parsed.success || !isValidDate(now)) return invalidConfirmation();
  const confirmation = parsed.data;
  if (!canConfirmReveal(authorization, confirmation, evidence)) {
    return invalidConfirmation();
  }
  if (
    evidence.contactRequestId !== confirmation.contactRequestId ||
    evidence.conversationId !== confirmation.conversationId ||
    evidence.noticeVersion !== confirmation.noticeVersion ||
    !constantTimeTextEqual(evidence.previewHmac, confirmation.previewHmac) ||
    evidence.usedAt !== null ||
    !isValidDate(evidence.expiresAt) ||
    evidence.expiresAt.getTime() <= now.getTime() ||
    !sameFields(evidence.fields, confirmation.fields)
  ) {
    return invalidConfirmation();
  }
  try {
    const selected = confirmationKeyring.find(
      ({ version }) => version === evidence.confirmationKeyVersion,
    );
    if (!selected) return invalidConfirmation();
    const key = keyBytes(selected, "Reveal confirmation");
    const normalized = normalizeValues(currentValues);
    if (!sameFields(normalized.map(({ field }) => field), confirmation.fields)) {
      return stalePreview();
    }
    const expected = calculatePreviewHmac(
      normalized,
      {
        contactRequestId: confirmation.contactRequestId,
        conversationId: confirmation.conversationId,
        candidateProfileId: authorization.candidateProfileId,
        companyId: authorization.companyId,
      },
      selected.version,
      key,
    );
    if (!constantTimeTextEqual(expected, confirmation.previewHmac)) {
      return stalePreview();
    }
    return Object.freeze({ ok: true, confirmation, values: normalized });
  } catch {
    return invalidConfirmation();
  }
}

export function canConfirmReveal(
  authorization: RevealConfirmationAuthorization,
  confirmation: RevealConfirmation,
  evidence: RevealPreviewEvidence,
): boolean {
  if (
    !UUID.safeParse(authorization.actorUserId).success ||
    !UUID.safeParse(authorization.candidateOwnerUserId).success ||
    !UUID.safeParse(authorization.candidateProfileId).success ||
    !UUID.safeParse(authorization.companyId).success ||
    !UUID.safeParse(authorization.requestId).success ||
    !UUID.safeParse(authorization.requestCandidateProfileId).success ||
    !UUID.safeParse(authorization.requestCompanyId).success ||
    (authorization.requestConversationId !== null &&
      !UUID.safeParse(authorization.requestConversationId).success) ||
    authorization.actorUserId !== authorization.candidateOwnerUserId ||
    authorization.candidateUserStatus !== "ACTIVE" ||
    authorization.companyStatus !== "ACTIVE" ||
    authorization.companyVerified !== true ||
    authorization.requestStatus !== "ACCEPTED" ||
    authorization.requestId !== confirmation.contactRequestId ||
    authorization.requestCandidateProfileId !== authorization.candidateProfileId ||
    authorization.requestCompanyId !== authorization.companyId ||
    authorization.requestConversationId !== confirmation.conversationId ||
    evidence.contactRequestId !== authorization.requestId ||
    evidence.conversationId !== authorization.requestConversationId ||
    evidence.candidateProfileId !== authorization.candidateProfileId ||
    evidence.companyId !== authorization.companyId
  ) {
    return false;
  }
  const grant = authorization.existingGrant;
  return grant === null || (
    grant.contactRequestId === authorization.requestId &&
    grant.candidateProfileId === authorization.candidateProfileId &&
    grant.companyId === authorization.companyId &&
    grant.conversationId === authorization.requestConversationId &&
    grant.revokedAt === null
  );
}

export function encryptRevealValues(
  values: readonly RevealValue[],
  keyring: readonly RevealKey[],
  binding: RevealSnapshotBinding,
): readonly EncryptedRevealField[] {
  assertSnapshotBinding(binding);
  const activeKey = keyring[0];
  if (!activeKey) throw new TypeError("PII reveal keyring requires an active writer key.");
  const key = keyBytes(activeKey, "PII reveal");
  const normalized = normalizeValues(values);
  const encrypted = normalized.map((item) => {
    const plainText = encodeValue(item);
    const nonce = randomBytes(REVEAL_SNAPSHOT_POLICY_V1.nonceBytes);
    const cipher = createCipheriv(REVEAL_SNAPSHOT_POLICY_V1.algorithm, key, nonce);
    const associatedData = aad(item.field, activeKey.version, binding);
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([cipher.update(plainText), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const integrityHmac = buildIntegrityHmac(
      key,
      associatedData,
      nonce,
      authTag,
      ciphertext,
    );
    return Object.freeze({
      field: item.field,
      ciphertext: Uint8Array.from(ciphertext),
      nonce: Uint8Array.from(nonce),
      authTag: Uint8Array.from(authTag),
      encryptionKeyVersion: activeKey.version,
      schemaVersion: REVEAL_SNAPSHOT_POLICY_V1.schemaVersion,
      integrityHmac,
    });
  });
  return Object.freeze(encrypted);
}

export function decryptRevealValue(
  encrypted: EncryptedRevealField,
  keyring: readonly RevealKey[],
  binding: RevealSnapshotBinding,
): RevealValue {
  try {
    assertSnapshotBinding(binding);
    assertEncryptedShape(encrypted);
    const selected = keyring.find(
      (entry) => entry.version === encrypted.encryptionKeyVersion,
    );
    if (!selected) throw new Error("missing-key");
    const key = keyBytes(selected, "PII reveal");
    const associatedData = aad(encrypted.field, selected.version, binding);
    const expectedHmac = buildIntegrityHmac(
      key,
      associatedData,
      encrypted.nonce,
      encrypted.authTag,
      encrypted.ciphertext,
    );
    if (!constantTimeTextEqual(expectedHmac, encrypted.integrityHmac)) {
      throw new Error("integrity");
    }
    const decipher = createDecipheriv(
      REVEAL_SNAPSHOT_POLICY_V1.algorithm,
      key,
      encrypted.nonce,
    );
    decipher.setAAD(associatedData);
    decipher.setAuthTag(Buffer.from(encrypted.authTag));
    const plainText = Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ]);
    return decodeValue(encrypted.field, plainText);
  } catch {
    throw new Error("Reveal snapshot is unavailable.");
  }
}

export function decryptAuthorizedRevealSnapshot(
  encrypted: EncryptedRevealField,
  keyring: readonly RevealKey[],
  binding: RevealSnapshotBinding,
  scope: RevealReadScope,
): RevealValue {
  if (!canReadRevealSnapshot(scope) || !bindingMatchesReadScope(binding, scope)) {
    throw new Error("Reveal snapshot is unavailable.");
  }
  return decryptRevealValue(encrypted, keyring, binding);
}

export function canReadRevealSnapshot(input: RevealReadScope): boolean {
  return input.requestStatus === "ACCEPTED" &&
    input.revokedAt === null &&
    input.requestId === input.grantRequestId &&
    input.requestCompanyId === input.grantCompanyId &&
    input.requestCandidateProfileId === input.grantCandidateProfileId &&
    input.requestConversationId === input.grantConversationId &&
    input.viewerCompanyId === input.grantCompanyId;
}

function normalizeValues(values: readonly RevealValue[]): readonly RevealValue[] {
  if (values.length === 0 || values.length > Object.keys(RevealField).length) {
    throw new TypeError("Reveal field set must contain one to four fields.");
  }
  const fields = new Set<RevealFieldType>();
  const normalized = values.map((item) => {
    if (!revealFieldSchema.safeParse(item.field).success || fields.has(item.field)) {
      throw new TypeError("Reveal field set must be closed and unique.");
    }
    fields.add(item.field);
    switch (item.field) {
      case "DISPLAY_NAME":
        return Object.freeze({ field: item.field, value: revealValueSchemas.DISPLAY_NAME.parse(item.value) });
      case "EMAIL":
        return Object.freeze({ field: item.field, value: revealValueSchemas.EMAIL.parse(item.value) });
      case "PHONE":
        return Object.freeze({ field: item.field, value: revealValueSchemas.PHONE.parse(item.value) });
      case "CV_METADATA": {
        const parsed = revealValueSchemas.CV_METADATA.parse(item.value);
        return Object.freeze({ field: item.field, value: Object.freeze(parsed) });
      }
    }
  });
  return Object.freeze(normalized);
}

function encodeValue(item: RevealValue): Buffer {
  if (item.field !== "CV_METADATA") return Buffer.from(item.value, "utf8");
  const fileName = Buffer.from(item.value.fileName, "utf8");
  if (fileName.length > 65_535) throw new TypeError("CV filename is too large.");
  const encoded = Buffer.allocUnsafe(8 + fileName.length);
  encoded.writeUInt8(1, 0);
  encoded.writeUInt8(CV_MIME_CODES[item.value.mimeType], 1);
  encoded.writeUInt16BE(fileName.length, 2);
  encoded.writeUInt32BE(item.value.sizeBytes, 4);
  fileName.copy(encoded, 8);
  return encoded;
}

function decodeValue(field: RevealFieldType, encoded: Buffer): RevealValue {
  if (field !== "CV_METADATA") {
    const parsed = revealValueSchemas[field].parse(encoded.toString("utf8"));
    return Object.freeze({ field, value: parsed }) as RevealValue;
  }
  if (encoded.length < 9 || encoded.readUInt8(0) !== 1) throw new Error("codec");
  const mimeCode = encoded.readUInt8(1);
  const mimeType = Object.entries(CV_MIME_CODES).find(([, code]) => code === mimeCode)?.[0];
  const fileNameLength = encoded.readUInt16BE(2);
  if (!mimeType || encoded.length !== 8 + fileNameLength) throw new Error("codec");
  const parsed = revealValueSchemas.CV_METADATA.parse({
    fileName: encoded.subarray(8).toString("utf8"),
    mimeType,
    sizeBytes: encoded.readUInt32BE(4),
  });
  return Object.freeze({ field, value: Object.freeze(parsed) });
}

function calculatePreviewHmac(
  values: readonly RevealValue[],
  scope: RevealPreviewScope,
  version: string,
  key: Buffer,
) {
  const hmac = createHmac("sha256", deriveHmacKey(key, "preview"));
  hmac.update(
    `reveal-preview-v1\0${version}\0${scope.contactRequestId}\0${scope.conversationId ?? ""}\0${scope.candidateProfileId}\0${scope.companyId}`,
  );
  for (const value of values) {
    const encoded = encodeValue(value);
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.length);
    hmac.update("\0").update(value.field).update(length).update(encoded);
  }
  return hmac.digest("hex");
}

function keyBytes(key: RevealKey, label: string): Buffer {
  if (!KEY_VERSION.test(key.version)) throw new TypeError(`${label} key version is invalid.`);
  const decoded = Buffer.from(key.secret, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== key.secret) {
    throw new TypeError(`${label} key must be canonical base64 for exactly 32 bytes.`);
  }
  return decoded;
}

function aad(
  field: RevealFieldType,
  version: string,
  binding: RevealSnapshotBinding,
): Buffer {
  return Buffer.from(
    [
      "pii-reveal-v1",
      binding.grantId,
      binding.candidateProfileId,
      binding.companyId,
      binding.contactRequestId,
      field,
      REVEAL_SNAPSHOT_POLICY_V1.schemaVersion,
      version,
    ].join("\0"),
    "utf8",
  );
}

function buildIntegrityHmac(
  key: Buffer,
  associatedData: Buffer,
  nonce: Uint8Array,
  authTag: Uint8Array,
  ciphertext: Uint8Array,
) {
  return createHmac("sha256", deriveHmacKey(key, "value-integrity"))
    .update(associatedData)
    .update(nonce)
    .update(authTag)
    .update(ciphertext)
    .digest("hex");
}

function deriveHmacKey(key: Buffer, purpose: string) {
  return createHmac("sha256", key).update(`swisstalenthub:${purpose}:v1`).digest();
}

function assertEncryptedShape(encrypted: EncryptedRevealField) {
  if (
    encrypted.schemaVersion !== REVEAL_SNAPSHOT_POLICY_V1.schemaVersion ||
    !revealFieldSchema.safeParse(encrypted.field).success ||
    encrypted.nonce.byteLength !== REVEAL_SNAPSHOT_POLICY_V1.nonceBytes ||
    encrypted.authTag.byteLength !== REVEAL_SNAPSHOT_POLICY_V1.authTagBytes ||
    encrypted.ciphertext.byteLength === 0 ||
    !/^[a-f0-9]{64}$/.test(encrypted.integrityHmac)
  ) {
    throw new Error("invalid-envelope");
  }
}

function assertSnapshotBinding(binding: RevealSnapshotBinding) {
  if (
    !UUID.safeParse(binding.grantId).success ||
    !UUID.safeParse(binding.candidateProfileId).success ||
    !UUID.safeParse(binding.companyId).success ||
    !UUID.safeParse(binding.contactRequestId).success
  ) {
    throw new TypeError("Reveal snapshot binding is invalid.");
  }
}

function assertPreviewScope(scope: RevealPreviewScope) {
  if (
    !UUID.safeParse(scope.contactRequestId).success ||
    (scope.conversationId !== null && !UUID.safeParse(scope.conversationId).success) ||
    !UUID.safeParse(scope.candidateProfileId).success ||
    !UUID.safeParse(scope.companyId).success
  ) {
    throw new TypeError("Reveal preview scope is invalid.");
  }
}

function bindingMatchesReadScope(binding: RevealSnapshotBinding, scope: RevealReadScope) {
  return binding.contactRequestId === scope.grantRequestId &&
    binding.companyId === scope.grantCompanyId &&
    binding.candidateProfileId === scope.grantCandidateProfileId;
}

function sameFields(left: readonly RevealFieldType[], right: readonly RevealFieldType[]) {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function constantTimeTextEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function assertValidDate(value: Date): asserts value is Date {
  if (!isValidDate(value)) throw new TypeError("Reveal clock is invalid.");
}

function invalidConfirmation(): RevealPreviewRecheckResult {
  return Object.freeze({ ok: false, code: "INVALID_REVEAL_CONFIRMATION" });
}

function stalePreview(): RevealPreviewRecheckResult {
  return Object.freeze({ ok: false, code: "STALE_REVEAL_PREVIEW" });
}
