import "server-only";

import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import { Webhook } from "svix";

import type { KeyringEntry, SecretHandle } from "@/lib/config/env-schema";
import { parseResendDeliveryEvent } from "@/lib/providers/email/resend-event";

export const RESEND_WEBHOOK_CONTRACT_V1 = Object.freeze({
  maximumRawBodyBytes: 256 * 1_024,
  maximumHeaderBytes: 8_192,
  adapterKey: "resend",
  adapterVersion: "v1",
  useCase: "email.delivery-events",
});

const SVIX_ID_PATTERN = /^msg_[A-Za-z0-9_-]{8,248}$/u;
const SVIX_TIMESTAMP_PATTERN = /^\d{10}$/u;
const SVIX_SIGNATURE_PATTERN =
  /^(?:v1,[A-Za-z0-9+/=_-]{32,512})(?:\s+v1,[A-Za-z0-9+/=_-]{32,512})*$/u;
const PAYLOAD_DIGEST_CONTEXT = "swisstalenthub.resend-webhook-payload.v1\0";

export type VerifiedResendDeliveryWebhook = Readonly<{
  event: NonNullable<ReturnType<typeof parseResendDeliveryEvent>>;
  eventId: string;
  payloadDigest: string;
  payloadDigestCandidates: readonly string[];
}>;

export class ResendWebhookVerificationError extends Error {
  readonly code:
    | "BODY_TOO_LARGE"
    | "HEADERS_INVALID"
    | "SIGNATURE_INVALID"
    | "EVENT_UNSUPPORTED";

  constructor(code: ResendWebhookVerificationError["code"]) {
    super(code);
    this.name = "ResendWebhookVerificationError";
    this.code = code;
  }
}

export function verifyResendDeliveryWebhook(
  input: Readonly<{
    rawBody: string | Buffer;
    secret: SecretHandle<"RESEND_WEBHOOK_SECRET">;
    recipientHashKeyring: readonly KeyringEntry<"NOTIFICATION_RECIPIENT_HASH_KEYS">[];
    svixId: string | null;
    svixSignature: string | null;
    svixTimestamp: string | null;
  }>,
): VerifiedResendDeliveryWebhook {
  if (
    rawBodyBytes(input.rawBody) > RESEND_WEBHOOK_CONTRACT_V1.maximumRawBodyBytes
  ) {
    throw new ResendWebhookVerificationError("BODY_TOO_LARGE");
  }
  if (
    input.svixId === null ||
    input.svixTimestamp === null ||
    input.svixSignature === null ||
    input.svixId.length > RESEND_WEBHOOK_CONTRACT_V1.maximumHeaderBytes ||
    input.svixTimestamp.length >
      RESEND_WEBHOOK_CONTRACT_V1.maximumHeaderBytes ||
    input.svixSignature.length >
      RESEND_WEBHOOK_CONTRACT_V1.maximumHeaderBytes ||
    !SVIX_ID_PATTERN.test(input.svixId) ||
    !SVIX_TIMESTAMP_PATTERN.test(input.svixTimestamp) ||
    !SVIX_SIGNATURE_PATTERN.test(input.svixSignature)
  ) {
    throw new ResendWebhookVerificationError("HEADERS_INVALID");
  }

  let payload: unknown;
  try {
    payload = input.secret.withValue((secret) =>
      new Webhook(secret).verify(input.rawBody, {
        "svix-id": input.svixId!,
        "svix-signature": input.svixSignature!,
        "svix-timestamp": input.svixTimestamp!,
      }),
    );
  } catch {
    throw new ResendWebhookVerificationError("SIGNATURE_INVALID");
  }

  const event = parseResendDeliveryEvent(payload, input.recipientHashKeyring);
  if (event === null) {
    throw new ResendWebhookVerificationError("EVENT_UNSUPPORTED");
  }
  const payloadDigestCandidates = webhookPayloadDigestCandidates(
    input.rawBody,
    input.recipientHashKeyring,
  );
  return Object.freeze({
    event,
    eventId: input.svixId,
    payloadDigest: payloadDigestCandidates[0]!,
    payloadDigestCandidates,
  });
}

export async function readBoundedResendWebhookBody(request: Request) {
  if (request.body === null) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > RESEND_WEBHOOK_CONTRACT_V1.maximumRawBodyBytes) {
        await reader.cancel("resend webhook body exceeded contract limit");
        throw new ResendWebhookVerificationError("BODY_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

function rawBodyBytes(rawBody: string | Buffer) {
  return typeof rawBody === "string"
    ? Buffer.byteLength(rawBody, "utf8")
    : rawBody.byteLength;
}

/**
 * Creates exact-body replay evidence under the dedicated recipient-identity
 * keyring rather than under the independently rotated Svix signing secret or
 * the AES delivery keyring. New rows persist the active digest; retained keys
 * let a byte-identical retry match during a bounded HMAC-key rotation without
 * storing the raw PII payload.
 */
function webhookPayloadDigestCandidates(
  rawBody: string | Buffer,
  keyring: readonly KeyringEntry<"NOTIFICATION_RECIPIENT_HASH_KEYS">[],
) {
  if (keyring.length === 0) {
    throw new ResendWebhookVerificationError("SIGNATURE_INVALID");
  }
  return Object.freeze(
    Array.from(
      new Set(
        keyring.map((entry) =>
          entry.key.withValue((encodedKey) => {
            const masterKey = Buffer.from(encodedKey, "base64");
            const evidenceKey = createHmac("sha256", masterKey)
              .update(`${PAYLOAD_DIGEST_CONTEXT}key\0`, "utf8")
              .update(entry.version, "utf8")
              .digest();
            return createHmac("sha256", evidenceKey)
              .update(`${PAYLOAD_DIGEST_CONTEXT}value\0`, "utf8")
              .update(entry.version, "utf8")
              .update("\0", "utf8")
              .update(rawBody)
              .digest("hex");
          }),
        ),
      ),
    ),
  );
}
