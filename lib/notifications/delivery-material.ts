import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { KeyringEntry } from "@/lib/config/env-schema";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const LEGACY_CONTEXT = Buffer.from(
  "swisstalenthub.notification-recipient.v1",
  "utf8",
);
const ROW_BOUND_CONTEXT = "swisstalenthub.notification-recipient.v2";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type NotificationRecipientBinding = Readonly<{
  bindingVersion: "v2";
  dedupeKey: string;
  outboxId: string;
  retentionUntil: string;
  templateKey: string;
}>;

export type EncryptedNotificationRecipient = Readonly<{
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
  keyVersion: string;
}>;

export function encryptNotificationRecipient(
  normalizedAddress: string,
  keyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[],
  binding: NotificationRecipientBinding,
): EncryptedNotificationRecipient {
  const writer = keyring[0];
  if (writer === undefined) {
    throw new Error("NOTIFICATION_DELIVERY_KEYRING_EMPTY");
  }
  const nonce = randomBytes(NONCE_BYTES);
  return writer.key.withValue((encodedKey) => {
    const cipher = createCipheriv(
      ALGORITHM,
      Buffer.from(encodedKey, "base64"),
      nonce,
    );
    cipher.setAAD(recipientAdditionalAuthenticatedData(binding));
    const ciphertext = Buffer.concat([
      cipher.update(normalizedAddress, "utf8"),
      cipher.final(),
    ]);
    return Object.freeze({
      ciphertext: Uint8Array.from(ciphertext),
      nonce: Uint8Array.from(nonce),
      authTag: Uint8Array.from(cipher.getAuthTag()),
      keyVersion: writer.version,
    });
  });
}

export function decryptNotificationRecipient(
  encrypted: EncryptedNotificationRecipient,
  keyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[],
  binding?: NotificationRecipientBinding,
) {
  if (
    encrypted.nonce.byteLength !== NONCE_BYTES ||
    encrypted.authTag.byteLength !== AUTH_TAG_BYTES
  ) {
    throw new Error("NOTIFICATION_DELIVERY_ENVELOPE_INVALID");
  }
  const entry = keyring.find(
    (candidate) => candidate.version === encrypted.keyVersion,
  );
  if (entry === undefined) {
    throw new Error("NOTIFICATION_DELIVERY_KEY_VERSION_UNKNOWN");
  }
  return entry.key.withValue((encodedKey) => {
    const decipher = createDecipheriv(
      ALGORITHM,
      Buffer.from(encodedKey, "base64"),
      Buffer.from(encrypted.nonce),
    );
    decipher.setAAD(
      binding === undefined
        ? LEGACY_CONTEXT
        : recipientAdditionalAuthenticatedData(binding),
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext)),
      decipher.final(),
    ]).toString("utf8");
  });
}

function recipientAdditionalAuthenticatedData(
  binding: NotificationRecipientBinding,
) {
  const retentionUntil = new Date(binding.retentionUntil);
  if (
    binding.bindingVersion !== "v2" ||
    !UUID_PATTERN.test(binding.outboxId) ||
    binding.dedupeKey.length < 1 ||
    binding.dedupeKey.length > 160 ||
    !Number.isFinite(retentionUntil.getTime()) ||
    retentionUntil.toISOString() !== binding.retentionUntil ||
    binding.templateKey.length < 1 ||
    binding.templateKey.length > 64
  ) {
    throw new Error("NOTIFICATION_RECIPIENT_BINDING_INVALID");
  }
  return Buffer.from(
    JSON.stringify({
      context: ROW_BOUND_CONTEXT,
      bindingVersion: binding.bindingVersion,
      dedupeKey: binding.dedupeKey,
      outboxId: binding.outboxId,
      retentionUntil: binding.retentionUntil,
      templateKey: binding.templateKey,
    }),
    "utf8",
  );
}
