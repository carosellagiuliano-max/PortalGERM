import "server-only";

import type { MetadataRoute } from "next";

import {
  evaluatePublicCompanyEligibility,
  projectPublicCompanyCard,
  type PublicCompanyCardProjectionSource,
} from "@/lib/companies/public-read-model";
import {
  evaluatePublicGuideEligibility,
  type PublicGuideSnapshot,
} from "@/lib/content/public-guides";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { filterPubliclyEligibleJobsInTransaction } from "@/lib/jobs/public-eligibility";
import { listIndexableClusterLandings } from "@/lib/seo/cluster-indexability";

export const MAXIMUM_SINGLE_SITEMAP_URLS = 50_000;

export const PUBLIC_SITEMAP_STATIC_PATHS = Object.freeze([
  "/",
  "/jobs",
  "/companies",
  "/salary-radar",
  "/guide",
  "/pricing",
  "/employers",
  "/employers/post-job",
  "/employers/talent-radar",
  "/employers/employer-branding",
  "/employers/xml-import",
] as const);

const SITEMAP_SCAN_BATCH_SIZE = 500;
const SITEMAP_TRANSACTION_TIMEOUT_MS = 30_000;
const SAFE_SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const DYNAMIC_PATH_PATTERNS = Object.freeze({
  job: new RegExp(`^/jobs/${SAFE_SLUG}$`, "u"),
  company: new RegExp(`^/companies/${SAFE_SLUG}$`, "u"),
  guide: new RegExp(`^/guide/${SAFE_SLUG}$`, "u"),
  cluster: new RegExp(
    `^/jobs/(?:kanton/${SAFE_SLUG}(?:/kategorie/${SAFE_SLUG})?|kategorie/${SAFE_SLUG})$`,
    "u",
  ),
});

type DynamicSitemapKind = keyof typeof DYNAMIC_PATH_PATTERNS;

export type PublicSitemapRow = Readonly<{
  path: string;
  lastModified: Date;
}>;

export type PublicSitemapSources = Readonly<{
  listJobs: (
    now: Date,
    database: DatabaseClient,
    maximumEntries: number,
  ) => Promise<readonly PublicSitemapRow[]>;
  listCompanies: (
    now: Date,
    database: DatabaseClient,
    maximumEntries: number,
  ) => Promise<readonly PublicSitemapRow[]>;
  listGuides: (
    now: Date,
    database: DatabaseClient,
    maximumEntries: number,
  ) => Promise<readonly PublicSitemapRow[]>;
  listClusters: (
    now: Date,
    database: DatabaseClient,
    maximumEntries: number,
  ) => Promise<readonly PublicSitemapRow[]>;
}>;

const DEFAULT_SITEMAP_SOURCES: PublicSitemapSources = Object.freeze({
  listJobs: listEligibleJobSitemapRows,
  listCompanies: listEligibleCompanySitemapRows,
  listGuides: listEligibleGuideSitemapRows,
  listClusters: listEligibleClusterSitemapRows,
});

export class PublicSitemapCapacityError extends RangeError {
  constructor(maximumUrls: number) {
    super(`The public sitemap exceeds its ${maximumUrls}-URL single-file bound.`);
    this.name = "PublicSitemapCapacityError";
  }
}

export async function buildPublicSitemap(
  input: Readonly<{
    origin: string;
    now?: Date;
    database?: DatabaseClient;
    /** Test seam; production is always capped at the protocol maximum. */
    maximumUrls?: number;
    sources?: PublicSitemapSources;
  }>,
): Promise<MetadataRoute.Sitemap> {
  const origin = validOrigin(input.origin);
  const now = validNow(input.now);
  const maximumUrls = validMaximumUrls(input.maximumUrls);
  if (PUBLIC_SITEMAP_STATIC_PATHS.length > maximumUrls) {
    throw new PublicSitemapCapacityError(maximumUrls);
  }
  const database = input.database ?? getDatabase();
  const sources = input.sources ?? DEFAULT_SITEMAP_SOURCES;
  const entries: MetadataRoute.Sitemap = PUBLIC_SITEMAP_STATIC_PATHS.map(
    (path) => staticEntry(path, origin),
  );
  const seenPaths = new Set<string>(PUBLIC_SITEMAP_STATIC_PATHS);

  for (const [kind, loader] of [
    ["job", sources.listJobs],
    ["company", sources.listCompanies],
    ["guide", sources.listGuides],
    ["cluster", sources.listClusters],
  ] as const) {
    const remaining = maximumUrls - entries.length;
    const rows = await loader(new Date(now), database, remaining);
    if (rows.length > remaining) {
      throw new PublicSitemapCapacityError(maximumUrls);
    }
    for (const row of rows) {
      assertDynamicRow(row, kind);
      if (seenPaths.has(row.path)) {
        throw new Error(`Duplicate public sitemap path: ${row.path}`);
      }
      seenPaths.add(row.path);
      entries.push(dynamicEntry(row, kind, origin));
    }
  }

  return entries;
}

export async function listEligibleJobSitemapRows(
  now: Date,
  database: DatabaseClient,
  maximumEntries: number,
): Promise<readonly PublicSitemapRow[]> {
  const rows: PublicSitemapRow[] = [];
  await database.$transaction(
    async (transaction) => {
      let afterId: string | undefined;
      while (true) {
        const candidates = await transaction.job.findMany({
          where: {
            status: "PUBLISHED",
            dataProvenance: "LIVE",
            publishedAt: { lte: now },
            expiresAt: { gt: now },
            ...(afterId === undefined ? {} : { id: { gt: afterId } }),
          },
          orderBy: { id: "asc" },
          take: SITEMAP_SCAN_BATCH_SIZE,
          select: { id: true, slug: true, updatedAt: true },
        });
        if (candidates.length === 0) return;
        const eligible = await filterPubliclyEligibleJobsInTransaction(
          candidates.map(({ id }) => id),
          now,
          "production",
          transaction,
        );
        const eligibleById = new Map(eligible.map((job) => [job.id, job]));
        for (const candidate of candidates) {
          const job = eligibleById.get(candidate.id);
          if (job === undefined) continue;
          appendWithinBound(
            rows,
            {
              path: `/jobs/${job.slug}`,
              lastModified: candidate.updatedAt,
            },
            maximumEntries,
          );
        }
        if (candidates.length < SITEMAP_SCAN_BATCH_SIZE) return;
        afterId = nextScanId(afterId, candidates.at(-1)?.id);
      }
    },
    {
      isolationLevel: "RepeatableRead",
      timeout: SITEMAP_TRANSACTION_TIMEOUT_MS,
    },
  );
  return Object.freeze(rows);
}

export async function listEligibleCompanySitemapRows(
  now: Date,
  database: DatabaseClient,
  maximumEntries: number,
): Promise<readonly PublicSitemapRow[]> {
  const rows: PublicSitemapRow[] = [];
  await database.$transaction(
    async (transaction) => {
      let afterId: string | undefined;
      while (true) {
        const companies = await transaction.company.findMany({
          where: {
            status: "ACTIVE",
            dataProvenance: "LIVE",
            ...(afterId === undefined ? {} : { id: { gt: afterId } }),
          },
          orderBy: { id: "asc" },
          take: SITEMAP_SCAN_BATCH_SIZE,
          select: {
            id: true,
            slug: true,
            name: true,
            industry: true,
            size: true,
            status: true,
            dataProvenance: true,
            updatedAt: true,
            locations: {
              where: { isPrimary: true },
              orderBy: { id: "asc" },
              take: 2,
              select: {
                city: { select: { name: true } },
                canton: { select: { name: true } },
              },
            },
            verificationRequests: {
              where: { status: "VERIFIED", supersededBy: null },
              orderBy: { id: "asc" },
              take: 2,
              select: { id: true },
            },
          },
        });
        if (companies.length === 0) return;
        const pauses = await transaction.moderationRestriction.findMany({
          where: {
            targetType: "PAUSE_COMPANY",
            targetId: { in: companies.map(({ id }) => id) },
            status: "ACTIVE",
            startsAt: { lte: now },
            liftedAt: null,
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
          select: { targetId: true },
        });
        const pausedIds = new Set(pauses.map(({ targetId }) => targetId));
        for (const company of companies) {
          const source: PublicCompanyCardProjectionSource = {
            id: company.id,
            slug: company.slug,
            name: company.name,
            industry: company.industry,
            size: company.size,
            status: company.status,
            dataProvenance: company.dataProvenance,
            primaryLocations: company.locations,
            currentVerifiedCycleIds: company.verificationRequests.map(
              ({ id }) => id,
            ),
            hasEffectivePauseRestriction: pausedIds.has(company.id),
          };
          if (
            !evaluatePublicCompanyEligibility(source, "production") ||
            projectPublicCompanyCard(source, {
                environment: "production",
                enhancedProfile: false,
                openJobCount: 0,
              }) === null
          ) {
            continue;
          }
          appendWithinBound(
            rows,
            {
              path: `/companies/${company.slug}`,
              lastModified: company.updatedAt,
            },
            maximumEntries,
          );
        }
        if (companies.length < SITEMAP_SCAN_BATCH_SIZE) return;
        afterId = nextScanId(afterId, companies.at(-1)?.id);
      }
    },
    {
      isolationLevel: "RepeatableRead",
      timeout: SITEMAP_TRANSACTION_TIMEOUT_MS,
    },
  );
  return Object.freeze(rows);
}

export async function listEligibleGuideSitemapRows(
  now: Date,
  database: DatabaseClient,
  maximumEntries: number,
): Promise<readonly PublicSitemapRow[]> {
  const rows: PublicSitemapRow[] = [];
  await database.$transaction(
    async (transaction) => {
      let afterId: string | undefined;
      while (true) {
        const guides = await transaction.contentPage.findMany({
          where: {
            locale: "de-CH",
            type: "GUIDE",
            dataProvenance: "LIVE",
            currentPublishedRevisionId: { not: null },
            currentPublishedRevision: {
              is: {
                status: "PUBLISHED",
                reviewedAt: { not: null },
                publishedAt: { lte: now },
              },
            },
            ...(afterId === undefined ? {} : { id: { gt: afterId } }),
          },
          orderBy: { id: "asc" },
          take: SITEMAP_SCAN_BATCH_SIZE,
          select: {
            id: true,
            slug: true,
            locale: true,
            type: true,
            canonicalPath: true,
            dataProvenance: true,
            currentPublishedRevisionId: true,
            updatedAt: true,
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
          },
        });
        if (guides.length === 0) return;
        for (const guide of guides) {
          const projected = evaluatePublicGuideEligibility(
            toPublicGuideSnapshot(guide),
            now,
            { liveOnly: true },
          );
          if (projected === null) continue;
          appendWithinBound(
            rows,
            {
              path: projected.canonicalPath,
              lastModified: guide.updatedAt,
            },
            maximumEntries,
          );
        }
        if (guides.length < SITEMAP_SCAN_BATCH_SIZE) return;
        afterId = nextScanId(afterId, guides.at(-1)?.id);
      }
    },
    {
      isolationLevel: "RepeatableRead",
      timeout: SITEMAP_TRANSACTION_TIMEOUT_MS,
    },
  );
  return Object.freeze(rows);
}

export async function listEligibleClusterSitemapRows(
  now: Date,
  database: DatabaseClient,
  maximumEntries: number,
): Promise<readonly PublicSitemapRow[]> {
  const rows = await listIndexableClusterLandings(now, database);
  if (rows.length > maximumEntries) {
    throw new PublicSitemapCapacityError(MAXIMUM_SINGLE_SITEMAP_URLS);
  }
  return rows.map((row) => Object.freeze({
    path: row.path,
    lastModified: new Date(row.lastModified),
  }));
}

type PublicGuideSitemapRow = Prisma.ContentPageGetPayload<{
  select: {
    id: true;
    slug: true;
    locale: true;
    type: true;
    canonicalPath: true;
    dataProvenance: true;
    currentPublishedRevisionId: true;
    updatedAt: true;
    currentPublishedRevision: {
      select: {
        id: true;
        contentPageId: true;
        status: true;
        title: true;
        excerpt: true;
        body: true;
        reviewedAt: true;
        publishedAt: true;
      };
    };
  };
}>;

function toPublicGuideSnapshot(row: PublicGuideSitemapRow): PublicGuideSnapshot {
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

function appendWithinBound(
  rows: PublicSitemapRow[],
  row: PublicSitemapRow,
  maximumEntries: number,
) {
  if (rows.length >= maximumEntries) {
    throw new PublicSitemapCapacityError(MAXIMUM_SINGLE_SITEMAP_URLS);
  }
  rows.push(Object.freeze({
    path: row.path,
    lastModified: new Date(row.lastModified),
  }));
}

function nextScanId(previousId: string | undefined, nextId: string | undefined) {
  if (nextId === undefined || (previousId !== undefined && nextId <= previousId)) {
    throw new Error("Public sitemap keyset scan did not advance.");
  }
  return nextId;
}

function assertDynamicRow(row: PublicSitemapRow, kind: DynamicSitemapKind) {
  if (!DYNAMIC_PATH_PATTERNS[kind].test(row.path)) {
    throw new Error(`Invalid ${kind} sitemap path: ${row.path}`);
  }
  if (!isValidDate(row.lastModified)) {
    throw new TypeError(`Invalid lastModified for sitemap path: ${row.path}`);
  }
}

function staticEntry(path: string, origin: URL): MetadataRoute.Sitemap[number] {
  return {
    url: new URL(path, origin).toString(),
    changeFrequency: path === "/" || path === "/jobs" ? "daily" : "weekly",
    priority: path === "/"
      ? 1
      : path === "/jobs"
      ? 0.9
      : path === "/pricing"
      ? 0.8
      : 0.7,
  };
}

function dynamicEntry(
  row: PublicSitemapRow,
  kind: DynamicSitemapKind,
  origin: URL,
): MetadataRoute.Sitemap[number] {
  return {
    url: new URL(row.path, origin).toString(),
    lastModified: new Date(row.lastModified),
    changeFrequency: kind === "guide" ? "monthly" : kind === "company" ? "weekly" : "daily",
    priority: kind === "job" ? 0.8 : 0.7,
  };
}

function validOrigin(value: string): URL {
  const origin = new URL(value);
  if (
    (origin.protocol !== "https:" && origin.hostname !== "localhost") ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new TypeError("The public sitemap requires a canonical HTTP(S) origin.");
  }
  return origin;
}

function validNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!isValidDate(now)) throw new TypeError("A valid sitemap clock is required.");
  return new Date(now);
}

function validMaximumUrls(value: number | undefined): number {
  const maximum = value ?? MAXIMUM_SINGLE_SITEMAP_URLS;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > MAXIMUM_SINGLE_SITEMAP_URLS
  ) {
    throw new RangeError(
      `The public sitemap limit must be between 1 and ${MAXIMUM_SINGLE_SITEMAP_URLS}.`,
    );
  }
  return maximum;
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
