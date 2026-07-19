import type { AnalyticsLevel, DataProvenance } from "@/lib/generated/prisma/enums";
import {
  buildSuppressedMetricCellV1,
  type MetricCell,
} from "@/lib/analytics/metric-contracts";

export const EMPLOYER_METRICS_POLICY_V1 = Object.freeze({
  version: "v1",
  basicLevels: Object.freeze(["BASIC", "ADVANCED", "PRO"] as const),
  breakdownLevels: Object.freeze(["ADVANCED", "PRO"] as const),
});

export type EmployerMetricEventV1 = Readonly<{
  eventId: string;
  kind:
    | "JOB_DETAIL_VIEWED"
    | "JOB_SAVED"
    | "APPLICATION_SUBMITTED"
    | "EMPLOYER_RESPONSE_RECORDED";
  occurredAt: Date;
  companyId: string;
  jobId: string;
  subjectId: string;
  actorProvenance: DataProvenance | null;
  companyProvenance: DataProvenance;
  jobProvenance: DataProvenance;
}>;

export type EmployerMetricJobBreakdownV1 = Readonly<{
  jobId: string;
  detailViews: number | "SUPPRESSED";
  saves: number | "SUPPRESSED";
  applications: number | "SUPPRESSED";
  applyRate: MetricCell;
}>;

export type EmployerMetricsResultV1 =
  | Readonly<{ allowed: false; reason: "ANALYTICS_ENTITLEMENT_REQUIRED" }>
  | Readonly<{
      allowed: true;
      totals:
        | Readonly<{
            status: "SUPPRESSED";
            detailViews: "SUPPRESSED";
            saves: "SUPPRESSED";
            applications: "SUPPRESSED";
            employerResponses: "SUPPRESSED";
            applyRateBps: "SUPPRESSED";
          }>
        | Readonly<{
            status: "VALUE";
            detailViews: number;
            saves: number;
            applications: number;
            employerResponses: number;
            applyRateBps: number;
          }>;
      jobBreakdown: readonly EmployerMetricJobBreakdownV1[] | null;
    }>;

export function aggregateEmployerMetricsV1(
  events: readonly EmployerMetricEventV1[],
  query: Readonly<{
    companyId: string;
    from: Date;
    to: Date;
    analyticsLevel: AnalyticsLevel;
  }>,
): EmployerMetricsResultV1 {
  if (!EMPLOYER_METRICS_POLICY_V1.basicLevels.includes(
    query.analyticsLevel as (typeof EMPLOYER_METRICS_POLICY_V1.basicLevels)[number],
  )) {
    return Object.freeze({
      allowed: false,
      reason: "ANALYTICS_ENTITLEMENT_REQUIRED",
    });
  }

  const scoped = dedupeEvents(events).filter(
    (event) =>
      event.companyId === query.companyId &&
      event.companyProvenance === "LIVE" &&
      event.jobProvenance === "LIVE" &&
      (event.actorProvenance === null || event.actorProvenance === "LIVE") &&
      event.occurredAt.getTime() >= query.from.getTime() &&
      event.occurredAt.getTime() < query.to.getTime(),
  );
  const totals = buildEmployerTotals(scoped);
  const canBreakDown = EMPLOYER_METRICS_POLICY_V1.breakdownLevels.includes(
    query.analyticsLevel as (typeof EMPLOYER_METRICS_POLICY_V1.breakdownLevels)[number],
  );

  return Object.freeze({
    allowed: true,
    totals,
    jobBreakdown: canBreakDown ? buildJobBreakdown(scoped) : null,
  });
}

function buildEmployerTotals(events: readonly EmployerMetricEventV1[]) {
  const viewedSubjects = new Set(
    events
      .filter((event) => event.kind === "JOB_DETAIL_VIEWED")
      .map((event) => event.subjectId),
  );
  const applicantSubjects = new Set(
    events
      .filter((event) => event.kind === "APPLICATION_SUBMITTED")
      .map((event) => event.subjectId),
  );
  const applyRate = buildSuppressedMetricCellV1(
    [...viewedSubjects].map((subjectId) => ({
      subjectId,
      qualifies: applicantSubjects.has(subjectId),
    })),
  );
  if (applyRate.status === "SUPPRESSED") {
    return Object.freeze({
      status: "SUPPRESSED" as const,
      detailViews: "SUPPRESSED" as const,
      saves: "SUPPRESSED" as const,
      applications: "SUPPRESSED" as const,
      employerResponses: "SUPPRESSED" as const,
      applyRateBps: "SUPPRESSED" as const,
    });
  }

  const totals = countMetrics(events);
  return Object.freeze({
    status: "VALUE" as const,
    ...totals,
    applyRateBps: applyRate.valueBps,
  });
}

function buildJobBreakdown(events: readonly EmployerMetricEventV1[]) {
  const byJob = new Map<string, EmployerMetricEventV1[]>();
  for (const event of events) {
    const bucket = byJob.get(event.jobId) ?? [];
    bucket.push(event);
    byJob.set(event.jobId, bucket);
  }

  return [...byJob.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([jobId, jobEvents]) => {
      const counts = countMetrics(jobEvents);
      const viewedSubjects = new Set(
        jobEvents
          .filter((event) => event.kind === "JOB_DETAIL_VIEWED")
          .map((event) => event.subjectId),
      );
      const applicantSubjects = new Set(
        jobEvents
          .filter((event) => event.kind === "APPLICATION_SUBMITTED")
          .map((event) => event.subjectId),
      );
      const applyRate = buildSuppressedMetricCellV1(
        [...viewedSubjects].map((subjectId) => ({
          subjectId,
          qualifies: applicantSubjects.has(subjectId),
        })),
      );
      const suppressed = applyRate.status === "SUPPRESSED";
      return Object.freeze({
        jobId,
        detailViews: suppressed ? "SUPPRESSED" as const : counts.detailViews,
        saves: suppressed ? "SUPPRESSED" as const : counts.saves,
        applications: suppressed ? "SUPPRESSED" as const : counts.applications,
        applyRate,
      });
    });
}

function countMetrics(events: readonly EmployerMetricEventV1[]) {
  return {
    detailViews: distinctSubjects(events, "JOB_DETAIL_VIEWED"),
    saves: distinctSubjects(events, "JOB_SAVED"),
    applications: distinctSubjects(events, "APPLICATION_SUBMITTED"),
    employerResponses: distinctSubjects(events, "EMPLOYER_RESPONSE_RECORDED"),
  };
}

function distinctSubjects(
  events: readonly EmployerMetricEventV1[],
  kind: EmployerMetricEventV1["kind"],
) {
  return new Set(
    events.filter((event) => event.kind === kind).map((event) => event.subjectId),
  ).size;
}

function dedupeEvents(events: readonly EmployerMetricEventV1[]) {
  return [...new Map(events.map((event) => [event.eventId, event])).values()];
}
