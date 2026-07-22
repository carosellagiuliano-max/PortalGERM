import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { CLUSTER_LAUNCH_POLICY_V1 } from "@/lib/seo/cluster-launch-policy";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MINIMUM_CLUSTER_BODY_WORDS = 80;

const PUBLIC_CLUSTER_CONTENT_SELECT = {
  id: true,
  slug: true,
  canonicalPath: true,
  locale: true,
  type: true,
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
} as const satisfies Prisma.ContentPageSelect;

type PublicClusterContentRow = Prisma.ContentPageGetPayload<{
  select: typeof PUBLIC_CLUSTER_CONTENT_SELECT;
}>;

export type PublicClusterContent = Readonly<{
  id: string;
  canonicalPath: string;
  title: string;
  description: string;
  paragraphs: readonly string[];
  publishedAt: Date;
  lastModified: Date;
}>;

export type PublicClusterAggregateFacts =
  | Readonly<{
      kind: "pair";
      evaluatedAt: Date;
      eligibleJobCount: number;
      activeEmployerCount: number;
      activeCandidateCount: number;
      responseRateBasisPoints: number;
    }>
  | Readonly<{
      kind: "dimension";
      passingChildCount: number;
    }>;

export type PublicClusterLanding = Readonly<{
  kind: "canton" | "category" | "pair";
  canonicalPath: string;
  canton: Readonly<{ id: string; code: string; name: string; slug: string }> | null;
  category: Readonly<{ id: string; name: string; slug: string }> | null;
  content: PublicClusterContent | null;
  indexable: boolean;
  activeAssessmentId: string | null;
  passingChildCount: number;
  aggregateFacts: PublicClusterAggregateFacts | null;
}>;

type ClusterLandingInput =
  | Readonly<{ kind: "canton"; cantonSlug: string }>
  | Readonly<{ kind: "category"; categorySlug: string }>
  | Readonly<{
      kind: "pair";
      cantonSlug: string;
      categorySlug: string;
    }>;

export async function loadPublicClusterLanding(
  input: ClusterLandingInput,
  options: Readonly<{ now?: Date; database?: DatabaseClient }> = {},
): Promise<PublicClusterLanding | null> {
  const now = validNow(options.now);
  const database = options.database ?? getDatabase();
  if (
    ("cantonSlug" in input && !isSafeSlug(input.cantonSlug)) ||
    ("categorySlug" in input && !isSafeSlug(input.categorySlug))
  ) {
    return null;
  }
  const [canton, category] = await Promise.all([
    "cantonSlug" in input
      ? database.canton.findFirst({
          where: {
            ...(isUuid(input.cantonSlug)
              ? { id: input.cantonSlug }
              : { slug: input.cantonSlug }),
            isActive: true,
          },
          select: { id: true, code: true, name: true, slug: true },
        })
      : Promise.resolve(null),
    "categorySlug" in input
      ? database.category.findFirst({
          where: {
            ...(isUuid(input.categorySlug)
              ? { id: input.categorySlug }
              : { slug: input.categorySlug }),
            isActive: true,
          },
          select: { id: true, name: true, slug: true },
        })
      : Promise.resolve(null),
  ]);
  if (
    ("cantonSlug" in input && canton === null) ||
    ("categorySlug" in input && category === null)
  ) {
    return null;
  }

  const canonicalPath = clusterCanonicalPath(
    input.kind === "canton"
      ? { kind: "canton", cantonSlug: canton!.slug }
      : input.kind === "category"
      ? { kind: "category", categorySlug: category!.slug }
      : {
          kind: "pair",
          cantonSlug: canton!.slug,
          categorySlug: category!.slug,
        },
  );
  const content = await loadCurrentClusterContent(database, canonicalPath, now);
  if (input.kind === "pair") {
    const assessment = await loadEffectivePairAssessment(
      database,
      canton!.id,
      category!.id,
      now,
    );
    return Object.freeze({
      kind: input.kind,
      canonicalPath,
      canton,
      category,
      content,
      indexable: content !== null && assessment !== null,
      activeAssessmentId: assessment?.id ?? null,
      passingChildCount: assessment === null || content === null ? 0 : 1,
      aggregateFacts: assessment === null
        ? null
        : Object.freeze({
            kind: "pair",
            evaluatedAt: new Date(assessment.evaluatedAt),
            eligibleJobCount: assessment.liveJobCount,
            activeEmployerCount: assessment.activeEmployerCount,
            activeCandidateCount: assessment.activeCandidateCount,
            responseRateBasisPoints: assessment.responseRateBasisPoints,
          }),
    });
  }

  const passingChildren = await loadPassingChildren(
    database,
    input.kind,
    input.kind === "canton" ? canton!.id : category!.id,
    now,
  );
  return Object.freeze({
    kind: input.kind,
    canonicalPath,
    canton,
    category,
    content,
    indexable: content !== null && passingChildren.length > 0,
    activeAssessmentId: null,
    passingChildCount: passingChildren.length,
    aggregateFacts: Object.freeze({
      kind: "dimension",
      passingChildCount: passingChildren.length,
    }),
  });
}

export async function isClusterIndexable(
  cantonId: string,
  categoryId: string,
  now: Date,
  database: DatabaseClient = getDatabase(),
): Promise<boolean> {
  if (!isUuid(cantonId) || !isUuid(categoryId) || !isValidDate(now)) return false;
  const pair = await database.$transaction(
    async (transaction) => {
      const [catalog, assessment] = await Promise.all([
        Promise.all([
          transaction.canton.findFirst({
            where: { id: cantonId, isActive: true },
            select: { slug: true },
          }),
          transaction.category.findFirst({
            where: { id: categoryId, isActive: true },
            select: { slug: true },
          }),
        ]),
        loadEffectivePairAssessment(transaction, cantonId, categoryId, now),
      ]);
      const [canton, category] = catalog;
      if (canton === null || category === null || assessment === null) return null;
      const content = await loadCurrentClusterContent(
        transaction,
        `/jobs/kanton/${canton.slug}/kategorie/${category.slug}`,
        now,
      );
      return content === null ? null : assessment.id;
    },
    { isolationLevel: "RepeatableRead" },
  );
  return pair !== null;
}

export async function listIndexableClusterLandings(
  now: Date,
  database: DatabaseClient = getDatabase(),
): Promise<readonly Readonly<{ path: string; lastModified: Date }>[] > {
  if (!isValidDate(now)) return Object.freeze([]);
  const assessments = await database.clusterLaunchAssessment.findMany({
    where: effectiveAssessmentWhere(now),
    orderBy: [{ evaluatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      cantonId: true,
      categoryId: true,
      canton: { select: { slug: true } },
      category: { select: { slug: true } },
      ...assessmentMetricSelect,
    },
  });
  const effective = assessments.filter(isEffectiveAssessmentSnapshot);
  const pairPaths = effective.map(({ canton, category }) =>
    `/jobs/kanton/${canton.slug}/kategorie/${category.slug}`
  );
  const cantonPaths = [...new Set(effective.map(({ canton }) =>
    `/jobs/kanton/${canton.slug}`
  ))];
  const categoryPaths = [...new Set(effective.map(({ category }) =>
    `/jobs/kategorie/${category.slug}`
  ))];
  const candidatePaths = [...pairPaths, ...cantonPaths, ...categoryPaths];
  if (candidatePaths.length === 0) return Object.freeze([]);
  const contents = await database.contentPage.findMany({
    where: {
      canonicalPath: { in: candidatePaths },
      ...clusterContentWhere(now),
    },
    select: PUBLIC_CLUSTER_CONTENT_SELECT,
  });
  const current = new Map(
    contents.flatMap((row) => {
      const content = projectClusterContent(row, row.canonicalPath, now);
      return content === null ? [] : [[row.canonicalPath, content] as const];
    }),
  );
  const passingPairs = new Set(pairPaths.filter((path) => current.has(path)));
  const paths = [
    ...passingPairs,
    ...cantonPaths.filter((path) =>
      current.has(path) && [...passingPairs].some((pair) => pair.startsWith(`${path}/kategorie/`))
    ),
    ...categoryPaths.filter((path) =>
      current.has(path) && [...passingPairs].some((pair) => pair.endsWith(`/kategorie/${path.split("/").at(-1)}`))
    ),
  ];
  return Object.freeze(
    [...new Set(paths)]
      .sort()
      .map((path) => Object.freeze({
        path,
        lastModified: new Date(current.get(path)!.lastModified),
      })),
  );
}

async function loadPassingChildren(
  database: DatabaseClient | Prisma.TransactionClient,
  kind: "canton" | "category",
  dimensionId: string,
  now: Date,
): Promise<readonly string[]> {
  const assessments = await database.clusterLaunchAssessment.findMany({
    where: {
      ...effectiveAssessmentWhere(now),
      ...(kind === "canton" ? { cantonId: dimensionId } : { categoryId: dimensionId }),
    },
    select: {
      id: true,
      canton: { select: { slug: true } },
      category: { select: { slug: true } },
      ...assessmentMetricSelect,
    },
  });
  const paths = assessments
    .filter(isEffectiveAssessmentSnapshot)
    .map(({ canton, category }) =>
      `/jobs/kanton/${canton.slug}/kategorie/${category.slug}`
    );
  if (paths.length === 0) return Object.freeze([]);
  const contents = await database.contentPage.findMany({
    where: { canonicalPath: { in: paths }, ...clusterContentWhere(now) },
    select: PUBLIC_CLUSTER_CONTENT_SELECT,
  });
  return Object.freeze(
    contents.flatMap((row) =>
      projectClusterContent(row, row.canonicalPath, now) === null
        ? []
        : [row.canonicalPath]
    ),
  );
}

async function loadCurrentClusterContent(
  database: DatabaseClient | Prisma.TransactionClient,
  canonicalPath: string,
  now: Date,
): Promise<PublicClusterContent | null> {
  const row = await database.contentPage.findFirst({
    where: { canonicalPath, ...clusterContentWhere(now) },
    select: PUBLIC_CLUSTER_CONTENT_SELECT,
  });
  return row === null ? null : projectClusterContent(row, canonicalPath, now);
}

async function loadEffectivePairAssessment(
  database: DatabaseClient | Prisma.TransactionClient,
  cantonId: string,
  categoryId: string,
  now: Date,
) {
  const assessment = await database.clusterLaunchAssessment.findFirst({
    where: { cantonId, categoryId, ...effectiveAssessmentWhere(now) },
    orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
    select: { id: true, ...assessmentMetricSelect },
  });
  return assessment !== null && isEffectiveAssessmentSnapshot(assessment)
    ? assessment
    : null;
}

const assessmentMetricSelect = {
  evaluatedAt: true,
  liveJobCount: true,
  activeCandidateCount: true,
  activeEmployerCount: true,
  responseRateBasisPoints: true,
  contentCoverageBasisPoints: true,
  medianApplicationsTimes2: true,
} as const;

function effectiveAssessmentWhere(now: Date): Prisma.ClusterLaunchAssessmentWhereInput {
  return {
    policyVersion: CLUSTER_LAUNCH_POLICY_V1.version,
    status: "ACTIVATED",
    dataProvenance: "LIVE",
    canton: { is: { isActive: true } },
    category: { is: { isActive: true } },
    evaluatedAt: { lte: now },
    validUntil: { gt: now },
    activatedAt: { lte: now },
    productApprovedAt: { not: null },
    opsApprovedAt: { not: null },
  };
}

function isEffectiveAssessmentSnapshot(value: Readonly<{
  liveJobCount: number;
  activeCandidateCount: number;
  activeEmployerCount: number;
  responseRateBasisPoints: number;
  contentCoverageBasisPoints: number;
  medianApplicationsTimes2: number;
}>): boolean {
  return value.liveJobCount >= CLUSTER_LAUNCH_POLICY_V1.minimumLiveJobs &&
    value.activeCandidateCount >= CLUSTER_LAUNCH_POLICY_V1.minimumActiveCandidates &&
    value.activeEmployerCount >= CLUSTER_LAUNCH_POLICY_V1.minimumActiveEmployers &&
    value.medianApplicationsTimes2 >= CLUSTER_LAUNCH_POLICY_V1.minimumMedianApplicationsTimes2 &&
    value.responseRateBasisPoints >= CLUSTER_LAUNCH_POLICY_V1.minimumResponseRateBasisPoints &&
    value.contentCoverageBasisPoints >= CLUSTER_LAUNCH_POLICY_V1.minimumContentCoverageBasisPoints;
}

function clusterContentWhere(now: Date): Prisma.ContentPageWhereInput {
  return {
    locale: "de-CH",
    type: "CLUSTER",
    dataProvenance: "LIVE",
    currentPublishedRevisionId: { not: null },
    currentPublishedRevision: {
      is: {
        status: "PUBLISHED",
        reviewedAt: { not: null },
        publishedAt: { lte: now },
      },
    },
  };
}

function projectClusterContent(
  row: PublicClusterContentRow,
  canonicalPath: string,
  now: Date,
): PublicClusterContent | null {
  const revision = row.currentPublishedRevision;
  if (
    row.canonicalPath !== canonicalPath ||
    row.locale !== "de-CH" ||
    row.type !== "CLUSTER" ||
    row.dataProvenance !== "LIVE" ||
    revision === null ||
    row.currentPublishedRevisionId !== revision.id ||
    revision.contentPageId !== row.id ||
    revision.status !== "PUBLISHED" ||
    !isValidDate(revision.reviewedAt) ||
    !isValidDate(revision.publishedAt) ||
    revision.publishedAt > now
  ) {
    return null;
  }
  const title = stripUnsafeHtml(revision.title);
  const description = stripUnsafeHtml(revision.excerpt);
  const paragraphs = revision.body
    .split(/(?:\r?\n\s*){2,}/u)
    .map(stripUnsafeHtml)
    .filter(Boolean);
  const wordCount = paragraphs.join(" ").split(/\s+/u).filter(Boolean).length;
  if (
    title.length === 0 ||
    description.length === 0 ||
    wordCount < MINIMUM_CLUSTER_BODY_WORDS
  ) {
    return null;
  }
  return Object.freeze({
    id: row.id,
    canonicalPath,
    title,
    description,
    paragraphs: Object.freeze(paragraphs),
    publishedAt: new Date(revision.publishedAt),
    lastModified: new Date(row.updatedAt),
  });
}

export function clusterCanonicalPath(input: ClusterLandingInput): string {
  if (input.kind === "canton") return `/jobs/kanton/${input.cantonSlug}`;
  if (input.kind === "category") return `/jobs/kategorie/${input.categorySlug}`;
  return `/jobs/kanton/${input.cantonSlug}/kategorie/${input.categorySlug}`;
}

function isSafeSlug(value: string): boolean {
  return value.length <= 160 && SLUG_PATTERN.test(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!isValidDate(now)) throw new TypeError("A valid cluster clock is required.");
  return new Date(now);
}
