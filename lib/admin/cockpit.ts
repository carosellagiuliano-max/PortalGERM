import "server-only";

import {
  calculateClusterBaselineBpsV1,
  evaluateBoostTestCandidateV1,
  evaluateFreeUpgradeCandidateV1,
  evaluateJobContentDiagnosticV1,
  evaluateNearJobLimitV1,
  evaluateSlowResponseV1,
  type ClusterBaselineJobV1,
} from "@/lib/analytics/metric-definitions-v1";
import { getEffectiveEntitlements } from "@/lib/billing/entitlements";
import { createPrismaEntitlementRepository } from "@/lib/billing/prisma-publish-quota";
import { getOperationalQueueCounts } from "@/lib/admin/overview";
import { adminNow, requireCapability, type AdminDependencies } from "@/lib/admin/common";

const DAY = 86_400_000;

export type AdminCockpitSignal = Readonly<{
  reason: "LEAD_FOLLOW_UP" | "NEAR_JOB_LIMIT" | "FREE_UPGRADE_CANDIDATE" | "SLOW_RESPONSE" | "JOB_CONTENT_DIAGNOSTIC" | "BOOST_TEST_CANDIDATE";
  dataProvenance: "LIVE" | "DEMO";
  companyId: string;
  companyName: string;
  jobId?: string;
  title: string;
  evidence: string;
  suggestedAction: string;
  leadId?: string;
  leadStatus?: "NEW" | "CONTACTED" | "QUALIFIED" | "WON" | "LOST";
  suggestedNextAt?: string;
}>;

export type AdminDemandOverviewRow = Readonly<{
  cantonCode: string;
  cantonName: string;
  categoryName: string;
  activeJobCount: number;
  submittedApplicationCount30d: number;
}>;

export async function getBusinessCockpit(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_COCKPIT_READ")) return null;
  const now = adminNow(dependencies.now);
  const window30 = new Date(now.getTime() - 30 * DAY);
  const window90 = new Date(now.getTime() - 90 * DAY);
  const [queues, companies, leads, analytics, supplyByCategory, breaches] = await Promise.all([
    getOperationalQueueCounts(dependencies.database, now),
    dependencies.database.company.findMany({
      where: { dataProvenance: { in: ["LIVE", "DEMO"] }, status: { in: ["ACTIVE", "SUSPENDED"] } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true, name: true, status: true, dataProvenance: true,
        verificationRequests: { where: { supersededBy: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { status: true } },
        subscriptions: { where: { status: { in: ["ACTIVE", "CANCELLING"] }, currentPeriodStart: { lte: now }, currentPeriodEnd: { gt: now } }, take: 1, select: { planVersion: { select: { plan: { select: { isDefaultFree: true, code: true } } } } } },
        jobs: {
          where: { status: { in: ["PUBLISHED", "PAUSED", "CLOSED", "EXPIRED"] }, dataProvenance: "LIVE" },
          select: {
            id: true, status: true, publishedAt: true, expiresAt: true, publishedCategoryId: true, publishedCantonId: true, dataProvenance: true,
            publishedCategory: { select: { name: true } },
            publishedCanton: { select: { code: true, name: true } },
            applications: { where: { submittedAt: { gte: window30, lt: now } }, select: { id: true, submittedAt: true, submissionSnapshot: { select: { responseTargetDays: true } }, events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { actorUserId: true, kind: true, createdAt: true } } } },
            currentRevision: { select: { applicationEffort: true, applicationProcessSteps: true, applicationContactKind: true, applicationContactValue: true, salaryPeriod: true, salaryMin: true, salaryMax: true, scoreSnapshots: { orderBy: [{ calculatedAt: "desc" }, { id: "desc" }], take: 1, select: { scoreVersion: true, scorePoints: true, maxPoints: true } } } },
            boosts: { where: { status: { not: "CANCELLED" }, startsAt: { lte: now }, endsAt: { gt: now } }, take: 1, select: { id: true } },
          },
        },
        salesLeads: { where: { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: { id: true, status: true } },
        systemTasks: { where: { reasonCode: { in: ["FREE_UPGRADE_CANDIDATE", "NEAR_JOB_LIMIT", "SLOW_RESPONSE", "JOB_CONTENT_DIAGNOSTIC", "BOOST_TEST_CANDIDATE"] }, status: "DISMISSED", updatedAt: { gte: window30, lte: now } }, select: { reasonCode: true, updatedAt: true } },
      },
    }),
    dependencies.database.salesLead.findMany({ where: { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } }, orderBy: [{ dueAt: "asc" }, { nextAt: "asc" }, { id: "asc" }], take: 50, select: { id: true, companyId: true, organizationName: true, status: true, dueAt: true, nextAt: true, owner: { select: { name: true } }, company: { select: { name: true, dataProvenance: true } } } }),
    dependencies.database.analyticsEvent.findMany({ where: { purpose: "PRODUCT_ANALYTICS", occurredAt: { gte: window90, lt: now }, kind: { in: ["JOB_DETAIL_VIEWED", "APPLY_INTENT_STARTED"] }, jobId: { not: null }, companyProvenanceSnapshot: "LIVE", jobProvenanceSnapshot: "LIVE" }, select: { jobId: true, kind: true, occurredAt: true, pseudonymousSessionId: true, dedupeKey: true, properties: true } }),
    dependencies.database.job.groupBy({ by: ["publishedCategoryId"], where: { status: "PUBLISHED", publishedAt: { lte: now }, expiresAt: { gt: now }, publishedCategoryId: { not: null }, dataProvenance: "LIVE" }, _count: { id: true }, orderBy: { _count: { id: "asc" } }, take: 20 }),
    Promise.all([
      dependencies.database.supportCase.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] }, dueAt: { lte: now } } }),
      dependencies.database.abuseReport.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] }, dueAt: { lte: now } } }),
    ]),
  ]);

  const analyticsByJob = aggregateAnalytics(analytics, window30, window90, now);
  const baselineRows: ClusterBaselineJobV1[] = [];
  const demandByPair = new Map<string, AdminDemandOverviewRow>();
  for (const company of companies) {
    for (const job of company.jobs) {
      if (job.publishedCantonId === null || job.publishedCategoryId === null) continue;
      if (job.publishedCanton !== null && job.publishedCategory !== null) {
        const key = `${job.publishedCantonId}:${job.publishedCategoryId}`;
        const current = demandByPair.get(key) ?? {
          cantonCode: job.publishedCanton.code,
          cantonName: job.publishedCanton.name,
          categoryName: job.publishedCategory.name,
          activeJobCount: 0,
          submittedApplicationCount30d: 0,
        };
        const active = job.status === "PUBLISHED" && job.publishedAt !== null && job.publishedAt <= now && job.expiresAt !== null && job.expiresAt > now;
        demandByPair.set(key, Object.freeze({
          ...current,
          activeJobCount: current.activeJobCount + Number(active),
          submittedApplicationCount30d: current.submittedApplicationCount30d + job.applications.length,
        }));
      }
      const sample = analyticsByJob.get(job.id);
      if (sample === undefined) continue;
      baselineRows.push({ jobId: job.id, cantonId: job.publishedCantonId, categoryId: job.publishedCategoryId, measuredFrom: window90, measuredTo: now, companyProvenance: "LIVE", jobProvenance: job.dataProvenance, organicDetailSessions: sample.views90, conversionBps: rateBps(sample.intents90, sample.views90) });
    }
  }

  const signals: AdminCockpitSignal[] = [];
  for (const lead of leads) {
    if (lead.companyId === null || lead.company === null || !["LIVE", "DEMO"].includes(lead.company.dataProvenance)) continue;
    const targetAt = lead.dueAt ?? lead.nextAt;
    signals.push({
      reason: "LEAD_FOLLOW_UP",
      dataProvenance: lead.company.dataProvenance === "DEMO" ? "DEMO" : "LIVE",
      companyId: lead.companyId,
      companyName: lead.company.name,
      title: `${lead.organizationName ?? lead.company.name} nachfassen`,
      evidence: `${lead.status} · ${targetAt === null ? "Termin offen" : targetAt <= now ? `überfällig seit ${targetAt.toISOString()}` : `fällig ${targetAt.toISOString()}`} · ${lead.owner?.name ?? "nicht zugewiesen"}`,
      suggestedAction: "Owner und nächsten Termin bestätigen; Kontaktversuch mit begrenztem Outcome dokumentieren.",
      leadId: lead.id,
      leadStatus: lead.status,
      suggestedNextAt: new Date(now.getTime() + DAY).toISOString(),
    });
  }
  for (const company of companies) {
    const dataProvenance = company.dataProvenance === "DEMO" ? "DEMO" as const : "LIVE" as const;
    const salesLead = company.salesLeads[0];
    const leadAction = salesLead === undefined ? {} : { leadId: salesLead.id, leadStatus: salesLead.status, suggestedNextAt: new Date(now.getTime() + DAY).toISOString() };
    const entitlements = await getEffectiveEntitlements(company.id, now, createPrismaEntitlementRepository(dependencies.database));
    if (!entitlements.ok) continue;
    const activeJobs = company.jobs.filter((job) => job.status === "PUBLISHED" && job.publishedAt !== null && job.publishedAt <= now && job.expiresAt !== null && job.expiresAt > now).length;
    const submittedApplications = company.jobs.reduce((sum, job) => sum + job.applications.length, 0);
    const dismissed = new Set(company.systemTasks.map((task) => task.reasonCode));
    if (!dismissed.has("NEAR_JOB_LIMIT") && evaluateNearJobLimitV1({ activeJobs, jobLimit: entitlements.value.rights.ACTIVE_JOB_LIMIT, submittedApplications })) {
      signals.push({ reason: "NEAR_JOB_LIMIT", dataProvenance, companyId: company.id, companyName: company.name, title: `${company.name} nutzt ${activeJobs} von ${entitlements.value.rights.ACTIVE_JOB_LIMIT} aktiven Jobs`, evidence: `${submittedApplications} Bewerbungen in 30 Tagen`, suggestedAction: "Plan-Fit prüfen und Upgrade auf Pro anbieten.", ...leadAction });
    }
    const firstPublishedAt = company.jobs.map((job) => job.publishedAt).filter((value): value is Date => value !== null).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    if (!dismissed.has("FREE_UPGRADE_CANDIDATE") && evaluateFreeUpgradeCandidateV1({ companyActive: company.status === "ACTIVE", companyVerified: company.verificationRequests[0]?.status === "VERIFIED", isFreePlan: company.subscriptions[0]?.planVersion.plan.isDefaultFree ?? true, firstPublishedAt, submittedApplications, hasOpenQualifiedLead: company.salesLeads.some((lead) => ["CONTACTED", "QUALIFIED"].includes(lead.status)), dismissedAt: null, now })) {
      signals.push({ reason: "FREE_UPGRADE_CANDIDATE", dataProvenance, companyId: company.id, companyName: company.name, title: `${company.name} zeigt organische Aktivierung`, evidence: `${submittedApplications} Bewerbungen in 30 Tagen`, suggestedAction: "Bedarf erfassen und einen passenden Pro-Plan besprechen.", ...leadAction });
    }
    const dueApplications = company.jobs.flatMap((job) => job.applications).filter((application) => application.submissionSnapshot !== null && new Date(application.submittedAt.getTime() + application.submissionSnapshot.responseTargetDays * DAY) <= now);
    const onTime = dueApplications.filter((application) => application.events.some((event) => ["STATUS_CHANGE", "MESSAGE_SENT"].includes(event.kind) && event.actorUserId !== null && event.createdAt <= new Date(application.submittedAt.getTime() + (application.submissionSnapshot?.responseTargetDays ?? 0) * DAY))).length;
    const onTimeRateBps = rateBps(onTime, dueApplications.length);
    if (!dismissed.has("SLOW_RESPONSE") && evaluateSlowResponseV1({ dueApplications: dueApplications.length, onTimeRateBps })) {
      signals.push({ reason: "SLOW_RESPONSE", dataProvenance, companyId: company.id, companyName: company.name, title: `${company.name} antwortet zu langsam`, evidence: `${onTime}/${dueApplications.length} fristgerechte Erstreaktionen (${onTimeRateBps} bp)`, suggestedAction: "Anti-Ghosting-Prozess empfehlen.", ...leadAction });
    }
    for (const job of company.jobs) {
      if (job.status !== "PUBLISHED" || job.publishedAt === null || job.currentRevision === null) continue;
      const sample = analyticsByJob.get(job.id);
      if (sample === undefined || sample.views30 < 100) continue;
      const revision = job.currentRevision;
      const score = revision.scoreSnapshots[0];
      const content = { organicDetailSessions: sample.views30, applyIntentRateBps: rateBps(sample.intents30, sample.views30), publishedAt: job.publishedAt, now, fairScoreV2: score?.scoreVersion.startsWith("fair-job-score-v2") === true ? Math.floor((score.scorePoints / score.maxPoints) * 100) : null, salaryEvidencePresent: revision.salaryPeriod !== null && revision.salaryMin !== null && revision.salaryMax !== null, processEvidencePresent: revision.applicationProcessSteps.length > 0, applicationEffort: revision.applicationEffort, applyPathBroken: revision.applicationContactValue.trim().length < 3 } as const;
      if (!dismissed.has("JOB_CONTENT_DIAGNOSTIC") && evaluateJobContentDiagnosticV1(content)) {
        signals.push({ reason: "JOB_CONTENT_DIAGNOSTIC", dataProvenance, companyId: company.id, companyName: company.name, jobId: job.id, title: "Job hat viele Views, aber wenig Bewerbungsstarts", evidence: `${sample.views30} organische Views, ${content.applyIntentRateBps} bp Apply-Intent`, suggestedAction: "Zuerst Text, Lohntransparenz und Bewerbungsweg prüfen.", ...leadAction });
        continue;
      }
      if (
        company.status !== "ACTIVE" ||
        company.verificationRequests[0]?.status !== "VERIFIED" ||
        job.expiresAt === null ||
        job.expiresAt <= now
      ) {
        continue;
      }
      if (job.publishedCantonId !== null && job.publishedCategoryId !== null) {
        const baselineBps = calculateClusterBaselineBpsV1(baselineRows, { cantonId: job.publishedCantonId, categoryId: job.publishedCategoryId, now });
        if (!dismissed.has("BOOST_TEST_CANDIDATE") && evaluateBoostTestCandidateV1({ content, hasActiveBoost: job.boosts.length > 0, baselineBps })) {
          signals.push({ reason: "BOOST_TEST_CANDIDATE", dataProvenance, companyId: company.id, companyName: company.name, jobId: job.id, title: "Messbarer Boost-Test möglich", evidence: `${sample.views30} organische Views, Cluster-Baseline ${baselineBps} bp; Messgrösse: Apply-Intent je Detail-Session, Follow-up in 14 Tagen.`, suggestedAction: "Nach bestandener Inhaltsdiagnose einen Sponsored-gekennzeichneten 7-Tage-Boost ab CHF 79 testen; keine Bewerbungen versprechen.", ...leadAction });
        }
      }
    }
  }

  const demandOverview = Object.freeze([...demandByPair.values()].sort((left, right) => right.submittedApplicationCount30d - left.submittedApplicationCount30d || left.activeJobCount - right.activeJobCount || left.cantonCode.localeCompare(right.cantonCode) || left.categoryName.localeCompare(right.categoryName)));
  return Object.freeze({ policyVersion: "COCKPIT_SIGNAL_POLICY_V1", queues, signals: Object.freeze(signals), leads, supplyByCategory, demandOverview, slaBreaches: { support: breaches[0], moderation: breaches[1] }, privacySafeRadarAggregates: null });
}

type AnalyticsRow = Readonly<{ jobId: string | null; kind: string; occurredAt: Date; pseudonymousSessionId: string | null; dedupeKey: string; properties: unknown }>;
function aggregateAnalytics(rows: readonly AnalyticsRow[], window30: Date, window90: Date, now: Date) {
  const buckets = new Map<string, { views30: Set<string>; intents30: Set<string>; views90: Set<string>; intents90: Set<string> }>();
  for (const row of rows) {
    if (row.jobId === null || row.occurredAt < window90 || row.occurredAt >= now) continue;
    const properties = typeof row.properties === "object" && row.properties !== null && !Array.isArray(row.properties) ? row.properties as Record<string, unknown> : {};
    if (row.kind === "JOB_DETAIL_VIEWED" && ["SEARCH_SPONSORED", "HOMEPAGE_SPONSORED"].includes(String(properties.placement ?? "ORGANIC"))) continue;
    const key = row.pseudonymousSessionId ?? row.dedupeKey;
    const bucket = buckets.get(row.jobId) ?? { views30: new Set(), intents30: new Set(), views90: new Set(), intents90: new Set() };
    if (row.kind === "JOB_DETAIL_VIEWED") { bucket.views90.add(key); if (row.occurredAt >= window30) bucket.views30.add(key); }
    if (row.kind === "APPLY_INTENT_STARTED") { bucket.intents90.add(key); if (row.occurredAt >= window30) bucket.intents30.add(key); }
    buckets.set(row.jobId, bucket);
  }
  return new Map([...buckets].map(([jobId, bucket]) => [jobId, { views30: bucket.views30.size, intents30: bucket.intents30.size, views90: bucket.views90.size, intents90: bucket.intents90.size }]));
}
function rateBps(numerator: number, denominator: number) { return denominator <= 0 ? 0 : Math.floor((numerator * 10_000) / denominator); }
