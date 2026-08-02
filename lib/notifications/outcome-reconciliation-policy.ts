import { createHash } from "node:crypto";

import { z } from "zod";

export const NOTIFICATION_OUTCOME_RECONCILIATION_RESOLUTIONS = [
  "ACCEPTED",
  "DEFINITIVELY_NOT_ACCEPTED",
  "UNKNOWN",
] as const;

export type NotificationOutcomeReconciliationResolution =
  (typeof NOTIFICATION_OUTCOME_RECONCILIATION_RESOLUTIONS)[number];

const safeEvidenceReferenceSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+ -]*$/u);

const providerReceiptSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export const notificationOutcomeReconciliationInputSchema = z
  .strictObject({
    outboxId: z.uuid(),
    resolution: z.enum(NOTIFICATION_OUTCOME_RECONCILIATION_RESOLUTIONS),
    evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    evidenceReference: safeEvidenceReferenceSchema,
    idempotencyKey: z.uuid(),
    providerReceipt: providerReceiptSchema.nullish(),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
    stepUpEvidenceId: z.uuid(),
    stepUpGrantToken: z.string().min(32).max(512),
  })
  .superRefine((input, context) => {
    if (input.resolution === "ACCEPTED" && input.providerReceipt == null) {
      context.addIssue({
        code: "custom",
        message: "An accepted resolution requires a provider receipt.",
        path: ["providerReceipt"],
      });
    }
    if (input.resolution !== "ACCEPTED" && input.providerReceipt != null) {
      context.addIssue({
        code: "custom",
        message: "Only an accepted resolution may carry a provider receipt.",
        path: ["providerReceipt"],
      });
    }
  });

export type NotificationOutcomeReconciliationInput = z.output<
  typeof notificationOutcomeReconciliationInputSchema
>;

export const notificationOutcomeReconciliationAuditMetadataSchema =
  z.strictObject({
    contract: z.literal("NOTIFICATION_OUTCOME_RECONCILIATION_V1"),
    evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    evidenceReference: safeEvidenceReferenceSchema,
    idempotencyKey: z.uuid(),
    providerActivationId: z.uuid(),
    providerClass: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u),
    providerDedupeKeyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    providerReceiptDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    providerRequestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    resolution: z.enum(NOTIFICATION_OUTCOME_RECONCILIATION_RESOLUTIONS),
    stepUpEvidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    stepUpGrantDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  });

export type NotificationOutcomeReconciliationAuditMetadata = z.output<
  typeof notificationOutcomeReconciliationAuditMetadataSchema
>;

export function notificationOutcomeReconciliationStepUpAction(
  resolution: NotificationOutcomeReconciliationResolution,
) {
  return `NOTIFICATION_OUTCOME_RECONCILE:${resolution}` as const;
}

export function digestNotificationReconciliationIdentifier(value: string) {
  return createHash("sha256")
    .update("swisstalenthub.notification-reconciliation.v1\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}
