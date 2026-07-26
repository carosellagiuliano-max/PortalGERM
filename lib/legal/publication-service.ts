import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/lib/generated/prisma/client";
import { z } from "zod";

import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminSuccess,
  requireCapability,
  writeAdminAudit,
  type AdminCommandResult,
  type AdminDependencies,
} from "@/lib/admin/common";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

const localeSchema = z.enum(["de-CH", "fr-CH", "it-CH", "en-CH"]);
const documentTypeSchema = z.enum([
  "PRIVACY",
  "TERMS",
  "IMPRINT",
  "COOKIE",
  "ANALYTICS",
  "AVG_NOTICE",
  "DPA",
  "DSFA",
]);
const reasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u);
const uuidSchema = z.string().uuid();

const draftSchema = z
  .object({
    type: documentTypeSchema,
    locale: localeSchema.default("de-CH"),
    title: z.string().trim().min(3).max(200),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(96),
    versionLabel: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u),
    contentMarkdown: z.string().trim().min(80).max(100_000),
    changeSummary: z.string().trim().min(3).max(1000),
    requiresReconsent: z.boolean(),
  })
  .strict();

const reviewSchema = z
  .object({
    revisionId: uuidSchema,
    approve: z.boolean(),
    reasonCode: reasonCodeSchema,
  })
  .strict();

const publishSchema = z
  .object({
    revisionId: uuidSchema,
    effectiveAt: z.date(),
    expiresAt: z.date().nullable().default(null),
    reasonCode: reasonCodeSchema,
  })
  .strict();

const revokeSchema = z
  .object({
    publicationId: uuidSchema,
    reasonCode: reasonCodeSchema,
  })
  .strict();

export type LegalPublicationView = Readonly<{
  publicationId: string;
  documentType: z.infer<typeof documentTypeSchema>;
  locale: string;
  slug: string;
  title: string;
  versionLabel: string;
  contentMarkdown: string;
  contentHash: string;
  publicationHash: string;
  requiresReconsent: boolean;
  effectiveAt: Date;
  expiresAt: Date | null;
}>;

export async function createLegalDraft(
  input: unknown,
  dependencies: AdminDependencies,
): Promise<AdminCommandResult<Readonly<{ revisionId: string }>>> {
  if (!requireCapability(dependencies, "ADMIN_LEGAL_DRAFT")) {
    return adminFailure("FORBIDDEN");
  }
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  const contentMarkdown = normalizeLegalMarkdown(parsed.data.contentMarkdown);
  if (contentMarkdown.length < 80) return adminFailure("INVALID_INPUT");
  const contentHash = hashLegalContent(contentMarkdown);
  const now = adminNow(dependencies.now);

  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const document = await transaction.legalDocument.upsert({
        where: {
          type_locale: {
            type: parsed.data.type,
            locale: parsed.data.locale,
          },
        },
        update: {
          title: parsed.data.title,
          updatedAt: now,
        },
        create: {
          type: parsed.data.type,
          locale: parsed.data.locale,
          slug: parsed.data.slug,
          title: parsed.data.title,
          updatedAt: now,
        },
        select: { id: true, slug: true },
      });
      if (document.slug !== parsed.data.slug) return adminFailure("CONFLICT");

      await lockLegalDocument(transaction, document.id);
      const replay = await transaction.legalRevision.findFirst({
        where: {
          legalDocumentId: document.id,
          versionLabel: parsed.data.versionLabel,
        },
        select: { id: true, contentHash: true },
      });
      if (replay !== null) {
        return replay.contentHash === contentHash
          ? adminSuccess({ revisionId: replay.id }, true)
          : adminFailure("CONFLICT");
      }
      const last = await transaction.legalRevision.aggregate({
        where: { legalDocumentId: document.id },
        _max: { revisionNumber: true },
      });
      const revision = await transaction.legalRevision.create({
        data: {
          legalDocumentId: document.id,
          revisionNumber: (last._max.revisionNumber ?? 0) + 1,
          versionLabel: parsed.data.versionLabel,
          contentMarkdown,
          contentHash,
          changeSummary: parsed.data.changeSummary,
          requiresReconsent: parsed.data.requiresReconsent,
          createdByUserId: dependencies.actor.userId,
          createdAt: now,
        },
        select: { id: true },
      });
      return adminSuccess({ revisionId: revision.id });
    }, transactionOptions());
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function reviewLegalRevision(
  input: unknown,
  dependencies: AdminDependencies,
): Promise<AdminCommandResult<Readonly<{ revisionId: string; status: string }>>> {
  if (!requireCapability(dependencies, "ADMIN_LEGAL_REVIEW")) {
    return adminFailure("FORBIDDEN");
  }
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  const now = adminNow(dependencies.now);

  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const revision = await lockLegalRevision(transaction, parsed.data.revisionId);
      if (revision === null) return adminFailure("NOT_FOUND");
      if (revision.createdByUserId === dependencies.actor.userId) {
        return adminFailure("RESTRICTED");
      }
      const targetStatus = parsed.data.approve ? "APPROVED" : "REJECTED";
      if (revision.status === targetStatus) {
        return adminSuccess(
          { revisionId: revision.id, status: targetStatus },
          true,
        );
      }
      if (!["DRAFT", "IN_REVIEW"].includes(revision.status)) {
        return adminFailure("CONFLICT");
      }
      const updated = await transaction.legalRevision.update({
        where: { id: revision.id },
        data: {
          status: targetStatus,
          reviewedByUserId: dependencies.actor.userId,
          reviewedAt: now,
        },
        select: { id: true, status: true },
      });
      await writeAdminAudit(transaction, dependencies, now, {
        action: "LEGAL_REVISION_REVIEWED",
        capability: "ADMIN_LEGAL_REVIEW",
        targetType: "LEGAL_DOCUMENT",
        targetId: revision.legalDocumentId,
        reasonCode: parsed.data.reasonCode,
      });
      return adminSuccess({ revisionId: updated.id, status: updated.status });
    }, transactionOptions());
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function publishLegalRevision(
  input: unknown,
  dependencies: AdminDependencies,
): Promise<AdminCommandResult<Readonly<{ publicationId: string }>>> {
  if (!requireCapability(dependencies, "ADMIN_LEGAL_PUBLISH")) {
    return adminFailure("FORBIDDEN");
  }
  const parsed = publishSchema.safeParse(input);
  if (
    !parsed.success ||
    !Number.isFinite(parsed.data.effectiveAt.getTime()) ||
    (parsed.data.expiresAt !== null &&
      (!Number.isFinite(parsed.data.expiresAt.getTime()) ||
        parsed.data.expiresAt <= parsed.data.effectiveAt))
  ) {
    return adminFailure("INVALID_INPUT");
  }
  const now = adminNow(dependencies.now);

  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const revision = await lockLegalRevision(transaction, parsed.data.revisionId);
      if (revision === null) return adminFailure("NOT_FOUND");
      if (
        revision.status !== "APPROVED" ||
        revision.reviewedByUserId === null ||
        revision.createdByUserId === dependencies.actor.userId ||
        revision.reviewedByUserId === dependencies.actor.userId
      ) {
        return adminFailure("RESTRICTED");
      }
      await lockLegalDocument(transaction, revision.legalDocumentId);
      const replay = await transaction.legalPublication.findUnique({
        where: { legalRevisionId: revision.id },
        select: { id: true },
      });
      if (replay !== null) return adminSuccess({ publicationId: replay.id }, true);

      await transaction.legalPublication.updateMany({
        where: {
          legalDocumentId: revision.legalDocumentId,
          status: "CURRENT",
        },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokeReasonCode: "SUPERSEDED",
        },
      });
      const publication = await transaction.legalPublication.create({
        data: {
          legalDocumentId: revision.legalDocumentId,
          legalRevisionId: revision.id,
          publicationHash: revision.contentHash,
          publishedByUserId: dependencies.actor.userId,
          effectiveAt: parsed.data.effectiveAt,
          expiresAt: parsed.data.expiresAt,
          createdAt: now,
        },
        select: { id: true },
      });
      await writeAdminAudit(transaction, dependencies, now, {
        action: "LEGAL_PUBLICATION_PUBLISHED",
        capability: "ADMIN_LEGAL_PUBLISH",
        targetType: "LEGAL_PUBLICATION",
        targetId: publication.id,
        reasonCode: parsed.data.reasonCode,
      });
      return adminSuccess({ publicationId: publication.id });
    }, transactionOptions());
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function revokeLegalPublication(
  input: unknown,
  dependencies: AdminDependencies,
): Promise<AdminCommandResult<Readonly<{ publicationId: string }>>> {
  if (!requireCapability(dependencies, "ADMIN_LEGAL_PUBLISH")) {
    return adminFailure("FORBIDDEN");
  }
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const publication = await transaction.legalPublication.findUnique({
        where: { id: parsed.data.publicationId },
        select: { id: true, status: true },
      });
      if (publication === null) return adminFailure("NOT_FOUND");
      if (publication.status === "REVOKED") {
        return adminSuccess({ publicationId: publication.id }, true);
      }
      if (publication.status !== "CURRENT") return adminFailure("CONFLICT");
      await transaction.legalPublication.update({
        where: { id: publication.id },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokeReasonCode: parsed.data.reasonCode,
        },
      });
      await writeAdminAudit(transaction, dependencies, now, {
        action: "LEGAL_PUBLICATION_REVOKED",
        capability: "ADMIN_LEGAL_PUBLISH",
        targetType: "LEGAL_PUBLICATION",
        targetId: publication.id,
        reasonCode: parsed.data.reasonCode,
      });
      return adminSuccess({ publicationId: publication.id });
    }, transactionOptions());
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function getCurrentLegalPublication(
  slug: string,
  database: AdminDependencies["database"],
  now = new Date(),
): Promise<LegalPublicationView | null> {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) ||
    !Number.isFinite(now.getTime())
  ) {
    return null;
  }
  const publication = await database.legalPublication.findFirst({
    where: {
      status: "CURRENT",
      effectiveAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      legalDocument: { slug },
    },
    select: {
      id: true,
      publicationHash: true,
      effectiveAt: true,
      expiresAt: true,
      legalDocument: {
        select: { type: true, locale: true, slug: true, title: true },
      },
      legalRevision: {
        select: {
          versionLabel: true,
          contentMarkdown: true,
          contentHash: true,
          requiresReconsent: true,
        },
      },
    },
  });
  if (
    publication === null ||
    publication.publicationHash !== publication.legalRevision.contentHash
  ) {
    return null;
  }
  return Object.freeze({
    publicationId: publication.id,
    documentType: publication.legalDocument.type,
    locale: publication.legalDocument.locale,
    slug: publication.legalDocument.slug,
    title: publication.legalDocument.title,
    versionLabel: publication.legalRevision.versionLabel,
    contentMarkdown: publication.legalRevision.contentMarkdown,
    contentHash: publication.legalRevision.contentHash,
    publicationHash: publication.publicationHash,
    requiresReconsent: publication.legalRevision.requiresReconsent,
    effectiveAt: publication.effectiveAt,
    expiresAt: publication.expiresAt,
  });
}

export function hashLegalContent(contentMarkdown: string) {
  return createHash("sha256")
    .update(normalizeLegalMarkdown(contentMarkdown), "utf8")
    .digest("hex");
}

export function normalizeLegalMarkdown(value: string) {
  return stripUnsafeHtml(value)
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

async function lockLegalDocument(
  transaction: Prisma.TransactionClient,
  documentId: string,
) {
  await transaction.$queryRaw`
    SELECT "id"
      FROM "LegalDocument"
     WHERE "id" = ${documentId}::uuid
     FOR UPDATE
  `;
}

async function lockLegalRevision(
  transaction: Prisma.TransactionClient,
  revisionId: string,
) {
  const rows = await transaction.$queryRaw<
    Array<{
      id: string;
      legalDocumentId: string;
      status: string;
      contentHash: string;
      createdByUserId: string;
      reviewedByUserId: string | null;
    }>
  >`
    SELECT
      "id",
      "legalDocumentId",
      "status"::text AS "status",
      "contentHash",
      "createdByUserId",
      "reviewedByUserId"
    FROM "LegalRevision"
    WHERE "id" = ${revisionId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function transactionOptions() {
  return {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 15_000,
    timeout: 15_000,
  } as const;
}
