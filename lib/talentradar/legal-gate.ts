import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  decideLegalGateV1,
  projectPersistedLegalGateV1,
  type LegalGateFailureCode,
} from "@/lib/privacy/legal-gate-policy";

const POSTGRES_PROCESSOR = "postgres-primary";
const SAFE_EVIDENCE_REFERENCE =
  /^(?!.*(?:pending|todo|tbd|unknown|placeholder|external_decision_required))[A-Za-z0-9][A-Za-z0-9_./:#-]{3,254}$/iu;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STORAGE_REGION = /^[a-z0-9][a-z0-9-]{1,63}$/u;

export const TALENT_RADAR_LEGAL_SCOPES = Object.freeze([
  "TALENT_RADAR",
  "RECRUITING_CONVERSATION",
] as const);

export type TalentRadarLegalScope =
  (typeof TALENT_RADAR_LEGAL_SCOPES)[number];

export type TalentRadarLegalEnvironment = Pick<
  ServerEnvironment,
  "APP_ENV" | "LEGAL_PUBLICATION_PRIVACY"
>;

export type TalentRadarLegalGateDecision =
  | Readonly<{
      allowed: true;
      mode: "LOCAL_SYNTHETIC";
      scope: TalentRadarLegalScope;
      approvalId: null;
      inventoryVersionId: null;
    }>
  | Readonly<{
      allowed: true;
      mode: "APPROVED_PROCESSING";
      scope: TalentRadarLegalScope;
      approvalId: string;
      approvalVersion: string;
      inventoryVersionId: string;
      inventoryContentHash: string;
      publicationId: string;
      publicationHash: string;
      processorKey: typeof POSTGRES_PROCESSOR;
      region: string;
      retentionDays: number;
    }>
  | Readonly<{
      allowed: false;
      mode: "BLOCKED";
      scope: TalentRadarLegalScope;
      code:
        | LegalGateFailureCode
        | "INVENTORY_UNAVAILABLE"
        | "INVENTORY_NOT_APPROVED"
        | "PUBLICATION_MISMATCH"
        | "GATE_UNAVAILABLE";
    }>;

/**
 * Local and CI deliberately keep the existing synthetic Radar journey. Every
 * public or production-like environment is bound to the active, reviewed data
 * inventory and an exact ProcessingApproval. No flag or database record alone
 * is sufficient.
 */
export async function decideTalentRadarRuntimeGate(
  database: DatabaseClient | Prisma.TransactionClient,
  input: Readonly<{
    scope: TalentRadarLegalScope;
    environment: TalentRadarLegalEnvironment;
    now: Date;
  }>,
): Promise<TalentRadarLegalGateDecision> {
  if (
    input.environment.APP_ENV === "local" ||
    input.environment.APP_ENV === "ci"
  ) {
    return Object.freeze({
      allowed: true,
      mode: "LOCAL_SYNTHETIC",
      scope: input.scope,
      approvalId: null,
      inventoryVersionId: null,
    });
  }

  if (!input.environment.LEGAL_PUBLICATION_PRIVACY) {
    return blocked(input.scope, "FEATURE_DISABLED");
  }
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    return blocked(input.scope, "INVALID_RECORD");
  }

  const contract = scopeContract(input.scope);
  try {
    const inventory = await database.privacyDataInventoryVersion.findFirst({
      where: {
        status: "ACTIVE",
        effectiveAt: { lte: input.now },
        revokedAt: null,
      },
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        contentHash: true,
        owner: true,
        reviewRef: true,
        entries: {
          where: {
            entityKey: contract.entityKey,
            purposeCode: contract.purposeCode,
            processorKey: POSTGRES_PROCESSOR,
            subjectClass: "CANDIDATE",
          },
          orderBy: { id: "asc" },
          take: 2,
          select: {
            fieldScope: true,
            legalBasisCode: true,
            holdRuleCode: true,
            owner: true,
            processorKey: true,
            retentionDays: true,
            storageRegion: true,
          },
        },
      },
    });
    if (inventory === null || inventory.entries.length !== 1) {
      return blocked(input.scope, "INVENTORY_UNAVAILABLE");
    }
    const entry = inventory.entries[0]!;
    if (
      inventory.reviewRef === null ||
      !SAFE_EVIDENCE_REFERENCE.test(inventory.reviewRef) ||
      !SHA256_HEX.test(inventory.contentHash) ||
      inventory.owner.trim().length < 2 ||
      entry.fieldScope.trim().length === 0 ||
      !SAFE_EVIDENCE_REFERENCE.test(entry.legalBasisCode) ||
      !SAFE_EVIDENCE_REFERENCE.test(entry.holdRuleCode) ||
      entry.owner.trim().length < 2 ||
      entry.processorKey !== POSTGRES_PROCESSOR ||
      !STORAGE_REGION.test(entry.storageRegion) ||
      entry.retentionDays === null ||
      !Number.isSafeInteger(entry.retentionDays) ||
      entry.retentionDays < 1 ||
      entry.retentionDays > 36_500
    ) {
      return blocked(input.scope, "INVENTORY_NOT_APPROVED");
    }

    const approval = await database.processingApproval.findFirst({
      where: {
        scope: input.scope,
        region: entry.storageRegion,
        processorKey: POSTGRES_PROCESSOR,
        status: "APPROVED",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        legalPublication: {
          include: {
            legalDocument: true,
            legalRevision: true,
          },
        },
      },
    });
    const decision = decideLegalGateV1({
      expectedScope: input.scope,
      expectedRegion: entry.storageRegion,
      expectedProcessorKey: POSTGRES_PROCESSOR,
      featureEnabled: input.environment.LEGAL_PUBLICATION_PRIVACY,
      cohortAllowed: true,
      now: input.now,
      gate: projectPersistedLegalGateV1(approval),
    });
    if (!decision.allowed || approval === null) {
      return decision.allowed
        ? blocked(input.scope, "GATE_UNAVAILABLE")
        : blocked(input.scope, decision.code);
    }

    const publication = approval.legalPublication;
    if (
      publication === null ||
      publication.legalDocument.type !== "PRIVACY" ||
      publication.legalDocument.locale !== "de-CH" ||
      publication.legalRevision.status !== "APPROVED" ||
      publication.publicationHash !== publication.legalRevision.contentHash
    ) {
      return blocked(input.scope, "PUBLICATION_MISMATCH");
    }

    return Object.freeze({
      allowed: true,
      mode: "APPROVED_PROCESSING",
      scope: input.scope,
      approvalId: decision.approvalId,
      approvalVersion: decision.approvalVersion,
      inventoryVersionId: inventory.id,
      inventoryContentHash: inventory.contentHash,
      publicationId: decision.publicationId,
      publicationHash: decision.publicationHash,
      processorKey: POSTGRES_PROCESSOR,
      region: entry.storageRegion,
      retentionDays: entry.retentionDays,
    });
  } catch {
    return blocked(input.scope, "GATE_UNAVAILABLE");
  }
}

/**
 * Revalidates and locks the exact legal evidence that authorizes a Radar
 * mutation. `FOR SHARE` prevents approval, publication, revision, document or
 * inventory state from being changed until the caller's transaction commits.
 * A newly inserted replacement approval cannot be substituted silently: the
 * evidence IDs and publication hash must still match after the locks exist.
 */
export async function lockTalentRadarRuntimeGate(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    scope: TalentRadarLegalScope;
    environment: TalentRadarLegalEnvironment;
    now: Date;
  }>,
): Promise<TalentRadarLegalGateDecision> {
  const initial = await decideTalentRadarRuntimeGate(transaction, input);
  if (!initial.allowed || initial.mode === "LOCAL_SYNTHETIC") return initial;

  const contract = scopeContract(input.scope);
  const locked = await transaction.$queryRaw<readonly { approvalId: string }[]>`
    SELECT approval."id" AS "approvalId"
    FROM "ProcessingApproval" approval
    JOIN "LegalPublication" publication
      ON publication."id" = approval."legalPublicationId"
    JOIN "LegalRevision" revision
      ON revision."id" = publication."legalRevisionId"
    JOIN "LegalDocument" document
      ON document."id" = publication."legalDocumentId"
    JOIN "PrivacyDataInventoryVersion" inventory
      ON inventory."id" = ${initial.inventoryVersionId}::uuid
    JOIN "PrivacyDataInventoryEntry" entry
      ON entry."inventoryVersionId" = inventory."id"
     AND entry."entityKey" = ${contract.entityKey}
     AND entry."purposeCode" = ${contract.purposeCode}
     AND entry."processorKey" = ${POSTGRES_PROCESSOR}
     AND entry."subjectClass" = 'CANDIDATE'::"PrivacySubjectClass"
    WHERE approval."id" = ${initial.approvalId}::uuid
      AND publication."id" = ${initial.publicationId}::uuid
    FOR SHARE OF approval, publication, revision, document, inventory, entry
  `;
  if (locked.length !== 1 || locked[0]?.approvalId !== initial.approvalId) {
    return blocked(input.scope, "GATE_UNAVAILABLE");
  }

  const current = await decideTalentRadarRuntimeGate(transaction, input);
  if (!current.allowed || current.mode === "LOCAL_SYNTHETIC") return current;
  if (
    current.approvalId !== initial.approvalId ||
    current.approvalVersion !== initial.approvalVersion ||
    current.inventoryVersionId !== initial.inventoryVersionId ||
    current.inventoryContentHash !== initial.inventoryContentHash ||
    current.publicationId !== initial.publicationId ||
    current.publicationHash !== initial.publicationHash ||
    current.processorKey !== initial.processorKey ||
    current.region !== initial.region ||
    current.retentionDays !== initial.retentionDays
  ) {
    return blocked(input.scope, "GATE_UNAVAILABLE");
  }
  return current;
}

function scopeContract(scope: TalentRadarLegalScope) {
  switch (scope) {
    case "TALENT_RADAR":
      return Object.freeze({
        entityKey: "RADAR_PROFILE",
        purposeCode: "TALENT_RADAR",
      });
    case "RECRUITING_CONVERSATION":
      return Object.freeze({
        entityKey: "MESSAGE",
        purposeCode: "RECRUITING_CONVERSATION",
      });
    default:
      return unsupportedScope(scope);
  }
}

function blocked(
  scope: TalentRadarLegalScope,
  code: Extract<TalentRadarLegalGateDecision, { allowed: false }>["code"],
): Extract<TalentRadarLegalGateDecision, { allowed: false }> {
  return Object.freeze({ allowed: false, mode: "BLOCKED", scope, code });
}

function unsupportedScope(scope: never): never {
  throw new Error(`Unsupported Talent Radar legal scope: ${String(scope)}`);
}
