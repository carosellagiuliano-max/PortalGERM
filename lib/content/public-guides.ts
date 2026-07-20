import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { DataProvenance } from "@/lib/generated/prisma/enums";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  getPublicDataContext,
  type PublicDataContext,
} from "@/lib/public/environment";
import type { PublicGuideModel } from "@/lib/public/types";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

const DEFAULT_RELATED_GUIDE_LIMIT = 3;
const MAXIMUM_GUIDE_LIST_LIMIT = 100;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const PUBLIC_GUIDE_SELECT = {
  id: true,
  slug: true,
  locale: true,
  type: true,
  canonicalPath: true,
  dataProvenance: true,
  currentPublishedRevisionId: true,
  currentPublishedRevision: {
    select: {
      id: true,
      contentPageId: true,
      status: true,
      title: true,
      excerpt: true,
      body: true,
      reviewedAt: true,
      publishedAt: true,
    },
  },
} as const satisfies Prisma.ContentPageSelect;

type PublicGuideRow = Prisma.ContentPageGetPayload<{
  select: typeof PUBLIC_GUIDE_SELECT;
}>;

export type PublicGuideSnapshot = Readonly<{
  id: string;
  slug: string;
  locale: string;
  type: string;
  canonicalPath: string;
  dataProvenance: DataProvenance;
  currentPublishedRevisionId: string | null;
  revision: Readonly<{
    id: string;
    contentPageId: string;
    status: string;
    title: string;
    excerpt: string;
    body: string;
    reviewedAt: Date | null;
    publishedAt: Date | null;
  }> | null;
}>;

type PublicGuideLoadOptions = Readonly<{
  now?: Date;
  database?: DatabaseClient;
}>;

/**
 * The sole public Guide eligibility/projection policy. It verifies revision
 * identity as well as publication state before returning the allowlisted model.
 */
export function evaluatePublicGuideEligibility(
  snapshot: PublicGuideSnapshot | null,
  now: Date,
  context: Pick<PublicDataContext, "liveOnly">,
): PublicGuideModel | null {
  if (snapshot === null || snapshot.revision === null || !isValidDate(now)) {
    return null;
  }
  const revision = snapshot.revision;
  if (
    snapshot.locale !== "de-CH" ||
    snapshot.type !== "GUIDE" ||
    !isSafeSlug(snapshot.slug) ||
    !isAllowedCanonicalPath(snapshot.canonicalPath, snapshot.slug) ||
    snapshot.currentPublishedRevisionId !== revision.id ||
    revision.contentPageId !== snapshot.id ||
    revision.status !== "PUBLISHED" ||
    !isValidDate(revision.reviewedAt) ||
    !isValidDate(revision.publishedAt) ||
    revision.publishedAt.getTime() > now.getTime() ||
    (context.liveOnly && snapshot.dataProvenance !== "LIVE")
  ) {
    return null;
  }

  const title = stripUnsafeHtml(revision.title);
  const excerpt = stripUnsafeHtml(revision.excerpt);
  const body = sanitizePublicGuideBody(revision.body);
  if (title.length === 0 || excerpt.length === 0 || body.length === 0) {
    return null;
  }

  return Object.freeze({
    id: snapshot.id,
    slug: snapshot.slug,
    canonicalPath: `/guide/${snapshot.slug}`,
    title,
    excerpt,
    body,
    publishedAt: new Date(revision.publishedAt),
    dataProvenance: snapshot.dataProvenance,
  });
}

function sanitizePublicGuideBody(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/(?:p|div|li|blockquote|h[1-6])\s*>/giu, "\n\n")
    .split(/(?:\r?\n\s*){2,}/u)
    .map((paragraph) => stripUnsafeHtml(paragraph))
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}

export async function listPublicGuides(
  options: PublicGuideLoadOptions & Readonly<{ limit?: number }> = {},
): Promise<readonly PublicGuideModel[]> {
  const limit = validLimit(options.limit, MAXIMUM_GUIDE_LIST_LIMIT);
  const now = validNow(options.now);
  const database = options.database ?? getDatabase();
  const context = getPublicDataContext();
  const rows = await database.contentPage.findMany({
    where: publicGuideWhere(now, context),
    select: PUBLIC_GUIDE_SELECT,
    orderBy: [
      { currentPublishedRevision: { publishedAt: "desc" } },
      { slug: "asc" },
      { id: "asc" },
    ],
    take: MAXIMUM_GUIDE_LIST_LIMIT,
  });
  return Object.freeze(
    rows
      .flatMap((row) => {
        const guide = evaluatePublicGuideEligibility(toSnapshot(row), now, context);
        return guide === null ? [] : [guide];
      })
      .sort(compareGuides)
      .slice(0, limit),
  );
}

export async function getPublicGuideBySlug(
  slug: string,
  options: PublicGuideLoadOptions = {},
): Promise<PublicGuideModel | null> {
  if (!isSafeSlug(slug)) return null;
  const now = validNow(options.now);
  const database = options.database ?? getDatabase();
  const context = getPublicDataContext();
  const row = await database.contentPage.findFirst({
    where: { slug, ...publicGuideWhere(now, context) },
    select: PUBLIC_GUIDE_SELECT,
  });
  return row === null
    ? null
    : evaluatePublicGuideEligibility(toSnapshot(row), now, context);
}

export async function listRelatedPublicGuides(
  guide: Pick<PublicGuideModel, "id">,
  options: PublicGuideLoadOptions & Readonly<{ limit?: number }> = {},
): Promise<readonly PublicGuideModel[]> {
  const limit = validLimit(options.limit, 12, DEFAULT_RELATED_GUIDE_LIMIT);
  const guides = await listPublicGuides({
    now: options.now,
    database: options.database,
    limit: MAXIMUM_GUIDE_LIST_LIMIT,
  });
  return selectRelatedPublicGuides(guides, guide.id, limit);
}

export function selectRelatedPublicGuides(
  guides: readonly PublicGuideModel[],
  currentGuideId: string,
  limit = DEFAULT_RELATED_GUIDE_LIMIT,
): readonly PublicGuideModel[] {
  const boundedLimit = validLimit(limit, 12, DEFAULT_RELATED_GUIDE_LIMIT);
  const seen = new Set<string>();
  const related = [...guides]
    .sort(compareGuides)
    .filter((guide) => {
      if (guide.id === currentGuideId || seen.has(guide.id)) return false;
      seen.add(guide.id);
      return true;
    })
    .slice(0, boundedLimit);
  return Object.freeze(related);
}

function publicGuideWhere(
  now: Date,
  context: Pick<PublicDataContext, "liveOnly">,
): Prisma.ContentPageWhereInput {
  return {
    locale: "de-CH",
    type: "GUIDE",
    currentPublishedRevisionId: { not: null },
    ...(context.liveOnly ? { dataProvenance: "LIVE" as const } : {}),
    currentPublishedRevision: {
      is: {
        status: "PUBLISHED",
        reviewedAt: { not: null },
        publishedAt: { lte: now },
      },
    },
  };
}

function toSnapshot(row: PublicGuideRow): PublicGuideSnapshot {
  return {
    id: row.id,
    slug: row.slug,
    locale: row.locale,
    type: row.type,
    canonicalPath: row.canonicalPath,
    dataProvenance: row.dataProvenance,
    currentPublishedRevisionId: row.currentPublishedRevisionId,
    revision: row.currentPublishedRevision,
  };
}

function compareGuides(left: PublicGuideModel, right: PublicGuideModel): number {
  const byPublication = right.publishedAt.getTime() - left.publishedAt.getTime();
  if (byPublication !== 0) return byPublication;
  if (left.slug < right.slug) return -1;
  if (left.slug > right.slug) return 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function isSafeSlug(value: string): boolean {
  return value.length <= 220 && SLUG_PATTERN.test(value);
}

function isAllowedCanonicalPath(path: string, slug: string): boolean {
  return path === `/guide/${slug}` || path === `/ratgeber/${slug}`;
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!isValidDate(now)) {
    throw new TypeError("A valid public Guide clock is required.");
  }
  return new Date(now);
}

function validLimit(value: number | undefined, maximum: number, fallback = maximum) {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new RangeError(`Public Guide limit must be between 1 and ${maximum}.`);
  }
  return limit;
}
