import "server-only";

import { z } from "zod";

import { hashNotificationRecipient } from "@/lib/notifications/outbox";
import { normalizedEmailSchema } from "@/lib/validation/common";

const eventSchema = z.strictObject({
  type: z.enum(["email.bounced", "email.suppressed", "email.delivered"]),
  created_at: z.iso.datetime(),
  data: z
    .object({
      email_id: z.string().min(1).max(255),
      to: z.array(normalizedEmailSchema).min(1).max(50),
    })
    .passthrough(),
});

export function parseResendDeliveryEvent(payload: unknown) {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) return null;
  return Object.freeze({
    kind:
      parsed.data.type === "email.bounced"
        ? ("BOUNCED" as const)
        : parsed.data.type === "email.suppressed"
          ? ("SUPPRESSED" as const)
          : ("DELIVERED" as const),
    providerReceipt: parsed.data.data.email_id,
    occurredAt: new Date(parsed.data.created_at),
    recipientHashes: Object.freeze(
      parsed.data.data.to.map(hashNotificationRecipient),
    ),
  });
}
