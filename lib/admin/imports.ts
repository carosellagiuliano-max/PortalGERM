import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { canRunLicensedSupplyImport, canUseEmployerImport } from "@/lib/admin/capabilities";
import { slaDueAt } from "@/lib/admin/sla";
import { Prisma } from "@/lib/generated/prisma/client";
import { createJobSlug } from "@/lib/jobs/slug";
import { slugify } from "@/lib/utils/slug";
import {
  adminErrorResult,
  AdminDomainError,
  adminFailure,
  adminNow,
  adminSuccess,
  operationKey,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";

const MAX_IMPORT_BYTES = 750_000;
const MAX_IMPORT_ITEMS = 500;
const MAX_XML_DEPTH = 12;
const MAX_ARRAY_VALUES = 30;

export const LICENSED_FEED_FIELDS = Object.freeze([
  "id", "company", "title", "workplace_country", "zip", "city", "canton", "description", "requirements", "offer", "contact", "application_url", "type", "workload_min", "workload_max", "keywords",
] as const);

const normalizedItemSchema = z.strictObject({
  id: z.string().trim().min(1).max(160),
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(3).max(200),
  workplace_country: z.string().trim().toUpperCase().length(2).default("CH"),
  zip: z.string().trim().max(16).default(""),
  city: z.string().trim().max(160).default(""),
  canton: z.string().trim().max(120).default(""),
  description: z.string().trim().min(10).max(10_000),
  requirements: z.array(z.string().trim().min(1).max(500)).max(MAX_ARRAY_VALUES).default([]),
  offer: z.string().trim().max(5_000).default(""),
  contact: z.string().trim().max(512).default(""),
  application_url: z.string().trim().max(512).default(""),
  type: z.string().trim().max(64).default("PERMANENT"),
  workload_min: z.coerce.number().int().min(1).max(100).default(80),
  workload_max: z.coerce.number().int().min(1).max(100).default(100),
  keywords: z.array(z.string().trim().min(1).max(160)).max(MAX_ARRAY_VALUES).default([]),
}).superRefine((item, context) => {
  if (item.workload_min > item.workload_max) context.addIssue({ code: "custom", path: ["workload_max"], message: "INVALID_WORKLOAD" });
  if (item.workplace_country !== "CH") context.addIssue({ code: "custom", path: ["workplace_country"], message: "UNSUPPORTED_COUNTRY" });
  if (item.canton.length === 0) context.addIssue({ code: "custom", path: ["canton"], message: "CANTON_REQUIRED" });
  if (item.city.length === 0) context.addIssue({ code: "custom", path: ["city"], message: "CITY_REQUIRED" });
  if (item.application_url.length > 0 && !z.url().safeParse(item.application_url).success) context.addIssue({ code: "custom", path: ["application_url"], message: "INVALID_URL" });
});

export type NormalizedImportItem = z.infer<typeof normalizedItemSchema>;

const parseSchema = z.strictObject({
  importSourceId: z.uuid(),
  inputSource: z.enum(["UPLOAD", "PASTE"]),
  format: z.enum(["XML", "JSON"]),
  payload: z.string().min(2).max(MAX_IMPORT_BYTES),
  idempotencyKey: z.uuid(),
});

export async function listAdminImports(dependencies: AdminDependencies) {
  if (!canRunLicensedSupplyImport(dependencies.actor)) return null;
  const [sources, runs, companies] = await Promise.all([
    dependencies.database.importSource.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, format: true, sourceReference: true, licenseReference: true, companyRights: { where: { revokedAt: null }, select: { companyId: true, validFrom: true, validTo: true, company: { select: { name: true } } } } } }),
    dependencies.database.importRun.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, status: true, format: true, inputSource: true, redactedErrorSummary: true, dueAt: true, createdAt: true, completedAt: true, importSource: { select: { name: true } }, _count: { select: { items: true } } } }),
    dependencies.database.company.findMany({ where: { status: { in: ["ACTIVE", "DRAFT"] } }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, slug: true } }),
  ]);
  return Object.freeze({ sources, runs, companies, employerImportPackaged: canUseEmployerImport() });
}

export async function getAdminImportRun(dependencies: AdminDependencies, runId: string) {
  if (!canRunLicensedSupplyImport(dependencies.actor) || !z.uuid().safeParse(runId).success) return null;
  return dependencies.database.importRun.findUnique({
    where: { id: runId },
    select: {
      id: true, status: true, format: true, inputSource: true, checksum: true, redactedErrorSummary: true, dueAt: true, createdAt: true, completedAt: true,
      importSource: { select: { id: true, name: true, sourceReference: true, licenseReference: true } },
      items: { orderBy: [{ sourceItemKey: "asc" }, { id: "asc" }], select: { id: true, sourceItemKey: true, normalizedPreview: true, normalizedChecksum: true, status: true, validationSummary: true, redactedErrorSummary: true, decision: { select: { kind: true, selectedCompanyId: true, reasonCode: true, committedJobId: true } } } },
    },
  });
}

export async function parseLicensedImport(raw: unknown, dependencies: AdminDependencies) {
  const parsed = parseSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!canRunLicensedSupplyImport(dependencies.actor)) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const bytes = Buffer.byteLength(parsed.data.payload, "utf8");
  if (bytes > MAX_IMPORT_BYTES) return adminFailure("INVALID_INPUT");
  const checksum = sha256(parsed.data.payload);
  const existing = await dependencies.database.importRun.findUnique({ where: { importSourceId_checksum: { importSourceId: parsed.data.importSourceId, checksum } }, select: { id: true, status: true } });
  if (existing !== null) return adminSuccess({ runId: existing.id, status: existing.status, duplicate: true }, true);
  const source = await dependencies.database.importSource.findFirst({ where: { id: parsed.data.importSourceId, isActive: true, format: parsed.data.format }, select: { id: true } });
  if (source === null) return adminFailure("NOT_FOUND");

  let records: readonly Record<string, unknown>[];
  try {
    records = parseLicensedFeedPayload(parsed.data.format, parsed.data.payload);
  } catch {
    records = [];
  }
  const parsingFailed = records.length === 0;
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const run = await transaction.importRun.create({ data: { id: randomUUID(), importSourceId: source.id, actorUserId: dependencies.actor.userId, inputSource: parsed.data.inputSource, format: parsed.data.format, checksum, status: parsingFailed ? "FAILED" : "PARSING", redactedErrorSummary: parsingFailed ? "Feed konnte nicht sicher gelesen werden." : null, dueAt: parsingFailed ? slaDueAt(now, "IMPORT_FAILURE") : null, startedAt: now, completedAt: parsingFailed ? now : null, createdAt: now, updatedAt: now } });
      let okItems = 0;
      let errorItems = 0;
      const seenSourceKeys = new Set<string>();
      if (!parsingFailed) {
        for (const [index, record] of records.entries()) {
          const normalized = normalizeRecord(record);
          const duplicateSourceKey = normalized.success && seenSourceKeys.has(normalized.data.id);
          if (normalized.success && !duplicateSourceKey) {
            seenSourceKeys.add(normalized.data.id);
            const preview = normalized.data as unknown as Prisma.InputJsonObject;
            await transaction.importItem.create({ data: { id: randomUUID(), runId: run.id, sourceItemKey: normalized.data.id, normalizedPreview: preview, normalizedChecksum: sha256(canonicalJson(normalized.data)), dedupeKey: sha256(`${normalized.data.id}\0${normalized.data.title}\0${normalized.data.company}`).slice(0, 160), status: "OK", validationSummary: { valid: true, fieldCount: LICENSED_FEED_FIELDS.length }, createdAt: now, updatedAt: now } });
            okItems += 1;
          } else {
            const originalSourceItemKey = boundedString(record.id, `row-${index + 1}`, 120);
            const sourceItemKey = duplicateSourceKey
              ? `${originalSourceItemKey}#duplicate-${index + 1}`
              : originalSourceItemKey;
            const issues = duplicateSourceKey
              ? [{ field: "id", code: "DUPLICATE_SOURCE_ITEM_KEY" }]
              : normalized.success
                ? []
                : normalized.error.issues.slice(0, 12).map((issue) => ({ field: issue.path.join("."), code: issue.code }));
            await transaction.importItem.create({ data: { id: randomUUID(), runId: run.id, sourceItemKey, normalizedPreview: { id: sourceItemKey }, normalizedChecksum: sha256(canonicalJson({ id: sourceItemKey })), dedupeKey: sha256(`${sourceItemKey}\0${index}`).slice(0, 160), status: "ERROR", validationSummary: { valid: false, issues }, redactedErrorSummary: duplicateSourceKey ? "Doppelte Quell-ID; Datensatz muss abgelehnt werden." : "Datensatz enthält ungültige oder fehlende Felder.", createdAt: now, updatedAt: now } });
            errorItems += 1;
          }
        }
        await transaction.importRun.update({ where: { id: run.id }, data: { status: "PREVIEW_READY", completedAt: now, redactedErrorSummary: errorItems > 0 ? `${errorItems} Datensätze benötigen Korrektur oder Ablehnung.` : null, updatedAt: now } });
      }
      await writeAdminAudit(transaction, dependencies, now, { action: "IMPORT_PARSED", capability: "ADMIN_LICENSED_IMPORT", targetType: "IMPORT_RUN", targetId: run.id, reasonCode: parsingFailed ? "PARSER_REJECTED" : "PREVIEW_CREATED" });
      return adminSuccess({ runId: run.id, status: parsingFailed ? "FAILED" as const : "PREVIEW_READY" as const, okItems, errorItems, duplicate: false });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const decisionSchema = z.strictObject({
  itemId: z.uuid(),
  decision: z.enum(["APPROVE", "REJECT"]),
  companyId: z.uuid().nullable().optional(),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  idempotencyKey: z.uuid(),
});

export async function decideImportItem(raw: unknown, dependencies: AdminDependencies) {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success || (parsed.data.decision === "APPROVE" && parsed.data.companyId == null)) return adminFailure("INVALID_INPUT");
  if (!canRunLicensedSupplyImport(dependencies.actor)) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const decisionKey = operationKey("admin-import-decision", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ImportItem" WHERE "id" = ${parsed.data.itemId}::uuid FOR UPDATE`;
      const item = await transaction.importItem.findUnique({ where: { id: parsed.data.itemId }, select: { id: true, status: true, decision: { select: { id: true, kind: true, selectedCompanyId: true, idempotencyKey: true } }, run: { select: { id: true, importSourceId: true, status: true } } } });
      if (item === null) return adminFailure("NOT_FOUND");
      if (item.decision !== null) return item.decision.idempotencyKey === decisionKey ? adminSuccess({ itemId: item.id, decision: item.decision.kind }, true) : adminFailure("CONFLICT");
      if (item.run.status !== "PREVIEW_READY" || (parsed.data.decision === "APPROVE" && item.status !== "OK")) return adminFailure("CONFLICT");
      if (parsed.data.decision === "APPROVE") {
        const allowed = await hasCurrentSourceRight(transaction, item.run.importSourceId, parsed.data.companyId!, now);
        if (!allowed) return adminFailure("FORBIDDEN");
      }
      await transaction.importDecision.create({ data: { id: randomUUID(), importItemId: item.id, kind: parsed.data.decision, selectedCompanyId: parsed.data.decision === "APPROVE" ? parsed.data.companyId : null, actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, idempotencyKey: decisionKey, createdAt: now } });
      await writeAdminAudit(transaction, dependencies, now, { action: "IMPORT_DECISION_RECORDED", capability: "ADMIN_LICENSED_IMPORT", targetType: "IMPORT_RUN", targetId: item.run.id, companyId: parsed.data.companyId ?? null, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ itemId: item.id, decision: parsed.data.decision });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const runCommandSchema = z.strictObject({ runId: z.uuid(), idempotencyKey: z.uuid() });

export async function commitImportRun(raw: unknown, dependencies: AdminDependencies) {
  const parsed = runCommandSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!canRunLicensedSupplyImport(dependencies.actor)) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const auditCorrelation = parsed.data.idempotencyKey;
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ImportRun" WHERE "id" = ${parsed.data.runId}::uuid FOR UPDATE`;
      const replay = await transaction.auditLog.findFirst({ where: { action: "IMPORT_COMMITTED", targetId: parsed.data.runId, correlationId: auditCorrelation }, select: { id: true } });
      const run = await transaction.importRun.findUnique({ where: { id: parsed.data.runId }, select: { id: true, importSourceId: true, status: true, importSource: { select: { sourceReference: true } }, items: { orderBy: [{ id: "asc" }], select: { id: true, normalizedPreview: true, normalizedChecksum: true, status: true, decision: { select: { id: true, kind: true, selectedCompanyId: true, committedJobId: true } } } } } });
      if (run === null) return adminFailure("NOT_FOUND");
      if (replay !== null && ["COMMITTED", "PARTIALLY_COMMITTED"].includes(run.status)) return adminSuccess({ runId: run.id, status: run.status, committed: 0, rejected: 0 }, true);
      if (run.status !== "PREVIEW_READY") return adminFailure("CONFLICT");
      let committed = 0;
      let rejected = 0;
      for (const item of run.items) {
        if (item.decision?.kind !== "APPROVE") { rejected += 1; continue; }
        if (item.status !== "OK" || item.decision.selectedCompanyId === null || item.decision.committedJobId !== null) throw new AdminDomainError("CONFLICT");
        if (!await hasCurrentSourceRight(transaction, run.importSourceId, item.decision.selectedCompanyId, now)) throw new AdminDomainError("FORBIDDEN");
        const preview = normalizedItemSchema.safeParse(item.normalizedPreview);
        if (!preview.success || sha256(canonicalJson(preview.data)) !== item.normalizedChecksum) throw new AdminDomainError("CONFLICT");
        const duplicate = await transaction.job.findFirst({ where: { origin: "IMPORT", importSourceId: run.importSourceId, sourceReference: preview.data.id }, select: { id: true } });
        if (duplicate !== null) throw new AdminDomainError("CONFLICT");
        const draft = await createImportedDraft(transaction, preview.data, item.normalizedChecksum, item.decision.selectedCompanyId, run.importSourceId, dependencies.actor.userId, now, dependencies.correlationId);
        await transaction.importDecision.update({ where: { id: item.decision.id }, data: { committedJobId: draft.jobId } });
        await transaction.importItem.update({ where: { id: item.id }, data: { status: "COMMITTED", updatedAt: now } });
        committed += 1;
      }
      if (committed === 0) return adminFailure("INCOMPLETE");
      const status = rejected === 0 ? "COMMITTED" as const : "PARTIALLY_COMMITTED" as const;
      await transaction.importRun.update({ where: { id: run.id }, data: { status, completedAt: now, updatedAt: now } });
      await writeAdminAudit(transaction, { ...dependencies, correlationId: auditCorrelation }, now, { action: "IMPORT_COMMITTED", capability: "ADMIN_LICENSED_IMPORT", targetType: "IMPORT_RUN", targetId: run.id, reasonCode: status });
      return adminSuccess({ runId: run.id, status, committed, rejected });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function rollbackImportRun(raw: unknown, dependencies: AdminDependencies) {
  const parsed = runCommandSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!canRunLicensedSupplyImport(dependencies.actor)) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const auditCorrelation = parsed.data.idempotencyKey;
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ImportRun" WHERE "id" = ${parsed.data.runId}::uuid FOR UPDATE`;
      const replay = await transaction.auditLog.findFirst({ where: { action: "IMPORT_ROLLED_BACK", targetId: parsed.data.runId, correlationId: auditCorrelation }, select: { id: true } });
      const run = await transaction.importRun.findUnique({ where: { id: parsed.data.runId }, select: { id: true, status: true, items: { orderBy: [{ id: "asc" }], select: { id: true, normalizedChecksum: true, status: true, decision: { select: { committedJobId: true } } } } } });
      if (run === null) return adminFailure("NOT_FOUND");
      if (replay !== null && ["ROLLED_BACK", "PARTIALLY_ROLLED_BACK"].includes(run.status)) return adminSuccess({ runId: run.id, status: run.status, rolledBack: 0, conflicts: 0 }, true);
      if (!["COMMITTED", "PARTIALLY_COMMITTED"].includes(run.status)) return adminFailure("CONFLICT");
      let rolledBack = 0;
      let conflicts = 0;
      for (const item of run.items) {
        if (item.status !== "COMMITTED" || item.decision?.committedJobId === null || item.decision?.committedJobId === undefined) continue;
        await transaction.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${item.decision.committedJobId}::uuid FOR UPDATE`;
        const job = await transaction.job.findUnique({ where: { id: item.decision.committedJobId }, select: { id: true, status: true, version: true, currentRevisionId: true, currentRevision: { select: { contentChecksum: true, version: true } }, statusEvents: { select: { kind: true, reasonCode: true } }, _count: { select: { applications: true, boosts: true } }, applications: { where: { conversation: { isNot: null } }, take: 1, select: { id: true } } } });
        const pristine = job !== null && job.status === "DRAFT" && job.currentRevision !== null && job.currentRevision.contentChecksum === item.normalizedChecksum && job.currentRevision.version === 1 && job._count.applications === 0 && job._count.boosts === 0 && job.applications.length === 0 && job.statusEvents.length === 1 && job.statusEvents[0]?.kind === "DRAFT_CREATED" && job.statusEvents[0]?.reasonCode === "IMPORT_COMMIT";
        if (!pristine || job === null) {
          await transaction.importItem.update({ where: { id: item.id }, data: { status: "CONFLICT_MANUAL_REMEDIATION", redactedErrorSummary: "Import-Entwurf wurde verändert oder bereits verwendet.", updatedAt: now } });
          conflicts += 1;
          continue;
        }
        const changed = await transaction.job.updateMany({ where: { id: job.id, status: "DRAFT", version: job.version, currentRevisionId: job.currentRevisionId }, data: { status: "REMOVED", version: { increment: 1 }, updatedAt: now } });
        if (changed.count !== 1) throw new Error("CONFLICT");
        await transaction.jobStatusEvent.create({ data: { id: randomUUID(), jobId: job.id, jobRevisionId: job.currentRevisionId, kind: "IMPORT_ROLLED_BACK", fromStatus: "DRAFT", toStatus: "REMOVED", actorUserId: dependencies.actor.userId, reasonCode: "SAFE_IMPORT_ROLLBACK", idempotencyKey: `${auditCorrelation}:job:${job.id}`, correlationId: dependencies.correlationId, createdAt: now } });
        await transaction.importItem.update({ where: { id: item.id }, data: { status: "ROLLED_BACK", updatedAt: now } });
        rolledBack += 1;
      }
      if (rolledBack === 0 && conflicts === 0) return adminFailure("CONFLICT");
      const status = conflicts === 0 ? "ROLLED_BACK" as const : "PARTIALLY_ROLLED_BACK" as const;
      await transaction.importRun.update({ where: { id: run.id }, data: { status, completedAt: now, updatedAt: now } });
      await writeAdminAudit(transaction, { ...dependencies, correlationId: auditCorrelation }, now, { action: "IMPORT_ROLLED_BACK", capability: "ADMIN_LICENSED_IMPORT", targetType: "IMPORT_RUN", targetId: run.id, reasonCode: status });
      return adminSuccess({ runId: run.id, status, rolledBack, conflicts });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const setupApprovalSchema = z.strictObject({
  companyId: z.uuid(), importSourceId: z.uuid(), rightsEvidence: z.string().trim().min(3).max(1000), mappingEvidence: z.string().trim().min(3).max(1000), validUntil: z.coerce.date(), reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u), idempotencyKey: z.uuid(),
});

export async function approveImportSetup(raw: unknown, dependencies: AdminDependencies) {
  const parsed = setupApprovalSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_IMPORT_SETUP_APPROVE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  if (parsed.data.validUntil <= now || parsed.data.validUntil > new Date(now.getTime() + 30 * 86_400_000)) return adminFailure("INVALID_INPUT");
  const approvalKey = operationKey("admin-import-setup-approve", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const replay = await transaction.importSetupApproval.findUnique({ where: { idempotencyKey: approvalKey }, select: { id: true, status: true } });
      if (replay !== null) return replay.status === "APPROVED" ? adminSuccess({ approvalId: replay.id, status: replay.status }, true) : adminFailure("CONFLICT");
      const [company, source] = await Promise.all([transaction.company.findUnique({ where: { id: parsed.data.companyId }, select: { id: true } }), transaction.importSource.findFirst({ where: { id: parsed.data.importSourceId, isActive: true }, select: { id: true } })]);
      if (company === null || source === null) return adminFailure("NOT_FOUND");
      const approval = await transaction.importSetupApproval.create({ data: { id: randomUUID(), companyId: company.id, importSourceId: source.id, sourceRightsEvidence: parsed.data.rightsEvidence, mappingEvidence: parsed.data.mappingEvidence, approvedByUserId: dependencies.actor.userId, approvalReason: parsed.data.reasonCode, validUntil: parsed.data.validUntil, status: "APPROVED", idempotencyKey: approvalKey, createdAt: now, updatedAt: now } });
      await transaction.importSetupApprovalEvent.create({ data: { id: randomUUID(), importSetupApprovalId: approval.id, kind: "APPROVED", actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, correlationId: dependencies.correlationId, idempotencyKey: `${approvalKey}:event`, createdAt: now } });
      await writeAdminAudit(transaction, dependencies, now, { action: "IMPORT_SETUP_APPROVED", capability: "ADMIN_IMPORT_SETUP_APPROVE", targetType: "IMPORT_SOURCE", targetId: source.id, companyId: company.id, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ approvalId: approval.id, status: "APPROVED" as const });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const setupEndSchema = z.strictObject({ approvalId: z.uuid(), reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u), idempotencyKey: z.uuid() });

export async function revokeImportSetup(raw: unknown, dependencies: AdminDependencies) { return endImportSetup(raw, dependencies, "REVOKED"); }
export async function expireImportSetup(raw: unknown, dependencies: AdminDependencies) { return endImportSetup(raw, dependencies, "EXPIRED"); }

async function endImportSetup(raw: unknown, dependencies: AdminDependencies, status: "REVOKED" | "EXPIRED") {
  const parsed = setupEndSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_IMPORT_SETUP_APPROVE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey(`admin-import-setup-${status.toLowerCase()}`, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ImportSetupApproval" WHERE "id" = ${parsed.data.approvalId}::uuid FOR UPDATE`;
      const approval = await transaction.importSetupApproval.findUnique({ where: { id: parsed.data.approvalId }, select: { id: true, companyId: true, importSourceId: true, status: true, validUntil: true, events: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } } } });
      if (approval === null) return adminFailure("NOT_FOUND");
      if (approval.events.length > 0 && approval.status === status) return adminSuccess({ approvalId: approval.id, status }, true);
      if (approval.status !== "APPROVED" || (status === "EXPIRED" && approval.validUntil > now)) return adminFailure("CONFLICT");
      await transaction.importSetupApproval.update({ where: { id: approval.id }, data: { status, updatedAt: now } });
      await transaction.importSetupApprovalEvent.create({ data: { id: randomUUID(), importSetupApprovalId: approval.id, kind: status, actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, correlationId: dependencies.correlationId, idempotencyKey: eventKey, createdAt: now } });
      await writeAdminAudit(transaction, dependencies, now, { action: "IMPORT_SETUP_REVOKED", capability: "ADMIN_IMPORT_SETUP_APPROVE", targetType: "IMPORT_SOURCE", targetId: approval.importSourceId, companyId: approval.companyId, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ approvalId: approval.id, status });
    }, { isolationLevel: "Serializable" });
  } catch (error) { return adminErrorResult(error); }
}

async function createImportedDraft(transaction: Prisma.TransactionClient, item: NormalizedImportItem, checksum: string, companyId: string, importSourceId: string, actorUserId: string, now: Date, correlationId: string) {
  const [category, company] = await Promise.all([
    transaction.category.findFirst({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true } }),
    transaction.company.findUnique({ where: { id: companyId }, select: { slug: true } }),
  ]);
  if (category === null) throw new Error("NO_CATEGORY");
  if (company === null) throw new AdminDomainError("NOT_FOUND");
  const canton = item.canton.length === 0 ? null : await transaction.canton.findFirst({ where: { isActive: true, OR: [{ code: item.canton.toUpperCase() }, { slug: slugify(item.canton) }, { name: { equals: item.canton, mode: "insensitive" } }] }, select: { id: true } });
  const city = canton === null || item.city.length === 0 ? null : await transaction.city.findFirst({ where: { cantonId: canton.id, isActive: true, OR: [{ slug: slugify(item.city) }, { name: { equals: item.city, mode: "insensitive" } }] }, select: { id: true } });
  if (canton === null || city === null) throw new AdminDomainError("INCOMPLETE");
  const jobId = randomUUID();
  const slug = createJobSlug({
    title: item.title,
    companyShortRef: company.slug,
    jobId,
  });
  const revisionId = randomUUID();
  await transaction.job.create({ data: { id: jobId, companyId, slug, status: "DRAFT", origin: "IMPORT", sourceReference: item.id, importSourceId, currentRevisionId: null, createdByUserId: actorUserId, createdAt: now, updatedAt: now } });
  const contactIsUrl = item.application_url.length > 0;
  const contactIsEmail = !contactIsUrl && z.email().safeParse(item.contact).success;
  await transaction.jobRevision.create({ data: { id: revisionId, jobId, revisionNumber: 1, title: item.title, companyIntro: `Importierter Entwurf für ${item.company}`, description: item.description, tasks: [], requirements: item.requirements, niceToHave: item.keywords, offer: item.offer || null, applicationProcessSteps: ["Bewerbung gemäss Kontaktangaben einreichen"], requiredDocumentKinds: ["CV"], jobType: normalizeJobType(item.type), remoteType: "ONSITE", remoteCountryCode: null, categoryId: category.id, cantonId: canton.id, cityId: city.id, locationLabel: [item.zip, item.city].filter(Boolean).join(" "), workloadMin: item.workload_min, workloadMax: item.workload_max, salaryPeriod: null, salaryMin: null, salaryMax: null, startDate: null, startByArrangement: true, validThrough: null, responseTargetDays: 10, applicationEffort: "MEDIUM", inclusionStatement: null, applicationContactKind: contactIsUrl ? "APPLY_URL" : contactIsEmail ? "EMAIL" : "EMAIL", applicationContactValue: contactIsUrl ? item.application_url : contactIsEmail ? item.contact : "import@swisstalenthub.local", authoredByUserId: actorUserId, contentChecksum: checksum, version: 1, createdAt: now, updatedAt: now } });
  await transaction.job.update({ where: { id: jobId }, data: { currentRevisionId: revisionId } });
  await transaction.jobStatusEvent.create({ data: { id: randomUUID(), jobId, jobRevisionId: revisionId, kind: "DRAFT_CREATED", fromStatus: null, toStatus: "DRAFT", actorUserId, reasonCode: "IMPORT_COMMIT", idempotencyKey: `import:${importSourceId}:${item.id}:${checksum.slice(0, 16)}`, correlationId, createdAt: now } });
  return { jobId, revisionId };
}

async function hasCurrentSourceRight(transaction: Prisma.TransactionClient, importSourceId: string, companyId: string, now: Date) {
  return (await transaction.importSourceCompanyRight.count({ where: { importSourceId, companyId, revokedAt: null, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }], importSource: { isActive: true }, company: { status: { in: ["ACTIVE", "DRAFT"] } } } })) === 1;
}

export function parseLicensedFeedPayload(
  format: "XML" | "JSON",
  payload: string,
): readonly Record<string, unknown>[] {
  if (typeof payload !== "string" || Buffer.byteLength(payload, "utf8") > MAX_IMPORT_BYTES) {
    throw new Error("IMPORT_SIZE");
  }
  return format === "JSON" ? parseJsonFeed(payload) : parseXmlFeed(payload);
}

function parseJsonFeed(payload: string): readonly Record<string, unknown>[] {
  const value: unknown = JSON.parse(payload);
  const rows = Array.isArray(value) ? value : typeof value === "object" && value !== null && Array.isArray((value as { jobs?: unknown }).jobs) ? (value as { jobs: unknown[] }).jobs : [];
  if (rows.length === 0 || rows.length > MAX_IMPORT_ITEMS || rows.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) throw new Error("INVALID_JSON_FEED");
  return rows as Record<string, unknown>[];
}

function parseXmlFeed(payload: string): readonly Record<string, unknown>[] {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|xinclude/iu.test(payload)) throw new Error("UNSAFE_XML");
  const stack: string[] = [];
  let maximumDepth = 0;
  for (const token of payload.matchAll(/<\/?([A-Za-z_][\w.-]*)(?:\s[^<>]*?)?\s*\/?>/gu)) {
    const raw = token[0];
    const name = (token[1] ?? "").toLowerCase();
    if (raw.startsWith("</")) {
      if (stack.pop() !== name) throw new Error("XML_STRUCTURE");
    } else if (!raw.endsWith("/>")) {
      stack.push(name);
      maximumDepth = Math.max(maximumDepth, stack.length);
    }
    if (maximumDepth > MAX_XML_DEPTH) throw new Error("XML_DEPTH");
  }
  if (stack.length !== 0) throw new Error("XML_STRUCTURE");
  const rows = [...payload.matchAll(/<(job|item)\b[^>]*>([\s\S]*?)<\/\1>/giu)].map((match) => {
    const row: Record<string, unknown> = {};
    for (const field of LICENSED_FEED_FIELDS) {
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const fieldMatch = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "iu").exec(match[2] ?? "");
      if (fieldMatch !== null) row[field] = decodeXmlText(fieldMatch[1] ?? "");
    }
    return row;
  });
  if (rows.length === 0 || rows.length > MAX_IMPORT_ITEMS) throw new Error("INVALID_XML_FEED");
  return rows;
}

function normalizeRecord(record: Record<string, unknown>) {
  return normalizedItemSchema.safeParse({
    id: record.id, company: record.company, title: record.title, workplace_country: record.workplace_country ?? "CH", zip: record.zip ?? "", city: record.city ?? "", canton: record.canton ?? "", description: record.description, requirements: listValue(record.requirements), offer: record.offer ?? "", contact: record.contact ?? "", application_url: record.application_url ?? "", type: record.type ?? "PERMANENT", workload_min: record.workload_min ?? 80, workload_max: record.workload_max ?? 100, keywords: listValue(record.keywords),
  });
}

function listValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_VALUES).map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(/\r?\n|[,;|]/u).map((entry) => entry.trim()).filter(Boolean).slice(0, MAX_ARRAY_VALUES);
}

function decodeXmlText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, "&").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function boundedString(value: unknown, fallback: string, maximum: number) { const text = typeof value === "string" ? value.trim() : fallback; return text.slice(0, maximum) || fallback; }
function sha256(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function normalizeJobType(value: string): "PERMANENT" | "TEMPORARY" | "FREELANCE" | "INTERNSHIP" | "APPRENTICESHIP" | "HOLIDAY_JOB" { const normalized = value.trim().toUpperCase(); return (["PERMANENT", "TEMPORARY", "FREELANCE", "INTERNSHIP", "APPRENTICESHIP", "HOLIDAY_JOB"] as const).find((kind) => kind === normalized) ?? "PERMANENT"; }
