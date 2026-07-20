import "server-only";

import { createHash } from "node:crypto";

import {
  trackAnalyticsEventV1,
  type AnalyticsWriter,
} from "@/lib/analytics/track";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { emailProvider } from "@/lib/providers/email";
import {
  SALES_LEAD_INTAKE_POLICY_V1,
  SALES_LEAD_NOTICE_HASH_V1,
  leadPurposeForInterest,
  planCodeForLeadInterest,
  salesLeadAnalyticsKeyV1,
  salesLeadDueAtV1,
  salesLeadRetainUntilV1,
} from "@/lib/sales/lead-policy";
import type { LeadFormInput } from "@/lib/validation/billing";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger();

export type PublicLeadSubmissionResult = Readonly<
  | { ok: true; leadId: string; activityId: string; duplicate: boolean }
  | {
      ok: false;
      code: "IDEMPOTENCY_CONFLICT" | "WRITE_FAILED" | "NOTIFICATION_FAILED";
    }
>;

type LeadTransactionResult = Readonly<{
  leadId: string;
  activityId: string;
  purpose: "EMPLOYER_DEMO" | "SALES_CONTACT" | "ENTERPRISE" | "IMPORT";
  occurredAt: Date;
  duplicate: boolean;
}>;

class LeadIdempotencyConflict extends Error {}

export async function submitPublicEmployerLead(
  input: LeadFormInput,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    request: AuthRequestContext;
    now: Date;
  }>,
): Promise<PublicLeadSubmissionResult> {
  const payloadHash = hashLeadIntakePayloadV1(input);
  const purpose = leadPurposeForInterest(input.interestCode);
  const dueAt = salesLeadDueAtV1(dependencies.now);
  const retainUntil = salesLeadRetainUntilV1(dependencies.now);

  let result: LeadTransactionResult;
  try {
    result = await dependencies.database.$transaction(async (transaction) => {
      await acquireLeadLocks(transaction, input.idempotencyKey, input.email, purpose);

      const priorActivity = await transaction.salesActivity.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: {
          id: true,
          payloadHash: true,
          createdAt: true,
          salesLead: {
            select: {
              id: true,
              purpose: true,
            },
          },
        },
      });
      if (priorActivity !== null) {
        if (priorActivity.payloadHash !== payloadHash) {
          throw new LeadIdempotencyConflict();
        }
        return Object.freeze({
          leadId: priorActivity.salesLead.id,
          activityId: priorActivity.id,
          purpose: asLeadPurpose(priorActivity.salesLead.purpose),
          occurredAt: priorActivity.createdAt,
          duplicate: true,
        });
      }

      const planVersionId = await resolveInterestedPlanVersionId(
        transaction,
        input.interestCode,
        dependencies.now,
      );
      const existing = await transaction.salesLead.findUnique({
        where: {
          emailNormalized_purpose: {
            emailNormalized: input.email,
            purpose,
          },
        },
        select: {
          id: true,
        },
      });
      const organizationNormalized = normalizeOrganizationName(input.companyName);
      const commonData = {
        organizationNormalized,
        organizationName: input.companyName,
        contactName: input.contactName,
        phoneNormalized: input.phone ?? null,
        companySizeCode: input.companySizeCode,
        hiringNeedCode: input.hiringNeedCode,
        interestCode: input.interestCode,
        callbackWindowCode: input.callbackWindowCode ?? null,
        consentSource: SALES_LEAD_INTAKE_POLICY_V1.consentSource,
        message: input.message,
        noticeVersion: SALES_LEAD_INTAKE_POLICY_V1.notice.version,
        noticeHash: SALES_LEAD_NOTICE_HASH_V1,
        slaPolicyVersion: SALES_LEAD_INTAKE_POLICY_V1.sla.version,
        interestedPlanVersionId: planVersionId,
      } as const;

      const lead = existing === null
        ? await transaction.salesLead.create({
            data: {
              emailNormalized: input.email,
              purpose,
              ...commonData,
              dueAt,
              nextAt: dueAt,
              retainUntil,
              status: "NEW",
            },
            select: { id: true },
          })
        : existing;

      const activity = await transaction.salesActivity.create({
        data: {
          salesLeadId: lead.id,
          kind: "INTAKE_RECEIVED",
          outcomeCode: "PUBLIC_INTAKE",
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          correlationId: dependencies.request.correlationId,
          createdAt: dependencies.now,
        },
        select: { id: true, createdAt: true },
      });

      const intake = await transaction.salesLeadIntake.create({
        data: {
          salesLeadId: lead.id,
          salesActivityId: activity.id,
          organizationName: input.companyName,
          contactName: input.contactName,
          phoneNormalized: input.phone ?? null,
          companySizeCode: input.companySizeCode,
          hiringNeedCode: input.hiringNeedCode,
          interestCode: input.interestCode,
          callbackWindowCode: input.callbackWindowCode ?? null,
          message: input.message,
          noticeVersion: SALES_LEAD_INTAKE_POLICY_V1.notice.version,
          noticeHash: SALES_LEAD_NOTICE_HASH_V1,
          slaPolicyVersion: SALES_LEAD_INTAKE_POLICY_V1.sla.version,
          dueAt,
          retainUntil,
          interestedPlanVersionId: planVersionId,
          createdAt: dependencies.now,
        },
        select: { id: true },
      });

      await transaction.systemTask.create({
        data: {
          kind: "SALES_FOLLOW_UP",
          reasonCode: "PUBLIC_EMPLOYER_LEAD_INTAKE",
          evidenceReference: `sales-lead-intake:${intake.id}`,
          dueAt,
          status: "OPEN",
          idempotencyKey:
            `SALES_FOLLOW_UP:${intake.id}:${SALES_LEAD_INTAKE_POLICY_V1.sla.version}`,
        },
      });

      await writeRequiredAudit(
        createPrismaTransactionAuditPort(transaction),
        {
          action: "LEAD_SUBMITTED",
          actorKind: "ANONYMOUS",
          capability: "PUBLIC_EMPLOYER_DEMO_SUBMIT",
          correlationId: dependencies.request.correlationId,
          reasonCode: "PUBLIC_INTAKE",
          result: "SUCCEEDED",
          retainUntil,
          targetId: lead.id,
          targetType: "SALES_LEAD",
        },
        {
          sourceIp: dependencies.request.sourceIp,
          keyring: dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
        },
      );

      await trackAnalyticsEventV1(
        {
          schemaVersion: "1",
          producerEventId: `LEAD_SUBMITTED:${activity.id}`,
          occurredAt: activity.createdAt,
          kind: "LEAD_SUBMITTED",
          pseudonymousSessionId: salesLeadAnalyticsKeyV1(lead.id),
          properties: { leadPurpose: purpose },
        },
        { producer: "employer-demo", productAnalyticsEnabled: false },
        createTransactionAnalyticsWriter(transaction),
      );

      return Object.freeze({
        leadId: lead.id,
        activityId: activity.id,
        purpose,
        occurredAt: activity.createdAt,
        duplicate: false,
      });
    }, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (error instanceof LeadIdempotencyConflict) {
      return Object.freeze({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    }
    logger.error(
      "public_lead.write_failed",
      {
        error,
        errorCode: databaseErrorCode(error),
      },
      dependencies.request.correlationId,
    );
    return Object.freeze({
      ok: false,
      code: "WRITE_FAILED",
    });
  }

  try {
    await emailProvider.send({
      to: SALES_LEAD_INTAKE_POLICY_V1.notificationRecipient,
      templateKey: "demo_request_received",
      subject: "Neue Demo-Anfrage eingegangen",
      data: {
        idempotencyKey: result.activityId,
      },
    });
  } catch (error) {
    logger.error(
      "public_lead.notification_failed",
      {
        error,
        errorCode: databaseErrorCode(error),
      },
      dependencies.request.correlationId,
    );
    return Object.freeze({ ok: false, code: "NOTIFICATION_FAILED" });
  }

  return Object.freeze({
    ok: true,
    leadId: result.leadId,
    activityId: result.activityId,
    duplicate: result.duplicate,
  });
}

export function hashLeadIntakePayloadV1(input: LeadFormInput) {
  const hash = createHash("sha256");
  updateLengthPrefixed(hash, "public-employer-lead-v1");
  for (const value of [
    input.email,
    input.companyName,
    input.contactName,
    input.phone ?? "",
    input.companySizeCode,
    input.hiringNeedCode,
    input.interestCode,
    input.message,
    input.callbackWindowCode ?? "",
    input.acceptedContactPurpose,
  ]) {
    updateLengthPrefixed(hash, value);
  }
  return hash.digest("hex");
}

async function resolveInterestedPlanVersionId(
  transaction: Prisma.TransactionClient,
  interest: LeadFormInput["interestCode"],
  at: Date,
) {
  const code = planCodeForLeadInterest(interest);
  if (code === null) return null;
  const rows = await transaction.planVersion.findMany({
    where: {
      plan: { code },
      status: "ACTIVE",
      validFrom: { lte: at },
      AND: [{ OR: [{ validTo: null }, { validTo: { gt: at } }] }],
    },
    select: { id: true },
    take: 2,
  });
  return rows.length === 1 ? rows[0]?.id ?? null : null;
}

async function acquireLeadLocks(
  transaction: Prisma.TransactionClient,
  idempotencyKey: string,
  email: string,
  purpose: string,
) {
  const keys = [
    `lead-intake:${idempotencyKey}`,
    `lead-identity:${email}\0${purpose}`,
  ].map((value) => createHash("sha256").update(value, "utf8").digest("hex")).sort();
  for (const key of keys) {
    await transaction.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS "locked"',
      key,
    );
  }
}

function updateLengthPrefixed(hash: ReturnType<typeof createHash>, value: string) {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function normalizeOrganizationName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("de-CH");
}

function asLeadPurpose(value: string): LeadTransactionResult["purpose"] {
  if (
    value === "EMPLOYER_DEMO" ||
    value === "SALES_CONTACT" ||
    value === "ENTERPRISE" ||
    value === "IMPORT"
  ) return value;
  return "EMPLOYER_DEMO";
}

function databaseErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 32);
  }
  return undefined;
}

function createTransactionAnalyticsWriter(
  transaction: Prisma.TransactionClient,
): AnalyticsWriter {
  return Object.freeze({
    async create(record: Parameters<AnalyticsWriter["create"]>[0]) {
      try {
        await transaction.analyticsEvent.create({ data: record });
        return "CREATED";
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ) {
          return "DUPLICATE";
        }
        throw error;
      }
    },
    async expire(retainUntilInclusive: Date) {
      const result = await transaction.analyticsEvent.deleteMany({
        where: { retainUntil: { lte: retainUntilInclusive } },
      });
      return result.count;
    },
  });
}
