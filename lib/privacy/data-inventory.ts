import { createHash } from "node:crypto";

import { z } from "zod";

export const PRIVACY_SUBJECT_CLASSES_V1 = Object.freeze([
  "USER",
  "CANDIDATE",
  "EMPLOYER_MEMBER",
  "INVITEE",
  "LEAD",
  "REPORTER",
  "NON_ACCOUNT_HOLDER",
] as const);

export const PRIVACY_PROCESSORS_V1 = Object.freeze([
  "postgres-primary",
  "document-object-store",
  "notification-outbox",
  "email-provider",
  "payment-ledger",
  "analytics-store",
  "audit-store",
  "runtime-logs",
  "backup-restore",
] as const);

const inventoryOutcomeSchema = z.enum([
  "INCLUDE",
  "EXCLUDE",
  "CORRECT",
  "DELETE",
  "ANONYMIZE",
  "RETAIN",
]);

export const privacyDataInventoryRowSchema = z
  .object({
    entityKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u),
    fieldScope: z.string().trim().min(1).max(255),
    subjectClass: z.enum(PRIVACY_SUBJECT_CLASSES_V1),
    purposeCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u),
    legalBasisCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u),
    processorKey: z.enum(PRIVACY_PROCESSORS_V1),
    storageRegion: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/u),
    retentionDays: z.number().int().min(1).max(36_500).nullable(),
    exportOutcome: inventoryOutcomeSchema,
    correctionOutcome: inventoryOutcomeSchema,
    erasureOutcome: inventoryOutcomeSchema,
    holdRuleCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u),
    owner: z.string().trim().min(2).max(160),
    flowScope: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
  })
  .strict();

export type PrivacyDataInventoryRowV1 = Readonly<
  z.infer<typeof privacyDataInventoryRowSchema>
>;

const POSTGRES_REGION = "ch-sandbox";
const COMMON = Object.freeze({
  legalBasisCode: "EXTERNAL_DECISION_REQUIRED",
  processorKey: "postgres-primary" as const,
  storageRegion: POSTGRES_REGION,
  holdRuleCode: "PHASE22_HOLD_MATRIX_V1",
  owner: "Privacy + Legal",
});

/**
 * Technical inventory V1. `EXTERNAL_DECISION_REQUIRED` is intentional: the
 * registry can be complete without pretending that counsel approved a basis.
 * Activation policy rejects that code until a signed database version replaces
 * it with an externally owned decision.
 */
export const PHASE22_DATA_INVENTORY_V1 = Object.freeze([
  row({
    entityKey: "USER_ACCOUNT",
    fieldScope: "identity, account state, verified address history",
    subjectClass: "USER",
    purposeCode: "ACCOUNT_AND_SECURITY",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "PRIVACY_RIGHTS",
  }),
  row({
    entityKey: "PERSONA_ASSIGNMENT",
    fieldScope:
      "persona kind, lifecycle status, source, version and context-safe history",
    subjectClass: "USER",
    purposeCode: "ACCOUNT_AND_SECURITY",
    exportOutcome: "INCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "PRIVACY_RIGHTS",
  }),
  row({
    entityKey: "CANDIDATE_PROFILE",
    fieldScope: "profile, preferences, salary and location choices",
    subjectClass: "CANDIDATE",
    purposeCode: "CANDIDATE_SERVICE",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "DELETE",
    retentionDays: null,
    flowScope: "PRIVACY_RIGHTS",
  }),
  row({
    entityKey: "CANDIDATE_APPLICATION",
    fieldScope: "submission snapshot, status and candidate-authored content",
    subjectClass: "CANDIDATE",
    purposeCode: "APPLICATION_WORKFLOW",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "RETAIN",
    retentionDays: 400,
    flowScope: "APPLICATION_WORKFLOW",
  }),
  row({
    entityKey: "EXTERNAL_APPLICATION_TRACKER",
    fieldScope:
      "candidate-confirmed status, immutable job snapshot, reminder and event history",
    subjectClass: "CANDIDATE",
    purposeCode: "EXTERNAL_APPLICATION_TRACKING",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "RETAIN",
    retentionDays: 400,
    flowScope: "EXTERNAL_APPLICATION_TRACKING",
  }),
  row({
    entityKey: "INTERVIEW_SCHEDULING",
    fieldScope:
      "owned participant, proposals, responses, calendar metadata, reminder and event history",
    subjectClass: "CANDIDATE",
    purposeCode: "INTERVIEW_SCHEDULING",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "RETAIN",
    retentionDays: 400,
    flowScope: "INTERVIEW_SCHEDULING",
  }),
  row({
    entityKey: "INTERVIEW_SCHEDULING",
    fieldScope:
      "owned company-participant, proposals, responses, calendar metadata, reminder and event history",
    subjectClass: "EMPLOYER_MEMBER",
    purposeCode: "INTERVIEW_SCHEDULING",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "RETAIN",
    retentionDays: 400,
    flowScope: "INTERVIEW_SCHEDULING",
  }),
  row({
    entityKey: "EMPLOYER_PRIVATE_NOTE",
    fieldScope: "employer-authored assessment and internal notes",
    subjectClass: "CANDIDATE",
    purposeCode: "EMPLOYER_APPLICATION_REVIEW",
    exportOutcome: "EXCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "RETAIN",
    retentionDays: 400,
    flowScope: "APPLICATION_WORKFLOW",
  }),
  row({
    entityKey: "RADAR_PROFILE",
    fieldScope: "anonymous projection, consent and contact lifecycle",
    subjectClass: "CANDIDATE",
    purposeCode: "TALENT_RADAR",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "DELETE",
    retentionDays: null,
    flowScope: "TALENT_RADAR",
  }),
  row({
    entityKey: "MESSAGE",
    fieldScope: "candidate-authored conversation content",
    subjectClass: "CANDIDATE",
    purposeCode: "RECRUITING_CONVERSATION",
    exportOutcome: "INCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "RECRUITING_CONVERSATION",
  }),
  row({
    entityKey: "COMPANY_MEMBERSHIP",
    fieldScope: "role, invitation, assignment and membership lifecycle",
    subjectClass: "EMPLOYER_MEMBER",
    purposeCode: "EMPLOYER_TENANCY",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "EMPLOYER_TENANCY",
  }),
  row({
    entityKey: "COMPANY_INVITATION",
    fieldScope: "invitee address, role and invitation lifecycle",
    subjectClass: "INVITEE",
    purposeCode: "EMPLOYER_INVITATION",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "DELETE",
    retentionDays: 90,
    flowScope: "EMPLOYER_TENANCY",
  }),
  row({
    entityKey: "SALES_LEAD",
    fieldScope: "lead identity, company context and qualification state",
    subjectClass: "LEAD",
    purposeCode: "EMPLOYER_LEAD",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "EMPLOYER_LEAD",
  }),
  row({
    entityKey: "ABUSE_REPORT",
    fieldScope:
      "reporter-provided identity, report content and freshness-review lifecycle",
    subjectClass: "REPORTER",
    purposeCode: "TRUST_AND_SAFETY",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "TRUST_AND_SAFETY",
  }),
  row({
    entityKey: "NON_ACCOUNT_PRIVACY_INTAKE",
    fieldScope: "bounded contact evidence and identity-challenge lifecycle",
    subjectClass: "NON_ACCOUNT_HOLDER",
    purposeCode: "PRIVACY_RIGHTS",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "PRIVACY_RIGHTS",
  }),
  row({
    entityKey: "SUPPORT_CASE",
    fieldScope: "requester-authored support messages and case state",
    subjectClass: "USER",
    purposeCode: "SUPPORT",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "SUPPORT",
  }),
  row({
    entityKey: "CONSENT_EVIDENCE",
    fieldScope: "notice version, decision, actor and effective time",
    subjectClass: "USER",
    purposeCode: "CONSENT_EVIDENCE",
    exportOutcome: "INCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "RETAIN",
    retentionDays: 3650,
    flowScope: "CONSENT",
  }),
  row({
    entityKey: "PRIVACY_CASE_EVIDENCE",
    fieldScope: "case state, processor outcomes, proofs and tombstones",
    subjectClass: "USER",
    purposeCode: "PRIVACY_RIGHTS",
    exportOutcome: "INCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "RETAIN",
    retentionDays: 3650,
    flowScope: "PRIVACY_RIGHTS",
  }),
  row({
    entityKey: "DOCUMENT_METADATA",
    fieldScope: "filename, size, digest, scan and access evidence",
    subjectClass: "CANDIDATE",
    purposeCode: "DOCUMENT_VAULT",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "DELETE",
    retentionDays: null,
    flowScope: "DOCUMENT_VAULT",
  }),
  row({
    entityKey: "DOCUMENT_BYTES",
    fieldScope: "candidate-owned clean document bytes",
    subjectClass: "CANDIDATE",
    purposeCode: "DOCUMENT_VAULT",
    processorKey: "document-object-store",
    storageRegion: "local-test",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "DELETE",
    retentionDays: null,
    flowScope: "DOCUMENT_VAULT",
  }),
  row({
    entityKey: "NOTIFICATION_OUTBOX",
    fieldScope:
      "delivery purpose/outcome; encrypted destination is short-lived, correlatable attempt evidence is compacted after 400 days",
    subjectClass: "USER",
    purposeCode: "TRANSACTIONAL_DELIVERY",
    processorKey: "notification-outbox",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "TRANSACTIONAL_EMAIL",
  }),
  row({
    entityKey: "EMAIL_PROVIDER_RECEIPT",
    fieldScope:
      "transactional provider receipt/digest for at most 400 days, then irreversible evidence compaction; bounded error class remains",
    subjectClass: "USER",
    purposeCode: "TRANSACTIONAL_DELIVERY",
    processorKey: "email-provider",
    storageRegion: "provider-decision-required",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "DELETE",
    retentionDays: 400,
    flowScope: "TRANSACTIONAL_EMAIL",
  }),
  row({
    entityKey: "BILLING_EVIDENCE",
    fieldScope: "orders, invoices, ledger and accounting identity",
    subjectClass: "EMPLOYER_MEMBER",
    purposeCode: "BILLING_AND_ACCOUNTING",
    processorKey: "payment-ledger",
    exportOutcome: "INCLUDE",
    correctionOutcome: "CORRECT",
    erasureOutcome: "RETAIN",
    retentionDays: 3650,
    flowScope: "BILLING",
  }),
  row({
    entityKey: "ESSENTIAL_ANALYTICS",
    fieldScope: "allowlisted operational event and provenance snapshot",
    subjectClass: "USER",
    purposeCode: "ESSENTIAL_OPERATIONAL",
    processorKey: "analytics-store",
    exportOutcome: "INCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 400,
    flowScope: "ESSENTIAL_ANALYTICS",
  }),
  row({
    entityKey: "OPTIONAL_PRODUCT_ANALYTICS",
    fieldScope: "allowlisted optional event family and pseudonym epoch",
    subjectClass: "USER",
    purposeCode: "PRODUCT_ANALYTICS",
    processorKey: "analytics-store",
    exportOutcome: "INCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "DELETE",
    retentionDays: 90,
    flowScope: "OPTIONAL_ANALYTICS",
  }),
  row({
    entityKey: "AUDIT_LOG",
    fieldScope:
      "security action, capability, result and pseudonymous network evidence",
    subjectClass: "USER",
    purposeCode: "SECURITY_AUDIT",
    processorKey: "audit-store",
    exportOutcome: "EXCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "RETAIN",
    retentionDays: 400,
    flowScope: "SECURITY_AUDIT",
  }),
  row({
    entityKey: "RUNTIME_LOG",
    fieldScope: "redacted request and bounded failure metadata",
    subjectClass: "USER",
    purposeCode: "SECURITY_OPERATIONS",
    processorKey: "runtime-logs",
    storageRegion: "runtime-decision-required",
    exportOutcome: "EXCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "DELETE",
    retentionDays: 30,
    flowScope: "SECURITY_OPERATIONS",
  }),
  row({
    entityKey: "BACKUP_SNAPSHOT",
    fieldScope: "encrypted point-in-time database and object snapshots",
    subjectClass: "USER",
    purposeCode: "DISASTER_RECOVERY",
    processorKey: "backup-restore",
    storageRegion: "backup-decision-required",
    exportOutcome: "EXCLUDE",
    correctionOutcome: "RETAIN",
    erasureOutcome: "ANONYMIZE",
    retentionDays: 35,
    flowScope: "BACKUP_RESTORE",
  }),
] satisfies readonly PrivacyDataInventoryRowV1[]);

export type PrivacyInventoryValidation = Readonly<{
  valid: boolean;
  contentHash: string;
  issues: readonly string[];
  processors: readonly string[];
  subjectClasses: readonly string[];
}>;

export function validatePrivacyDataInventoryV1(
  rows: readonly unknown[],
): PrivacyInventoryValidation {
  const issues: string[] = [];
  const parsed: PrivacyDataInventoryRowV1[] = [];
  const keys = new Set<string>();

  for (const [index, input] of rows.entries()) {
    const result = privacyDataInventoryRowSchema.safeParse(input);
    if (!result.success) {
      issues.push(
        `row:${index}:${result.error.issues[0]?.message ?? "invalid"}`,
      );
      continue;
    }
    const value = Object.freeze({ ...result.data });
    const key = inventoryRowKey(value);
    if (keys.has(key)) issues.push(`duplicate:${key}`);
    keys.add(key);
    if (value.erasureOutcome === "RETAIN" && value.retentionDays === null) {
      issues.push(`retention-required:${key}`);
    }
    parsed.push(value);
  }

  for (const processor of PRIVACY_PROCESSORS_V1) {
    if (!parsed.some((entry) => entry.processorKey === processor)) {
      issues.push(`missing-processor:${processor}`);
    }
  }
  for (const subjectClass of PRIVACY_SUBJECT_CLASSES_V1) {
    if (!parsed.some((entry) => entry.subjectClass === subjectClass)) {
      issues.push(`missing-subject:${subjectClass}`);
    }
  }

  const canonical = [...parsed].sort((left, right) =>
    inventoryRowKey(left).localeCompare(inventoryRowKey(right)),
  );
  return Object.freeze({
    valid: issues.length === 0,
    contentHash: createHash("sha256")
      .update(JSON.stringify(canonical), "utf8")
      .digest("hex"),
    issues: Object.freeze(issues),
    processors: Object.freeze(
      [...new Set(canonical.map(({ processorKey }) => processorKey))].sort(),
    ),
    subjectClasses: Object.freeze(
      [...new Set(canonical.map(({ subjectClass }) => subjectClass))].sort(),
    ),
  });
}

export function processorKeysForPrivacyActionV1(
  subjectClass: PrivacyDataInventoryRowV1["subjectClass"],
  action: "EXPORT" | "CORRECTION" | "ERASURE",
): readonly string[] {
  const outcomeKey =
    action === "EXPORT"
      ? "exportOutcome"
      : action === "CORRECTION"
        ? "correctionOutcome"
        : "erasureOutcome";
  return Object.freeze(
    [
      ...new Set(
        PHASE22_DATA_INVENTORY_V1.filter(
          (entry) =>
            (entry.subjectClass === subjectClass ||
              entry.subjectClass === "USER") &&
            entry[outcomeKey] !== "EXCLUDE",
        ).map(({ processorKey }) => processorKey),
      ),
    ].sort(),
  );
}

function row(
  input: Omit<
    PrivacyDataInventoryRowV1,
    | "legalBasisCode"
    | "processorKey"
    | "storageRegion"
    | "holdRuleCode"
    | "owner"
  > &
    Partial<
      Pick<
        PrivacyDataInventoryRowV1,
        | "legalBasisCode"
        | "processorKey"
        | "storageRegion"
        | "holdRuleCode"
        | "owner"
      >
    >,
): PrivacyDataInventoryRowV1 {
  return Object.freeze(
    privacyDataInventoryRowSchema.parse({ ...COMMON, ...input }),
  );
}

function inventoryRowKey(rowValue: PrivacyDataInventoryRowV1) {
  return [
    rowValue.entityKey,
    rowValue.fieldScope,
    rowValue.subjectClass,
    rowValue.processorKey,
  ].join(":");
}
