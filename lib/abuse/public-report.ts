import "server-only";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { EmailProvider } from "@/lib/providers/email";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { trimmedString } from "@/lib/validation/common";

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
  slug: z.string().trim().min(1).max(220).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
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
      code: "INVALID_INPUT" | "TARGET_NOT_FOUND" | "RATE_LIMITED" | "WRITE_FAILED";
    }>;

export type AbuseReportDependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: AuthRequestContext;
  currentUser: CurrentUser | null;
  emailProvider?: EmailProvider;
  now?: Date;
}>;

export async function createPublicReport(
  rawInput: unknown,
  target: ResolvedPublicReportTarget | null,
  dependencies: AbuseReportDependencies,
): Promise<PublicReportResult> {
  const parsed = publicReportInputSchema.safeParse(rawInput);
  if (!parsed.success) return Object.freeze({ ok: false, code: "INVALID_INPUT" });
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
  const parsed = abuseReportContentSchema.safeParse(rawInput);
  const parsedTarget = z
    .strictObject({
      id: z.uuid(),
      targetType: z.enum(["JOB", "COMPANY", "USER", "MESSAGE"]),
      companyId: z.uuid().nullable(),
    })
    .safeParse(target);
  if (!parsed.success) return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  if (!parsedTarget.success) {
    return Object.freeze({ ok: false, code: "TARGET_NOT_FOUND" });
  }
  const resolvedTarget = parsedTarget.data;
  const now = dependencies.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  }
  const description = stripUnsafeHtml(parsed.data.description);
  if (Array.from(description).length < 20 || Array.from(description).length > 1_500) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  }

  const rate = await consumeRequestRateLimit(
    "ABUSE_INTAKE",
    {
      ...(dependencies.currentUser === null
        ? {}
        : { actorId: dependencies.currentUser.id }),
      targetId: resolvedTarget.id,
    },
    dependencies.request,
    now,
    { environment: dependencies.environment, database: dependencies.database },
  );
  if (!rate.allowed) {
    await recordRateLimitDenial(
      rate.audit,
      {
        actorKind: dependencies.currentUser === null ? "ANONYMOUS" : "USER",
        actorUserId: dependencies.currentUser?.id,
        capability: "PUBLIC_ABUSE_REPORT",
        companyId: resolvedTarget.companyId,
        targetId: resolvedTarget.id,
        targetType: resolvedTarget.targetType,
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

  try {
    const report = await dependencies.database.$transaction(async (transaction) => {
      const created = await transaction.abuseReport.create({
        data: {
          targetType: resolvedTarget.targetType,
          targetId: resolvedTarget.id,
          reporterUserId: dependencies.currentUser?.id ?? null,
          reasonCode: parsed.data.reasonCode,
          description,
          severity: severityFor(parsed.data.reasonCode),
          status: "OPEN",
          dueAt: new Date(now.getTime() + dueMilliseconds(parsed.data.reasonCode)),
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
          keyring: dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
        },
      );
      return created;
    });
    await notifyAbuseReportAdmins(
      report.id,
      parsed.data.reasonCode,
      dependencies,
    ).catch(() => undefined);
    return Object.freeze({ ok: true, reportId: report.id });
  } catch {
    return Object.freeze({ ok: false, code: "WRITE_FAILED" });
  }
}

async function notifyAbuseReportAdmins(
  reportId: string,
  reasonCode: AbuseReportContentInput["reasonCode"],
  dependencies: AbuseReportDependencies,
): Promise<void> {
  const provider = dependencies.emailProvider;
  if (provider === undefined) return;
  const configured = dependencies.environment.ABUSE_REPORT_ADMIN_EMAILS ?? [];
  const fallback =
    configured.length > 0
      ? []
      : await dependencies.database.user.findMany({
          where: { role: "ADMIN", status: "ACTIVE" },
          orderBy: [{ emailNormalized: "asc" }, { id: "asc" }],
          select: { emailNormalized: true },
          take: 20,
        });
  const recipients = [
    ...new Set([
      ...configured,
      ...fallback.map(({ emailNormalized }) => emailNormalized),
    ]),
  ];
  await Promise.allSettled(
    recipients.map((to) =>
      provider.send({
        to,
        templateKey: "abuse_report_received",
        subject: "Neue Missbrauchsmeldung eingegangen",
        data: {
          categoryLabel: reasonLabel(reasonCode),
          idempotencyKey: `abuse-report:${reportId}`,
        },
      }),
    ),
  );
}

function reasonLabel(reason: AbuseReportContentInput["reasonCode"]): string {
  const labels: Readonly<Record<AbuseReportContentInput["reasonCode"], string>> =
    Object.freeze({
      MISLEADING: "Irreführende Angaben",
      SCAM_OR_FRAUD: "Betrug oder Täuschung",
      DISCRIMINATION: "Diskriminierung",
      OUTDATED: "Nicht mehr aktuell",
      OTHER: "Andere Meldung",
    });
  return labels[reason];
}

function severityFor(reason: AbuseReportContentInput["reasonCode"]) {
  if (reason === "SCAM_OR_FRAUD" || reason === "DISCRIMINATION") return "HIGH" as const;
  if (reason === "OUTDATED") return "LOW" as const;
  return "MEDIUM" as const;
}

function dueMilliseconds(reason: AbuseReportContentInput["reasonCode"]) {
  return (reason === "SCAM_OR_FRAUD" || reason === "DISCRIMINATION" ? 1 : 3) * 86_400_000;
}
