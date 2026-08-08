import "server-only";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { RateLimitDecision } from "@/lib/auth/rate-limit";
import { consumeRequestRateLimitInTransaction } from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { enqueueNotification } from "@/lib/notifications/outbox";
import { notificationRecipientMaterialExpiresAt } from "@/lib/notifications/retention";
import type { PublicIntakePrivacyExpectedBinding } from "@/lib/privacy/public-intake-privacy-contract";
import {
  lockPublicIntakePrivacyGate,
  preflightPublicIntakePrivacyGate,
} from "@/lib/privacy/public-intake-privacy-gate";
import type { EmailProvider } from "@/lib/providers/email";
import { recordCandidateFreshnessReport } from "@/lib/jobs/freshness";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";
import { recordAndDecideRiskSignal } from "@/lib/security/risk/risk-service";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { createLogger } from "@/lib/utils/logger";
import { trimmedString } from "@/lib/validation/common";

const logger = createLogger();

export const PUBLIC_REPORT_REASONS = [
  "MISLEADING",
  "SCAM_OR_FRAUD",
  "DISCRIMINATION",
  "OUTDATED",
  "OTHER",
] as const;

export const abuseReportContentSchema = z.strictObject({
  reasonCode: z.enum(PUBLIC_REPORT_REASONS),
  description: trimmedString(20, 1_500),
});

export const publicReportInputSchema = z.strictObject({
  targetType: z.enum(["JOB", "COMPANY"]),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(220)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  ...abuseReportContentSchema.shape,
});

export type PublicReportInput = z.output<typeof publicReportInputSchema>;
export type AbuseReportContentInput = z.output<typeof abuseReportContentSchema>;
export type ResolvedAbuseReportTarget = Readonly<{
  id: string;
  targetType: "JOB" | "COMPANY" | "USER" | "MESSAGE";
  companyId: string | null;
}>;
export type ResolvedPublicReportTarget = Readonly<{
  id: string;
  targetType: "JOB" | "COMPANY";
  companyId: string | null;
}>;

export type PublicReportResult =
  | Readonly<{ ok: true; reportId: string }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_INPUT"
        | "TARGET_NOT_FOUND"
        | "RATE_LIMITED"
        | "PRIVACY_UNAVAILABLE"
        | "WRITE_FAILED";
    }>;

export type AbuseReportDependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: AuthRequestContext;
  currentUser: CurrentUser | null;
  emailProvider?: EmailProvider;
  now?: Date;
  privacyBinding: PublicIntakePrivacyExpectedBinding;
}>;

type AbuseReportTransactionOutcome =
  | Readonly<{ kind: "SUCCESS"; reportId: string }>
  | Readonly<{ kind: "PRIVACY_UNAVAILABLE" }>
  | Readonly<{
      kind: "RATE_LIMITED";
      stage: "PRECHECK" | "TARGET";
      audit: Extract<RateLimitDecision, { allowed: false }>["audit"];
    }>;

export async function createPublicReport(
  rawInput: unknown,
  target: ResolvedPublicReportTarget | null,
  dependencies: AbuseReportDependencies,
): Promise<PublicReportResult> {
  const parsed = publicReportInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  if (
    target === null ||
    target.targetType !== parsed.data.targetType ||
    (target.targetType !== "JOB" && target.targetType !== "COMPANY")
  ) {
    return Object.freeze({ ok: false, code: "TARGET_NOT_FOUND" });
  }
  return createResolvedAbuseReport(
    {
      reasonCode: parsed.data.reasonCode,
      description: parsed.data.description,
    },
    target,
    dependencies,
  );
}

export async function createResolvedAbuseReport(
  rawInput: unknown,
  target: ResolvedAbuseReportTarget | null,
  dependencies: AbuseReportDependencies,
): Promise<PublicReportResult> {
  if (dependencies.privacyBinding.purpose !== "ABUSE_REPORT") {
    return Object.freeze({ ok: false, code: "PRIVACY_UNAVAILABLE" });
  }
  const parsed = abuseReportContentSchema.safeParse(rawInput);
  const parsedTarget = z
    .strictObject({
      id: z.uuid(),
      targetType: z.enum(["JOB", "COMPANY", "USER", "MESSAGE"]),
      companyId: z.uuid().nullable(),
    })
    .safeParse(target);
  if (!parsed.success)
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  if (!parsedTarget.success) {
    return Object.freeze({ ok: false, code: "TARGET_NOT_FOUND" });
  }
  const resolvedTarget = parsedTarget.data;
  const now = dependencies.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  }
  const description = stripUnsafeHtml(parsed.data.description);
  if (
    Array.from(description).length < 20 ||
    Array.from(description).length > 1_500
  ) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  }

  const privacyPreflight = await preflightPublicIntakePrivacyGate(
    dependencies.privacyBinding,
    {
      database: dependencies.database,
      environment: dependencies.environment,
      now,
    },
  );
  if (!privacyPreflight.allowed) {
    return Object.freeze({ ok: false, code: "PRIVACY_UNAVAILABLE" });
  }

  let outcome: AbuseReportTransactionOutcome;
  try {
    outcome = await dependencies.database.$transaction(
      async (transaction) => {
        const privacy = await lockPublicIntakePrivacyGate(
          transaction,
          dependencies.privacyBinding,
          { environment: dependencies.environment, now },
        );
        if (!privacy.allowed) {
          return Object.freeze({
            kind: "PRIVACY_UNAVAILABLE",
          } satisfies AbuseReportTransactionOutcome);
        }

        const rateIdentity =
          dependencies.currentUser === null
            ? {}
            : { actorId: dependencies.currentUser.id };
        const precheck = await consumeRequestRateLimitInTransaction(
          "ABUSE_INTAKE_PRECHECK",
          rateIdentity,
          dependencies.request,
          transaction,
          now,
          dependencies.environment,
        );
        if (!precheck.allowed) {
          return Object.freeze({
            kind: "RATE_LIMITED",
            stage: "PRECHECK",
            audit: precheck.audit,
          } satisfies AbuseReportTransactionOutcome);
        }

        const targetRate = await consumeRequestRateLimitInTransaction(
          "ABUSE_INTAKE",
          { ...rateIdentity, targetId: resolvedTarget.id },
          dependencies.request,
          transaction,
          now,
          dependencies.environment,
        );
        if (!targetRate.allowed) {
          return Object.freeze({
            kind: "RATE_LIMITED",
            stage: "TARGET",
            audit: targetRate.audit,
          } satisfies AbuseReportTransactionOutcome);
        }

        const priorityFreshness =
          parsed.data.reasonCode === "OUTDATED" &&
          resolvedTarget.targetType === "JOB" &&
          dependencies.currentUser?.role === "CANDIDATE";
        const created = await transaction.abuseReport.create({
          data: {
            targetType: resolvedTarget.targetType,
            targetId: resolvedTarget.id,
            reporterUserId: dependencies.currentUser?.id ?? null,
            reasonCode: parsed.data.reasonCode,
            description,
            severity: severityFor(parsed.data.reasonCode, priorityFreshness),
            status: "OPEN",
            privacyEvidenceMode: privacy.binding.evidenceMode,
            privacyLegalPublicationId: privacy.binding.legalPublicationId,
            privacyPublicationHash: privacy.binding.publicationHash,
            privacyPublicationVersion: privacy.binding.publicationVersion,
            privacyNoticeVersion: privacy.binding.noticeVersion,
            privacyNoticeHash: privacy.binding.noticeHash,
            dueAt: new Date(
              now.getTime() +
                dueMilliseconds(parsed.data.reasonCode, priorityFreshness),
            ),
            events: {
              create: {
                kind: "CREATED",
                actorUserId: dependencies.currentUser?.id ?? null,
                reasonCode: "PUBLIC_INTAKE",
                safeNote: "Öffentliche Meldung sicher entgegengenommen.",
                correlationId: dependencies.request.correlationId,
                createdAt: now,
              },
            },
          },
          select: { id: true },
        });
        if (priorityFreshness && dependencies.currentUser !== null) {
          await recordCandidateFreshnessReport(transaction, {
            jobId: resolvedTarget.id,
            abuseReportId: created.id,
            reporterUserId: dependencies.currentUser.id,
            correlationId: dependencies.request.correlationId,
            now,
          });
        }
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "ABUSE_REPORT_SUBMITTED",
            actorKind: dependencies.currentUser === null ? "ANONYMOUS" : "USER",
            actorUserId: dependencies.currentUser?.id ?? null,
            capability: "PUBLIC_ABUSE_REPORT_SUBMIT",
            companyId: resolvedTarget.companyId,
            correlationId: dependencies.request.correlationId,
            reasonCode: "PUBLIC_INTAKE",
            result: "SUCCEEDED",
            retainUntil: new Date(now.getTime() + 365 * 86_400_000),
            targetId: created.id,
            targetType: "ABUSE_REPORT",
          },
          {
            sourceIp: dependencies.request.sourceIp,
            keyring:
              dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
          },
        );
        await enqueueAbuseReportAdminNotifications(transaction, {
          reportId: created.id,
          reasonCode: parsed.data.reasonCode,
          availableAt: now,
          environment: dependencies.environment,
        });
        return Object.freeze({
          kind: "SUCCESS",
          reportId: created.id,
        } satisfies AbuseReportTransactionOutcome);
      },
      { isolationLevel: "ReadCommitted" },
    );
  } catch (error) {
    logger.error(
      "public_abuse_report.write_failed",
      {
        error,
        errorCode: safeDatabaseErrorReference(error),
      },
      dependencies.request.correlationId,
    );
    return Object.freeze({ ok: false, code: "WRITE_FAILED" });
  }

  if (outcome.kind === "PRIVACY_UNAVAILABLE") {
    return Object.freeze({ ok: false, code: "PRIVACY_UNAVAILABLE" });
  }
  if (outcome.kind === "RATE_LIMITED") {
    const precheck = outcome.stage === "PRECHECK";
    await recordRateLimitDenial(
      outcome.audit,
      {
        actorKind: dependencies.currentUser === null ? "ANONYMOUS" : "USER",
        actorUserId: dependencies.currentUser?.id,
        capability: precheck
          ? "PUBLIC_ABUSE_REPORT_PRECHECK"
          : "PUBLIC_ABUSE_REPORT",
        companyId: resolvedTarget.companyId,
        targetId: precheck
          ? (dependencies.currentUser?.id ?? dependencies.request.correlationId)
          : resolvedTarget.id,
        targetType: precheck
          ? dependencies.currentUser === null
            ? "SYSTEM_TASK"
            : "USER"
          : resolvedTarget.targetType,
      },
      {
        database: dependencies.database,
        environment: dependencies.environment,
        request: dependencies.request,
        now,
      },
    );
    return Object.freeze({ ok: false, code: "RATE_LIMITED" });
  }

  await recordTrustSignalForReport(
    outcome.reportId,
    resolvedTarget,
    parsed.data.reasonCode,
    now,
    dependencies,
  ).catch(() => undefined);
  return Object.freeze({ ok: true, reportId: outcome.reportId });
}

function safeDatabaseErrorReference(error: unknown): string | undefined {
  const references: string[] = [];
  const seen = new Set<unknown>();
  const visit = (current: unknown, depth: number) => {
    if (
      depth > 5 ||
      !current ||
      typeof current !== "object" ||
      seen.has(current)
    ) {
      return;
    }
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (
        /(?:code|state|constraint)$/iu.test(key) &&
        typeof value === "string" &&
        /^[A-Z0-9_]{2,32}$/iu.test(value) &&
        !references.includes(value)
      ) {
        references.push(value);
      } else if (
        key === "cause" ||
        key === "meta" ||
        key === "driverAdapterError"
      ) {
        visit(value, depth + 1);
      }
    }
  };
  visit(error, 0);
  return references.length > 0 ? references.slice(0, 4).join(":") : undefined;
}

async function recordTrustSignalForReport(
  reportId: string,
  target: ResolvedAbuseReportTarget,
  reasonCode: AbuseReportContentInput["reasonCode"],
  now: Date,
  dependencies: AbuseReportDependencies,
): Promise<void> {
  if (
    target.targetType !== "JOB" &&
    target.targetType !== "COMPANY" &&
    target.targetType !== "MESSAGE"
  ) {
    return;
  }
  const windowStartedAt = new Date(now.getTime() - 30 * 86_400_000);
  const observedCount = await dependencies.database.abuseReport.count({
    where: {
      targetType: target.targetType,
      targetId: target.id,
      createdAt: { gte: windowStartedAt, lte: now },
    },
  });
  await recordAndDecideRiskSignal(
    {
      kind:
        reasonCode === "SCAM_OR_FRAUD" && target.targetType === "JOB"
          ? "JOB_SCAM"
          : "REPEATED_COMPLAINT",
      subjectType: target.targetType,
      subjectId: target.id,
      companyId: target.companyId,
      source: "ABUSE_REPORT",
      observedCount,
      windowStartedAt,
      windowEndedAt: now,
      evidenceReference: `abuse-report:${reportId}`,
      idempotencyKey: `abuse-report:${reportId}`,
    },
    {
      database: dependencies.database,
      correlationId: dependencies.request.correlationId,
      mode: dependencies.environment.TRUST_RISK_MODE,
      recordedByUserId: dependencies.currentUser?.id ?? null,
      now,
    },
  );
}

async function enqueueAbuseReportAdminNotifications(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    reportId: string;
    reasonCode: AbuseReportContentInput["reasonCode"];
    availableAt: Date;
    environment: ServerEnvironment;
  }>,
): Promise<void> {
  const configured = input.environment.ABUSE_REPORT_ADMIN_EMAILS ?? [];
  if (configured.length > 0) {
    for (const [index, address] of configured.entries()) {
      await enqueueNotification(transaction, {
        recipient: {
          address,
          keyring:
            input.environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
          hashKeyring:
            input.environment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
          retentionUntil: notificationRecipientMaterialExpiresAt(
            input.availableAt,
          ),
        },
        templateKey: "abuse_report_received",
        payloadSchemaVersion: "abuse-report-v1",
        payload: {
          reportId: input.reportId,
          categoryLabel: reasonLabel(input.reasonCode),
        },
        dedupeKey: `abuse-report:${input.reportId}:configured:${index}`,
        createdAt: input.availableAt,
        availableAt: input.availableAt,
      });
    }
    return;
  }

  const fallback = await transaction.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    orderBy: [{ emailNormalized: "asc" }, { id: "asc" }],
    select: { id: true },
    take: 20,
  });
  for (const admin of fallback) {
    await enqueueNotification(transaction, {
      recipient: { userId: admin.id },
      templateKey: "abuse_report_received",
      payloadSchemaVersion: "abuse-report-v1",
      payload: {
        reportId: input.reportId,
        categoryLabel: reasonLabel(input.reasonCode),
      },
      dedupeKey: `abuse-report:${input.reportId}:admin:${admin.id}`,
      createdAt: input.availableAt,
      availableAt: input.availableAt,
    });
  }
}

function reasonLabel(reason: AbuseReportContentInput["reasonCode"]): string {
  const labels: Readonly<
    Record<AbuseReportContentInput["reasonCode"], string>
  > = Object.freeze({
    MISLEADING: "Irreführende Angaben",
    SCAM_OR_FRAUD: "Betrug oder Täuschung",
    DISCRIMINATION: "Diskriminierung",
    OUTDATED: "Nicht mehr aktuell",
    OTHER: "Andere Meldung",
  });
  return labels[reason];
}

function severityFor(
  reason: AbuseReportContentInput["reasonCode"],
  priorityFreshness: boolean,
) {
  if (priorityFreshness) return "HIGH" as const;
  if (reason === "SCAM_OR_FRAUD" || reason === "DISCRIMINATION")
    return "HIGH" as const;
  if (reason === "OUTDATED") return "LOW" as const;
  return "MEDIUM" as const;
}

function dueMilliseconds(
  reason: AbuseReportContentInput["reasonCode"],
  priorityFreshness: boolean,
) {
  if (priorityFreshness) return 4 * 60 * 60_000;
  return (
    (reason === "SCAM_OR_FRAUD" || reason === "DISCRIMINATION" ? 1 : 3) *
    86_400_000
  );
}
