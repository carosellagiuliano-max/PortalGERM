import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
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
import type { AdminCapability } from "@/lib/admin/capabilities";
import { CLUSTER_LAUNCH_POLICY_V1 } from "@/lib/seo/cluster-launch-policy";

export async function listAdminContent(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_CONTENT_MANAGE")) return null;
  const [pages, assessments, cantons, categories] = await Promise.all([
    dependencies.database.contentPage.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 200, select: { id: true, slug: true, locale: true, type: true, canonicalPath: true, currentPublishedRevisionId: true, updatedAt: true, revisions: { orderBy: [{ revisionNumber: "desc" }], take: 1, select: { id: true, revisionNumber: true, status: true, title: true, version: true, createdAt: true } } } }),
    dependencies.database.clusterLaunchAssessment.findMany({ orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, policyVersion: true, evaluatedAt: true, validUntil: true, status: true, liveJobCount: true, activeCandidateCount: true, activeEmployerCount: true, responseRateBasisPoints: true, contentCoverageBasisPoints: true, medianApplicationsTimes2: true, evidenceHash: true, evidenceWindowStart: true, evidenceWindowEnd: true, canton: { select: { name: true, code: true } }, category: { select: { name: true } } } }),
    dependencies.database.canton.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true } }),
    dependencies.database.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  return Object.freeze({ pages, assessments, cantons, categories });
}

export async function getAdminContentPage(dependencies: AdminDependencies, pageId: string) {
  if (!requireCapability(dependencies, "ADMIN_CONTENT_MANAGE") || !z.uuid().safeParse(pageId).success) return null;
  return dependencies.database.contentPage.findUnique({ where: { id: pageId }, select: { id: true, slug: true, locale: true, type: true, canonicalPath: true, currentPublishedRevisionId: true, dataProvenance: true, revisions: { orderBy: [{ revisionNumber: "desc" }], select: { id: true, revisionNumber: true, status: true, title: true, excerpt: true, body: true, contentHash: true, version: true, reviewedAt: true, publishedAt: true, createdAt: true } }, events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, actorUserId: true, reasonCode: true, createdAt: true } } } });
}

const draftSchema = z.strictObject({
  pageId: z.uuid().optional(),
  slug: z.string().trim().min(1).max(220),
  locale: z.string().trim().min(2).max(16).default("de-CH"),
  type: z.enum(["GUIDE", "CLUSTER"]),
  canonicalPath: z.string().trim().min(2).max(500),
  title: z.string().trim().min(3).max(220),
  excerpt: z.string().trim().min(10).max(500),
  body: z.string().trim().min(20).max(100_000),
  idempotencyKey: z.uuid(),
});

export function sanitizeAdminMarkdown(value: string): string {
  return value
    .replace(/\u0000/gu, "")
    .replace(/<\/?[A-Za-z][^>]*>/gu, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\((?!https?:\/\/|\/)[^)]+\)/giu, "$1")
    .replace(/javascript\s*:/giu, "")
    .replace(/(?:\r?\n){4,}/gu, "\n\n\n")
    .trim();
}

export async function saveContentDraft(raw: unknown, dependencies: AdminDependencies) {
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CONTENT_MANAGE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const body = sanitizeAdminMarkdown(parsed.data.body);
  if (body.length < 20 || /<script|onerror\s*=|javascript\s*:/iu.test(body)) return adminFailure("INVALID_INPUT");
  const canonicalSlug = slugify(parsed.data.slug);
  const expectedPath = parsed.data.type === "GUIDE" ? `/guide/${canonicalSlug}` : parsed.data.canonicalPath;
  if (parsed.data.canonicalPath !== expectedPath || !parsed.data.canonicalPath.startsWith("/")) return adminFailure("INVALID_INPUT");
  const eventKey = operationKey("admin-content-draft", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const replay = await transaction.contentEvent.findUnique({ where: { idempotencyKey: eventKey }, select: { contentPageId: true, contentRevisionId: true, contentRevision: { select: { revisionNumber: true, status: true } } } });
      if (replay !== null) return adminSuccess({ pageId: replay.contentPageId, revisionId: replay.contentRevisionId, revisionNumber: replay.contentRevision.revisionNumber, status: replay.contentRevision.status }, true);
      let pageId = parsed.data.pageId;
      let revisionNumber = 1;
      if (pageId === undefined) {
        const page = await transaction.contentPage.create({ data: { id: randomUUID(), slug: canonicalSlug, locale: parsed.data.locale, type: parsed.data.type, canonicalPath: parsed.data.canonicalPath, createdAt: now, updatedAt: now } });
        pageId = page.id;
      } else {
        await transaction.$queryRaw`SELECT "id" FROM "ContentPage" WHERE "id" = ${pageId}::uuid FOR UPDATE`;
        const page = await transaction.contentPage.findUnique({ where: { id: pageId }, select: { id: true, slug: true, locale: true, type: true, canonicalPath: true, revisions: { orderBy: [{ revisionNumber: "desc" }], take: 1, select: { revisionNumber: true } } } });
        if (page === null || page.slug !== canonicalSlug || page.locale !== parsed.data.locale || page.type !== parsed.data.type || page.canonicalPath !== parsed.data.canonicalPath) return adminFailure("CONFLICT");
        revisionNumber = (page.revisions[0]?.revisionNumber ?? 0) + 1;
      }
      const contentHash = hashContent({ title: parsed.data.title, excerpt: parsed.data.excerpt, body });
      const revision = await transaction.contentRevision.create({ data: { id: randomUUID(), contentPageId: pageId, revisionNumber, status: "DRAFT", title: parsed.data.title, excerpt: parsed.data.excerpt, body, authoredByUserId: dependencies.actor.userId, contentHash, version: 1, createdAt: now } });
      await transaction.contentPage.update({ where: { id: pageId }, data: { updatedAt: now } });
      await transaction.contentEvent.create({ data: { id: randomUUID(), contentPageId: pageId, contentRevisionId: revision.id, kind: "DRAFTED", actorUserId: dependencies.actor.userId, reasonCode: "CONTENT_DRAFT_CREATED", correlationId: dependencies.correlationId, idempotencyKey: eventKey, createdAt: now } });
      await writeAdminAudit(transaction, dependencies, now, { action: "CONTENT_DRAFTED", capability: "ADMIN_CONTENT_MANAGE", targetType: "CONTENT_REVISION", targetId: revision.id, reasonCode: "CONTENT_DRAFT_CREATED" });
      return adminSuccess({ pageId, revisionId: revision.id, revisionNumber, status: "DRAFT" as const });
    }, { isolationLevel: "Serializable" });
  } catch (error) { return adminErrorResult(error); }
}

const lifecycleSchema = z.strictObject({ revisionId: z.uuid(), expectedVersion: z.coerce.number().int().positive(), action: z.enum(["SUBMIT", "APPROVE", "REJECT", "PUBLISH", "UNPUBLISH"]), reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u), idempotencyKey: z.uuid() });

export async function transitionContentRevision(raw: unknown, dependencies: AdminDependencies) {
  const parsed = lifecycleSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CONTENT_MANAGE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey(`admin-content-${parsed.data.action.toLowerCase()}`, parsed.data.idempotencyKey);
  const rule = parsed.data.action === "SUBMIT" ? { from: "DRAFT" as const, to: "IN_REVIEW" as const, kind: "SUBMITTED_FOR_REVIEW" as const, audit: "CONTENT_REVIEWED" as const }
    : parsed.data.action === "APPROVE" ? { from: "IN_REVIEW" as const, to: "APPROVED" as const, kind: "APPROVED" as const, audit: "CONTENT_REVIEWED" as const }
      : parsed.data.action === "REJECT" ? { from: "IN_REVIEW" as const, to: "REJECTED" as const, kind: "REJECTED" as const, audit: "CONTENT_REVIEWED" as const }
        : parsed.data.action === "PUBLISH" ? { from: "APPROVED" as const, to: "PUBLISHED" as const, kind: "PUBLISHED" as const, audit: "CONTENT_PUBLISHED" as const }
          : { from: "PUBLISHED" as const, to: "UNPUBLISHED" as const, kind: "UNPUBLISHED" as const, audit: "CONTENT_UNPUBLISHED" as const };
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ContentRevision" WHERE "id" = ${parsed.data.revisionId}::uuid FOR UPDATE`;
      const revision = await transaction.contentRevision.findUnique({ where: { id: parsed.data.revisionId }, select: { id: true, contentPageId: true, status: true, version: true, contentPage: { select: { currentPublishedRevisionId: true } }, events: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } } } });
      if (revision === null) return adminFailure("NOT_FOUND");
      if (revision.events.length > 0 && revision.status === rule.to) return adminSuccess({ revisionId: revision.id, status: rule.to, version: revision.version }, true);
      if (revision.status !== rule.from || revision.version !== parsed.data.expectedVersion) return adminFailure("CONFLICT");
      if (parsed.data.action === "UNPUBLISH" && revision.contentPage.currentPublishedRevisionId !== revision.id) return adminFailure("CONFLICT");
      const changed = await transaction.contentRevision.updateMany({ where: { id: revision.id, status: rule.from, version: revision.version }, data: { status: rule.to, version: { increment: 1 }, ...(parsed.data.action === "APPROVE" ? { reviewedAt: now } : {}), ...(parsed.data.action === "PUBLISH" ? { publishedAt: now } : {}) } });
      if (changed.count !== 1) throw new AdminDomainError("CONFLICT");
      if (parsed.data.action === "PUBLISH") await transaction.contentPage.update({ where: { id: revision.contentPageId }, data: { currentPublishedRevisionId: revision.id, updatedAt: now } });
      if (parsed.data.action === "UNPUBLISH") {
        await transaction.contentPage.update({ where: { id: revision.contentPageId }, data: { currentPublishedRevisionId: null, updatedAt: now } });
      }
      await transaction.contentEvent.create({ data: { id: randomUUID(), contentPageId: revision.contentPageId, contentRevisionId: revision.id, kind: rule.kind, actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, correlationId: dependencies.correlationId, idempotencyKey: eventKey, createdAt: now } });
      await writeAdminAudit(transaction, dependencies, now, { action: rule.audit, capability: "ADMIN_CONTENT_MANAGE", targetType: "CONTENT_REVISION", targetId: revision.id, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ revisionId: revision.id, status: rule.to, version: revision.version + 1 });
    }, { isolationLevel: "Serializable" });
  } catch (error) { return adminErrorResult(error); }
}

export async function getClusterAssessmentDetail(dependencies: AdminDependencies, assessmentId: string) {
  if (!requireCapability(dependencies, "ADMIN_CONTENT_MANAGE") || !z.uuid().safeParse(assessmentId).success) return null;
  return dependencies.database.clusterLaunchAssessment.findUnique({ where: { id: assessmentId }, select: { id: true, policyVersion: true, evaluatedAt: true, evidenceWindowStart: true, evidenceWindowEnd: true, liveJobCount: true, activeCandidateCount: true, activeEmployerCount: true, responseRateBasisPoints: true, contentCoverageBasisPoints: true, medianApplicationsTimes2: true, dataProvenance: true, evidenceHash: true, validUntil: true, status: true, productApprovedByUserId: true, productApprovedAt: true, opsApprovedByUserId: true, opsApprovedAt: true, activatedAt: true, revokedAt: true, canton: { select: { code: true, name: true } }, category: { select: { name: true, slug: true } }, events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, reasonCode: true, createdAt: true } } } });
}

const clusterActionSchema = z.strictObject({ assessmentId: z.uuid(), action: z.enum(["PRODUCT_APPROVE", "OPS_APPROVE", "ACTIVATE", "REVOKE"]), reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u), idempotencyKey: z.uuid() });
const namedClusterActionSchema = clusterActionSchema.omit({ action: true });

export async function approveClusterForProduct(raw: unknown, dependencies: AdminDependencies) {
  return namedClusterTransition(raw, "PRODUCT_APPROVE", dependencies);
}

export async function approveClusterForOps(raw: unknown, dependencies: AdminDependencies) {
  return namedClusterTransition(raw, "OPS_APPROVE", dependencies);
}

export async function activateCluster(raw: unknown, dependencies: AdminDependencies) {
  return namedClusterTransition(raw, "ACTIVATE", dependencies);
}

export async function revokeCluster(raw: unknown, dependencies: AdminDependencies) {
  return namedClusterTransition(raw, "REVOKE", dependencies);
}

async function namedClusterTransition(raw: unknown, action: "PRODUCT_APPROVE" | "OPS_APPROVE" | "ACTIVATE" | "REVOKE", dependencies: AdminDependencies) {
  const parsed = namedClusterActionSchema.safeParse(raw);
  return parsed.success
    ? transitionClusterLaunch({ ...parsed.data, action }, dependencies)
    : adminFailure("INVALID_INPUT");
}

export async function transitionClusterLaunch(raw: unknown, dependencies: AdminDependencies) {
  const parsed = clusterActionSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  const capability: AdminCapability = parsed.data.action === "PRODUCT_APPROVE" ? "ADMIN_CLUSTER_PRODUCT_APPROVE" : parsed.data.action === "OPS_APPROVE" ? "ADMIN_CLUSTER_OPS_APPROVE" : "ADMIN_CLUSTER_ACTIVATE";
  if (!requireCapability(dependencies, capability)) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey(`admin-cluster-${parsed.data.action.toLowerCase()}`, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ClusterLaunchAssessment" WHERE "id" = ${parsed.data.assessmentId}::uuid FOR UPDATE`;
      const assessment = await transaction.clusterLaunchAssessment.findUnique({ where: { id: parsed.data.assessmentId }, select: { id: true, cantonId: true, categoryId: true, policyVersion: true, status: true, dataProvenance: true, evaluatedAt: true, validUntil: true, liveJobCount: true, activeCandidateCount: true, activeEmployerCount: true, responseRateBasisPoints: true, contentCoverageBasisPoints: true, medianApplicationsTimes2: true, productApprovedAt: true, opsApprovedAt: true, events: { where: { correlationId: eventKey }, take: 1, select: { id: true } } } });
      if (assessment === null) return adminFailure("NOT_FOUND");
      if (assessment.events.length > 0) return adminSuccess({ assessmentId: assessment.id, status: assessment.status }, true);
      if (parsed.data.action === "ACTIVATE" && assessment.status === "ACTIVATED") return adminSuccess({ assessmentId: assessment.id, status: assessment.status }, true);
      if (parsed.data.action === "REVOKE" && assessment.status === "REVOKED") return adminSuccess({ assessmentId: assessment.id, status: assessment.status }, true);
      let status = assessment.status;
      let kind: "PRODUCT_APPROVED" | "OPS_APPROVED" | "ACTIVATED" | "REVOKED";
      let data: Prisma.ClusterLaunchAssessmentUpdateInput;
      if (parsed.data.action === "PRODUCT_APPROVE") {
        if (status !== "READY" || assessment.productApprovedAt !== null) return adminFailure("CONFLICT");
        kind = "PRODUCT_APPROVED"; data = { productApprovedByUserId: dependencies.actor.userId, productApprovedAt: now };
      } else if (parsed.data.action === "OPS_APPROVE") {
        if (status !== "READY" || assessment.opsApprovedAt !== null) return adminFailure("CONFLICT");
        kind = "OPS_APPROVED"; data = { opsApprovedByUserId: dependencies.actor.userId, opsApprovedAt: now };
      } else if (parsed.data.action === "ACTIVATE") {
        if (status !== "READY" || assessment.policyVersion !== CLUSTER_LAUNCH_POLICY_V1.version || assessment.dataProvenance !== "LIVE" || assessment.evaluatedAt > now || assessment.validUntil <= now || assessment.productApprovedAt === null || assessment.opsApprovedAt === null || !clusterMetricsPass(assessment)) return adminFailure("CONFLICT");
        const superseded = await transaction.clusterLaunchAssessment.findFirst({ where: { id: { not: assessment.id }, cantonId: assessment.cantonId, categoryId: assessment.categoryId, policyVersion: assessment.policyVersion, status: "ACTIVATED" }, select: { id: true } });
        if (superseded !== null) {
          await transaction.clusterLaunchAssessment.update({ where: { id: superseded.id }, data: { status: "REVOKED", revokedAt: now, revokeReason: "SUPERSEDED_BY_NEW_ASSESSMENT" } });
          await transaction.clusterLaunchEvent.create({ data: { id: randomUUID(), clusterLaunchAssessmentId: superseded.id, kind: "REVOKED", actorUserId: dependencies.actor.userId, reasonCode: "SUPERSEDED_BY_NEW_ASSESSMENT", correlationId: `${eventKey}:supersede`.slice(0, 128), createdAt: now } });
        }
        kind = "ACTIVATED"; status = "ACTIVATED"; data = { status, activatedAt: now, activationReason: parsed.data.reasonCode };
      } else {
        if (status !== "ACTIVATED") return adminFailure("CONFLICT");
        kind = "REVOKED"; status = "REVOKED"; data = { status, revokedAt: now, revokeReason: parsed.data.reasonCode };
      }
      await transaction.clusterLaunchAssessment.update({ where: { id: assessment.id }, data });
      await transaction.clusterLaunchEvent.create({ data: { id: randomUUID(), clusterLaunchAssessmentId: assessment.id, kind, actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, correlationId: eventKey, createdAt: now } });
      const auditAction = parsed.data.action === "ACTIVATE" ? "CLUSTER_ACTIVATED" as const : parsed.data.action === "REVOKE" ? "CLUSTER_REVOKED" as const : "CLUSTER_ASSESSMENT_APPROVED" as const;
      await writeAdminAudit(transaction, dependencies, now, { action: auditAction, capability, targetType: "CLUSTER_LAUNCH_ASSESSMENT", targetId: assessment.id, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ assessmentId: assessment.id, status });
    }, { isolationLevel: "Serializable" });
  } catch (error) { return adminErrorResult(error); }
}

const clusterExpirySchema = z.strictObject({ idempotencyKey: z.uuid() });

export async function projectExpiredClusterLaunches(raw: unknown, dependencies: AdminDependencies) {
  const parsed = clusterExpirySchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CLUSTER_ACTIVATE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const prefix = operationKey("admin-cluster-expire", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const due = await transaction.clusterLaunchAssessment.findMany({ where: { status: "ACTIVATED", validUntil: { lte: now } }, orderBy: [{ validUntil: "asc" }, { id: "asc" }], take: 500, select: { id: true } });
      let projectedCount = 0;
      for (const assessment of due) {
        await transaction.$queryRaw`SELECT "id" FROM "ClusterLaunchAssessment" WHERE "id" = ${assessment.id}::uuid FOR UPDATE`;
        const changed = await transaction.clusterLaunchAssessment.updateMany({ where: { id: assessment.id, status: "ACTIVATED", validUntil: { lte: now } }, data: { status: "EXPIRED" } });
        if (changed.count === 0) continue;
        await transaction.clusterLaunchEvent.create({ data: { id: randomUUID(), clusterLaunchAssessmentId: assessment.id, kind: "EXPIRED", actorUserId: dependencies.actor.userId, reasonCode: "ASSESSMENT_VALIDITY_ELAPSED", correlationId: `${prefix}:${assessment.id}`.slice(0, 128), createdAt: now } });
        projectedCount += 1;
      }
      return adminSuccess({ projectedCount });
    }, { isolationLevel: "Serializable" });
  } catch (error) { return adminErrorResult(error); }
}

function hashContent(value: Readonly<{ title: string; excerpt: string; body: string }>) { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }

function clusterMetricsPass(value: Readonly<{ liveJobCount: number; activeCandidateCount: number; activeEmployerCount: number; responseRateBasisPoints: number; contentCoverageBasisPoints: number; medianApplicationsTimes2: number }>) {
  return value.liveJobCount >= CLUSTER_LAUNCH_POLICY_V1.minimumLiveJobs && value.activeCandidateCount >= CLUSTER_LAUNCH_POLICY_V1.minimumActiveCandidates && value.activeEmployerCount >= CLUSTER_LAUNCH_POLICY_V1.minimumActiveEmployers && value.responseRateBasisPoints >= CLUSTER_LAUNCH_POLICY_V1.minimumResponseRateBasisPoints && value.contentCoverageBasisPoints >= CLUSTER_LAUNCH_POLICY_V1.minimumContentCoverageBasisPoints && value.medianApplicationsTimes2 >= CLUSTER_LAUNCH_POLICY_V1.minimumMedianApplicationsTimes2;
}
