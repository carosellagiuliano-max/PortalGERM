import { z } from "zod";

import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@/lib/policies/status/application";
import { trimmedString } from "@/lib/validation/common";

export const APPLICATION_CONFIRMATION_NOTICE_VERSION_V1 =
  "application-confirmation-v1" as const;
export const APPLICATION_CONFIRMATION_NOTICE_V1 =
  "Ich bestätige, dass SwissTalentHub meine oben angezeigten Identitäts- und Bewerbungsdaten für diese konkrete Stelle an das genannte Unternehmen übermitteln und als unveränderbaren Einreichungsnachweis speichern darf.";

export const APPLICATION_STATUS_LABELS_V1: Readonly<
  Record<ApplicationStatus, string>
> = Object.freeze({
  SUBMITTED: "Eingereicht",
  IN_REVIEW: "In Prüfung",
  SHORTLISTED: "Vorauswahl",
  INTERVIEW: "Interview",
  OFFER: "Angebot",
  HIRED: "Eingestellt",
  REJECTED: "Abgelehnt",
  WITHDRAWN: "Zurückgezogen",
});

const optionalCoverLetter = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  trimmedString(0, 4_000).optional(),
);

export const applyToJobInputSchema = z
  .strictObject({
    signedIntent: z.string().min(1).max(1_024),
    coverLetter: optionalCoverLetter,
    selectedDocumentIds: z.array(z.uuid()).max(1),
    confirmationVersion: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    confirmationSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    confirmed: z.literal(true),
    idempotencyKey: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  })
  .superRefine((input, context) => {
    if (new Set(input.selectedDocumentIds).size !== input.selectedDocumentIds.length) {
      context.addIssue({
        code: "custom",
        path: ["selectedDocumentIds"],
        message: "Document selection must be unique.",
      });
    }
  });

export const candidateApplicationNoteSchema = z.strictObject({
  applicationId: z.uuid(),
  body: trimmedString(1, 1_000),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
});

export const candidateWithdrawApplicationSchema = z.strictObject({
  applicationId: z.uuid(),
  confirmed: z.literal(true),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
});

export const applicationListFilterSchema = z.strictObject({
  status: z.enum(APPLICATION_STATUSES).optional(),
  query: z.string().trim().max(100).optional(),
});

export type ApplyToJobInput = z.output<typeof applyToJobInputSchema>;
export type ApplicationListFilter = z.output<typeof applicationListFilterSchema>;
