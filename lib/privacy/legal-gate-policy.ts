import { z } from "zod";

const SAFE_REFERENCE_PATTERN = /^(?!.*(?:pending|todo|tbd|unknown|placeholder))[A-Za-z0-9][A-Za-z0-9_./:#-]{3,254}$/iu;
const AVG_RELEVANT_SCOPES = Object.freeze([
  "TALENT_RADAR",
  "RECRUITING_CONVERSATION",
  "SUCCESS_FEE",
  "PAID_PLACEMENT",
] as const);
const EXTERNAL_PROCESSORS = Object.freeze([
  "document-object-store",
  "email-provider",
  "payment-ledger",
  "runtime-logs",
  "backup-restore",
] as const);

export const legalGateRecordSchema = z
  .object({
    id: z.string().uuid(),
    scope: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
    region: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/u),
    processorKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,95}$/u),
    version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u),
    status: z.enum(["DRAFT", "APPROVED", "REVOKED", "EXPIRED"]),
    legalPublicationId: z.string().uuid().nullable(),
    legalBasisRef: z.string().max(255),
    avgDecisionRef: z.string().max(255).nullable(),
    dpaRef: z.string().max(255).nullable(),
    dsfaDecision: z.enum(["REQUIRED", "NOT_REQUIRED", "APPROVED"]),
    dsfaDecisionRef: z.string().max(255).nullable(),
    owner: z.string().trim().min(2).max(160),
    approvedBy: z.string().trim().min(2).max(160).nullable(),
    effectiveAt: z.date().nullable(),
    expiresAt: z.date().nullable(),
    reviewAt: z.date(),
    revokedAt: z.date().nullable(),
    publication: z
      .object({
        status: z.enum(["CURRENT", "REVOKED", "EXPIRED"]),
        effectiveAt: z.date(),
        expiresAt: z.date().nullable(),
        revokedAt: z.date().nullable(),
        publicationHash: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type LegalGateRecordV1 = Readonly<z.infer<typeof legalGateRecordSchema>>;
export type LegalGateFailureCode =
  | "INVALID_RECORD"
  | "SCOPE_MISMATCH"
  | "REGION_MISMATCH"
  | "PROCESSOR_MISMATCH"
  | "NOT_APPROVED"
  | "NOT_EFFECTIVE"
  | "EXPIRED"
  | "REVIEW_DUE"
  | "REVOKED"
  | "PUBLICATION_UNAVAILABLE"
  | "LEGAL_BASIS_UNAVAILABLE"
  | "AVG_DECISION_UNAVAILABLE"
  | "DPA_UNAVAILABLE"
  | "DSFA_UNAVAILABLE"
  | "SEPARATION_OF_DUTIES_REQUIRED"
  | "FEATURE_DISABLED"
  | "COHORT_DENIED";

export type LegalGateDecisionV1 =
  | Readonly<{
      allowed: true;
      approvalId: string;
      approvalVersion: string;
      publicationId: string;
      publicationHash: string;
    }>
  | Readonly<{ allowed: false; code: LegalGateFailureCode }>;

/**
 * Projects a persistence record onto the closed policy contract. Prisma
 * includes relation and bookkeeping fields which a strict deny-by-default
 * schema must not accept implicitly.
 */
export function projectPersistedLegalGateV1(
  value: Readonly<{
    id: unknown;
    scope: unknown;
    region: unknown;
    processorKey: unknown;
    version: unknown;
    status: unknown;
    legalPublicationId: unknown;
    legalBasisRef: unknown;
    avgDecisionRef: unknown;
    dpaRef: unknown;
    dsfaDecision: unknown;
    dsfaDecisionRef: unknown;
    owner: unknown;
    approvedBy: unknown;
    effectiveAt: unknown;
    expiresAt: unknown;
    reviewAt: unknown;
    revokedAt: unknown;
    legalPublication?: unknown;
  }> | null,
): unknown {
  if (value === null) return null;
  const publication =
    typeof value.legalPublication === "object" &&
    value.legalPublication !== null
      ? (value.legalPublication as Readonly<Record<string, unknown>>)
      : null;
  return Object.freeze({
    id: value.id,
    scope: value.scope,
    region: value.region,
    processorKey: value.processorKey,
    version: value.version,
    status: value.status,
    legalPublicationId: value.legalPublicationId,
    legalBasisRef: value.legalBasisRef,
    avgDecisionRef: value.avgDecisionRef,
    dpaRef: value.dpaRef,
    dsfaDecision: value.dsfaDecision,
    dsfaDecisionRef: value.dsfaDecisionRef,
    owner: value.owner,
    approvedBy: value.approvedBy,
    effectiveAt: value.effectiveAt,
    expiresAt: value.expiresAt,
    reviewAt: value.reviewAt,
    revokedAt: value.revokedAt,
    publication:
      publication === null
        ? null
        : Object.freeze({
            status: publication.status,
            effectiveAt: publication.effectiveAt,
            expiresAt: publication.expiresAt,
            revokedAt: publication.revokedAt,
            publicationHash: publication.publicationHash,
          }),
  });
}

export function decideLegalGateV1(
  input: Readonly<{
    expectedScope: string;
    expectedRegion: string;
    expectedProcessorKey: string;
    featureEnabled: boolean;
    cohortAllowed: boolean;
    now: Date;
    gate: unknown;
  }>,
): LegalGateDecisionV1 {
  if (!input.featureEnabled) return denied("FEATURE_DISABLED");
  if (!input.cohortAllowed) return denied("COHORT_DENIED");
  if (!isValidDate(input.now)) return denied("INVALID_RECORD");
  const parsed = legalGateRecordSchema.safeParse(input.gate);
  if (!parsed.success) return denied("INVALID_RECORD");
  const gate = parsed.data;

  if (gate.scope !== input.expectedScope) return denied("SCOPE_MISMATCH");
  if (gate.region !== input.expectedRegion) return denied("REGION_MISMATCH");
  if (gate.processorKey !== input.expectedProcessorKey) {
    return denied("PROCESSOR_MISMATCH");
  }
  if (gate.status === "REVOKED" || gate.revokedAt !== null) {
    return denied("REVOKED");
  }
  if (gate.status !== "APPROVED" || gate.approvedBy === null) {
    return denied("NOT_APPROVED");
  }
  if (gate.owner.localeCompare(gate.approvedBy, undefined, { sensitivity: "accent" }) === 0) {
    return denied("SEPARATION_OF_DUTIES_REQUIRED");
  }
  if (gate.effectiveAt === null || gate.effectiveAt > input.now) {
    return denied("NOT_EFFECTIVE");
  }
  if (gate.expiresAt !== null && gate.expiresAt <= input.now) {
    return denied("EXPIRED");
  }
  if (gate.reviewAt <= input.now) return denied("REVIEW_DUE");
  if (!SAFE_REFERENCE_PATTERN.test(gate.legalBasisRef)) {
    return denied("LEGAL_BASIS_UNAVAILABLE");
  }
  if (
    AVG_RELEVANT_SCOPES.includes(
      gate.scope as (typeof AVG_RELEVANT_SCOPES)[number],
    ) &&
    (gate.avgDecisionRef === null ||
      !SAFE_REFERENCE_PATTERN.test(gate.avgDecisionRef))
  ) {
    return denied("AVG_DECISION_UNAVAILABLE");
  }
  if (
    EXTERNAL_PROCESSORS.includes(
      gate.processorKey as (typeof EXTERNAL_PROCESSORS)[number],
    ) &&
    (gate.dpaRef === null || !SAFE_REFERENCE_PATTERN.test(gate.dpaRef))
  ) {
    return denied("DPA_UNAVAILABLE");
  }
  if (
    gate.dsfaDecision === "REQUIRED" ||
    gate.dsfaDecisionRef === null ||
    !SAFE_REFERENCE_PATTERN.test(gate.dsfaDecisionRef)
  ) {
    return denied("DSFA_UNAVAILABLE");
  }
  const publication = gate.publication;
  if (
    gate.legalPublicationId === null ||
    publication === null ||
    publication.status !== "CURRENT" ||
    publication.revokedAt !== null ||
    publication.effectiveAt > input.now ||
    (publication.expiresAt !== null && publication.expiresAt <= input.now)
  ) {
    return denied("PUBLICATION_UNAVAILABLE");
  }

  return Object.freeze({
    allowed: true,
    approvalId: gate.id,
    approvalVersion: gate.version,
    publicationId: gate.legalPublicationId,
    publicationHash: publication.publicationHash,
  });
}

function denied(code: LegalGateFailureCode): LegalGateDecisionV1 {
  return Object.freeze({ allowed: false, code });
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}
