import "server-only";

import {
  calculateClusterBaselineBpsV1,
  evaluateBoostTestCandidateV1,
  evaluateJobContentDiagnosticV1,
  getSignalFollowUpAtV1,
  type ClusterBaselineJobV1,
} from "@/lib/analytics/metric-definitions-v1";
import { jobHasActiveBoost } from "@/lib/billing/boosts";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import { getServerEnvironment } from "@/lib/config/env";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { isJobPubliclyEligible } from "@/lib/jobs/public-eligibility";

const DAY = 86_400_000;
export const EMPLOYER_DASHBOARD_QUERY_LIMITS = Object.freeze({
  responseApplications: 5_000,
  analyzedJobs: 1_000,
  recommendationEvents: 200_000,
  baselineJobs: 20_000,
});

export type EmployerDashboardRecommendation = Readonly<{
  kind: "JOB_CONTENT_DIAGNOSTIC" | "BOOST_TEST_CANDIDATE";
  jobId: string;
  title: string;
  evidence: string;
  suggestedAction: string;
  expectedMetric: string;
  followUpAt: Date;
}>;

export type EmployerDashboardData = Readonly<{
  companyName: string;
  activeJobs: number;
  activeJobLimit: number | null;
  applicationsThisWeek: number;
  averageResponseHours: number | null;
  lowScoreJobs: readonly Readonly<{
    id: string;
    title: string;
    points: number;
    maxPoints: number;
  }>[];
  diagnosticJobs: readonly Readonly<{
    id: string;
    title: string;
    views: number;
    applications: number;
  }>[];
  recommendations: readonly EmployerDashboardRecommendation[];
  plan: Readonly<{
    label: string;
    periodEnd: Date | null;
    schedule: string | null;
  }>;
  boostCredits: number;
  radarEnabled: boolean;
  radarContacts: number;
}>;

export type EmployerDashboardAccess = Readonly<{
  companyId: string;
  membershipId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
  userId: string;
}>;

export async function getEmployerDashboardData(
  access: EmployerDashboardAccess,
  database: DatabaseClient,
  now = new Date(),
): Promise<EmployerDashboardData | null> {
  const companyId = access.companyId;
  const weekStart = new Date(now.getTime() - 7 * DAY);
  const membershipScope = activeMembershipScope(access);
  const jobScope = dashboardJobScope(access, now);
  const company = await database.company.findFirst({
    where: { id: companyId, status: { in: ["DRAFT", "ACTIVE"] }, memberships: { some: membershipScope } },
    select: {
      name: true,
      status: true,
      dataProvenance: true,
      verificationRequests: {
        where: { supersededBy: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { status: true },
      },
    },
  });
  if (company === null) return null;

  const window30 = new Date(now.getTime() - 30 * DAY);
  const window90 = new Date(now.getTime() - 90 * DAY);
  const [activeJobs, applicationsThisWeek, applications, jobs, entitlementResult, subscription, recommendationEvents, baselineJobs] =
    await Promise.all([
      database.job.count({
        where: {
          ...jobScope,
          status: "PUBLISHED",
          publishedAt: { lte: now },
          expiresAt: { gt: now },
        },
      }),
      database.application.count({
        where: { job: jobScope, submittedAt: { gte: weekStart, lt: now } },
      }),
      database.application.findMany({
        where: { job: jobScope },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        take: EMPLOYER_DASHBOARD_QUERY_LIMITS.responseApplications,
        select: {
          submittedAt: true,
          events: {
            where: { kind: "STATUS_CHANGE", fromStatus: { not: null } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
      database.job.findMany({
        where: { ...jobScope, status: { not: "REMOVED" } },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: EMPLOYER_DASHBOARD_QUERY_LIMITS.analyzedJobs,
        select: {
          id: true,
          status: true,
          publishedAt: true,
          expiresAt: true,
          publishedCantonId: true,
          publishedCategoryId: true,
          dataProvenance: true,
          currentRevision: {
            select: {
              title: true,
              applicationEffort: true,
              applicationProcessSteps: true,
              applicationContactValue: true,
              salaryPeriod: true,
              salaryMin: true,
              salaryMax: true,
              scoreSnapshots: {
                orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { scoreVersion: true, scorePoints: true, maxPoints: true },
              },
            },
          },
          boosts: {
            where: {
              status: { not: "CANCELLED" },
              startsAt: { lte: now },
              endsAt: { gt: now },
            },
            select: { status: true, startsAt: true, endsAt: true },
          },
          viewAggregates: {
            where: { windowEnd: { gt: weekStart }, windowStart: { lt: now } },
            select: { viewCount: true },
          },
          _count: { select: { applications: true } },
        },
      }),
      getPrismaEffectiveEntitlements(companyId, now, database),
      database.employerSubscription.findFirst({
        where: {
          companyId,
          company: { status: { in: ["DRAFT", "ACTIVE"] }, memberships: { some: membershipScope } },
          status: { in: ["ACTIVE", "CANCELLING"] },
          currentPeriodStart: { lte: now },
          currentPeriodEnd: { gt: now },
        },
        orderBy: [{ currentPeriodStart: "desc" }, { id: "desc" }],
        select: {
          currentPeriodEnd: true,
          planVersion: { select: { plan: { select: { code: true } } } },
          currentChangeSchedules: {
            where: { status: "PENDING" },
            orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { kind: true, effectiveAt: true },
          },
        },
      }),
      database.analyticsEvent.findMany({
        where: {
          purpose: "PRODUCT_ANALYTICS",
          occurredAt: { gte: window90, lt: now },
          kind: { in: ["JOB_DETAIL_VIEWED", "APPLY_INTENT_STARTED"] },
          jobId: { not: null },
          companyProvenanceSnapshot: "LIVE",
          jobProvenanceSnapshot: "LIVE",
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: EMPLOYER_DASHBOARD_QUERY_LIMITS.recommendationEvents,
        select: {
          jobId: true,
          kind: true,
          occurredAt: true,
          pseudonymousSessionId: true,
          dedupeKey: true,
          properties: true,
        },
      }),
      database.job.findMany({
        where: {
          dataProvenance: "LIVE",
          company: { dataProvenance: "LIVE" },
          publishedCantonId: { not: null },
          publishedCategoryId: { not: null },
        },
        orderBy: [{ id: "asc" }],
        take: EMPLOYER_DASHBOARD_QUERY_LIMITS.baselineJobs,
        select: {
          id: true,
          dataProvenance: true,
          publishedCantonId: true,
          publishedCategoryId: true,
          company: { select: { dataProvenance: true } },
        },
      }),
    ]);

  const responseDurations = applications.flatMap((application) => {
    const respondedAt = application.events[0]?.createdAt;
    return respondedAt === undefined
      ? []
      : [(respondedAt.getTime() - application.submittedAt.getTime()) / 3_600_000];
  });
  const averageResponseHours = responseDurations.length === 0
    ? null
    : Math.round(
        responseDurations.reduce((sum, value) => sum + value, 0) /
          responseDurations.length,
      );
  const lowScoreJobs = jobs
    .flatMap((job) => {
      const revision = job.currentRevision;
      const score = revision?.scoreSnapshots[0];
      return revision === null || revision === undefined || score === undefined
        ? []
        : [{
            id: job.id,
            title: revision.title,
            points: score.scorePoints,
            maxPoints: score.maxPoints,
          }];
    })
    .filter((job) => job.points / job.maxPoints < 0.7)
    .sort((left, right) => left.points / left.maxPoints - right.points / right.maxPoints || left.id.localeCompare(right.id))
    .slice(0, 3);
  const diagnosticJobs = jobs
    .map((job) => ({
      id: job.id,
      title: job.currentRevision?.title ?? "Unbenanntes Inserat",
      views: job.viewAggregates.reduce((sum, row) => sum + row.viewCount, 0),
      applications: job._count.applications,
    }))
    .filter((job) => job.views >= 20 && job.applications <= Math.max(1, Math.floor(job.views * 0.02)))
    .sort((left, right) => right.views - left.views || left.applications - right.applications || left.id.localeCompare(right.id))
    .slice(0, 3);
  const analyticsByJob = aggregateRecommendationAnalytics(
    recommendationEvents,
    window30,
    window90,
    now,
  );
  const baselineRows: ClusterBaselineJobV1[] = baselineJobs.flatMap((job) => {
    const sample = analyticsByJob.get(job.id);
    return sample === undefined ||
      job.publishedCantonId === null ||
      job.publishedCategoryId === null
      ? []
      : [{
          jobId: job.id,
          cantonId: job.publishedCantonId,
          categoryId: job.publishedCategoryId,
          measuredFrom: window90,
          measuredTo: now,
          companyProvenance: job.company.dataProvenance,
          jobProvenance: job.dataProvenance,
          organicDetailSessions: sample.views90,
          conversionBps: rateBps(sample.intents90, sample.views90),
        }];
  });
  const recommendations: EmployerDashboardData["recommendations"][number][] = [];
  for (const job of jobs) {
    const revision = job.currentRevision;
    const sample = analyticsByJob.get(job.id);
    if (
      revision === null ||
      job.status !== "PUBLISHED" ||
      job.publishedAt === null ||
      job.expiresAt === null ||
      job.expiresAt <= now ||
      sample === undefined
    ) {
      continue;
    }
    const score = revision.scoreSnapshots[0];
    const content = {
      organicDetailSessions: sample.views30,
      applyIntentRateBps: rateBps(sample.intents30, sample.views30),
      publishedAt: job.publishedAt,
      now,
      fairScoreV2: score === undefined || !score.scoreVersion.startsWith("fair-job-score-v2")
        ? null
        : Math.floor((score.scorePoints / score.maxPoints) * 100),
      salaryEvidencePresent:
        revision.salaryPeriod !== null &&
        revision.salaryMin !== null &&
        revision.salaryMax !== null,
      processEvidencePresent: revision.applicationProcessSteps.length > 0,
      applicationEffort: revision.applicationEffort,
      applyPathBroken: revision.applicationContactValue.trim().length < 3,
    } as const;
    if (evaluateJobContentDiagnosticV1(content)) {
      recommendations.push(Object.freeze({
        kind: "JOB_CONTENT_DIAGNOSTIC",
        jobId: job.id,
        title: revision.title,
        evidence: `${sample.views30} organische Detail-Sessions in 30 Tagen, ${content.applyIntentRateBps} bp Apply-Intent-Rate.`,
        suggestedAction: "Zuerst Inhalt, Lohntransparenz, Prozess und Bewerbungsweg verbessern.",
        expectedMetric: "Apply-Intent pro organischer Detail-Session",
        followUpAt: getSignalFollowUpAtV1(now, "JOB_CONTENT_DIAGNOSTIC"),
      }));
      continue;
    }
    if (
      access.membershipRole !== "OWNER" && access.membershipRole !== "ADMIN" ||
      company.status !== "ACTIVE" ||
      company.verificationRequests[0]?.status !== "VERIFIED" ||
      job.publishedCantonId === null ||
      job.publishedCategoryId === null
    ) {
      continue;
    }
    const baselineBps = calculateClusterBaselineBpsV1(baselineRows, {
      cantonId: job.publishedCantonId,
      categoryId: job.publishedCategoryId,
      now,
    });
    if (!evaluateBoostTestCandidateV1({
      content,
      hasActiveBoost: jobHasActiveBoost(job.boosts, now),
      baselineBps,
    })) {
      continue;
    }
    const appEnvironment = getServerEnvironment().APP_ENV;
    const eligibility = await isJobPubliclyEligible(
      job.id,
      now,
      appEnvironment === "production" || appEnvironment === "staging"
        ? "production"
        : "non-production",
      database,
    );
    if (!eligibility.eligible) continue;
    recommendations.push(Object.freeze({
      kind: "BOOST_TEST_CANDIDATE",
      jobId: job.id,
      title: revision.title,
      evidence: `${sample.views30} organische Detail-Sessions in 30 Tagen, ${content.applyIntentRateBps} bp gegenüber ${baselineBps} bp Cluster-Baseline.`,
      suggestedAction: "Transparent beschrifteten 7-Tage-Test ab CHF 79 durchführen; Sponsored-Platzierung nur in relevanten Ergebnissen.",
      expectedMetric: "Apply-Intent pro organischer und gesponserter Detail-Session",
      followUpAt: getSignalFollowUpAtV1(now, "BOOST_TEST_CANDIDATE"),
    }));
  }

  const entitlements = entitlementResult.ok ? entitlementResult.value : null;
  const planSlug = subscription?.planVersion.plan.code ?? entitlements?.source.planSlug ?? "free-basic";
  const schedule = subscription?.currentChangeSchedules[0];
  const boostCredits = entitlements === null
    ? 0
    : sumCredits(entitlements.fundableBySource, "JOB_BOOST");
  const radarContacts = entitlements === null
    ? 0
    : sumCredits(entitlements.fundableBySource, "TALENT_CONTACT");

  return Object.freeze({
    companyName: company.name,
    activeJobs,
    activeJobLimit: entitlements?.rights.ACTIVE_JOB_LIMIT ?? null,
    applicationsThisWeek,
    averageResponseHours,
    lowScoreJobs: Object.freeze(lowScoreJobs),
    diagnosticJobs: Object.freeze(diagnosticJobs),
    recommendations: Object.freeze(
      orderEmployerDashboardRecommendations(recommendations).slice(0, 3),
    ),
    plan: Object.freeze({
      label: planLabel(planSlug),
      periodEnd: subscription?.currentPeriodEnd ?? null,
      schedule: schedule === undefined
        ? null
        : `${schedule.kind} per ${new Intl.DateTimeFormat("de-CH").format(schedule.effectiveAt)}`,
    }),
    boostCredits,
    radarEnabled: entitlements?.rights.TALENT_RADAR_ACCESS ?? false,
    radarContacts,
  });
}

export type RecommendationAnalyticsRow = Readonly<{
  jobId: string | null;
  kind: string;
  occurredAt: Date;
  pseudonymousSessionId: string | null;
  dedupeKey: string;
  properties: unknown;
}>;

export function aggregateRecommendationAnalytics(
  rows: readonly RecommendationAnalyticsRow[],
  window30: Date,
  window90: Date,
  now: Date,
) {
  const buckets = new Map<string, {
    views30: Set<string>;
    intents30: Set<string>;
    views90: Set<string>;
    intents90: Set<string>;
  }>();
  for (const row of rows) {
    if (row.jobId === null || row.occurredAt < window90 || row.occurredAt >= now) continue;
    const properties = typeof row.properties === "object" && row.properties !== null && !Array.isArray(row.properties)
      ? row.properties as Record<string, unknown>
      : {};
    if (
      row.kind === "JOB_DETAIL_VIEWED" &&
      ["SEARCH_SPONSORED", "HOMEPAGE_SPONSORED"].includes(String(properties.placement ?? "ORGANIC"))
    ) {
      continue;
    }
    const key = row.pseudonymousSessionId ?? row.dedupeKey;
    const bucket = buckets.get(row.jobId) ?? {
      views30: new Set<string>(),
      intents30: new Set<string>(),
      views90: new Set<string>(),
      intents90: new Set<string>(),
    };
    if (row.kind === "JOB_DETAIL_VIEWED") {
      bucket.views90.add(key);
      if (row.occurredAt >= window30) bucket.views30.add(key);
    }
    if (row.kind === "APPLY_INTENT_STARTED") {
      bucket.intents90.add(key);
      if (row.occurredAt >= window30) bucket.intents30.add(key);
    }
    buckets.set(row.jobId, bucket);
  }
  return new Map([...buckets].map(([jobId, bucket]) => [jobId, {
    views30: bucket.views30.size,
    intents30: intersectionSize(bucket.intents30, bucket.views30),
    views90: bucket.views90.size,
    intents90: intersectionSize(bucket.intents90, bucket.views90),
  }]));
}

export function orderEmployerDashboardRecommendations(
  recommendations: readonly EmployerDashboardRecommendation[],
): EmployerDashboardRecommendation[] {
  return [...recommendations].sort(
    (left, right) =>
      recommendationPriority(left.kind) - recommendationPriority(right.kind) ||
      left.jobId.localeCompare(right.jobId),
  );
}

function recommendationPriority(
  kind: EmployerDashboardRecommendation["kind"],
): number {
  return kind === "JOB_CONTENT_DIAGNOSTIC" ? 0 : 1;
}

function intersectionSize(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  let matches = 0;
  for (const value of left) {
    if (right.has(value)) matches += 1;
  }
  return matches;
}

function rateBps(numerator: number, denominator: number) {
  return denominator <= 0 ? 0 : Math.floor((numerator * 10_000) / denominator);
}

function activeMembershipScope(access: EmployerDashboardAccess) {
  return {
    id: access.membershipId,
    userId: access.userId,
    companyId: access.companyId,
    role: access.membershipRole,
    status: "ACTIVE" as const,
    removedAt: null,
  };
}

function dashboardJobScope(access: EmployerDashboardAccess, now: Date): Prisma.JobWhereInput {
  return {
    companyId: access.companyId,
    company: {
      status: { in: ["DRAFT", "ACTIVE"] },
      memberships: { some: activeMembershipScope(access) },
    },
    ...(access.membershipRole !== "RECRUITER" ? {} : {
      assignments: {
        some: {
          companyId: access.companyId,
          membershipId: access.membershipId,
          userId: access.userId,
          status: "ACTIVE",
          revokedAt: null,
          validFrom: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
    }),
  };
}

function sumCredits(
  rows: Record<string, Record<string, number>>,
  type: "JOB_BOOST" | "TALENT_CONTACT",
) {
  return Object.values(rows).reduce((sum, row) => sum + (row[type] ?? 0), 0);
}

export function planLabel(slug: string) {
  const labels: Readonly<Record<string, string>> = {
    free: "Free Basic",
    "free-basic": "Free Basic",
    free_basic: "Free Basic",
    starter: "Starter",
    pro: "Pro",
    business: "Business",
    enterprise: "Enterprise",
    enterprise_contract: "Enterprise",
  };
  return labels[slug.trim().toLowerCase()] ?? slug;
}
