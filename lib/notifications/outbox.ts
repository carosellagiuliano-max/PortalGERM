import "server-only";

import { createHash } from "node:crypto";

import type { KeyringEntry } from "@/lib/config/env-schema";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from "@/lib/providers/email/email-provider";
import { normalizedEmailSchema } from "@/lib/validation/common";

import { encryptNotificationRecipient } from "./delivery-material";
import { policyForTemplate } from "./purpose-policy";

const DEDUPE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const PAYLOAD_SCHEMA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;
const MAXIMUM_PAYLOAD_BYTES = 32 * 1024;
const FORBIDDEN_PAYLOAD_KEY =
  /(password|secret|credential|authorization|cookie|rawtoken|bearer|cv|messagebody|ciphertext)/iu;
const RAW_TOKEN_VALUE = /^[A-Za-z0-9_-]{32,512}$/u;
const UUID_VALUE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type NotificationRecipient =
  | Readonly<{ userId: string }>
  | Readonly<{
      address: string;
      keyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[];
    }>;

export type EnqueueNotificationInput = Readonly<{
  recipient: NotificationRecipient;
  templateKey: EmailTemplateKey;
  payloadSchemaVersion: string;
  payload: Readonly<Record<string, unknown>>;
  dedupeKey: string;
  availableAt: Date;
  maxAttempts?: number;
}>;

export class NotificationOutboxInputError extends Error {
  constructor(readonly code: string) {
    super(`Notification outbox input rejected: ${code}`);
    this.name = "NotificationOutboxInputError";
  }
}

export async function enqueueNotification(
  transaction: Prisma.TransactionClient,
  input: EnqueueNotificationInput,
) {
  const normalized = normalizeInput(input);
  const policy = policyForTemplate(normalized.templateKey);
  const encryptedRecipient =
    "address" in normalized.recipient
      ? encryptNotificationRecipient(
          normalized.recipient.address,
          normalized.recipient.keyring,
        )
      : undefined;
  const providerDedupeKey = providerKey(normalized.dedupeKey);
  const data = {
    ...("userId" in normalized.recipient
      ? { recipientUserId: normalized.recipient.userId }
      : {
          recipientAddressCiphertext: Buffer.from(
            encryptedRecipient!.ciphertext,
          ),
          recipientAddressNonce: Buffer.from(encryptedRecipient!.nonce),
          recipientAddressTag: Buffer.from(encryptedRecipient!.authTag),
          recipientAddressKeyVersion: encryptedRecipient!.keyVersion,
        }),
    purpose: policy.purpose,
    purposeClass: policy.classification,
    channel: "EMAIL" as const,
    templateKey: normalized.templateKey,
    payloadSchemaVersion: normalized.payloadSchemaVersion,
    payload: normalized.payload as Prisma.InputJsonValue,
    dedupeKey: normalized.dedupeKey,
    providerDedupeKey,
    status: "PENDING" as const,
    availableAt: normalized.availableAt,
    maxAttempts: normalized.maxAttempts,
  };
  const row = await transaction.notificationOutbox.upsert({
    where: { dedupeKey: normalized.dedupeKey },
    create: data,
    update: {},
    select: {
      id: true,
      recipientUserId: true,
      recipientAddressCiphertext: true,
      purpose: true,
      purposeClass: true,
      templateKey: true,
      payloadSchemaVersion: true,
      payload: true,
      providerDedupeKey: true,
      availableAt: true,
      maxAttempts: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (
    row.purpose !== policy.purpose ||
    row.purposeClass !== policy.classification ||
    row.templateKey !== normalized.templateKey ||
    row.payloadSchemaVersion !== normalized.payloadSchemaVersion ||
    row.providerDedupeKey !== providerDedupeKey ||
    row.availableAt.getTime() !== normalized.availableAt.getTime() ||
    row.maxAttempts !== normalized.maxAttempts ||
    stableJson(row.payload) !== stableJson(normalized.payload) ||
    ("userId" in normalized.recipient
      ? row.recipientUserId !== normalized.recipient.userId ||
        row.recipientAddressCiphertext !== null
      : row.recipientUserId !== null ||
        row.recipientAddressCiphertext === null)
  ) {
    throw new NotificationOutboxInputError("DEDUPE_CONFLICT");
  }
  return Object.freeze({
    id: row.id,
    created: row.createdAt.getTime() === row.updatedAt.getTime(),
  });
}

export function hashNotificationRecipient(normalizedAddress: string) {
  return createHash("sha256")
    .update("swisstalenthub.notification-recipient-hash.v1\0", "utf8")
    .update(normalizedAddress, "utf8")
    .digest("hex");
}

function normalizeInput(input: EnqueueNotificationInput) {
  if (!EMAIL_TEMPLATE_KEYS.includes(input.templateKey)) {
    throw new NotificationOutboxInputError("TEMPLATE_UNKNOWN");
  }
  if (!DEDUPE_KEY_PATTERN.test(input.dedupeKey)) {
    throw new NotificationOutboxInputError("DEDUPE_KEY_INVALID");
  }
  if (!PAYLOAD_SCHEMA_PATTERN.test(input.payloadSchemaVersion)) {
    throw new NotificationOutboxInputError("PAYLOAD_SCHEMA_INVALID");
  }
  if (
    !(input.availableAt instanceof Date) ||
    !Number.isFinite(input.availableAt.getTime())
  ) {
    throw new NotificationOutboxInputError("AVAILABLE_AT_INVALID");
  }
  const maxAttempts = input.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new NotificationOutboxInputError("MAX_ATTEMPTS_INVALID");
  }
  const payload = structuredClone(input.payload);
  assertPayloadSafe(payload);
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (payloadBytes > MAXIMUM_PAYLOAD_BYTES) {
    throw new NotificationOutboxInputError("PAYLOAD_TOO_LARGE");
  }

  const recipient =
    "userId" in input.recipient
      ? normalizeUserRecipient(input.recipient)
      : normalizeAddressRecipient(input.recipient);
  return Object.freeze({
    ...input,
    recipient,
    payload: Object.freeze(payload),
    maxAttempts,
  });
}

function normalizeUserRecipient(recipient: Readonly<{ userId: string }>) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      recipient.userId,
    )
  ) {
    throw new NotificationOutboxInputError("RECIPIENT_USER_INVALID");
  }
  return Object.freeze({ userId: recipient.userId });
}

function normalizeAddressRecipient(
  recipient: Readonly<{
    address: string;
    keyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[];
  }>,
) {
  const address = normalizedEmailSchema.safeParse(recipient.address);
  if (!address.success) {
    throw new NotificationOutboxInputError("RECIPIENT_ADDRESS_INVALID");
  }
  if (recipient.keyring.length === 0) {
    throw new NotificationOutboxInputError("RECIPIENT_KEYRING_EMPTY");
  }
  return Object.freeze({ address: address.data, keyring: recipient.keyring });
}

function assertPayloadSafe(
  value: unknown,
  path: readonly string[] = [],
): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new NotificationOutboxInputError("PAYLOAD_NON_FINITE");
    }
    return;
  }
  if (typeof value === "string") {
    if (
      value.length > 2_048 ||
      /https?:\/\//iu.test(value) ||
      (RAW_TOKEN_VALUE.test(value) && !UUID_VALUE.test(value))
    ) {
      throw new NotificationOutboxInputError("PAYLOAD_SECRET_OR_URL");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new NotificationOutboxInputError("PAYLOAD_ARRAY_TOO_LARGE");
    }
    for (const [index, entry] of value.entries()) {
      assertPayloadSafe(entry, [...path, String(index)]);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new NotificationOutboxInputError("PAYLOAD_TYPE_INVALID");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEY.test(key)) {
      throw new NotificationOutboxInputError(
        `PAYLOAD_KEY_FORBIDDEN:${[...path, key].join(".")}`,
      );
    }
    assertPayloadSafe(entry, [...path, key]);
  }
}

function providerKey(dedupeKey: string) {
  return `sth-${createHash("sha256")
    .update("swisstalenthub.notification-provider-key.v1\0", "utf8")
    .update(dedupeKey, "utf8")
    .digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
