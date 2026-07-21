import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  AnalyticsWriteRecord,
  AnalyticsWriter,
} from "@/lib/analytics/track";
import { trackAnalyticsEventV1 } from "@/lib/analytics/track";
import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  writeNotificationExactlyOnce,
} from "@/lib/notifications/writer";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { isConversationMessageBlocked } from "@/lib/admin/moderation";
import {
  decideApplicationTransition,
  type ApplicationActorCapability,
  type ApplicationStatus,
  type ApplicationTransitionAction,
} from "@/lib/policies/status/application";
import type { AiProvider } from "@/lib/providers/ai/ai-provider";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

const DAY = 86_400_000;
const AUDIT_TTL = 365 * DAY;

export type EmployerApplicationAccess = Readonly<{
  companyId: string;
  membershipId: string;
  userId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
}>;
type Dependencies = Readonly<{
  database: DatabaseClient;
  request: AuthRequestContext;
  environment: ServerEnvironment;
  emailProvider?: EmailProvider;
  aiProvider?: AiProvider;
  now?: Date;
}>;

const transitionInputSchema = z.strictObject({
  applicationId: z.uuid(),
  nextStatus: z.enum(["IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]),
  rejectionReason: z.enum(["NOT_A_MATCH", "POSITION_FILLED", "REQUIREMENTS_NOT_MET", "OTHER_REVIEWED"]).optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
}).superRefine((value, context) => {
  if (value.nextStatus === "REJECTED" && value.rejectionReason === undefined) {
    context.addIssue({ code: "custom", path: ["rejectionReason"], message: "Ein Ablehnungsgrund ist erforderlich." });
  }
  if (value.nextStatus !== "REJECTED" && value.rejectionReason !== undefined) {
    context.addIssue({ code: "custom", path: ["rejectionReason"], message: "Ein Ablehnungsgrund ist nur bei einer Ablehnung zulässig." });
  }
});
const noteInputSchema = z.strictObject({ applicationId: z.uuid(), body: z.string().trim().min(1).max(3000), idempotencyKey: z.string().trim().min(8).max(128) });
const messageInputSchema = z.strictObject({ applicationId: z.uuid(), body: z.string().trim().min(1).max(5000), idempotencyKey: z.string().trim().min(8).max(128) });

export function normalizeEmployerApplicationFilter(raw: Readonly<{ jobId?: string | string[]; status?: string | string[]; query?: string | string[] }>) {
  const jobId = first(raw.jobId);
  const status = first(raw.status);
  const query = first(raw.query)?.trim().slice(0, 100);
  return Object.freeze({
    jobId: z.uuid().safeParse(jobId).success ? jobId : undefined,
    status: ["SUBMITTED", "IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"].includes(status ?? "") ? status as ApplicationStatus : undefined,
    query: query === "" ? undefined : query,
  });
}

export async function listEmployerApplications(access: EmployerApplicationAccess, database: DatabaseClient, rawFilter: ReturnType<typeof normalizeEmployerApplicationFilter>, now = new Date()) {
  const where = applicationWhere(access, now);
  const [applications, jobs] = await Promise.all([
    database.application.findMany({
      where: {
        job: { ...where, ...(rawFilter.jobId === undefined ? {} : { id: rawFilter.jobId }) },
        ...(rawFilter.status === undefined ? {} : { status: rawFilter.status }),
        ...(rawFilter.query === undefined ? {} : { submissionSnapshot: { OR: [
          { candidateFirstName: { contains: rawFilter.query, mode: "insensitive" } },
          { candidateLastName: { contains: rawFilter.query, mode: "insensitive" } },
        ] } }),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 200,
      select: applicationCardSelect,
    }),
    database.job.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 200, select: { id: true, currentRevision: { select: { title: true } } } }),
  ]);
  return Object.freeze({ applications, jobs });
}

export async function getEmployerApplicationDetail(applicationId: string, access: EmployerApplicationAccess, database: DatabaseClient, now = new Date()) {
  if (!z.uuid().safeParse(applicationId).success) return null;
  return database.application.findFirst({
    where: { id: applicationId, job: applicationWhere(access, now) },
    select: {
      ...applicationCardSelect,
      coverLetter: true,
      rejectionReason: true,
      rejectionNote: true,
      submissionDocuments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50, select: { id: true, safeFilenameSnapshot: true, mimeTypeSnapshot: true, sizeBytesSnapshot: true } },
      employerNotes: { where: { companyId: access.companyId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, body: true, createdAt: true, authorUserId: true } },
      conversation: { select: { id: true, messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200, select: { id: true, body: true, createdAt: true, senderUserId: true, sender: { select: { name: true } } } } } },
      events: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, kind: true, fromStatus: true, toStatus: true, createdAt: true } },
    },
  });
}

const applicationCardSelect = {
  id: true, status: true, submittedAt: true, updatedAt: true,
  submissionSnapshot: { select: { candidateFirstName: true, candidateLastName: true, candidateEmail: true, responseTargetDays: true, applicationEffort: true } },
  job: { select: { id: true, currentRevision: { select: { title: true } } } },
  events: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1, select: { kind: true, toStatus: true, createdAt: true } },
} as const satisfies Prisma.ApplicationSelect;

export async function transitionEmployerApplication(access: EmployerApplicationAccess, rawInput: unknown, dependencies: Dependencies) {
  const parsed = transitionInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false as const, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  try {
    const result = await runSerializableTransaction(dependencies.database, async (tx) => {
      const application = await loadAuthorizedApplication(tx, parsed.data.applicationId, access, now);
      if (application === null) return { ok: false as const, code: "NOT_FOUND" };
      await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${application.id}::uuid FOR UPDATE`;
      const replay = await tx.applicationEvent.findUnique({ where: { idempotencyKey: eventKey("status", parsed.data.idempotencyKey) }, select: { applicationId: true, toStatus: true, metadata: true } });
      if (replay !== null) return isMatchingEmployerStatusReplay(replay, parsed.data)
        ? {
            ok: true as const,
            duplicate: true,
            email: {
              to: application.candidateEmail,
              title: application.jobTitle,
              status: parsed.data.nextStatus,
            },
          }
        : { ok: false as const, code: "IDEMPOTENCY_CONFLICT" };
      const current = await tx.application.findUniqueOrThrow({ where: { id: application.id }, select: { status: true } });
      const action = actionForStatus(parsed.data.nextStatus);
      const decision = decideApplicationTransition({ action, actor: capability(access, application.assignmentRole), currentStatus: current.status, rejectionReason: parsed.data.rejectionReason });
      if (decision.type !== "OK") return { ok: false as const, code: decision.type === "VALIDATION" ? "INVALID_TRANSITION" : "CONFLICT" };
      await tx.application.update({ where: { id: application.id }, data: { status: decision.value.nextStatus, rejectionReason: decision.value.nextStatus === "REJECTED" ? parsed.data.rejectionReason : null, rejectionNote: null, updatedAt: now } });
      await tx.applicationEvent.create({ data: { applicationId: application.id, actorUserId: access.userId, kind: "STATUS_CHANGE", fromStatus: current.status, toStatus: decision.value.nextStatus, idempotencyKey: eventKey("status", parsed.data.idempotencyKey), correlationId: dependencies.request.correlationId, metadata: parsed.data.rejectionReason === undefined ? undefined : { reasonCode: parsed.data.rejectionReason }, createdAt: now } });
      await writeRequiredAudit(createPrismaTransactionAuditPort(tx), { action: "APPLICATION_STATUS_CHANGED", actorKind: "USER", actorUserId: access.userId, capability: "COMPANY_APPLICATION_TRANSITION", companyId: access.companyId, correlationId: dependencies.request.correlationId, result: "SUCCEEDED", retainUntil: new Date(now.getTime() + AUDIT_TTL), targetId: application.id, targetType: "APPLICATION" });
      await writeNotificationExactlyOnce(createPrismaNotificationPort(tx), { recipientUserId: application.candidateUserId, kind: "APPLICATION_STATUS_CHANGED", dedupeKey: eventKey("status", parsed.data.idempotencyKey), payload: { applicationId: application.id, status: decision.value.nextStatus, ...(parsed.data.rejectionReason === undefined ? {} : { reasonCode: parsed.data.rejectionReason }) } });
      if (isQualifyingEmployerResponseStatus(decision.value.nextStatus)) {
        await trackAnalyticsEventV1(
          {
            schemaVersion: "1",
            producerEventId: `EMPLOYER_RESPONSE:${application.id}`,
            occurredAt: now,
            kind: "EMPLOYER_RESPONSE_RECORDED",
            companyId: access.companyId,
            jobId: application.jobId,
            properties: {},
          },
          {
            producer: "employer-application",
            productAnalyticsEnabled: false,
            provenance: {
              actor: application.actorProvenance,
              company: application.companyProvenance,
              job: application.jobProvenance,
            },
          },
          transactionAnalyticsWriter(tx),
        );
      }
      return {
        ok: true as const,
        duplicate: false,
        email: {
          to: application.candidateEmail,
          title: application.jobTitle,
          status: decision.value.nextStatus,
        },
      };
    });
    if (!result.ok) return result;
    const publicResult = { ok: true as const, duplicate: result.duplicate };
    if (result.email === null || dependencies.emailProvider === undefined) return publicResult;
    try { await dependencies.emailProvider.send({ to: result.email.to, templateKey: "application_status_changed", subject: "Neuer Status deiner Bewerbung", data: { jobTitle: result.email.title, statusLabel: statusLabel(result.email.status), idempotencyKey: eventKey("status", parsed.data.idempotencyKey) } }); } catch { /* committed event remains authoritative */ }
    return publicResult;
  } catch { return { ok: false as const, code: "WRITE_FAILED" }; }
}

export async function addEmployerApplicationNote(access: EmployerApplicationAccess, rawInput: unknown, dependencies: Dependencies) {
  const parsed = noteInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false as const, code: "INVALID_INPUT" };
  const body = sanitizeBody(parsed.data.body, 3000);
  if (body === null) return { ok: false as const, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  try {
    return await dependencies.database.$transaction(async (tx) => {
      const application = await loadAuthorizedApplication(tx, parsed.data.applicationId, access, now);
      if (application === null) return { ok: false as const, code: "NOT_FOUND" };
      await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${application.id}::uuid FOR UPDATE`;
      const key = eventKey("employer-note", parsed.data.idempotencyKey);
      const replay = await tx.applicationEvent.findUnique({ where: { idempotencyKey: key }, select: { applicationId: true, metadata: true } });
      if (replay !== null) {
        const employerNoteId = metadataString(replay.metadata, "employerNoteId");
        const persistedNote = employerNoteId === null
          ? null
          : await tx.applicationEmployerNote.findFirst({
              where: { id: employerNoteId, applicationId: application.id, companyId: access.companyId },
              select: { id: true, applicationId: true, companyId: true, body: true },
            });
        return isMatchingEmployerNoteReplay(replay, persistedNote, { applicationId: application.id, companyId: access.companyId, body })
          ? { ok: true as const, duplicate: true }
          : { ok: false as const, code: "IDEMPOTENCY_CONFLICT" };
      }
      const note = await tx.applicationEmployerNote.create({ data: { applicationId: application.id, companyId: access.companyId, authorUserId: access.userId, body, createdAt: now }, select: { id: true } });
      await tx.applicationEvent.create({ data: { applicationId: application.id, actorUserId: access.userId, kind: "EMPLOYER_NOTE_ADDED", idempotencyKey: key, correlationId: dependencies.request.correlationId, metadata: { employerNoteId: note.id, payloadBindingVersion: "employer-note-v1" }, createdAt: now } });
      await writeRequiredAudit(createPrismaTransactionAuditPort(tx), { action: "APPLICATION_EMPLOYER_NOTE_ADDED", actorKind: "USER", actorUserId: access.userId, capability: "COMPANY_APPLICATION_NOTE", companyId: access.companyId, correlationId: dependencies.request.correlationId, result: "SUCCEEDED", retainUntil: new Date(now.getTime() + AUDIT_TTL), targetId: application.id, targetType: "APPLICATION" });
      return { ok: true as const, duplicate: false };
    });
  } catch { return { ok: false as const, code: "WRITE_FAILED" }; }
}

export async function sendEmployerApplicationMessage(access: EmployerApplicationAccess, rawInput: unknown, dependencies: Dependencies) {
  const parsed = messageInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false as const, code: "INVALID_INPUT" };
  const body = sanitizeBody(parsed.data.body, 5000);
  if (body === null) return { ok: false as const, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  try {
    const result = await runSerializableTransaction(dependencies.database, async (tx) => {
      const application = await loadAuthorizedApplication(tx, parsed.data.applicationId, access, now);
      if (application === null) return { ok: false as const, code: "NOT_FOUND" };
      await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${application.id}::uuid FOR UPDATE`;
      const existing = await tx.message.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey }, select: { id: true, senderUserId: true, body: true, conversation: { select: { applicationId: true } } } });
      if (existing !== null) return existing.senderUserId === access.userId && existing.body === body && existing.conversation.applicationId === application.id
        ? {
            ok: true as const,
            duplicate: true,
            email: {
              to: application.candidateEmail,
              title: application.jobTitle,
              companyName: application.companyName,
            },
          }
        : { ok: false as const, code: "IDEMPOTENCY_CONFLICT" };
      let conversationId = application.conversationId;
      if (conversationId !== null && await isConversationMessageBlocked(tx, conversationId, now)) {
        return { ok: false as const, code: "CONFLICT" };
      }
      if (conversationId === null) {
        const created = await tx.conversation.create({ data: { companyId: access.companyId, kind: "APPLICATION", applicationId: application.id, subject: `Bewerbung: ${application.jobTitle}`.slice(0, 200), createdAt: now, participants: { create: [{ kind: "USER", userId: application.candidateUserId, joinedAt: now }, { kind: "COMPANY_PRINCIPAL", companyId: access.companyId, joinedAt: now }] } }, select: { id: true } });
        conversationId = created.id;
      }
      const message = await tx.message.create({ data: { conversationId, senderUserId: access.userId, idempotencyKey: parsed.data.idempotencyKey, body, createdAt: now }, select: { id: true } });
      await tx.applicationEvent.create({ data: { applicationId: application.id, actorUserId: access.userId, kind: "MESSAGE_SENT", idempotencyKey: eventKey("message", parsed.data.idempotencyKey), correlationId: dependencies.request.correlationId, createdAt: now } });
      await writeNotificationExactlyOnce(createPrismaNotificationPort(tx), { recipientUserId: application.candidateUserId, kind: "MESSAGE_RECEIVED", dedupeKey: `message:${message.id}`, payload: { conversationId, status: "UNREAD" } });
      await writeRequiredAudit(createPrismaTransactionAuditPort(tx), { action: "MESSAGE_SENT", actorKind: "USER", actorUserId: access.userId, capability: "COMPANY_APPLICATION_MESSAGE", companyId: access.companyId, correlationId: dependencies.request.correlationId, result: "SUCCEEDED", retainUntil: new Date(now.getTime() + AUDIT_TTL), targetId: message.id, targetType: "MESSAGE" });
      await trackAnalyticsEventV1(
        {
          schemaVersion: "1",
          producerEventId: `EMPLOYER_RESPONSE:${application.id}`,
          occurredAt: now,
          kind: "EMPLOYER_RESPONSE_RECORDED",
          companyId: access.companyId,
          jobId: application.jobId,
          properties: {},
        },
        {
          producer: "employer-application",
          productAnalyticsEnabled: false,
          provenance: {
            actor: application.actorProvenance,
            company: application.companyProvenance,
            job: application.jobProvenance,
          },
        },
        transactionAnalyticsWriter(tx),
      );
      return {
        ok: true as const,
        duplicate: false,
        email: {
          to: application.candidateEmail,
          title: application.jobTitle,
          companyName: application.companyName,
        },
      };
    });
    if (!result.ok) return result;
    const publicResult = { ok: true as const, duplicate: result.duplicate };
    if (result.email === null || dependencies.emailProvider === undefined) return publicResult;
    try { await dependencies.emailProvider.send({ to: result.email.to, templateKey: "employer_message_received", subject: "Neue Nachricht zu deiner Bewerbung", data: { companyName: result.email.companyName, jobTitle: result.email.title, idempotencyKey: parsed.data.idempotencyKey } }); } catch { /* post-commit delivery is retryable */ }
    return publicResult;
  } catch { return { ok: false as const, code: "WRITE_FAILED" }; }
}

export async function draftEmployerApplicationText(applicationId: string, kind: "REJECTION" | "INTERVIEW", access: EmployerApplicationAccess, dependencies: Dependencies) {
  if (dependencies.aiProvider === undefined) return null;
  const application = await getEmployerApplicationDetail(applicationId, access, dependencies.database, dependencies.now ?? new Date());
  const title = application?.job.currentRevision?.title;
  if (application === null || title === undefined) return null;
  return kind === "REJECTION"
    ? dependencies.aiProvider.draftRejectionMessage({ jobTitle: title })
    : dependencies.aiProvider.draftInterviewInvitation({ jobTitle: title, suggestedSlots: [] });
}

function applicationWhere(access: EmployerApplicationAccess, now: Date): Prisma.JobWhereInput {
  const membership = { id: access.membershipId, userId: access.userId, companyId: access.companyId, status: "ACTIVE" as const, user: { status: "ACTIVE" as const } };
  if (access.membershipRole === "OWNER" || access.membershipRole === "ADMIN") return { companyId: access.companyId, company: { status: "ACTIVE", memberships: { some: { ...membership, role: access.membershipRole } } } };
  if (access.membershipRole === "RECRUITER") return { companyId: access.companyId, company: { status: "ACTIVE", memberships: { some: { ...membership, role: "RECRUITER" } } }, assignments: { some: { membershipId: access.membershipId, companyId: access.companyId, userId: access.userId, role: { in: ["EDITOR", "PIPELINE"] }, status: "ACTIVE", revokedAt: null, validFrom: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } };
  return { id: "00000000-0000-0000-0000-000000000000" };
}

async function loadAuthorizedApplication(tx: Prisma.TransactionClient, applicationId: string, access: EmployerApplicationAccess, now: Date) {
  return tx.application.findFirst({
    where: { id: applicationId, job: applicationWhere(access, now) },
    select: {
      id: true,
      job: { select: {
        id: true,
        dataProvenance: true,
        company: { select: {
          name: true,
          dataProvenance: true,
          memberships: {
            where: { id: access.membershipId, userId: access.userId, status: "ACTIVE", user: { status: "ACTIVE" } },
            take: 1,
            select: { user: { select: { dataProvenance: true } } },
          },
        } },
        assignments: { where: { membershipId: access.membershipId, status: "ACTIVE", revokedAt: null, validFrom: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, take: 1, select: { role: true } },
      } },
      candidateProfile: { select: { userId: true } },
      submittedJobRevision: { select: { title: true } },
      submissionSnapshot: { select: { candidateEmail: true, recipientCompanyName: true } },
      conversation: { select: { id: true } },
    },
  }).then((row) => row === null ? null : ({
    id: row.id,
    candidateUserId: row.candidateProfile.userId,
    candidateEmail: row.submissionSnapshot?.candidateEmail ?? "",
    jobTitle: row.submittedJobRevision.title,
    companyName: row.submissionSnapshot?.recipientCompanyName ?? row.job.company.name,
    jobId: row.job.id,
    actorProvenance: row.job.company.memberships[0]!.user.dataProvenance,
    companyProvenance: row.job.company.dataProvenance,
    jobProvenance: row.job.dataProvenance,
    conversationId: row.conversation?.id ?? null,
    assignmentRole: access.membershipRole === "RECRUITER" ? row.job.assignments[0]?.role ?? null : null,
  }));
}

function capability(access: EmployerApplicationAccess, assignmentRole: string | null): ApplicationActorCapability {
  if (access.membershipRole === "OWNER") return "COMPANY_OWNER_PIPELINE";
  if (access.membershipRole === "ADMIN") return "COMPANY_ADMIN_PIPELINE";
  if (assignmentRole === "EDITOR") return "RECRUITER_EDITOR_PIPELINE";
  return "RECRUITER_PIPELINE";
}
function actionForStatus(status: string): ApplicationTransitionAction {
  const actions: Readonly<Record<string, ApplicationTransitionAction>> = { IN_REVIEW: "START_REVIEW", SHORTLISTED: "SHORTLIST", INTERVIEW: "SCHEDULE_INTERVIEW", OFFER: "MAKE_OFFER", HIRED: "HIRE", REJECTED: "REJECT" };
  return actions[status] ?? "START_REVIEW";
}
function statusLabel(status: ApplicationStatus) { return ({ SUBMITTED: "Eingegangen", IN_REVIEW: "In Prüfung", SHORTLISTED: "Vorauswahl", INTERVIEW: "Interview", OFFER: "Angebot", HIRED: "Eingestellt", REJECTED: "Abgelehnt", WITHDRAWN: "Zurückgezogen" } as const)[status]; }
function sanitizeBody(value: string, max: number) { const cleaned = stripUnsafeHtml(value).trim(); return cleaned.length === 0 || cleaned.length > max ? null : cleaned; }
function eventKey(scope: string, key: string) { return `${scope}:${createHash("sha256").update(key, "utf8").digest("hex")}`.slice(0, 128); }
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export function isQualifyingEmployerResponseStatus(status: ApplicationStatus): boolean {
  return status === "SHORTLISTED" || status === "INTERVIEW" || status === "OFFER" || status === "HIRED" || status === "REJECTED";
}

export function isMatchingEmployerStatusReplay(
  replay: Readonly<{ applicationId: string; toStatus: ApplicationStatus | null; metadata: Prisma.JsonValue | null }>,
  input: Readonly<{ applicationId: string; nextStatus: ApplicationStatus; rejectionReason?: string }>,
): boolean {
  return replay.applicationId === input.applicationId
    && replay.toStatus === input.nextStatus
    && metadataString(replay.metadata, "reasonCode") === (input.rejectionReason ?? null);
}

export function isMatchingEmployerNoteReplay(
  replay: Readonly<{ applicationId: string; metadata: Prisma.JsonValue | null }>,
  persistedNote: Readonly<{ id: string; applicationId: string; companyId: string; body: string }> | null,
  input: Readonly<{ applicationId: string; companyId: string; body: string }>,
): boolean {
  return replay.applicationId === input.applicationId
    && persistedNote !== null
    && metadataString(replay.metadata, "employerNoteId") === persistedNote.id
    && persistedNote.applicationId === input.applicationId
    && persistedNote.companyId === input.companyId
    && persistedNote.body === input.body;
}

function metadataString(metadata: Prisma.JsonValue | null, key: string): string | null {
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") return null;
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function transactionAnalyticsWriter(transaction: Prisma.TransactionClient): AnalyticsWriter {
  return Object.freeze({
    async create(record: AnalyticsWriteRecord) {
      const result = await transaction.analyticsEvent.createMany({ data: record, skipDuplicates: true });
      return result.count === 0 ? "DUPLICATE" : "CREATED";
    },
    async expire(retainUntilInclusive: Date) {
      const result = await transaction.analyticsEvent.deleteMany({ where: { retainUntil: { lte: retainUntilInclusive } } });
      return result.count;
    },
  });
}

async function runSerializableTransaction<T>(
  database: DatabaseClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await database.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt === 3 || !isRetryableTransactionError(error)) throw error;
    }
  }
  throw new Error("Employer application transaction retry budget exhausted.");
}

function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null
    ? error.meta
    : null;
  if (code === "P2010" && meta !== null && "code" in meta) {
    const databaseCode = String(meta.code);
    if (databaseCode === "40001" || databaseCode === "40P01") return true;
  }
  const messages = [
    "message" in error && typeof error.message === "string" ? error.message : "",
    meta !== null && "message" in meta && typeof meta.message === "string" ? meta.message : "",
  ].join("\n");
  return /could not serialize access|deadlock detected|write conflict/iu.test(messages);
}
