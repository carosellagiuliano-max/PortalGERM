import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { DataProvenance } from "@/lib/generated/prisma/enums";
import { z } from "zod";

import {
  ANALYTICS_EVENT_CONTRACTS_V1,
  analyticsEventV1Schema,
  type AnalyticsEventInputV1,
} from "@/lib/analytics/event-contracts";
import {
  createPrismaAnalyticsWriter,
  trackAnalyticsEventV1,
  type AnalyticsProvenanceSnapshots,
  type TrackAnalyticsResult,
} from "@/lib/analytics/track";
import {
  writeRequiredAudit,
  type AuditPersistenceRecord,
} from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  decideLegalGateV1,
  projectPersistedLegalGateV1,
} from "@/lib/privacy/legal-gate-policy";

export const OPTIONAL_ANALYTICS_FAMILIES_V1 = Object.freeze([
  "NAVIGATION",
  "CONVERSION",
] as const);
export type OptionalAnalyticsFamilyV1 =
  (typeof OPTIONAL_ANALYTICS_FAMILIES_V1)[number];

const consentInputSchema = z
  .object({
    userId: z.string().uuid().optional(),
    pseudonymousSubjectId: z.string().min(16).max(128).optional(),
    eventFamily: z.enum(OPTIONAL_ANALYTICS_FAMILIES_V1),
    granted: z.boolean(),
    policyVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u),
    noticeHash: z.string().regex(/^[a-f0-9]{64}$/u),
    legalPublicationId: z.string().uuid(),
    processingApprovalId: z.string().uuid(),
    pseudonymEpoch: z.number().int().min(1).max(1_000_000),
    actorUserId: z.string().uuid().optional(),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
    effectiveAt: z.date(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.userId === undefined) === (value.pseudonymousSubjectId === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["userId"],
        message: "exactly one analytics consent subject is required",
      });
    }
    if (
      value.userId !== undefined &&
      value.actorUserId !== undefined &&
      value.userId !== value.actorUserId
    ) {
      context.addIssue({
        code: "custom",
        path: ["actorUserId"],
        message: "an authenticated user can change only their own preference",
      });
    }
  });

export type LiveAnalyticsPolicyDecision =
  | Readonly<{ allowed: true; family: OptionalAnalyticsFamilyV1 }>
  | Readonly<{
      allowed: false;
      code:
        | "ESSENTIAL_EVENT"
        | "FEATURE_DISABLED"
        | "CONSENT_MISSING"
        | "CONSENT_REVOKED"
        | "CONSENT_STALE"
        | "LEGAL_GATE_BLOCKED"
        | "PROVENANCE_BLOCKED"
        | "PII_PROPERTY_BLOCKED"
        | "SEARCH_LEARNING_BLOCKED";
    }>;

export function optionalAnalyticsFamilyForEventV1(
  kind: AnalyticsEventInputV1["kind"],
): OptionalAnalyticsFamilyV1 | null {
  switch (kind) {
    case "PUBLIC_VALUE_VIEWED":
    case "SEARCH_SUBMITTED":
    case "SEARCH_RESULTS_VIEWED":
    case "JOB_DETAIL_VIEWED":
      return "NAVIGATION";
    case "JOB_SAVED":
    case "APPLY_INTENT_STARTED":
    case "EXTERNAL_APPLY_CLICKED":
    case "PRICING_VIEWED":
      return "CONVERSION";
    default:
      return null;
  }
}

export function decideLiveAnalyticsWriteV1(input: Readonly<{
  event: AnalyticsEventInputV1;
  familyEnabled: boolean;
  searchLearningCollection: boolean;
  provenance: DataProvenance | null;
  consent: Readonly<{
    granted: boolean;
    eventFamily: string;
    policyVersion: string;
    noticeHash: string;
    effectiveAt: Date;
    legalPublicationId: string;
    processingApprovalId: string;
  }> | null;
  requiredPolicyVersion: string;
  now: Date;
  legalGateAllowed: boolean;
  currentPublicationId: string | null;
  currentPublicationHash: string | null;
}>): LiveAnalyticsPolicyDecision {
  const family = optionalAnalyticsFamilyForEventV1(input.event.kind);
  if (family === null) return denied("ESSENTIAL_EVENT");
  if (!input.familyEnabled) return denied("FEATURE_DISABLED");
  if (input.provenance !== "LIVE") return denied("PROVENANCE_BLOCKED");
  if (containsPiiProperty(input.event.properties)) {
    return denied("PII_PROPERTY_BLOCKED");
  }
  if (
    input.searchLearningCollection ||
    hasSearchLearningPayload(input.event.properties)
  ) {
    return denied("SEARCH_LEARNING_BLOCKED");
  }
  if (input.consent === null || input.consent.eventFamily !== family) {
    return denied("CONSENT_MISSING");
  }
  if (!input.consent.granted) return denied("CONSENT_REVOKED");
  if (
    input.consent.policyVersion !== input.requiredPolicyVersion ||
    input.consent.legalPublicationId !== input.currentPublicationId ||
    input.consent.noticeHash !== input.currentPublicationHash ||
    input.consent.effectiveAt > input.now
  ) {
    return denied("CONSENT_STALE");
  }
  if (!input.legalGateAllowed) return denied("LEGAL_GATE_BLOCKED");
  return Object.freeze({ allowed: true, family });
}

export async function trackAnalyticsEventWithLiveConsentV1(
  rawEvent: unknown,
  context: Readonly<{
    database: DatabaseClient;
    producer: string;
    userId?: string;
    pseudonymousSubjectId?: string;
    requiredPolicyVersion: string;
    region: string;
    familyFlags: Readonly<Record<OptionalAnalyticsFamilyV1, boolean>>;
    searchLearningCollection: boolean;
    provenance: AnalyticsProvenanceSnapshots;
    now?: Date;
  }>,
): Promise<TrackAnalyticsResult> {
  const event = analyticsEventV1Schema.parse(rawEvent);
  const contract = ANALYTICS_EVENT_CONTRACTS_V1[event.kind];
  if (contract.purpose === "ESSENTIAL_OPERATIONAL") {
    return trackAnalyticsEventV1(
      event,
      {
        producer: context.producer,
        productAnalyticsEnabled: false,
        provenance: context.provenance,
      },
      createPrismaAnalyticsWriter(context.database),
    );
  }
  const family = optionalAnalyticsFamilyForEventV1(event.kind);
  if (family === null) return skipped();
  const now = context.now ?? new Date();
  const consent = await context.database.analyticsConsentEvent.findFirst({
    where:
      context.userId !== undefined
        ? { userId: context.userId, eventFamily: family }
        : {
            pseudonymousSubjectId: context.pseudonymousSubjectId,
            eventFamily: family,
          },
    orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
    include: {
      legalPublication: true,
      processingApproval: {
        include: { legalPublication: true },
      },
    },
  });
  const approval = consent?.processingApproval ?? null;
  const gateDecision = decideLegalGateV1({
    expectedScope: `OPTIONAL_ANALYTICS_${family}`,
    expectedRegion: context.region,
    expectedProcessorKey: "analytics-store",
    featureEnabled: context.familyFlags[family],
    cohortAllowed: true,
    now,
    gate: projectPersistedLegalGateV1(approval),
  });
  const provenance =
    context.provenance.actor ??
    context.provenance.company ??
    context.provenance.job ??
    null;
  const decision = decideLiveAnalyticsWriteV1({
    event,
    familyEnabled: context.familyFlags[family],
    searchLearningCollection: context.searchLearningCollection,
    provenance,
    consent,
    requiredPolicyVersion: context.requiredPolicyVersion,
    now,
    legalGateAllowed: gateDecision.allowed,
    currentPublicationId: approval?.legalPublication?.id ?? null,
    currentPublicationHash:
      approval?.legalPublication?.publicationHash ?? null,
  });
  if (!decision.allowed) return skipped();
  return trackAnalyticsEventV1(
    event,
    {
      producer: context.producer,
      productAnalyticsEnabled: true,
      provenance: context.provenance,
    },
    createPrismaAnalyticsWriter(context.database),
  );
}

export async function recordAnalyticsConsentV1(
  rawInput: unknown,
  context: Readonly<{
    database: DatabaseClient;
    region: string;
    familyEnabled: boolean;
    now?: Date;
  }>,
) {
  const input = consentInputSchema.safeParse(rawInput);
  const now = context.now ?? new Date();
  if (!input.success || !Number.isFinite(now.getTime())) {
    return Object.freeze({ ok: false as const, code: "INVALID_INPUT" as const });
  }
  const approval = await context.database.processingApproval.findUnique({
    where: { id: input.data.processingApprovalId },
    include: { legalPublication: true },
  });
  const gate = decideLegalGateV1({
    expectedScope: `OPTIONAL_ANALYTICS_${input.data.eventFamily}`,
    expectedRegion: context.region,
    expectedProcessorKey: "analytics-store",
    featureEnabled: context.familyEnabled,
    cohortAllowed: true,
    now,
    gate: projectPersistedLegalGateV1(approval),
  });
  const publication = await context.database.legalPublication.findUnique({
    where: { id: input.data.legalPublicationId },
    select: { publicationHash: true, status: true },
  });
  if (
    input.data.granted &&
    (!gate.allowed ||
      gate.publicationId !== input.data.legalPublicationId ||
      gate.publicationHash !== input.data.noticeHash ||
      publication?.status !== "CURRENT" ||
      publication.publicationHash !== input.data.noticeHash)
  ) {
    return Object.freeze({
      ok: false as const,
      code: "LEGAL_GATE_BLOCKED" as const,
    });
  }

  const stored = await context.database.$transaction(async (transaction) => {
    const event = await transaction.analyticsConsentEvent.create({
      data: {
        ...input.data,
        effectiveAt: now,
        createdAt: now,
      },
      select: { id: true },
    });
    await writeRequiredAudit(prismaAuditPort(transaction), {
      action: "ANALYTICS_CONSENT_CHANGED",
      actorKind: input.data.actorUserId === undefined ? "ANONYMOUS" : "USER",
      actorUserId: input.data.actorUserId ?? null,
      capability: "ANALYTICS_CONSENT_WRITE",
      correlationId: randomUUID(),
      metadata: {},
      reasonCode: input.data.reasonCode,
      result: "SUCCEEDED",
      retainUntil: new Date(now.getTime() + 400 * 86_400_000),
      targetId: event.id,
      targetType: "ANALYTICS_CONSENT",
    });
    return event;
  });
  return Object.freeze({ ok: true as const, consentEventId: stored.id });
}

function containsPiiProperty(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return /(?:email|e-mail|phone|telephone|first.?name|last.?name|address|postal|session.?replay)/iu.test(
    serialized,
  );
}

function hasSearchLearningPayload(value: unknown): boolean {
  return /(?:queryText|rawQuery|rareQuery|searchTerms|keyword)/u.test(
    JSON.stringify(value),
  );
}

function skipped(): TrackAnalyticsResult {
  return Object.freeze({
    recorded: false,
    duplicate: false,
    skippedForPrivacy: true,
  });
}

function denied(
  code: Extract<LiveAnalyticsPolicyDecision, { allowed: false }>["code"],
): LiveAnalyticsPolicyDecision {
  return Object.freeze({ allowed: false, code });
}

function prismaAuditPort(transaction: Prisma.TransactionClient) {
  return {
    auditLog: {
      create: ({ data }: Readonly<{ data: AuditPersistenceRecord }>) =>
        transaction.auditLog.create({
          data: {
            ...data,
            metadata:
              data.metadata === null
                ? Prisma.JsonNull
                : (data.metadata as Prisma.InputJsonValue),
          },
        }),
    },
  };
}

export function hashAnalyticsNoticeV1(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
