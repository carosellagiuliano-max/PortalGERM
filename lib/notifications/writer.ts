import { createHash } from "node:crypto";

import { z } from "zod";

import {
  NotificationKind as NotificationKinds,
  type NotificationKind,
} from "@/lib/generated/prisma/enums";
import { parseNotificationPayloadV1 } from "@/lib/notifications/payloads-v1";

const notificationInputSchema = z.strictObject({
  dedupeKey: z.string().trim().min(1).max(160),
  kind: z.enum(NotificationKinds),
  payload: z.unknown(),
  recipientUserId: z.uuid(),
});

export type NotificationWriteInput<Kind extends NotificationKind = NotificationKind> =
  Readonly<{
    dedupeKey: string;
    kind: Kind;
    payload: unknown;
    recipientUserId: string;
  }>;

export type NotificationPersistenceRecord = Readonly<{
  dedupeKey: string;
  kind: NotificationKind;
  payload: Readonly<Record<string, unknown>>;
  recipientUserId: string;
  schemaVersion: "1";
}>;

export type NotificationWritePort<TRow = unknown> = Readonly<{
  notification: Readonly<{
    upsert(input: Readonly<{
      create: NotificationPersistenceRecord;
      update: Readonly<Record<string, never>>;
      where: Readonly<{
        recipientUserId_kind_dedupeKey: Readonly<{
          recipientUserId: string;
          kind: NotificationKind;
          dedupeKey: string;
        }>;
      }>;
    }>): Promise<TRow>;
  }>;
}>;

export class NotificationInputValidationError extends Error {
  readonly issueCodes: readonly string[];

  constructor(error: z.ZodError) {
    const issueCodes = error.issues.map((issue) => {
      const path = issue.path.join(".") || "input";
      return `${path}:${issue.code}`;
    });
    super(`Notification input validation failed: ${issueCodes.join(",")}`);
    this.name = "NotificationInputValidationError";
    this.issueCodes = Object.freeze(issueCodes);
  }
}

export async function writeNotificationExactlyOnce<TRow>(
  port: NotificationWritePort<TRow>,
  input: NotificationWriteInput,
): Promise<TRow> {
  const data = buildNotificationPersistenceRecord(input);
  return port.notification.upsert({
    create: data,
    update: Object.freeze({}),
    where: Object.freeze({
      recipientUserId_kind_dedupeKey: Object.freeze({
        recipientUserId: data.recipientUserId,
        kind: data.kind,
        dedupeKey: data.dedupeKey,
      }),
    }),
  });
}

export function buildNotificationPersistenceRecord(
  input: NotificationWriteInput,
): NotificationPersistenceRecord {
  const inputResult = notificationInputSchema.safeParse(input);
  if (!inputResult.success) {
    throw new NotificationInputValidationError(inputResult.error);
  }

  let payload: Readonly<Record<string, unknown>>;
  try {
    payload = parseNotificationPayloadV1(
      inputResult.data.kind,
      inputResult.data.payload,
    ) as Readonly<Record<string, unknown>>;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new NotificationInputValidationError(error);
    }
    throw error;
  }

  return Object.freeze({
    dedupeKey: buildNotificationStorageDedupeKey({
      dedupeKey: inputResult.data.dedupeKey,
      kind: inputResult.data.kind,
      recipientUserId: inputResult.data.recipientUserId,
    }),
    kind: inputResult.data.kind,
    payload: Object.freeze(payload),
    recipientUserId: inputResult.data.recipientUserId,
    schemaVersion: "1",
  });
}

export function buildNotificationStorageDedupeKey(input: Readonly<{
  dedupeKey: string;
  kind: NotificationKind;
  recipientUserId: string;
}>) {
  const digest = createHash("sha256")
    .update("notification-dedupe-v1\0", "utf8")
    .update(input.recipientUserId, "utf8")
    .update("\0", "utf8")
    .update(input.kind, "utf8")
    .update("\0", "utf8")
    .update(input.dedupeKey, "utf8")
    .digest("hex");
  return `notification-v1:${digest}`;
}
