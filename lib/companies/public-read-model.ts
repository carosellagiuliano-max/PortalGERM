import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  EMPLOYER_RESPONSE_POLICY_V1,
} from "@/lib/analytics/response-policy-v1";
import {
  getEffectiveEntitlements,
  type EntitlementGrantRecord,
  type EntitlementRepository,
  type PlanVersionEntitlementSource,
  type SubscriptionEntitlementSource,
} from "@/lib/billing/entitlements";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { DataProvenance } from "@/lib/generated/prisma/enums";
import {
  getPublicDataContext,
  type PublicDataContext,
} from "@/lib/public/environment";
import type {
  PublicCompanyCardModel,
  PublicCompanyDetailModel,
  PublicCompanyDirectoryPage,
  PublicJobCardModel,
  PublicResponseEvidence,
} from "@/lib/public/types";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

export type PublicCompanyEligibilityEnvironment =
  | "production"
  | "non-production";

export type PublicCompanyEligibilitySnapshot = Readonly<{
  status: string;
  dataProvenance: DataProvenance;
  hasEffectivePauseRestriction: boolean;
}>;

export type PublicCompanyCardProjectionSource =
  PublicCompanyEligibilitySnapshot &
    Readonly<{
      id: string;
      slug: string;
      name: string;
      industry: string | null;
      size: string | null;
      primaryLocations: readonly Readonly<{
        city: Readonly<{ name: string }>;
        canton: Readonly<{ name: string }>;
      }>[];
      currentVerifiedCycleIds: readonly string[];
    }>;

type PublicCompanyEnhancedCardProjectionSource =
  PublicCompanyCardProjectionSource &
    Readonly<{
      benefits: readonly string[];
      responseTargetDays: number | null;
      responseSampleSize: number;
      responseWithinTargetBps: number | null;
    }>;

export type PublicCompanyProjectionSource =
  PublicCompanyEnhancedCardProjectionSource &
    Readonly<{
      website: string | null;
      about: string | null;
      values: readonly string[];
    }>;

export type PublicCompanyReadOptions = Readonly<{
  now?: Date;
  database?: DatabaseClient;
  dataContext?: PublicDataContext;
  /** Test seam; production callers use the guarded session secret. */
  cursorSecret?: string;
}>;

export type PublicCompanyJobsLoader = (
  companyId: string,
  options: Readonly<{ now: Date }>,
) => Promise<readonly PublicJobCardModel[]>;

export type PublicCompanyOpenJobCountLoader = (
  companyIds: readonly string[],
  options: Readonly<{ now: Date }>,
) => Promise<ReadonlyMap<string, number>>;

export type PublicCompanyDirectoryInput = Readonly<{
  query?: string;
  cantonSlug?: string;
  industry?: string;
  verifiedOnly?: boolean;
  cursor?: string;
  limit?: number;
}>;

const COMPANY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DEFAULT_DIRECTORY_LIMIT = 24;
const MAX_DIRECTORY_LIMIT = 100;
const MAX_VALUES = 12;
const MAX_BENEFITS = 20;
const MAX_CARD_BENEFITS = 3;
const MAX_VALUE_LENGTH = 240;
const MAX_CURSOR_LENGTH = 2_048;
const DIRECTORY_CURSOR_VERSION = "v1";

const UNKNOWN_RESPONSE: PublicResponseEvidence = Object.freeze({
  known: false,
  targetDays: null,
  onTimeRateBps: null,
  sampleSizeBucket: null,
});

const PUBLIC_COMPANY_CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  industry: true,
  size: true,
  status: true,
  dataProvenance: true,
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
} as const satisfies Prisma.CompanySelect;

const PUBLIC_COMPANY_DETAIL_SELECT = {
  ...PUBLIC_COMPANY_CARD_SELECT,
  website: true,
  about: true,
  values: true,
  benefits: true,
  responseTargetDays: true,
  responseSampleSize: true,
  responseWithinTargetBps: true,
} as const satisfies Prisma.CompanySelect;

const PUBLIC_COMPANY_CARD_ENHANCEMENT_SELECT = {
  id: true,
  benefits: true,
  responseTargetDays: true,
  responseSampleSize: true,
  responseWithinTargetBps: true,
} as const satisfies Prisma.CompanySelect;

type PublicCompanyCardSourceRow = Prisma.CompanyGetPayload<{
  select: typeof PUBLIC_COMPANY_CARD_SELECT;
}>;
type PublicCompanyDetailSourceRow = Prisma.CompanyGetPayload<{
  select: typeof PUBLIC_COMPANY_DETAIL_SELECT;
}>;
type PublicCompanyCardEnhancementSourceRow = Prisma.CompanyGetPayload<{
  select: typeof PUBLIC_COMPANY_CARD_ENHANCEMENT_SELECT;
}>;

type PublicCompanyDirectoryCursor = Readonly<{
  version: typeof DIRECTORY_CURSOR_VERSION;
  queryHash: string;
  name: string;
  id: string;
}>;

/** Verification is intentionally absent: it is a badge, not a visibility gate. */
export function evaluatePublicCompanyEligibility(
  snapshot: PublicCompanyEligibilitySnapshot | null,
  environment: PublicCompanyEligibilityEnvironment,
): boolean {
  return (
    snapshot !== null &&
    snapshot.status === "ACTIVE" &&
    !snapshot.hasEffectivePauseRestriction &&
    (environment !== "production" || snapshot.dataProvenance === "LIVE")
  );
}

export function projectPublicCompanyCard(
  source:
    | PublicCompanyCardProjectionSource
    | PublicCompanyProjectionSource
    | null,
  input: Readonly<{
    environment: PublicCompanyEligibilityEnvironment;
    enhancedProfile: boolean;
    openJobCount: number;
  }>,
): PublicCompanyCardModel | null {
  if (!evaluatePublicCompanyEligibility(source, input.environment) || source === null) {
    return null;
  }

  const id = boundedRequiredText(source.id, 100);
  const slug = validCompanySlug(source.slug) ? source.slug : null;
  const name = boundedRequiredText(source.name, 200);
  if (id === null || slug === null || name === null) return null;

  const location = source.primaryLocations.length === 1
    ? source.primaryLocations[0]
    : undefined;
  const openJobCount = Number.isSafeInteger(input.openJobCount) &&
      input.openJobCount >= 0
    ? input.openJobCount
    : 0;

  return Object.freeze({
    id,
    slug,
    name,
    industry: boundedOptionalText(source.industry, 160),
    size: boundedOptionalText(source.size, 64),
    city: boundedOptionalText(location?.city.name ?? null, 200),
    canton: boundedOptionalText(location?.canton.name ?? null, 200),
    verified: source.currentVerifiedCycleIds.length === 1,
    openJobCount,
    benefitsPreview:
      input.enhancedProfile && hasEnhancedCardSource(source)
        ? sanitizeList(source.benefits, MAX_CARD_BENEFITS)
        : Object.freeze([]),
    response: hasResponseEvidenceSource(source)
      ? projectPublicResponseEvidence(source, input.enhancedProfile)
      : UNKNOWN_RESPONSE,
    dataProvenance: source.dataProvenance,
  });
}

export function projectPublicCompanyDetail(
  source: PublicCompanyProjectionSource | null,
  input: Readonly<{
    environment: PublicCompanyEligibilityEnvironment;
    enhancedProfile: boolean;
    jobs: readonly PublicJobCardModel[];
  }>,
): PublicCompanyDetailModel | null {
  if (source === null) return null;

  // The caller supplies the canonical public Job read model. This module only
  // prevents accidental cross-company injection; it does not reimplement Job
  // eligibility.
  const jobs = input.jobs.filter(
    (job) => job.company.id === source.id && job.company.slug === source.slug,
  );
  const card = projectPublicCompanyCard(source, {
    environment: input.environment,
    enhancedProfile: input.enhancedProfile,
    openJobCount: jobs.length,
  });
  if (card === null) return null;

  return Object.freeze({
    ...card,
    website: safePublicWebsite(source.website),
    about: boundedOptionalText(source.about, 5_000),
    values: input.enhancedProfile
      ? sanitizeList(source.values, MAX_VALUES)
      : Object.freeze([]),
    benefits: input.enhancedProfile
      ? sanitizeList(source.benefits, MAX_BENEFITS)
      : Object.freeze([]),
    enhancedProfile: input.enhancedProfile,
    jobs: Object.freeze([...jobs]),
  });
}

/** Any resolution error, ambiguity or repository failure hides paid fields. */
export async function hasEnhancedCompanyProfileAccess(
  companyId: string,
  now: Date,
  repository: EntitlementRepository,
): Promise<boolean> {
  if (boundedRequiredText(companyId, 100) === null || !isValidDate(now)) {
    return false;
  }

  try {
    const result = await getEffectiveEntitlements(companyId, now, repository);
    return result.ok &&
      result.value.companyId === companyId &&
      result.value.rights.ENHANCED_COMPANY_PROFILE === true;
  } catch {
    return false;
  }
}

export async function listPublicCompanies(
  input: PublicCompanyDirectoryInput,
  loadOpenJobCounts: PublicCompanyOpenJobCountLoader,
  options: PublicCompanyReadOptions = {},
): Promise<readonly PublicCompanyCardModel[]> {
  const page = await listPublicCompanyDirectory(
    input,
    loadOpenJobCounts,
    options,
  );
  return page.companies;
}

export async function listPublicCompanyDirectory(
  input: PublicCompanyDirectoryInput,
  loadOpenJobCounts: PublicCompanyOpenJobCountLoader,
  options: PublicCompanyReadOptions = {},
): Promise<PublicCompanyDirectoryPage> {
  const limit = directoryLimit(input.limit);
  const normalizedInput = normalizeDirectoryInput(input);
  if (normalizedInput === null) return emptyCompanyDirectoryPage(false);
  const now = options.now ?? new Date();
  if (!isValidDate(now)) return emptyCompanyDirectoryPage(false);
  const database = options.database ?? getDatabase();
  const dataContext = options.dataContext ?? getPublicDataContext();
  const queryHash = createCompanyDirectoryQueryHash(
    normalizedInput,
    dataContext.liveOnly,
  );
  const decodedCursor = input.cursor === undefined
    ? undefined
    : decodeCompanyDirectoryCursorWithSecret(
        input.cursor,
        queryHash,
        options,
      );
  const invalidCursor = input.cursor !== undefined && decodedCursor === null;

  const loaded = await database.$transaction(
    async (transaction) => {
      const restrictions = await transaction.moderationRestriction.findMany({
        where: {
          targetType: "PAUSE_COMPANY",
          status: "ACTIVE",
          startsAt: { lte: now },
          liftedAt: null,
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        select: { targetId: true },
      });
      const ambiguousVerificationRows = normalizedInput.verifiedOnly
        ? await transaction.companyVerificationRequest.groupBy({
            by: ["companyId"],
            where: { status: "VERIFIED", supersededBy: null },
            having: { companyId: { _count: { gt: 1 } } },
          })
        : [];
      const excludedIds = [
        ...new Set([
          ...restrictions.map((restriction) => restriction.targetId),
          ...ambiguousVerificationRows.map((row) => row.companyId),
        ]),
      ];
      const where: Prisma.CompanyWhereInput = {
        status: "ACTIVE",
        ...(dataContext.liveOnly ? { dataProvenance: "LIVE" } : {}),
        ...(excludedIds.length === 0 ? {} : { id: { notIn: excludedIds } }),
        ...(normalizedInput.query === undefined
          ? {}
          : {
              name: {
                contains: normalizedInput.query,
                mode: "insensitive" as const,
              },
            }),
        ...(normalizedInput.industry === undefined
          ? {}
          : {
              industry: {
                equals: normalizedInput.industry,
                mode: "insensitive" as const,
              },
            }),
        ...(normalizedInput.cantonSlug === undefined
          ? {}
          : {
              locations: {
                some: {
                  isPrimary: true,
                  canton: { slug: normalizedInput.cantonSlug },
                },
              },
            }),
        ...(normalizedInput.verifiedOnly
          ? {
              verificationRequests: {
                some: { status: "VERIFIED", supersededBy: null },
              },
            }
          : {}),
      };
      const pageWhere: Prisma.CompanyWhereInput =
        decodedCursor === undefined || decodedCursor === null
          ? where
          : {
              AND: [
                where,
                {
                  OR: [
                    { name: { gt: decodedCursor.name } },
                    {
                      name: decodedCursor.name,
                      id: { gt: decodedCursor.id },
                    },
                  ],
                },
              ],
            };
      const totalEligible = await transaction.company.count({ where });
      const companies = await transaction.company.findMany({
        where: pageWhere,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: limit + 1,
        select: PUBLIC_COMPANY_CARD_SELECT,
      });
      const pageRows = companies.slice(0, limit);
      const sources = pageRows
        .map((company) =>
          toPublicCompanyCardProjectionSource(company, false),
        )
        .filter((source) =>
          evaluatePublicCompanyEligibility(
            source,
            dataContext.eligibilityEnvironment,
          ),
        );
      const enhancedProfileByCompanyId =
        await loadEnhancedCompanyProfileAccessByCompanyId(
          transaction,
          sources.map((source) => source.id),
          now,
        );
      const enhancedCompanyIds = sources
        .filter(
          (source) => enhancedProfileByCompanyId.get(source.id) === true,
        )
        .map((source) => source.id);
      const enhancementRows = enhancedCompanyIds.length === 0
        ? []
        : await transaction.company.findMany({
            where: { id: { in: enhancedCompanyIds } },
            select: PUBLIC_COMPANY_CARD_ENHANCEMENT_SELECT,
          });
      const enhancementByCompanyId = new Map(
        enhancementRows.map((row) => [row.id, row] as const),
      );
      return Object.freeze({
        sources: Object.freeze(
          sources.map((source) => {
            const enhancement = enhancementByCompanyId.get(source.id);
            return Object.freeze({
              source: enhancement === undefined
                ? source
                : toPublicCompanyEnhancedCardProjectionSource(
                    source,
                    enhancement,
                  ),
              // A missing enhancement row fails closed even if entitlement
              // resolution succeeded; no paid fields are inferred or leaked.
              enhancedProfile: enhancement !== undefined,
            });
          }),
        ),
        totalEligible,
        nextCursorSource: companies.length > limit
          ? pageRows.at(-1) ?? null
          : null,
      });
    },
    { isolationLevel: "RepeatableRead" },
  );

  if (loaded.sources.length === 0) {
    return Object.freeze({
      companies: Object.freeze([]),
      nextCursor: null,
      totalEligible: loaded.totalEligible,
      invalidCursor,
    });
  }
  const companyIds = Object.freeze(
    loaded.sources.map(({ source }) => source.id),
  );
  const openJobCounts = await loadOpenJobCounts(companyIds, {
    now: new Date(now),
  });
  const companies = loaded.sources.flatMap(({ source, enhancedProfile }) => {
    const card = projectPublicCompanyCard(source, {
      environment: dataContext.eligibilityEnvironment,
      enhancedProfile,
      openJobCount: openJobCounts.get(source.id) ?? 0,
    });
    return card === null ? [] : [card];
  });
  const nextCursor = loaded.nextCursorSource === null
    ? null
    : encodeCompanyDirectoryCursorWithSecret(
        {
          version: DIRECTORY_CURSOR_VERSION,
          queryHash,
          name: loaded.nextCursorSource.name,
          id: loaded.nextCursorSource.id,
        },
        options,
      );
  return Object.freeze({
    companies: Object.freeze(companies),
    nextCursor,
    totalEligible: loaded.totalEligible,
    invalidCursor,
  });
}

export async function getPublicCompanyCardBySlug(
  slug: string,
  openJobCount: number,
  options: PublicCompanyReadOptions = {},
): Promise<PublicCompanyCardModel | null> {
  const loaded = await loadCardProjectionSource(slug, options);
  return loaded === null
    ? null
    : projectPublicCompanyCard(loaded.source, {
        environment: loaded.environment,
        enhancedProfile: false,
        openJobCount,
      });
}

export async function getPublicCompanyDetailBySlug(
  slug: string,
  loadPublicJobs: PublicCompanyJobsLoader,
  options: PublicCompanyReadOptions = {},
): Promise<PublicCompanyDetailModel | null> {
  const loaded = await loadDetailProjectionSource(slug, options);
  if (loaded === null) return null;
  if (
    projectPublicCompanyCard(loaded.source, {
      environment: loaded.environment,
      enhancedProfile: loaded.enhancedProfile,
      openJobCount: 0,
    }) === null
  ) {
    return null;
  }
  const jobs = await loadPublicJobs(loaded.source.id, { now: loaded.now });
  return projectPublicCompanyDetail(loaded.source, {
    environment: loaded.environment,
    enhancedProfile: loaded.enhancedProfile,
    jobs,
  });
}

async function loadCardProjectionSource(
  slug: string,
  options: PublicCompanyReadOptions,
): Promise<Readonly<{
  source: PublicCompanyCardProjectionSource;
  environment: PublicCompanyEligibilityEnvironment;
}> | null> {
  if (!validCompanySlug(slug)) return null;
  const now = options.now ?? new Date();
  if (!isValidDate(now)) return null;
  const database = options.database ?? getDatabase();
  const dataContext = options.dataContext ?? getPublicDataContext();

  return database.$transaction(
    async (transaction) => {
      const company = await transaction.company.findUnique({
        where: { slug },
        select: PUBLIC_COMPANY_CARD_SELECT,
      });
      if (company === null) return null;
      const restrictionCount = await countEffectiveCompanyPauses(
        transaction,
        company.id,
        now,
      );
      const source = toPublicCompanyCardProjectionSource(
        company,
        restrictionCount > 0,
      );
      return evaluatePublicCompanyEligibility(
        source,
        dataContext.eligibilityEnvironment,
      )
        ? Object.freeze({
            source,
            environment: dataContext.eligibilityEnvironment,
          })
        : null;
    },
    { isolationLevel: "RepeatableRead" },
  );
}

async function loadDetailProjectionSource(
  slug: string,
  options: PublicCompanyReadOptions,
): Promise<Readonly<{
  source: PublicCompanyProjectionSource;
  enhancedProfile: boolean;
  environment: PublicCompanyEligibilityEnvironment;
  now: Date;
}> | null> {
  if (!validCompanySlug(slug)) return null;
  const now = options.now ?? new Date();
  if (!isValidDate(now)) return null;
  const database = options.database ?? getDatabase();
  const dataContext = options.dataContext ?? getPublicDataContext();

  return database.$transaction(
    async (transaction) => {
      const company = await transaction.company.findUnique({
        where: { slug },
        select: PUBLIC_COMPANY_DETAIL_SELECT,
      });
      if (company === null) return null;

      const restrictionCount = await countEffectiveCompanyPauses(
        transaction,
        company.id,
        now,
      );
      const source = toPublicCompanyProjectionSource(
        company,
        restrictionCount > 0,
      );
      if (
        !evaluatePublicCompanyEligibility(
          source,
          dataContext.eligibilityEnvironment,
        )
      ) {
        return null;
      }

      const enhancedProfile = await hasEnhancedCompanyProfileAccess(
        company.id,
        now,
        createEntitlementRepository(transaction),
      );
      return Object.freeze({
        source,
        enhancedProfile,
        environment: dataContext.eligibilityEnvironment,
        now: new Date(now),
      });
    },
    { isolationLevel: "RepeatableRead" },
  );
}

async function countEffectiveCompanyPauses(
  database: Prisma.TransactionClient,
  companyId: string,
  now: Date,
): Promise<number> {
  return database.moderationRestriction.count({
    where: {
      targetType: "PAUSE_COMPANY",
      targetId: companyId,
      status: "ACTIVE",
      startsAt: { lte: now },
      liftedAt: null,
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
  });
}

function toPublicCompanyCardProjectionSource(
  company: PublicCompanyCardSourceRow,
  hasEffectivePauseRestriction: boolean,
): PublicCompanyCardProjectionSource {
  return {
    id: company.id,
    slug: company.slug,
    name: company.name,
    industry: company.industry,
    size: company.size,
    status: company.status,
    dataProvenance: company.dataProvenance,
    primaryLocations: company.locations,
    currentVerifiedCycleIds: company.verificationRequests.map(
      (request) => request.id,
    ),
    hasEffectivePauseRestriction,
  };
}

function toPublicCompanyProjectionSource(
  company: PublicCompanyDetailSourceRow,
  hasEffectivePauseRestriction: boolean,
): PublicCompanyProjectionSource {
  return {
    ...toPublicCompanyCardProjectionSource(
      company,
      hasEffectivePauseRestriction,
    ),
    website: company.website,
    about: company.about,
    values: company.values,
    benefits: company.benefits,
    responseTargetDays: company.responseTargetDays,
    responseSampleSize: company.responseSampleSize,
    responseWithinTargetBps: company.responseWithinTargetBps,
  };
}

function toPublicCompanyEnhancedCardProjectionSource(
  source: PublicCompanyCardProjectionSource,
  enhancement: PublicCompanyCardEnhancementSourceRow,
): PublicCompanyEnhancedCardProjectionSource {
  return {
    ...source,
    benefits: enhancement.benefits,
    responseTargetDays: enhancement.responseTargetDays,
    responseSampleSize: enhancement.responseSampleSize,
    responseWithinTargetBps: enhancement.responseWithinTargetBps,
  };
}

/**
 * Resolves the page's branding gate through the canonical entitlement reader
 * while keeping database work constant: one Free-plan query, one Subscription
 * query and one Grant query for the whole page. Credit balances are deliberately
 * absent because they can never grant enhanced-profile access.
 */
async function loadEnhancedCompanyProfileAccessByCompanyId(
  database: Prisma.TransactionClient,
  companyIds: readonly string[],
  now: Date,
): Promise<ReadonlyMap<string, boolean>> {
  const uniqueCompanyIds = [...new Set(companyIds)];
  if (uniqueCompanyIds.length === 0) return new Map();

  const defaultPlanRows = await database.planVersion.findMany({
    where: {
      status: "ACTIVE",
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      plan: { isDefaultFree: true },
    },
    select: entitlementPlanVersionSelect,
  });
  const subscriptionRows = await database.employerSubscription.findMany({
    where: {
      companyId: { in: uniqueCompanyIds },
      status: { in: ["ACTIVE", "CANCELLING"] },
      currentPeriodStart: { lte: now },
      currentPeriodEnd: { gt: now },
    },
    select: {
      id: true,
      companyId: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      planVersion: { select: entitlementPlanVersionSelect },
    },
  });
  const grantRows = await database.entitlementGrant.findMany({
    where: {
      companyId: { in: uniqueCompanyIds },
      validFrom: { lte: now },
      validTo: { gt: now },
      revokedAt: null,
    },
    select: {
      id: true,
      companyId: true,
      key: true,
      valueType: true,
      booleanValue: true,
      integerValue: true,
      analyticsLevelValue: true,
      integerMode: true,
      validFrom: true,
      validTo: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  const defaultFreePlanVersions = defaultPlanRows.map(
    toEntitlementPlanVersion,
  );
  const subscriptionsByCompanyId = new Map<
    string,
    SubscriptionEntitlementSource[]
  >();
  for (const subscription of subscriptionRows) {
    const source: SubscriptionEntitlementSource = {
      id: subscription.id,
      companyId: subscription.companyId,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      planVersion: toEntitlementPlanVersion(subscription.planVersion),
    };
    const existing = subscriptionsByCompanyId.get(source.companyId) ?? [];
    existing.push(source);
    subscriptionsByCompanyId.set(source.companyId, existing);
  }
  const grantsByCompanyId = new Map<string, EntitlementGrantRecord[]>();
  for (const grant of grantRows) {
    const existing = grantsByCompanyId.get(grant.companyId) ?? [];
    existing.push(grant);
    grantsByCompanyId.set(grant.companyId, existing);
  }

  const repository: EntitlementRepository = {
    async listDefaultFreePlanVersions() {
      return defaultFreePlanVersions;
    },
    async listCompanySubscriptions(companyId) {
      return subscriptionsByCompanyId.get(companyId) ?? [];
    },
    async listCompanyEntitlementGrants(companyId) {
      return grantsByCompanyId.get(companyId) ?? [];
    },
    async listFundableCredits() {
      return [];
    },
  };
  const access = await Promise.all(
    uniqueCompanyIds.map(
      async (companyId) =>
        [
          companyId,
          await hasEnhancedCompanyProfileAccess(companyId, now, repository),
        ] as const,
    ),
  );
  return new Map(access);
}

function createEntitlementRepository(
  database: Prisma.TransactionClient,
): EntitlementRepository {
  return {
    async listDefaultFreePlanVersions(at) {
      const versions = await database.planVersion.findMany({
        where: {
          status: "ACTIVE",
          validFrom: { lte: at },
          OR: [{ validTo: null }, { validTo: { gt: at } }],
          plan: { isDefaultFree: true },
        },
        select: entitlementPlanVersionSelect,
      });
      return versions.map(toEntitlementPlanVersion);
    },
    async listCompanySubscriptions(companyId, at) {
      const subscriptions = await database.employerSubscription.findMany({
        where: {
          companyId,
          status: { in: ["ACTIVE", "CANCELLING"] },
          currentPeriodStart: { lte: at },
          currentPeriodEnd: { gt: at },
        },
        select: {
          id: true,
          companyId: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          planVersion: { select: entitlementPlanVersionSelect },
        },
      });
      return subscriptions.map((subscription) => ({
        id: subscription.id,
        companyId: subscription.companyId,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        planVersion: toEntitlementPlanVersion(subscription.planVersion),
      }));
    },
    async listCompanyEntitlementGrants(companyId, at) {
      return database.entitlementGrant.findMany({
        where: {
          companyId,
          validFrom: { lte: at },
          validTo: { gt: at },
          revokedAt: null,
        },
        select: {
          id: true,
          companyId: true,
          key: true,
          valueType: true,
          booleanValue: true,
          integerValue: true,
          analyticsLevelValue: true,
          integerMode: true,
          validFrom: true,
          validTo: true,
          revokedAt: true,
          createdAt: true,
        },
      });
    },
    // Credit balances do not influence ENHANCED_COMPANY_PROFILE. Returning the
    // neutral ledger keeps this public decision scoped to plan + grants.
    async listFundableCredits() {
      return [];
    },
  };
}

const entitlementPlanVersionSelect = {
  id: true,
  status: true,
  validFrom: true,
  validTo: true,
  plan: { select: { code: true, isDefaultFree: true } },
  entitlements: {
    select: {
      key: true,
      valueType: true,
      booleanValue: true,
      integerValue: true,
      analyticsLevelValue: true,
    },
  },
} as const;

function toEntitlementPlanVersion(
  version: Readonly<{
    id: string;
    status: PlanVersionEntitlementSource["status"];
    validFrom: Date;
    validTo: Date | null;
    plan: Readonly<{ code: string; isDefaultFree: boolean }>;
    entitlements: PlanVersionEntitlementSource["entitlements"];
  }>,
): PlanVersionEntitlementSource {
  return {
    id: version.id,
    planSlug: version.plan.code,
    isDefaultFree: version.plan.isDefaultFree,
    status: version.status,
    validFrom: version.validFrom,
    validTo: version.validTo,
    entitlements: version.entitlements,
  };
}

function projectPublicResponseEvidence(
  source: Pick<
    PublicCompanyProjectionSource,
    | "responseTargetDays"
    | "responseSampleSize"
    | "responseWithinTargetBps"
  >,
  enhancedProfile: boolean,
): PublicResponseEvidence {
  const targetDays = source.responseTargetDays;
  const sampleSize = source.responseSampleSize;
  const onTimeRateBps = source.responseWithinTargetBps;
  if (
    !enhancedProfile ||
    !Number.isInteger(targetDays) ||
    targetDays === null ||
    targetDays < EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min ||
    targetDays > EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max ||
    !Number.isSafeInteger(sampleSize) ||
    sampleSize < EMPLOYER_RESPONSE_POLICY_V1.minimumDueCases ||
    !Number.isInteger(onTimeRateBps) ||
    onTimeRateBps === null ||
    onTimeRateBps < 0 ||
    onTimeRateBps > 10_000
  ) {
    return UNKNOWN_RESPONSE;
  }

  return Object.freeze({
    known: true,
    targetDays,
    onTimeRateBps,
    sampleSizeBucket: sampleSize >= 50 ? "50+" : "20–49",
  });
}

function hasResponseEvidenceSource(
  source:
    | PublicCompanyCardProjectionSource
    | PublicCompanyEnhancedCardProjectionSource
    | PublicCompanyProjectionSource,
): source is PublicCompanyEnhancedCardProjectionSource {
  return "responseTargetDays" in source &&
    "responseSampleSize" in source &&
    "responseWithinTargetBps" in source;
}

function hasEnhancedCardSource(
  source:
    | PublicCompanyCardProjectionSource
    | PublicCompanyEnhancedCardProjectionSource
    | PublicCompanyProjectionSource,
): source is PublicCompanyEnhancedCardProjectionSource {
  return "benefits" in source && hasResponseEvidenceSource(source);
}

function emptyCompanyDirectoryPage(
  invalidCursor: boolean,
): PublicCompanyDirectoryPage {
  return Object.freeze({
    companies: Object.freeze([]),
    nextCursor: null,
    totalEligible: 0,
    invalidCursor,
  });
}

function createCompanyDirectoryQueryHash(
  input: NonNullable<ReturnType<typeof normalizeDirectoryInput>>,
  liveOnly: boolean,
): string {
  const canonical = {
    version: DIRECTORY_CURSOR_VERSION,
    query: input.query?.toLocaleLowerCase("de-CH") ?? null,
    cantonSlug: input.cantonSlug ?? null,
    industry: input.industry?.toLocaleLowerCase("de-CH") ?? null,
    verifiedOnly: input.verifiedOnly,
    liveOnly,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

function encodeCompanyDirectoryCursorWithSecret(
  payload: PublicCompanyDirectoryCursor,
  options: PublicCompanyReadOptions,
): string {
  return withCompanyDirectoryCursorSecret(options, (secret) => {
    if (secret.length < 32) {
      throw new TypeError(
        "Company directory cursor signing key must contain at least 32 characters.",
      );
    }
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    return `${encoded}.${companyDirectoryCursorSignature(encoded, secret).toString("base64url")}`;
  });
}

function decodeCompanyDirectoryCursorWithSecret(
  cursor: string,
  queryHash: string,
  options: PublicCompanyReadOptions,
): PublicCompanyDirectoryCursor | null {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) return null;
  return withCompanyDirectoryCursorSecret(options, (secret) => {
    if (secret.length < 32) return null;
    const [encoded, encodedSignature, extra] = cursor.split(".");
    if (!encoded || !encodedSignature || extra !== undefined) return null;
    try {
      const supplied = Buffer.from(encodedSignature, "base64url");
      const correct = companyDirectoryCursorSignature(encoded, secret);
      if (
        supplied.length !== correct.length ||
        !timingSafeEqual(supplied, correct)
      ) {
        return null;
      }
      const raw: unknown = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      );
      if (!isCompanyDirectoryCursor(raw) || raw.queryHash !== queryHash) {
        return null;
      }
      return Object.freeze({ ...raw });
    } catch {
      return null;
    }
  });
}

function isCompanyDirectoryCursor(
  value: unknown,
): value is PublicCompanyDirectoryCursor {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 4 &&
    candidate.version === DIRECTORY_CURSOR_VERSION &&
    typeof candidate.queryHash === "string" &&
    /^[a-f0-9]{64}$/u.test(candidate.queryHash) &&
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    candidate.name.length <= 200 &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    candidate.id.length <= 100;
}

function companyDirectoryCursorSignature(
  encoded: string,
  secret: string,
): Buffer {
  return createHmac("sha256", secret)
    .update(`company-directory-cursor-v1\0${encoded}`)
    .digest();
}

function withCompanyDirectoryCursorSecret<T>(
  options: PublicCompanyReadOptions,
  consumer: (secret: string) => T,
): T {
  return options.cursorSecret === undefined
    ? getServerEnvironment().secrets.session.withValue(consumer)
    : consumer(options.cursorSecret);
}

function sanitizeList(values: readonly string[], maximum: number) {
  return Object.freeze(
    values
      .map((value) => boundedOptionalText(value, MAX_VALUE_LENGTH))
      .filter((value): value is string => value !== null)
      .slice(0, maximum),
  );
}

function boundedRequiredText(value: string, maximum: number): string | null {
  const sanitized = stripUnsafeHtml(value).slice(0, maximum).trim();
  return sanitized.length > 0 ? sanitized : null;
}

function boundedOptionalText(
  value: string | null,
  maximum: number,
): string | null {
  return value === null ? null : boundedRequiredText(value, maximum);
}

function safePublicWebsite(value: string | null): string | null {
  if (value === null || value.length > 512) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === ""
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function directoryLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_DIRECTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DIRECTORY_LIMIT) {
    throw new RangeError(
      `Public Company directory limit must be between 1 and ${MAX_DIRECTORY_LIMIT}.`,
    );
  }
  return limit;
}

function normalizeDirectoryInput(input: PublicCompanyDirectoryInput): Readonly<{
  query?: string;
  cantonSlug?: string;
  industry?: string;
  verifiedOnly: boolean;
}> | null {
  const query = normalizeOptionalFilter(input.query, 120);
  const cantonSlug = normalizeOptionalFilter(input.cantonSlug, 200);
  const industry = normalizeOptionalFilter(input.industry, 160);
  if (query === null || cantonSlug === null || industry === null) return null;
  if (cantonSlug !== undefined && !validCompanySlug(cantonSlug)) return null;

  return Object.freeze({
    ...(query === undefined ? {} : { query }),
    ...(cantonSlug === undefined ? {} : { cantonSlug }),
    ...(industry === undefined ? {} : { industry }),
    verifiedOnly: input.verifiedOnly === true,
  });
}

function normalizeOptionalFilter(
  value: string | undefined,
  maximum: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().normalize("NFKC");
  if (normalized.length === 0) return undefined;
  return normalized.length <= maximum ? normalized : null;
}

function validCompanySlug(value: string): boolean {
  return value.length <= 200 && COMPANY_SLUG_PATTERN.test(value);
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
