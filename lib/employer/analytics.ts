import "server-only";

import {
  aggregateEmployerMetricsV1,
  type EmployerMetricEventV1,
} from "@/lib/analytics/employer-metrics";
import { canUseAdvancedAnalytics } from "@/lib/billing/feature-gates";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";

const DAY = 86_400_000;
const MIN_SALARY_GROUP_JOBS = 5;
export const EMPLOYER_ANALYTICS_QUERY_LIMITS = Object.freeze({
  events: 50_000,
  applications: 10_000,
  jobs: 2_000,
  outputRows: 20,
});

export type EmployerAnalyticsAccess = Readonly<{
  companyId: string;
  membershipId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
  userId: string;
}>;

export async function getEmployerAnalyticsData(
  access: EmployerAnalyticsAccess,
  database: DatabaseClient,
  now = new Date(),
) {
  const companyId = access.companyId;
  const from = new Date(now.getTime() - 30 * DAY);
  const membershipScope = analyticsMembershipScope(access);
  const jobScope = analyticsJobScope(access, now);
  const authorizedCompany = await database.company.findFirst({
    where: { id: companyId, status: { in: ["DRAFT", "ACTIVE"] }, memberships: { some: membershipScope } },
    select: { id: true },
  });
  if (authorizedCompany === null) return null;

  const [entitlementResult, events, applications, jobs] = await Promise.all([
    getPrismaEffectiveEntitlements(companyId, now, database),
    database.analyticsEvent.findMany({
      where: {
        companyId,
        job: jobScope,
        occurredAt: { gte: from, lt: now },
        kind: { in: ["JOB_DETAIL_VIEWED", "JOB_SAVED", "APPLICATION_SUBMITTED", "EMPLOYER_RESPONSE_RECORDED"] },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: EMPLOYER_ANALYTICS_QUERY_LIMITS.events,
      select: {
        id: true,
        kind: true,
        occurredAt: true,
        companyId: true,
        jobId: true,
        pseudonymousActorId: true,
        pseudonymousSessionId: true,
        actorProvenanceSnapshot: true,
        companyProvenanceSnapshot: true,
        jobProvenanceSnapshot: true,
      },
    }),
    database.application.findMany({
      where: { job: jobScope, submittedAt: { gte: from, lt: now } },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: EMPLOYER_ANALYTICS_QUERY_LIMITS.applications,
      select: {
        submittedAt: true,
        job: { select: { id: true, currentRevision: { select: { title: true } } } },
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
      take: EMPLOYER_ANALYTICS_QUERY_LIMITS.jobs,
      select: {
        id: true,
        currentRevision: {
          select: {
            title: true,
            salaryMin: true,
            salaryMax: true,
            scoreSnapshots: {
              orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { scorePoints: true, maxPoints: true },
            },
          },
        },
      },
    }),
  ]);
  const entitlements = entitlementResult.ok ? entitlementResult.value : null;
  const metricEvents = [...events].reverse().flatMap((event): EmployerMetricEventV1[] =>
    event.jobId === null || event.companyId === null ? [] : [{
      eventId: event.id,
      kind: event.kind as EmployerMetricEventV1["kind"],
      occurredAt: event.occurredAt,
      companyId: event.companyId,
      jobId: event.jobId,
      subjectId: event.pseudonymousActorId ?? event.pseudonymousSessionId ?? event.id,
      actorProvenance: event.actorProvenanceSnapshot,
      companyProvenance: event.companyProvenanceSnapshot ?? "DEMO",
      jobProvenance: event.jobProvenanceSnapshot ?? "DEMO",
    }],
  );
  const metrics = entitlements === null
    ? { allowed: false as const, reason: "ANALYTICS_ENTITLEMENT_REQUIRED" as const }
    : aggregateEmployerMetricsV1(
        metricEvents,
        { companyId, from, to: now, analyticsLevel: entitlements.rights.ANALYTICS_LEVEL },
      );
  const advancedAllowed = entitlements !== null && canUseAdvancedAnalytics(entitlements).allowed;

  const responseByJob = new Map<string, { title: string; hours: number[] }>();
  for (const application of applications) {
    const first = application.events[0];
    if (first === undefined) continue;
    const bucket = responseByJob.get(application.job.id) ?? {
      title: application.job.currentRevision?.title ?? "Unbenanntes Inserat",
      hours: [],
    };
    bucket.hours.push((first.createdAt.getTime() - application.submittedAt.getTime()) / 3_600_000);
    responseByJob.set(application.job.id, bucket);
  }
  const responseTimes = [...responseByJob.entries()].flatMap(([jobId, value]) =>
    value.hours.length < 20 ? [] : [{
      jobId,
      title: value.title,
      averageHours: Math.round(value.hours.reduce((sum, hours) => sum + hours, 0) / value.hours.length),
      sampleSize: value.hours.length,
    }],
  ).sort((left, right) => right.averageHours - left.averageHours || left.jobId.localeCompare(right.jobId))
    .slice(0, EMPLOYER_ANALYTICS_QUERY_LIMITS.outputRows);
  const scoreSuggestions = jobs.flatMap((job) => {
    const revision = job.currentRevision;
    const score = revision?.scoreSnapshots[0];
    return revision === null || revision === undefined || score === undefined || score.scorePoints / score.maxPoints >= 0.8
      ? []
      : [{ jobId: job.id, title: revision.title, score: score.scorePoints, max: score.maxPoints }];
  }).sort((left, right) => left.score / left.max - right.score / right.max || left.jobId.localeCompare(right.jobId))
    .slice(0, EMPLOYER_ANALYTICS_QUERY_LIMITS.outputRows);
  const jobTitles = new Map(jobs.map((job) => [job.id, job.currentRevision?.title ?? "Unbenanntes Inserat"]));
  const diagnosticJobs = !metrics.allowed || metrics.jobBreakdown === null
    ? []
    : metrics.jobBreakdown.flatMap((job) => {
        if (typeof job.detailViews !== "number" || typeof job.applications !== "number") return [];
        if (job.detailViews < 20 || job.applications > Math.max(1, Math.floor(job.detailViews * 0.02))) return [];
        return [{
          jobId: job.jobId,
          title: jobTitles.get(job.jobId) ?? "Unbenanntes Inserat",
          views: job.detailViews,
          applications: job.applications,
        }];
      })
        .sort((left, right) => right.views - left.views || left.applications - right.applications || left.jobId.localeCompare(right.jobId))
        .slice(0, EMPLOYER_ANALYTICS_QUERY_LIMITS.outputRows);
  const salaryFunnelEvidence = buildSalaryFunnelEvidence({
    advancedAllowed,
    analyticsLevel: entitlements?.rights.ANALYTICS_LEVEL,
    companyId,
    events: metricEvents,
    from,
    jobs,
    to: now,
  });

  return Object.freeze({
    from,
    to: now,
    metrics,
    advancedAllowed,
    responseTimes: Object.freeze(responseTimes),
    scoreSuggestions: Object.freeze(scoreSuggestions),
    diagnosticJobs: Object.freeze(diagnosticJobs),
    salaryFunnelEvidence,
  });
}

function analyticsMembershipScope(access: EmployerAnalyticsAccess) {
  return {
    id: access.membershipId,
    userId: access.userId,
    companyId: access.companyId,
    role: access.membershipRole,
    status: "ACTIVE" as const,
    removedAt: null,
  };
}

function analyticsJobScope(access: EmployerAnalyticsAccess, now: Date): Prisma.JobWhereInput {
  return {
    companyId: access.companyId,
    company: {
      status: { in: ["DRAFT", "ACTIVE"] },
      memberships: { some: analyticsMembershipScope(access) },
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

function buildSalaryFunnelEvidence(input: Readonly<{
  advancedAllowed: boolean;
  analyticsLevel: "NONE" | "BASIC" | "ADVANCED" | "PRO" | undefined;
  companyId: string;
  events: readonly EmployerMetricEventV1[];
  from: Date;
  jobs: readonly Readonly<{
    id: string;
    currentRevision: Readonly<{ salaryMin: unknown; salaryMax: unknown }> | null;
  }>[];
  to: Date;
}>) {
  if (!input.advancedAllowed || input.analyticsLevel === undefined) {
    return Object.freeze({ status: "LOCKED" as const });
  }
  const transparentIds = new Set(
    input.jobs
      .filter((job) => job.currentRevision?.salaryMin != null && job.currentRevision.salaryMax != null)
      .map((job) => job.id),
  );
  const opaqueIds = new Set(input.jobs.filter((job) => !transparentIds.has(job.id)).map((job) => job.id));
  if (transparentIds.size < MIN_SALARY_GROUP_JOBS || opaqueIds.size < MIN_SALARY_GROUP_JOBS) {
    return Object.freeze({
      status: "INSUFFICIENT" as const,
      transparentJobs: transparentIds.size,
      opaqueJobs: opaqueIds.size,
      requiredJobsPerGroup: MIN_SALARY_GROUP_JOBS,
    });
  }
  const query = { companyId: input.companyId, from: input.from, to: input.to, analyticsLevel: input.analyticsLevel } as const;
  const transparent = aggregateEmployerMetricsV1(input.events.filter((event) => transparentIds.has(event.jobId)), query);
  const opaque = aggregateEmployerMetricsV1(input.events.filter((event) => opaqueIds.has(event.jobId)), query);
  if (!transparent.allowed || !opaque.allowed || transparent.totals.status !== "VALUE" || opaque.totals.status !== "VALUE") {
    return Object.freeze({
      status: "SUPPRESSED" as const,
      requiredViewedSubjectsPerGroup: 20,
    });
  }
  return Object.freeze({
    status: "VALUE" as const,
    transparent: Object.freeze({
      jobs: transparentIds.size,
      views: transparent.totals.detailViews,
      applications: transparent.totals.applications,
      applyRateBps: transparent.totals.applyRateBps,
    }),
    opaque: Object.freeze({
      jobs: opaqueIds.size,
      views: opaque.totals.detailViews,
      applications: opaque.totals.applications,
      applyRateBps: opaque.totals.applyRateBps,
    }),
  });
}
