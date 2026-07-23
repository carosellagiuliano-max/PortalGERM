import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import { slugify } from "@/lib/utils/slug";
import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminSuccess,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";
import { trimmedString } from "@/lib/validation/common";

export const TAXONOMY_ENTITY_TYPES = ["CATEGORY", "CANTON", "CITY", "SKILL", "OCCUPATION_VERSION", "OCCUPATION_CODE"] as const;
export type TaxonomyEntityType = (typeof TAXONOMY_ENTITY_TYPES)[number];

export async function getAdminTaxonomyCatalog(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_TAXONOMY_MANAGE")) return null;
  const [categories, cantons, cities, skills, occupationVersions] = await Promise.all([
    dependencies.database.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, parentId: true, name: true, slug: true, isActive: true, sortOrder: true } }),
    dependencies.database.canton.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, slug: true, language: true, isActive: true, sortOrder: true } }),
    dependencies.database.city.findMany({ orderBy: [{ canton: { code: "asc" } }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, cantonId: true, name: true, slug: true, isActive: true, sortOrder: true, canton: { select: { code: true } } } }),
    dependencies.database.skill.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true, isActive: true, sortOrder: true } }),
    dependencies.database.occupationCodeVersion.findMany({ orderBy: [{ validFrom: "desc" }, { id: "desc" }], select: { id: true, datasetKey: true, datasetYear: true, version: true, source: true, referenceUrl: true, disclaimer: true, validFrom: true, validTo: true, codes: { orderBy: [{ code: "asc" }], select: { id: true, code: true, label: true, result: true, effectiveFrom: true, effectiveTo: true } } } }),
  ]);
  return Object.freeze({ categories, cantons, cities, skills, occupationVersions });
}

const baseSchema = z.strictObject({
  entityType: z.enum(TAXONOMY_ENTITY_TYPES),
  entityId: z.uuid().optional(),
  action: z.enum(["CREATE", "UPDATE", "ACTIVATE", "DEACTIVATE"]),
  name: trimmedString(1, 255).optional(),
  slug: trimmedString(0, 160).optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
  parentId: z.uuid().nullable().optional(),
  cantonId: z.uuid().optional(),
  code: trimmedString(1, 32).optional(),
  language: z.enum(["DE", "FR", "IT", "EN"]).optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  datasetKey: trimmedString(2, 64).optional(),
  datasetYear: z.coerce.number().int().min(1900).max(2200).optional(),
  version: trimmedString(1, 32).optional(),
  source: trimmedString(3, 500).optional(),
  referenceUrl: z.url().max(1000).nullable().optional(),
  disclaimer: trimmedString(3, 1000).optional(),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().nullable().optional(),
  occupationCodeVersionId: z.uuid().optional(),
  result: z.enum(["REQUIRES_REPORTING", "NOT_REQUIRED", "UNKNOWN"]).optional(),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  idempotencyKey: z.uuid(),
});

export async function mutateAdminTaxonomy(raw: unknown, dependencies: AdminDependencies) {
  const parsed = baseSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_TAXONOMY_MANAGE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const replay = await transaction.auditLog.findFirst({ where: { action: "TAXONOMY_CHANGED", correlationId: parsed.data.idempotencyKey }, select: { targetId: true } });
      if (replay !== null) return adminSuccess({ entityId: replay.targetId, entityType: parsed.data.entityType }, true);
      const entityId = await persistTaxonomyMutation(transaction, parsed.data, now);
      await writeAdminAudit(transaction, { ...dependencies, correlationId: parsed.data.idempotencyKey }, now, { action: "TAXONOMY_CHANGED", capability: "ADMIN_TAXONOMY_MANAGE", targetType: "TAXONOMY", targetId: entityId, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ entityId, entityType: parsed.data.entityType });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

async function persistTaxonomyMutation(
  transaction: Prisma.TransactionClient,
  input: z.infer<typeof baseSchema>,
  now: Date,
): Promise<string> {
  const activation = input.action === "ACTIVATE" ? true : input.action === "DEACTIVATE" ? false : undefined;
  if (input.entityType === "CATEGORY") {
    if (input.action === "CREATE") {
      if (input.name === undefined) throw new Error("INVALID_INPUT");
      return (await transaction.category.create({ data: { id: randomUUID(), name: input.name, slug: canonicalSlug(input.slug, input.name), parentId: input.parentId ?? null, sortOrder: input.sortOrder ?? 0, isActive: true, createdAt: now, updatedAt: now }, select: { id: true } })).id;
    }
    const id = requireId(input.entityId);
    const current = await transaction.category.findUnique({ where: { id }, select: { id: true } });
    if (current === null) throw new Error("NOT_FOUND");
    await transaction.category.update({ where: { id }, data: { ...(input.name === undefined ? {} : { name: input.name }), ...(input.slug === undefined ? {} : { slug: canonicalSlug(input.slug, input.name ?? input.slug) }), ...(input.parentId === undefined ? {} : { parentId: input.parentId }), ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }), ...(activation === undefined ? {} : { isActive: activation }), updatedAt: now } });
    return id;
  }
  if (input.entityType === "CANTON") {
    if (input.action === "CREATE") {
      if (input.name === undefined || input.code === undefined || input.language === undefined) throw new Error("INVALID_INPUT");
      return (await transaction.canton.create({ data: { id: randomUUID(), name: input.name, code: input.code.toUpperCase(), slug: canonicalSlug(input.slug, input.name), language: input.language, sortOrder: input.sortOrder ?? 0, isActive: true, createdAt: now, updatedAt: now }, select: { id: true } })).id;
    }
    const id = requireId(input.entityId);
    await transaction.canton.update({ where: { id }, data: { ...(input.name === undefined ? {} : { name: input.name }), ...(input.slug === undefined ? {} : { slug: canonicalSlug(input.slug, input.name ?? input.slug) }), ...(input.code === undefined ? {} : { code: input.code.toUpperCase() }), ...(input.language === undefined ? {} : { language: input.language }), ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }), ...(activation === undefined ? {} : { isActive: activation }), updatedAt: now } });
    return id;
  }
  if (input.entityType === "CITY") {
    if (input.action === "CREATE") {
      if (input.name === undefined || input.cantonId === undefined) throw new Error("INVALID_INPUT");
      return (await transaction.city.create({ data: { id: randomUUID(), name: input.name, cantonId: input.cantonId, slug: canonicalSlug(input.slug, input.name), latitude: input.latitude, longitude: input.longitude, sortOrder: input.sortOrder ?? 0, isActive: true, createdAt: now, updatedAt: now }, select: { id: true } })).id;
    }
    const id = requireId(input.entityId);
    await transaction.city.update({ where: { id }, data: { ...(input.name === undefined ? {} : { name: input.name }), ...(input.slug === undefined ? {} : { slug: canonicalSlug(input.slug, input.name ?? input.slug) }), ...(input.cantonId === undefined ? {} : { cantonId: input.cantonId }), ...(input.latitude === undefined ? {} : { latitude: input.latitude }), ...(input.longitude === undefined ? {} : { longitude: input.longitude }), ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }), ...(activation === undefined ? {} : { isActive: activation }), updatedAt: now } });
    return id;
  }
  if (input.entityType === "SKILL") {
    if (input.action === "CREATE") {
      if (input.name === undefined) throw new Error("INVALID_INPUT");
      return (await transaction.skill.create({ data: { id: randomUUID(), name: input.name, slug: canonicalSlug(input.slug, input.name), sortOrder: input.sortOrder ?? 0, isActive: true, createdAt: now }, select: { id: true } })).id;
    }
    const id = requireId(input.entityId);
    await transaction.skill.update({ where: { id }, data: { ...(input.name === undefined ? {} : { name: input.name }), ...(input.slug === undefined ? {} : { slug: canonicalSlug(input.slug, input.name ?? input.slug) }), ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }), ...(activation === undefined ? {} : { isActive: activation }) } });
    return id;
  }
  if (input.entityType === "OCCUPATION_VERSION") {
    if (input.action === "CREATE") {
      if (input.datasetKey === undefined || input.datasetYear === undefined || input.version === undefined || input.source === undefined || input.disclaimer === undefined || input.validFrom === undefined) throw new Error("INVALID_INPUT");
      return (await transaction.occupationCodeVersion.create({ data: { id: randomUUID(), datasetKey: input.datasetKey, datasetYear: input.datasetYear, version: input.version, source: input.source, referenceUrl: input.referenceUrl ?? null, disclaimer: input.disclaimer, validFrom: input.validFrom, validTo: input.validTo ?? null, createdAt: now }, select: { id: true } })).id;
    }
    const id = requireId(input.entityId);
    await transaction.occupationCodeVersion.update({ where: { id }, data: { ...(input.source === undefined ? {} : { source: input.source }), ...(input.referenceUrl === undefined ? {} : { referenceUrl: input.referenceUrl }), ...(input.disclaimer === undefined ? {} : { disclaimer: input.disclaimer }), ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }), ...(input.validTo === undefined ? {} : { validTo: input.validTo }), ...(input.action === "DEACTIVATE" ? { validTo: now } : {}) } });
    return id;
  }
  if (input.action === "CREATE") {
    if (input.occupationCodeVersionId === undefined || input.code === undefined || input.name === undefined || input.result === undefined) throw new Error("INVALID_INPUT");
    return (await transaction.occupationCode.create({ data: { id: randomUUID(), occupationCodeVersionId: input.occupationCodeVersionId, code: input.code, label: input.name, result: input.result, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo }, select: { id: true } })).id;
  }
  const id = requireId(input.entityId);
  await transaction.occupationCode.update({ where: { id }, data: { ...(input.code === undefined ? {} : { code: input.code }), ...(input.name === undefined ? {} : { label: input.name }), ...(input.result === undefined ? {} : { result: input.result }), ...(input.effectiveFrom === undefined ? {} : { effectiveFrom: input.effectiveFrom }), ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }), ...(input.action === "DEACTIVATE" ? { effectiveTo: now } : {}) } });
  return id;
}

function requireId(value: string | undefined): string {
  if (value === undefined) throw new Error("INVALID_INPUT");
  return value;
}

function canonicalSlug(value: string | undefined, fallback: string): string {
  const slug = slugify(value === undefined || value.length === 0 ? fallback : value);
  if (slug.length === 0 || slug.length > 160) throw new Error("INVALID_INPUT");
  return slug;
}
