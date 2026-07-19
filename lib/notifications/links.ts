import { z } from "zod";

import { type NotificationKind } from "@/lib/generated/prisma/enums";
import {
  parseNotificationPayloadV1,
  type NotificationPayloadsV1,
} from "@/lib/notifications/payloads-v1";

export type AuthorizedNotificationLinkPort = Readonly<{
  authorizeAndBuildLink<Kind extends NotificationKind>(input: Readonly<{
    kind: Kind;
    payload: NotificationPayloadsV1[Kind];
    recipientUserId: string;
  }>): Promise<string | null>;
}>;

export class UnsafeNotificationLinkError extends Error {
  constructor() {
    super("Notification link resolver returned an unsafe path");
    this.name = "UnsafeNotificationLinkError";
  }
}

/**
 * Payload IDs are routing hints only. The supplied port must authorize the
 * recipient and target together in its first repository query.
 */
export async function resolveAuthorizedNotificationLink<
  Kind extends NotificationKind,
>(
  port: AuthorizedNotificationLinkPort,
  input: Readonly<{
    kind: Kind;
    payload: unknown;
    recipientUserId: string;
  }>,
): Promise<string | null> {
  const recipientUserId = z.uuid().parse(input.recipientUserId);
  const payload = parseNotificationPayloadV1(input.kind, input.payload);
  const path = await port.authorizeAndBuildLink({
    kind: input.kind,
    payload,
    recipientUserId,
  });

  if (path === null) {
    return null;
  }
  if (!isSafeInternalPath(path)) {
    throw new UnsafeNotificationLinkError();
  }
  return path;
}

function isSafeInternalPath(value: string) {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
