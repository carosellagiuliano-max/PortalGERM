import "server-only";

import type { DatabaseClient } from "@/lib/db/factory";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import type { Prisma } from "@/lib/generated/prisma/client";

const DAY = 86_400_000;
export const EMPLOYER_DASHBOARD_QUERY_LIMITS = Object.freeze({
  responseApplications: 5_000,
  analyzedJobs: 1_000,
});

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
    select: { name: true },
  });
  if (company === null) return null;

  const [activeJobs, applicationsThisWeek, applications, jobs, entitlementResult, subscription] =
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
          currentRevision: {
            select: {
              title: true,
              scoreSnapshots: {
                orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { scorePoints: true, maxPoints: true },
              },
            },
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
