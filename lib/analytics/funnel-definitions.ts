import type {
  AnalyticsEventKind,
  DataProvenance,
} from "@/lib/generated/prisma/enums";
import {
  ANALYTICS_MINIMUM_COHORT_SIZE_V1,
  ratioToBasisPoints,
} from "@/lib/analytics/metric-contracts";

const DAY_MS = 86_400_000;

export const FUNNEL_DEFINITIONS_V1 = Object.freeze({
  version: "v1",
  lateEventCutoffDays: 7,
  candidateActivationWindowDays: 7,
  employerActivationWindowDays: 14,
  searchToApplyWindowDays: 7,
  minimumDenominatorSubjects: ANALYTICS_MINIMUM_COHORT_SIZE_V1,
  businessTimezone: "Europe/Zurich",
});

export type FunnelEventV1 = Readonly<{
  kind: AnalyticsEventKind;
  occurredAt: Date;
  receivedAt?: Date;
  subjectId?: string;
  companyId?: string;
  jobId?: string;
  leadId?: string;
  orderId?: string;
  pseudonymousSessionId?: string;
  actorProvenance: DataProvenance | null;
  companyProvenance: DataProvenance | null;
  jobProvenance: DataProvenance | null;
}>;

export type FunnelRatioV1 =
  | Readonly<{
      status: "VALUE";
      numerator: number;
      denominator: number;
      rateBps: number;
    }>
  | Readonly<{
      status: "SUPPRESSED";
      numerator: "SUPPRESSED";
      denominator: "SUPPRESSED";
      rateBps: "SUPPRESSED";
    }>;

export type SearchToApplyFunnelV1 =
  | Readonly<{
      status: "VALUE";
      resultSessions: number;
      detailSessions: number;
      intentSessions: number;
      submittedSessions: number;
      resultToApplyRateBps: number;
    }>
  | Readonly<{
      status: "SUPPRESSED";
      resultSessions: "SUPPRESSED";
      detailSessions: "SUPPRESSED";
      intentSessions: "SUPPRESSED";
      submittedSessions: "SUPPRESSED";
      resultToApplyRateBps: "SUPPRESSED";
    }>;

export type LeadFunnelV1 =
  | Readonly<{
      status: "VALUE";
      submitted: number;
      qualified: number;
      won: number;
      submittedToWonBps: number;
    }>
  | Readonly<{
      status: "SUPPRESSED";
      submitted: "SUPPRESSED";
      qualified: "SUPPRESSED";
      won: "SUPPRESSED";
      submittedToWonBps: "SUPPRESSED";
    }>;

export type CheckoutConversionFunnelV1 =
  | Readonly<{
      status: "VALUE";
      started: number;
      completed: number;
      conversionBps: number;
    }>
  | Readonly<{
      status: "SUPPRESSED";
      started: "SUPPRESSED";
      completed: "SUPPRESSED";
      conversionBps: "SUPPRESSED";
    }>;

export function calculateCandidateActivation7dV1(
  events: readonly FunnelEventV1[],
): FunnelRatioV1 {
  return calculateActivation(
    admissibleLiveEvents(events),
    "CANDIDATE_REGISTERED",
    "CANDIDATE_PROFILE_COMPLETED",
    "subjectId",
    FUNNEL_DEFINITIONS_V1.candidateActivationWindowDays,
  );
}

export function calculateEmployerActivation14dV1(
  events: readonly FunnelEventV1[],
): FunnelRatioV1 {
  return calculateActivation(
    admissibleLiveEvents(events),
    "COMPANY_ONBOARDING_COMPLETED",
    "JOB_PUBLISHED",
    "companyId",
    FUNNEL_DEFINITIONS_V1.employerActivationWindowDays,
  );
}

export function calculateSearchToApply7dV1(
  events: readonly FunnelEventV1[],
): SearchToApplyFunnelV1 {
  const bySession = groupByRequiredKey(
    admissibleLiveEvents(events),
    "pseudonymousSessionId",
  );
  let resultSessions = 0;
  let detailSessions = 0;
  let intentSessions = 0;
  let submittedSessions = 0;

  for (const sessionEvents of bySession.values()) {
    const ordered = [...sessionEvents].sort(compareEvents);
    const results = ordered.find((event) => event.kind === "SEARCH_RESULTS_VIEWED");
    if (!results) {
      continue;
    }
    resultSessions += 1;

    const deadline = results.occurredAt.getTime() +
      FUNNEL_DEFINITIONS_V1.searchToApplyWindowDays * DAY_MS;
    const detail = ordered.find(
      (event) =>
        event.kind === "JOB_DETAIL_VIEWED" &&
        followsWithin(event, results.occurredAt, deadline),
    );
    if (!detail) {
      continue;
    }
    detailSessions += 1;

    const applyIntent = ordered.find(
      (event) =>
        event.kind === "APPLY_INTENT_STARTED" &&
        followsWithin(event, detail.occurredAt, deadline),
    );
    if (!applyIntent) {
      continue;
    }
    intentSessions += 1;

    const submitted = ordered.find(
      (event) =>
        event.kind === "APPLICATION_SUBMITTED" &&
        followsWithin(event, applyIntent.occurredAt, deadline),
    );
    if (submitted) {
      submittedSessions += 1;
    }
  }

  if (isSuppressedPopulation(resultSessions)) {
    return Object.freeze({
      status: "SUPPRESSED",
      resultSessions: "SUPPRESSED",
      detailSessions: "SUPPRESSED",
      intentSessions: "SUPPRESSED",
      submittedSessions: "SUPPRESSED",
      resultToApplyRateBps: "SUPPRESSED",
    });
  }

  return Object.freeze({
    status: "VALUE",
    resultSessions,
    detailSessions,
    intentSessions,
    submittedSessions,
    resultToApplyRateBps: ratioToBasisPoints(submittedSessions, resultSessions),
  });
}

export function calculateLeadFunnelV1(
  events: readonly FunnelEventV1[],
): LeadFunnelV1 {
  return calculateOrderedThreeStageFunnel(
    admissibleLiveEvents(events),
    "leadId",
    "LEAD_SUBMITTED",
    "LEAD_QUALIFIED",
    "LEAD_WON",
  );
}

export function calculateCheckoutConversionV1(
  events: readonly FunnelEventV1[],
): CheckoutConversionFunnelV1 {
  const cohorts = new Map<string, readonly FunnelEventV1[]>();
  for (const [key, values] of groupByRequiredKey(
    admissibleLiveEvents(events),
    "orderId",
  )) {
    const companyId = values[0]?.companyId;
    if (companyId) {
      cohorts.set(`${companyId}:${key}`, values);
    }
  }

  let started = 0;
  let completed = 0;
  for (const values of cohorts.values()) {
    const ordered = [...values].sort(compareEvents);
    const start = ordered.find((event) => event.kind === "CHECKOUT_STARTED");
    if (!start) {
      continue;
    }
    started += 1;
    if (
      ordered.some(
        (event) =>
          event.kind === "CHECKOUT_COMPLETED" &&
          event.occurredAt.getTime() >= start.occurredAt.getTime(),
      )
    ) {
      completed += 1;
    }
  }

  if (isSuppressedPopulation(started)) {
    return Object.freeze({
      status: "SUPPRESSED",
      started: "SUPPRESSED",
      completed: "SUPPRESSED",
      conversionBps: "SUPPRESSED",
    });
  }

  return Object.freeze({
    status: "VALUE",
    started,
    completed,
    conversionBps: ratioToBasisPoints(completed, started),
  });
}

export function isAdmissibleAnalyticsEventV1(event: FunnelEventV1) {
  const snapshots = [
    event.actorProvenance,
    event.companyProvenance,
    event.jobProvenance,
  ];
  if (snapshots.some((snapshot) => snapshot !== null && snapshot !== "LIVE")) {
    return false;
  }
  if (
    (event.subjectId !== undefined && event.actorProvenance !== "LIVE") ||
    (event.companyId !== undefined && event.companyProvenance !== "LIVE") ||
    (event.jobId !== undefined && event.jobProvenance !== "LIVE")
  ) {
    return false;
  }
  const receivedAt = event.receivedAt ?? event.occurredAt;
  const delay = receivedAt.getTime() - event.occurredAt.getTime();
  return delay >= 0 && delay < FUNNEL_DEFINITIONS_V1.lateEventCutoffDays * DAY_MS;
}

export function getZurichBusinessDateV1(at: Date) {
  if (!Number.isFinite(at.getTime())) {
    throw new RangeError("A valid instant is required for Zurich attribution.");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUNNEL_DEFINITIONS_V1.businessTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function admissibleLiveEvents(events: readonly FunnelEventV1[]) {
  return events.filter(isAdmissibleAnalyticsEventV1);
}

function calculateActivation<TKey extends "subjectId" | "companyId">(
  events: readonly FunnelEventV1[],
  cohortKind: AnalyticsEventKind,
  activationKind: AnalyticsEventKind,
  key: TKey,
  windowDays: number,
): FunnelRatioV1 {
  const bySubject = groupByRequiredKey(events, key);
  let denominator = 0;
  let numerator = 0;

  for (const subjectEvents of bySubject.values()) {
    const ordered = [...subjectEvents].sort(compareEvents);
    const cohort = ordered.find((event) => event.kind === cohortKind);
    if (!cohort) {
      continue;
    }
    denominator += 1;
    const deadline = cohort.occurredAt.getTime() + windowDays * DAY_MS;
    if (
      ordered.some(
        (event) =>
          event.kind === activationKind &&
          followsWithin(event, cohort.occurredAt, deadline),
      )
    ) {
      numerator += 1;
    }
  }

  return buildFunnelRatio(numerator, denominator);
}

function calculateOrderedThreeStageFunnel<TKey extends "leadId">(
  events: readonly FunnelEventV1[],
  key: TKey,
  firstKind: AnalyticsEventKind,
  secondKind: AnalyticsEventKind,
  thirdKind: AnalyticsEventKind,
): LeadFunnelV1 {
  let first = 0;
  let second = 0;
  let third = 0;

  for (const values of groupByRequiredKey(events, key).values()) {
    const ordered = [...values].sort(compareEvents);
    const firstEvent = ordered.find((event) => event.kind === firstKind);
    if (!firstEvent) {
      continue;
    }
    first += 1;
    const secondEvent = ordered.find(
      (event) =>
        event.kind === secondKind &&
        event.occurredAt.getTime() >= firstEvent.occurredAt.getTime(),
    );
    if (!secondEvent) {
      continue;
    }
    second += 1;
    if (
      ordered.some(
        (event) =>
          event.kind === thirdKind &&
          event.occurredAt.getTime() >= secondEvent.occurredAt.getTime(),
      )
    ) {
      third += 1;
    }
  }

  if (isSuppressedPopulation(first)) {
    return Object.freeze({
      status: "SUPPRESSED",
      submitted: "SUPPRESSED",
      qualified: "SUPPRESSED",
      won: "SUPPRESSED",
      submittedToWonBps: "SUPPRESSED",
    });
  }

  return Object.freeze({
    status: "VALUE",
    submitted: first,
    qualified: second,
    won: third,
    submittedToWonBps: ratioToBasisPoints(third, first),
  });
}

function groupByRequiredKey<TKey extends keyof FunnelEventV1>(
  events: readonly FunnelEventV1[],
  key: TKey,
) {
  const grouped = new Map<string, FunnelEventV1[]>();
  for (const event of events) {
    const value = event[key];
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    const bucket = grouped.get(value) ?? [];
    bucket.push(event);
    grouped.set(value, bucket);
  }
  return grouped;
}

function followsWithin(event: FunnelEventV1, start: Date, deadline: number) {
  return event.occurredAt.getTime() >= start.getTime() &&
    event.occurredAt.getTime() < deadline;
}

function compareEvents(left: FunnelEventV1, right: FunnelEventV1) {
  return left.occurredAt.getTime() - right.occurredAt.getTime();
}

function buildFunnelRatio(
  numerator: number,
  denominator: number,
): FunnelRatioV1 {
  if (isSuppressedPopulation(denominator)) {
    return Object.freeze({
      status: "SUPPRESSED",
      numerator: "SUPPRESSED",
      denominator: "SUPPRESSED",
      rateBps: "SUPPRESSED",
    });
  }

  return Object.freeze({
    status: "VALUE",
    numerator,
    denominator,
    rateBps: ratioToBasisPoints(numerator, denominator),
  });
}

function isSuppressedPopulation(population: number) {
  return population < FUNNEL_DEFINITIONS_V1.minimumDenominatorSubjects;
}
