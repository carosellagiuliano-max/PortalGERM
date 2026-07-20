import { z } from "zod";

import {
  COMPANY_CLAIM_SIGNAL_CODES_V1,
} from "@/lib/auth/employer-registration-signals";
import { RATE_LIMIT_PRESET_NAMES_V1 } from "@/lib/auth/rate-limit";
import type { KeyringEntry } from "@/lib/config/env-schema";
import {
  AUDIT_ACTIONS_V1,
  type AuditActionV1,
} from "@/lib/domains/audit/audit-actions";
import { hashIpWithFirstKey } from "@/lib/utils/hash";

export const AUDIT_ACTOR_KINDS_V1 = ["USER", "SYSTEM", "ANONYMOUS"] as const;
export type AuditActorKindV1 = (typeof AUDIT_ACTOR_KINDS_V1)[number];

export const AUDIT_RESULTS_V1 = ["SUCCEEDED", "DENIED", "FAILED"] as const;
export type AuditResultV1 = (typeof AUDIT_RESULTS_V1)[number];

export const AUDIT_TARGET_TYPES_V1 = [
  "USER",
  "SESSION",
  "COMPANY",
  "MEMBERSHIP",
  "INVITATION",
  "CLAIM_REQUEST",
  "VERIFICATION_REQUEST",
  "JOB",
  "JOB_REVISION",
  "JOB_ASSIGNMENT",
  "APPLICATION",
  "CONVERSATION",
  "MESSAGE",
  "RADAR_PROFILE",
  "CONTACT_REQUEST",
  "IDENTITY_REVEAL_GRANT",
  "PRIVACY_REQUEST",
  "ABUSE_REPORT",
  "MODERATION_RESTRICTION",
  "PLAN_VERSION",
  "PRODUCT_VERSION",
  "SUBSCRIPTION",
  "ORDER",
  "INVOICE",
  "CREDIT_LEDGER_ENTRY",
  "JOB_BOOST",
  "IMPORT_SOURCE",
  "IMPORT_RUN",
  "SUPPORT_CASE",
  "CONTENT_REVISION",
  "SALES_LEAD",
  "SYSTEM_TASK",
  "CLUSTER_LAUNCH_ASSESSMENT",
  "TAX_RATE_VERSION",
] as const;

export type AuditTargetTypeV1 = (typeof AUDIT_TARGET_TYPES_V1)[number];

const EMPTY_AUDIT_METADATA_SCHEMA = z.strictObject({});
const RATE_LIMITED_AUDIT_METADATA_SCHEMA = z.strictObject({
  preset: z.enum(RATE_LIMIT_PRESET_NAMES_V1),
  scope: z.enum([
    "IP_EMAIL",
    "IP",
    "USER",
    "ACTOR_OR_IP",
    "TARGET",
    "COMPANY",
    "CANDIDATE",
    "MEMBERSHIP",
    "OPEN_TYPE",
    "UNKNOWN",
  ]),
});
const VERSIONED_IDENTIFIER_HASH_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}:[a-f0-9]{64}$/u;
const USER_REGISTERED_AUDIT_METADATA_SCHEMA = z.strictObject({
  role: z.enum(["CANDIDATE", "EMPLOYER"]),
});
const USER_LOGIN_FAILED_AUDIT_METADATA_SCHEMA = z.strictObject({
  identifierHash: z.string().regex(VERSIONED_IDENTIFIER_HASH_PATTERN),
});
const COMPANY_REGISTRATION_AUDIT_METADATA_SCHEMA = z
  .strictObject({
    signalCodes: z
      .array(z.enum(COMPANY_CLAIM_SIGNAL_CODES_V1))
      .min(1)
      .max(COMPANY_CLAIM_SIGNAL_CODES_V1.length),
  })
  .superRefine((metadata, context) => {
    if (new Set(metadata.signalCodes).size !== metadata.signalCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["signalCodes"],
        message: "Company registration signal codes must be unique.",
      });
    }
  });

/**
 * Phase 03 starts with a deny-by-default metadata contract. A domain owner may
 * replace an action's empty strict schema only together with its owning tests.
 * Actor, target, result, reason and correlation already have dedicated columns.
 */
const auditMetadataSchemas = Object.fromEntries(
  AUDIT_ACTIONS_V1.map((action) => [action, EMPTY_AUDIT_METADATA_SCHEMA]),
) as unknown as Record<
  AuditActionV1,
  z.ZodType<Readonly<Record<string, unknown>>>
>;
auditMetadataSchemas.RATE_LIMITED = RATE_LIMITED_AUDIT_METADATA_SCHEMA;
auditMetadataSchemas.USER_REGISTERED = USER_REGISTERED_AUDIT_METADATA_SCHEMA;
auditMetadataSchemas.USER_LOGIN_FAILED = USER_LOGIN_FAILED_AUDIT_METADATA_SCHEMA;
auditMetadataSchemas.COMPANY_CREATED_WITH_OWNER =
  COMPANY_REGISTRATION_AUDIT_METADATA_SCHEMA;
auditMetadataSchemas.COMPANY_CLAIM_REQUESTED =
  COMPANY_REGISTRATION_AUDIT_METADATA_SCHEMA;

export const AUDIT_METADATA_SCHEMAS_V1 = Object.freeze(auditMetadataSchemas);

export const AUDIT_IP_HASH_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
export type AuditIpHashKeyring = readonly KeyringEntry<"AUDIT_IP_HASH_KEYS">[];
export type AuditIpContext = Readonly<{
  sourceIp: string;
  keyring: AuditIpHashKeyring;
}>;

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const CAPABILITY_PATTERN = /^[A-Z][A-Z0-9_:.-]{0,127}$/;
const auditInputSchema = z
  .strictObject({
    action: z.enum(AUDIT_ACTIONS_V1),
    actorKind: z.enum(AUDIT_ACTOR_KINDS_V1),
    actorUserId: z.uuid().nullish(),
    capability: z.string().regex(CAPABILITY_PATTERN),
    companyId: z.uuid().nullish(),
    correlationId: z.uuid(),
    metadata: z.unknown().optional(),
    reasonCode: z.string().regex(CODE_PATTERN).nullish(),
    result: z.enum(AUDIT_RESULTS_V1),
    retainUntil: z.date(),
    targetId: z.uuid(),
    targetType: z.enum(AUDIT_TARGET_TYPES_V1),
  })
  .superRefine((input, context) => {
    if (input.actorKind === "USER" && input.actorUserId == null) {
      context.addIssue({
        code: "custom",
        message: "USER actors require actorUserId",
        path: ["actorUserId"],
      });
    }
    if (input.actorKind !== "USER" && input.actorUserId != null) {
      context.addIssue({
        code: "custom",
        message: "Non-user actors cannot carry actorUserId",
        path: ["actorUserId"],
      });
    }
  });

export type RequiredAuditInput = Readonly<{
  action: AuditActionV1;
  actorKind: AuditActorKindV1;
  actorUserId?: string | null;
  capability: string;
  companyId?: string | null;
  correlationId: string;
  metadata?: unknown;
  reasonCode?: string | null;
  result: AuditResultV1;
  retainUntil: Date;
  targetId: string;
  targetType: AuditTargetTypeV1;
}>;

export type AuditPersistenceRecord = Readonly<{
  action: AuditActionV1;
  actorKind: AuditActorKindV1;
  actorUserId: string | null;
  capability: string;
  companyId: string | null;
  correlationId: string;
  ipHash: string | null;
  ipHashVersion: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  reasonCode: string | null;
  result: AuditResultV1;
  retainUntil: Date;
  targetId: string;
  targetType: AuditTargetTypeV1;
}>;

export type AuditWritePort<TRow = unknown> = Readonly<{
  auditLog: Readonly<{
    create(input: Readonly<{ data: AuditPersistenceRecord }>): Promise<TRow>;
  }>;
}>;

export type AuditIpRetentionPort = Readonly<{
  auditLog: Readonly<{
    updateMany(
      input: Readonly<{
        where: Readonly<{
          ipHash: Readonly<{ not: null }>;
          createdAt: Readonly<{ lte: Date }>;
        }>;
        data: Readonly<{ ipHash: null; ipHashVersion: null }>;
      }>,
    ): Promise<Readonly<{ count: number }>>;
  }>;
}>;

export type BestEffortAuditFailure = Readonly<{
  action: AuditActionV1 | "UNKNOWN";
  code: "AUDIT_VALIDATION_FAILED" | "AUDIT_WRITE_FAILED";
  correlationId?: string;
}>;

export type BestEffortAuditResult = Readonly<
  | { written: true }
  | {
      written: false;
      code: BestEffortAuditFailure["code"];
    }
>;

export class AuditInputValidationError extends Error {
  readonly issueCodes: readonly string[];

  constructor(error: z.ZodError) {
    const issueCodes = error.issues.map((issue) => {
      const path = issue.path.join(".") || "input";
      return `${path}:${issue.code}`;
    });
    super(`Audit input validation failed: ${issueCodes.join(",")}`);
    this.name = "AuditInputValidationError";
    this.issueCodes = Object.freeze(issueCodes);
  }
}

export class RequiredAuditWriteError extends Error {
  readonly action: AuditActionV1;

  constructor(action: AuditActionV1) {
    super(`Required audit write failed for ${action}`);
    this.name = "RequiredAuditWriteError";
    this.action = action;
  }
}

export async function writeRequiredAudit<TRow>(
  port: AuditWritePort<TRow>,
  input: RequiredAuditInput,
  ipContext?: AuditIpContext,
): Promise<TRow> {
  const data = buildAuditPersistenceRecord(input, ipContext);

  try {
    return await port.auditLog.create({ data });
  } catch {
    throw new RequiredAuditWriteError(data.action);
  }
}

export async function writeBestEffortAudit(
  port: AuditWritePort,
  input: RequiredAuditInput,
  onFailure?: (failure: BestEffortAuditFailure) => void,
  ipContext?: AuditIpContext,
): Promise<BestEffortAuditResult> {
  let data: AuditPersistenceRecord;
  try {
    data = buildAuditPersistenceRecord(input, ipContext);
  } catch {
    notifyFailure(onFailure, {
      action: getSafeAction(input.action),
      code: "AUDIT_VALIDATION_FAILED",
      ...getSafeCorrelation(input.correlationId),
    });
    return Object.freeze({
      written: false,
      code: "AUDIT_VALIDATION_FAILED",
    });
  }

  try {
    await port.auditLog.create({ data });
    return Object.freeze({ written: true });
  } catch {
    notifyFailure(onFailure, {
      action: data.action,
      code: "AUDIT_WRITE_FAILED",
      correlationId: data.correlationId,
    });
    return Object.freeze({ written: false, code: "AUDIT_WRITE_FAILED" });
  }
}

export function buildAuditPersistenceRecord(
  input: RequiredAuditInput,
  ipContext?: AuditIpContext,
): AuditPersistenceRecord {
  const result = auditInputSchema.safeParse(input);
  if (!result.success) {
    throw new AuditInputValidationError(result.error);
  }

  const writerIpHash =
    ipContext === undefined
      ? null
      : hashAuditSourceIp(ipContext.sourceIp, ipContext.keyring);

  const metadataResult = AUDIT_METADATA_SCHEMAS_V1[
    result.data.action
  ].safeParse(result.data.metadata ?? {});
  if (!metadataResult.success) {
    throw new AuditInputValidationError(metadataResult.error);
  }

  const ipHashVersion = writerIpHash?.split(":", 1)[0] ?? null;

  return Object.freeze({
    action: result.data.action,
    actorKind: result.data.actorKind,
    actorUserId: result.data.actorUserId ?? null,
    capability: result.data.capability,
    companyId: result.data.companyId ?? null,
    correlationId: result.data.correlationId,
    ipHash: writerIpHash,
    ipHashVersion,
    metadata: result.data.metadata === undefined ? null : metadataResult.data,
    reasonCode: result.data.reasonCode ?? null,
    result: result.data.result,
    retainUntil: result.data.retainUntil,
    targetId: result.data.targetId,
    targetType: result.data.targetType,
  });
}

export function hashAuditSourceIp(
  sourceIp: string,
  keyring: AuditIpHashKeyring,
): string {
  return hashIpWithFirstKey(sourceIp, keyring, "AUDIT_IP_HASH_KEYS");
}

export async function nullifyExpiredAuditIpHashes(
  port: AuditIpRetentionPort,
  clock: Readonly<{ now: Date }>,
): Promise<number> {
  if (!Number.isFinite(clock.now.getTime())) {
    throw new TypeError("Audit IP retention requires a valid clock.");
  }
  const cutoff = new Date(
    clock.now.getTime() - AUDIT_IP_HASH_RETENTION_MILLISECONDS,
  );
  const result = await port.auditLog.updateMany({
    where: { ipHash: { not: null }, createdAt: { lte: cutoff } },
    data: { ipHash: null, ipHashVersion: null },
  });
  return result.count;
}

function notifyFailure(
  onFailure: ((failure: BestEffortAuditFailure) => void) | undefined,
  failure: BestEffortAuditFailure,
) {
  try {
    onFailure?.(Object.freeze(failure));
  } catch {
    // Best-effort telemetry must never break its owning domain operation.
  }
}

function getSafeAction(value: unknown): AuditActionV1 | "UNKNOWN" {
  return typeof value === "string" &&
    AUDIT_ACTIONS_V1.some((action) => action === value)
    ? (value as AuditActionV1)
    : "UNKNOWN";
}

function getSafeCorrelation(value: unknown) {
  return typeof value === "string" && z.uuid().safeParse(value).success
    ? { correlationId: value }
    : {};
}
