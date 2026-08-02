import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

import type { KeyringEntry } from "@/lib/config/env-schema";
import {
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from "@/lib/providers/email/email-provider";
import type { EmailDeliveryRequest } from "@/lib/providers/email/email-delivery-provider";
import { normalizedEmailSchema } from "@/lib/validation/common";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAXIMUM_PLAINTEXT_BYTES = 64 * 1_024;
const CONTEXT = Buffer.from(
  "swisstalenthub.notification-provider-request.v1",
  "utf8",
);
const DIGEST_CONTEXT = "swisstalenthub.notification-provider-request.v1\0";
const DIGEST_KEY_CONTEXT =
  "swisstalenthub.notification-provider-request.digest-key.v1";

const requestSchema = z.strictObject({
  idempotencyKey: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  subject: z.string().min(1).max(200),
  templateData: z.record(z.string(), z.unknown()),
  templateKey: z.enum(EMAIL_TEMPLATE_KEYS),
  text: z.string().min(1).max(20_000),
  timeoutMilliseconds: z.number().int().min(100).max(30_000),
  to: normalizedEmailSchema,
});

const bindingSchema = z.strictObject({
  outboxId: z.uuid(),
  providerActivationId: z.uuid(),
  providerDedupeKey: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  templateKey: z.enum(EMAIL_TEMPLATE_KEYS),
});

export type NotificationProviderRequestBinding = Readonly<
  z.output<typeof bindingSchema>
>;

export type FrozenEmailDeliveryRequest = Readonly<{
  idempotencyKey: string;
  subject: string;
  templateData: Readonly<Record<string, unknown>>;
  templateKey: EmailTemplateKey;
  text: string;
  timeoutMilliseconds: number;
  to: string;
}>;

export type EncryptedNotificationProviderRequest = Readonly<{
  authTag: Uint8Array;
  ciphertext: Uint8Array;
  digest: string;
  keyVersion: string;
  nonce: Uint8Array;
}>;

/**
 * Freezes the exact provider request before the first network effect. The
 * rendered recipient/content may contain short-lived tokens, so only an
 * authenticated encrypted envelope and a non-reversible digest are stored.
 */
export function encryptNotificationProviderRequest(
  request: EmailDeliveryRequest,
  keyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[],
  binding: NotificationProviderRequestBinding,
): EncryptedNotificationProviderRequest {
  const parsed = requestSchema.safeParse(request);
  const parsedBinding = bindingSchema.safeParse(binding);
  const writer = keyring[0];
  if (
    !parsed.success ||
    !parsedBinding.success ||
    writer === undefined ||
    parsed.data.idempotencyKey !== parsedBinding.data.providerDedupeKey ||
    parsed.data.templateKey !== parsedBinding.data.templateKey
  ) {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_INVALID");
  }
  const plaintext = Buffer.from(JSON.stringify(parsed.data), "utf8");
  if (plaintext.byteLength > MAXIMUM_PLAINTEXT_BYTES) {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_TOO_LARGE");
  }
  const authenticatedContext = bindingContext(parsedBinding.data);
  const nonce = randomBytes(NONCE_BYTES);
  return writer.key.withValue((encodedKey) => {
    const key = Buffer.from(encodedKey, "base64");
    const digest = requestDigest(plaintext, key, authenticatedContext);
    const cipher = createCipheriv(
      ALGORITHM,
      key,
      nonce,
    );
    cipher.setAAD(authenticatedContext);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return Object.freeze({
      authTag: Uint8Array.from(cipher.getAuthTag()),
      ciphertext: Uint8Array.from(ciphertext),
      digest,
      keyVersion: writer.version,
      nonce: Uint8Array.from(nonce),
    });
  });
}

export function decryptNotificationProviderRequest(
  encrypted: Readonly<{
    authTag: Uint8Array;
    ciphertext: Uint8Array;
    digest: string;
    keyVersion: string;
    nonce: Uint8Array;
  }>,
  keyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[],
  binding: NotificationProviderRequestBinding,
): FrozenEmailDeliveryRequest {
  const parsedBinding = bindingSchema.safeParse(binding);
  if (
    !parsedBinding.success ||
    encrypted.nonce.byteLength !== NONCE_BYTES ||
    encrypted.authTag.byteLength !== AUTH_TAG_BYTES ||
    !/^[a-f0-9]{64}$/u.test(encrypted.digest) ||
    encrypted.ciphertext.byteLength > MAXIMUM_PLAINTEXT_BYTES + AUTH_TAG_BYTES
  ) {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_ENVELOPE_INVALID");
  }
  const entry = keyring.find(
    (candidate) => candidate.version === encrypted.keyVersion,
  );
  if (entry === undefined) {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_KEY_VERSION_UNKNOWN");
  }
  const authenticatedContext = bindingContext(parsedBinding.data);
  const decrypted = entry.key.withValue((encodedKey) => {
    const key = Buffer.from(encodedKey, "base64");
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(encrypted.nonce),
    );
    decipher.setAAD(authenticatedContext);
    decipher.setAuthTag(Buffer.from(encrypted.authTag));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext)),
      decipher.final(),
    ]);
    return Object.freeze({
      digest: requestDigest(plaintext, key, authenticatedContext),
      plaintext,
    });
  });
  const { digest: calculatedDigest, plaintext } = decrypted;
  if (plaintext.byteLength > MAXIMUM_PLAINTEXT_BYTES) {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_TOO_LARGE");
  }
  if (calculatedDigest !== encrypted.digest) {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_DIGEST_MISMATCH");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_DECODE_FAILED");
  }
  const parsed = requestSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_DECODE_FAILED");
  }
  if (
    parsed.data.idempotencyKey !== parsedBinding.data.providerDedupeKey ||
    parsed.data.templateKey !== parsedBinding.data.templateKey
  ) {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_BINDING_MISMATCH");
  }
  return Object.freeze({
    ...parsed.data,
    templateData: Object.freeze({ ...parsed.data.templateData }),
  });
}

function requestDigest(
  plaintext: Uint8Array,
  encryptionKey: Uint8Array,
  authenticatedContext: Uint8Array,
) {
  // Derive a domain-separated MAC key so the persisted request digest cannot
  // be used as an offline oracle for recipient addresses or predictable
  // template content, and the AES key is not reused directly for the MAC.
  const digestKey = createHmac("sha256", encryptionKey)
    .update(DIGEST_KEY_CONTEXT, "utf8")
    .digest();
  return createHmac("sha256", digestKey)
    .update(DIGEST_CONTEXT, "utf8")
    .update(authenticatedContext)
    .update(plaintext)
    .digest("hex");
}

function bindingContext(binding: z.output<typeof bindingSchema>) {
  return Buffer.concat([
    CONTEXT,
    Buffer.from("\0", "utf8"),
    Buffer.from(
      JSON.stringify({
        outboxId: binding.outboxId,
        providerActivationId: binding.providerActivationId,
        providerDedupeKey: binding.providerDedupeKey,
        templateKey: binding.templateKey,
      }),
      "utf8",
    ),
  ]);
}
