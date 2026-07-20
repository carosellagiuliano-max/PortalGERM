import "server-only";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

export const PUBLIC_REPORT_REASONS = [
  "MISLEADING",
  "SCAM_OR_FRAUD",
  "DISCRIMINATION",
  "OUTDATED",
  "OTHER",
] as const;

export const publicReportInputSchema = z.strictObject({
  targetType: z.enum(["JOB", "COMPANY"]),
  slug: z.string().trim().min(1).max(220).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  reasonCode: z.enum(PUBLIC_REPORT_REASONS),
  description: z.string().trim().min(20).max(1_500),
});

export type PublicReportInput = z.output<typeof publicReportInputSchema>;
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

export async function createPublicReport(
  rawInput: unknown,
  target: ResolvedPublicReportTarget | null,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    request: AuthRequestContext;
    currentUser: CurrentUser | null;
    now?: Date;
  }>,
): Promise<PublicReportResult> {
  const parsed = publicReportInputSchema.safeParse(rawInput);
  if (!parsed.success) return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  if (target === null || target.targetType !== parsed.data.targetType) {
    return Object.freeze({ ok: false, code: "TARGET_NOT_FOUND" });
  }
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
      targetId: target.id,
    },
    dependencies.request,
    now,
    { environment: dependencies.environment, database: dependencies.database },
  );
  if (!rate.allowed) return Object.freeze({ ok: false, code: "RATE_LIMITED" });

  try {
    const report = await dependencies.database.$transaction(async (transaction) => {
      const created = await transaction.abuseReport.create({
        data: {
          targetType: target.targetType,
          targetId: target.id,
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
          companyId: target.companyId,
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
    return Object.freeze({ ok: true, reportId: report.id });
  } catch {
    return Object.freeze({ ok: false, code: "WRITE_FAILED" });
  }
}

function severityFor(reason: PublicReportInput["reasonCode"]) {
  if (reason === "SCAM_OR_FRAUD" || reason === "DISCRIMINATION") return "HIGH" as const;
  if (reason === "OUTDATED") return "LOW" as const;
  return "MEDIUM" as const;
}

function dueMilliseconds(reason: PublicReportInput["reasonCode"]) {
  return (reason === "SCAM_OR_FRAUD" || reason === "DISCRIMINATION" ? 1 : 3) * 86_400_000;
}
