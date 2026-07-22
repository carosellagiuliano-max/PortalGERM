import "server-only";

import type { AnalyticsEventKind, DataProvenance } from "@/lib/generated/prisma/enums";

import { adminNow, requireCapability, type AdminDependencies } from "@/lib/admin/common";
import {
  calculateCandidateActivation7dV1,
  calculateCheckoutConversionV1,
  calculateEmployerActivation14dV1,
  calculateLeadFunnelV1,
  calculateSearchToApply7dV1,
  FUNNEL_DEFINITIONS_V1,
  getZurichBusinessDateV1,
  type FunnelEventV1,
} from "@/lib/analytics/funnel-definitions";
import {
  ANALYTICS_EVENT_CONTRACTS_V1,
} from "@/lib/analytics/event-contracts";
import {
  ANALYTICS_SUPPRESSION_V1,
  METRIC_DEFINITIONS_V1,
  type AnalyticsMetricKeyV1,
} from "@/lib/analytics/metric-definitions-v1";
import { PUBLIC_PLAN_ORDER_V1, type PublicPlanCode } from "@/lib/billing/public-catalog-core";

const DAY_MILLISECONDS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const FUNNEL_EVENT_KINDS = Object.freeze([
  "CANDIDATE_REGISTERED",
  "CANDIDATE_PROFILE_COMPLETED",
  "COMPANY_ONBOARDING_COMPLETED",
  "JOB_PUBLISHED",
  "SEARCH_RESULTS_VIEWED",
  "JOB_DETAIL_VIEWED",
  "APPLY_INTENT_STARTED",
  "APPLICATION_SUBMITTED",
  "LEAD_SUBMITTED",
  "LEAD_QUALIFIED",
  "LEAD_WON",
  "CHECKOUT_STARTED",
  "CHECKOUT_COMPLETED",
] as const satisfies readonly AnalyticsEventKind[]);

export const ADMIN_FUNNEL_CHANNELS_V1 = Object.freeze([
  "ALL",
  "JOB_SEARCH",
  "EMPLOYER_DEMO",
  "SALES_CONTACT",
  "ENTERPRISE",
  "IMPORT",
  "CHECKOUT",
] as const);

export const ADMIN_FUNNEL_PLANS_V1 = Object.freeze([
  "ALL",
  ...PUBLIC_PLAN_ORDER_V1,
] as const);

export type AdminFunnelChannel = (typeof ADMIN_FUNNEL_CHANNELS_V1)[number];
export type AdminFunnelPlan = (typeof ADMIN_FUNNEL_PLANS_V1)[number];

export const ADMIN_FUNNEL_POLICY_V1 = Object.freeze({
  version: "ADMIN_FUNNELS_V1" as const,
  definitionVersion: FUNNEL_DEFINITIONS_V1.version,
  businessTimezone: FUNNEL_DEFINITIONS_V1.businessTimezone,
  maximumCohortDays: 90,
  minimumDenominatorSubjects:
    ANALYTICS_SUPPRESSION_V1.minimumDistinctDenominatorSubjects,
  dateSemantics: "HALF_OPEN_ZURICH_DATES" as const,
  provenanceOutsideDemoMode: "LIVE_ONLY" as const,
  provenanceInDemoMode: "LIVE_AND_DEMO" as const,
});

export type AdminFunnelRawFilters = Readonly<{
  from?: string | readonly string[];
  to?: string | readonly string[];
  channel?: string | readonly string[];
  plan?: string | readonly string[];
  cluster?: string | readonly string[];
}>;

export type AdminFunnelClusterOption = Readonly<{
  key: string;
  cantonCode: string;
  cantonName: string;
  categorySlug: string;
  categoryName: string;
}>;

export type AdminFunnelFilters = Readonly<{
  fromDate: string;
  toDate: string;
  maximumToDate: string;
  from: Date;
  to: Date;
  channel: AdminFunnelChannel;
  plan: AdminFunnelPlan;
  clusterKey: string | null;
  adjusted: boolean;
}>;

type AdminFunnelDimension = "COHORT_DATE" | "CLUSTER" | "CHANNEL" | "PLAN";
type AdminFunnelValue = number | "SUPPRESSED";

export type AdminFunnelCard = Readonly<{
  key:
    | "CANDIDATE_ACTIVATION"
    | "EMPLOYER_ACTIVATION"
    | "SEARCH_TO_APPLY"
    | "LEAD_FUNNEL"
    | "CHECKOUT_FUNNEL";
  title: string;
  metricKey: AnalyticsMetricKeyV1;
  metricVersion: "v1";
  formula: string;
  window: string;
  denominatorSubject: string;
  status: "VALUE" | "SUPPRESSED";
  stages: readonly Readonly<{ label: string; value: AdminFunnelValue }>[];
  rateBps: AdminFunnelValue;
  appliedDimensions: readonly AdminFunnelDimension[];
  unavailableDimensions: readonly Exclude<AdminFunnelDimension, "COHORT_DATE">[];
}>;

export type AdminFunnelDashboard = Readonly<{
  policyVersion: typeof ADMIN_FUNNEL_POLICY_V1.version;
  measuredAt: Date;
  provenanceMode: "LIVE_ONLY" | "LIVE_AND_DEMO";
  filters: AdminFunnelFilters;
  options: Readonly<{
    channels: typeof ADMIN_FUNNEL_CHANNELS_V1;
    plans: typeof ADMIN_FUNNEL_PLANS_V1;
    clusters: readonly AdminFunnelClusterOption[];
  }>;
  cards: readonly AdminFunnelCard[];
}>;

type RawFunnelEvent = Readonly<{
  id: string;
  kind: AnalyticsEventKind;
  purpose: "ESSENTIAL_OPERATIONAL" | "PRODUCT_ANALYTICS";
  schemaVersion: string;
  occurredAt: Date;
  receivedAt: Date;
  pseudonymousActorId: string | null;
  pseudonymousSessionId: string | null;
  companyId: string | null;
  jobId: string | null;
  actorProvenanceSnapshot: DataProvenance | null;
  companyProvenanceSnapshot: DataProvenance | null;
  jobProvenanceSnapshot: DataProvenance | null;
  properties: unknown;
  job: Readonly<{
    publishedCanton: Readonly<{ code: string }> | null;
    publishedCategory: Readonly<{ slug: string }> | null;
  }> | null;
}>;

type PreparedFunnelEvent = FunnelEventV1 & Readonly<{
  id: string;
  properties: Readonly<Record<string, unknown>>;
  clusterKey: string | null;
}>;

/**
 * Authorized Phase-12 strategy-funnel read model. It returns no actor, session,
 * order, lead, Company or Job identifiers and delegates every formula and
 * suppression decision to the frozen Phase-03 implementation.
 */
export async function getAdminFunnelDashboard(
  rawFilters: AdminFunnelRawFilters,
  dependencies: AdminDependencies,
  options: Readonly<{ demoMode?: boolean }> = {},
): Promise<AdminFunnelDashboard | null> {
  if (!requireCapability(dependencies, "ADMIN_ANALYTICS_READ")) return null;
  const now = adminNow(dependencies.now);
  const demoMode = options.demoMode === true;
  const clusters = await loadLaunchClusterOptions(dependencies, now, demoMode);
  const filters = parseAdminFunnelFiltersV1(rawFilters, now, clusters);

  const rows = await dependencies.database.analyticsEvent.findMany({
    where: {
      schemaVersion: "1",
      kind: { in: [...FUNNEL_EVENT_KINDS] },
      occurredAt: { gte: filters.from, lt: now },
      receivedAt: { lte: now },
      retainUntil: { gt: now },
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      kind: true,
      purpose: true,
      schemaVersion: true,
      occurredAt: true,
      receivedAt: true,
      pseudonymousActorId: true,
      pseudonymousSessionId: true,
      companyId: true,
      jobId: true,
      actorProvenanceSnapshot: true,
      companyProvenanceSnapshot: true,
      jobProvenanceSnapshot: true,
      properties: true,
      job: {
        select: {
          publishedCanton: { select: { code: true } },
          publishedCategory: { select: { slug: true } },
        },
      },
    },
  });

  const events = (rows as readonly RawFunnelEvent[])
    .map((row) => prepareFunnelEvent(row, demoMode))
    .filter((event): event is PreparedFunnelEvent => event !== null);
  const selectedCluster = filters.clusterKey;

  const candidateEvents = selectCohorts(
    events.filter((event) =>
      event.kind === "CANDIDATE_REGISTERED" ||
      event.kind === "CANDIDATE_PROFILE_COMPLETED"
    ),
    "subjectId",
    "CANDIDATE_REGISTERED",
    filters,
  );

  const employerEvents = selectCohorts(
    events.filter((event) =>
      event.kind === "COMPANY_ONBOARDING_COMPLETED" ||
      event.kind === "JOB_PUBLISHED"
    ),
    "companyId",
    "COMPANY_ONBOARDING_COMPLETED",
    filters,
    (cohort) => selectedCluster === null || cohort.some(
      (event) => event.kind === "JOB_PUBLISHED" && event.clusterKey === selectedCluster,
    ),
  );

  const searchEvents = selectCohorts(
    events.filter((event) => [
      "SEARCH_RESULTS_VIEWED",
      "JOB_DETAIL_VIEWED",
      "APPLY_INTENT_STARTED",
      "APPLICATION_SUBMITTED",
    ].includes(event.kind)),
    "pseudonymousSessionId",
    "SEARCH_RESULTS_VIEWED",
    filters,
    (cohort, cohortStart) =>
      matchesSearchChannel(cohortStart, filters.channel) &&
      (selectedCluster === null || resolveCohortCluster(cohort, cohortStart) === selectedCluster),
  );

  const leadEvents = selectCohorts(
    events.filter((event) => [
      "LEAD_SUBMITTED",
      "LEAD_QUALIFIED",
      "LEAD_WON",
    ].includes(event.kind)),
    "leadId",
    "LEAD_SUBMITTED",
    filters,
    (_cohort, cohortStart) => matchesLeadChannel(cohortStart, filters.channel),
  );

  const checkoutEvents = selectCohorts(
    events.filter((event) =>
      event.kind === "CHECKOUT_STARTED" || event.kind === "CHECKOUT_COMPLETED"
    ),
    "orderId",
    "CHECKOUT_STARTED",
    filters,
    (_cohort, cohortStart) =>
      matchesCheckoutChannel(filters.channel) &&
      matchesCheckoutPlan(cohortStart, filters.plan),
  );

  const candidate = calculateCandidateActivation7dV1(candidateEvents);
  const employer = calculateEmployerActivation14dV1(employerEvents);
  const search = calculateSearchToApply7dV1(searchEvents);
  const lead = calculateLeadFunnelV1(leadEvents);
  const checkout = calculateCheckoutConversionV1(checkoutEvents);

  const cards = Object.freeze([
    ratioCard({
      key: "CANDIDATE_ACTIVATION",
      title: "Candidate Activation",
      metricKey: "CANDIDATE_ACTIVATION",
      result: candidate,
      numeratorLabel: "Profil vollständig",
      denominatorLabel: "Registrierte Kandidaturen",
      appliedDimensions: ["COHORT_DATE"],
      unavailableDimensions: ["CLUSTER", "CHANNEL", "PLAN"],
    }),
    ratioCard({
      key: "EMPLOYER_ACTIVATION",
      title: "Employer Activation",
      metricKey: "EMPLOYER_ACTIVATION",
      result: employer,
      numeratorLabel: "Stelle publiziert",
      denominatorLabel: "Onboardete Unternehmen",
      appliedDimensions: selectedCluster === null
        ? ["COHORT_DATE"]
        : ["COHORT_DATE", "CLUSTER"],
      unavailableDimensions: ["CHANNEL", "PLAN"],
    }),
    multiStageCard({
      key: "SEARCH_TO_APPLY",
      title: "Search → Detail → Apply",
      metricKey: "SEARCH_FUNNEL",
      status: search.status,
      stages: search.status === "VALUE"
        ? [
            { label: "Suchergebnis-Sessions", value: search.resultSessions },
            { label: "Detail-Sessions", value: search.detailSessions },
            { label: "Apply-Intent-Sessions", value: search.intentSessions },
            { label: "Bewerbungs-Sessions", value: search.submittedSessions },
          ]
        : suppressedStages([
            "Suchergebnis-Sessions",
            "Detail-Sessions",
            "Apply-Intent-Sessions",
            "Bewerbungs-Sessions",
          ]),
      rateBps: search.resultToApplyRateBps,
      appliedDimensions: selectedDimensions(filters, ["CLUSTER", "CHANNEL"]),
      unavailableDimensions: ["PLAN"],
    }),
    multiStageCard({
      key: "LEAD_FUNNEL",
      title: "Lead → Qualified → Won",
      metricKey: "LEAD_FUNNEL",
      status: lead.status,
      stages: lead.status === "VALUE"
        ? [
            { label: "Eingereicht", value: lead.submitted },
            { label: "Qualifiziert", value: lead.qualified },
            { label: "Gewonnen", value: lead.won },
          ]
        : suppressedStages(["Eingereicht", "Qualifiziert", "Gewonnen"]),
      rateBps: lead.submittedToWonBps,
      appliedDimensions: selectedDimensions(filters, ["CHANNEL"]),
      unavailableDimensions: ["CLUSTER", "PLAN"],
    }),
    multiStageCard({
      key: "CHECKOUT_FUNNEL",
      title: "Checkout",
      metricKey: "CHECKOUT_FUNNEL",
      status: checkout.status,
      stages: checkout.status === "VALUE"
        ? [
            { label: "Gestartete Aufträge", value: checkout.started },
            { label: "Abgeschlossene Aufträge", value: checkout.completed },
          ]
        : suppressedStages(["Gestartete Aufträge", "Abgeschlossene Aufträge"]),
      rateBps: checkout.conversionBps,
      appliedDimensions: selectedDimensions(filters, ["CHANNEL", "PLAN"]),
      unavailableDimensions: ["CLUSTER"],
    }),
  ] satisfies readonly AdminFunnelCard[]);

  return Object.freeze({
    policyVersion: ADMIN_FUNNEL_POLICY_V1.version,
    measuredAt: new Date(now),
    provenanceMode: demoMode ? "LIVE_AND_DEMO" : "LIVE_ONLY",
    filters,
    options: Object.freeze({
      channels: ADMIN_FUNNEL_CHANNELS_V1,
      plans: ADMIN_FUNNEL_PLANS_V1,
      clusters,
    }),
    cards,
  });
}

export function parseAdminFunnelFiltersV1(
  raw: AdminFunnelRawFilters,
  now: Date,
  clusters: readonly AdminFunnelClusterOption[],
): AdminFunnelFilters {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Admin funnel filters require a valid clock.");
  }
  const today = getZurichBusinessDateV1(now);
  const defaultTo = today;
  const defaultFrom = shiftCalendarDate(defaultTo, -30);
  const candidateFrom = scalar(raw.from);
  const candidateTo = scalar(raw.to);
  const dateInputProvided = raw.from !== undefined || raw.to !== undefined;
  const validDates = candidateFrom !== null && candidateTo !== null &&
    isBoundedDateWindow(candidateFrom, candidateTo, today);
  const fromDate = validDates ? candidateFrom : defaultFrom;
  const toDate = validDates ? candidateTo : defaultTo;
  const rawChannel = scalar(raw.channel);
  const channel = ADMIN_FUNNEL_CHANNELS_V1.includes(rawChannel as AdminFunnelChannel)
    ? rawChannel as AdminFunnelChannel
    : "ALL";
  const rawPlan = scalar(raw.plan);
  const plan = ADMIN_FUNNEL_PLANS_V1.includes(rawPlan as AdminFunnelPlan)
    ? rawPlan as AdminFunnelPlan
    : "ALL";
  const rawCluster = scalar(raw.cluster);
  const clusterKey = rawCluster !== null && rawCluster !== "ALL" && clusters.some((option) => option.key === rawCluster)
    ? rawCluster
    : null;

  return Object.freeze({
    fromDate,
    toDate,
    maximumToDate: today,
    from: resolveZurichMidnight(fromDate),
    to: resolveZurichMidnight(toDate),
    channel,
    plan,
    clusterKey,
    adjusted:
      (dateInputProvided && !validDates) ||
      (raw.channel !== undefined && rawChannel !== channel) ||
      (raw.plan !== undefined && rawPlan !== plan) ||
      (raw.cluster !== undefined && !(
        rawCluster === "ALL" ||
        (rawCluster !== null && rawCluster === clusterKey)
      )),
  });
}

async function loadLaunchClusterOptions(
  dependencies: AdminDependencies,
  now: Date,
  demoMode: boolean,
): Promise<readonly AdminFunnelClusterOption[]> {
  const rows = await dependencies.database.clusterLaunchAssessment.findMany({
    where: {
      status: "ACTIVATED",
      activatedAt: { lte: now },
      revokedAt: null,
      validUntil: { gt: now },
      dataProvenance: demoMode ? { in: ["LIVE", "DEMO"] } : "LIVE",
    },
    orderBy: [
      { canton: { sortOrder: "asc" } },
      { canton: { code: "asc" } },
      { category: { sortOrder: "asc" } },
      { category: { slug: "asc" } },
      { id: "asc" },
    ],
    select: {
      canton: { select: { code: true, name: true } },
      category: { select: { slug: true, name: true } },
    },
  });
  const unique = new Map<string, AdminFunnelClusterOption>();
  for (const row of rows) {
    const key = clusterKey(row.canton.code, row.category.slug);
    unique.set(key, Object.freeze({
      key,
      cantonCode: row.canton.code,
      cantonName: row.canton.name,
      categorySlug: row.category.slug,
      categoryName: row.category.name,
    }));
  }
  return Object.freeze([...unique.values()]);
}

function prepareFunnelEvent(
  raw: RawFunnelEvent,
  demoMode: boolean,
): PreparedFunnelEvent | null {
  if (raw.schemaVersion !== "1") return null;
  const contract = ANALYTICS_EVENT_CONTRACTS_V1[raw.kind];
  if (contract === undefined || raw.purpose !== contract.purpose) return null;
  const propertiesResult = contract.propertiesSchema.safeParse(raw.properties);
  if (!propertiesResult.success) return null;
  const provenance = normalizeProvenance(raw, demoMode);
  if (provenance === null) return null;
  const properties = Object.freeze({
    ...(propertiesResult.data as Record<string, unknown>),
  });
  const propertyCanton = stringProperty(properties, "cantonCode");
  const propertyCategory = stringProperty(properties, "categorySlug");
  const jobCanton = raw.job?.publishedCanton?.code ?? null;
  const jobCategory = raw.job?.publishedCategory?.slug ?? null;
  const resolvedCluster = propertyCanton !== null && propertyCategory !== null
    ? clusterKey(propertyCanton, propertyCategory)
    : jobCanton !== null && jobCategory !== null
      ? clusterKey(jobCanton, jobCategory)
      : null;

  return Object.freeze({
    id: raw.id,
    kind: raw.kind,
    occurredAt: new Date(raw.occurredAt),
    receivedAt: new Date(raw.receivedAt),
    ...(raw.pseudonymousActorId === null || ![
      "CANDIDATE_REGISTERED",
      "CANDIDATE_PROFILE_COMPLETED",
    ].includes(raw.kind)
      ? {}
      : { subjectId: raw.pseudonymousActorId }),
    ...(raw.companyId === null ? {} : { companyId: raw.companyId }),
    ...(raw.jobId === null ? {} : { jobId: raw.jobId }),
    ...(raw.pseudonymousSessionId === null
      ? {}
      : {
          pseudonymousSessionId: raw.pseudonymousSessionId,
          ...(["LEAD_SUBMITTED", "LEAD_QUALIFIED", "LEAD_WON"].includes(raw.kind)
            ? { leadId: raw.pseudonymousSessionId }
            : {}),
          ...(["CHECKOUT_STARTED", "CHECKOUT_COMPLETED"].includes(raw.kind)
            ? { orderId: raw.pseudonymousSessionId }
            : {}),
        }),
    actorProvenance: provenance.actor,
    companyProvenance: provenance.company,
    jobProvenance: provenance.job,
    properties,
    clusterKey: resolvedCluster,
  });
}

function normalizeProvenance(
  raw: Pick<
    RawFunnelEvent,
    | "actorProvenanceSnapshot"
    | "companyProvenanceSnapshot"
    | "jobProvenanceSnapshot"
  >,
  demoMode: boolean,
) {
  const snapshots = [
    raw.actorProvenanceSnapshot,
    raw.companyProvenanceSnapshot,
    raw.jobProvenanceSnapshot,
  ];
  if (snapshots.every((snapshot) => snapshot === null)) return null;
  if (snapshots.includes("TEST")) return null;
  if (!demoMode && snapshots.includes("DEMO")) return null;
  return Object.freeze({
    actor: normalizeSnapshot(raw.actorProvenanceSnapshot, demoMode),
    company: normalizeSnapshot(raw.companyProvenanceSnapshot, demoMode),
    job: normalizeSnapshot(raw.jobProvenanceSnapshot, demoMode),
  });
}

function normalizeSnapshot(
  value: DataProvenance | null,
  demoMode: boolean,
): DataProvenance | null {
  if (demoMode && value === "DEMO") return "LIVE";
  return value;
}

function selectCohorts<TKey extends "subjectId" | "companyId" | "pseudonymousSessionId" | "leadId" | "orderId">(
  events: readonly PreparedFunnelEvent[],
  key: TKey,
  cohortKind: AnalyticsEventKind,
  filters: Pick<AdminFunnelFilters, "from" | "to">,
  matches: (
    cohort: readonly PreparedFunnelEvent[],
    cohortStart: PreparedFunnelEvent,
  ) => boolean = () => true,
): readonly PreparedFunnelEvent[] {
  const groups = new Map<string, PreparedFunnelEvent[]>();
  for (const event of events) {
    const value = event[key];
    if (typeof value !== "string" || value.length === 0) continue;
    const group = groups.get(value) ?? [];
    group.push(event);
    groups.set(value, group);
  }
  const selected: PreparedFunnelEvent[] = [];
  for (const cohort of groups.values()) {
    const cohortStart = cohort.find((event) =>
      event.kind === cohortKind &&
      event.occurredAt.getTime() >= filters.from.getTime() &&
      event.occurredAt.getTime() < filters.to.getTime()
    );
    if (cohortStart !== undefined && matches(cohort, cohortStart)) {
      selected.push(...cohort);
    }
  }
  return Object.freeze(selected);
}

function matchesSearchChannel(
  cohortStart: PreparedFunnelEvent,
  channel: AdminFunnelChannel,
) {
  return channel === "ALL" ||
    (channel === "JOB_SEARCH" && stringProperty(cohortStart.properties, "surface") === "JOB_SEARCH");
}

function matchesLeadChannel(
  cohortStart: PreparedFunnelEvent,
  channel: AdminFunnelChannel,
) {
  return channel === "ALL" || stringProperty(cohortStart.properties, "leadPurpose") === channel;
}

function matchesCheckoutChannel(channel: AdminFunnelChannel) {
  return channel === "ALL" || channel === "CHECKOUT";
}

function matchesCheckoutPlan(
  cohortStart: PreparedFunnelEvent,
  plan: AdminFunnelPlan,
) {
  if (plan === "ALL") return true;
  return normalizePlanSlug(stringProperty(cohortStart.properties, "planSlug")) === plan;
}

function normalizePlanSlug(value: string | null): PublicPlanCode | null {
  switch (value?.toLocaleLowerCase("en-US")) {
    case "free":
    case "free-basic":
    case "free_basic":
      return "FREE_BASIC";
    case "starter":
      return "STARTER";
    case "pro":
      return "PRO";
    case "business":
      return "BUSINESS";
    case "enterprise":
    case "enterprise-contract":
    case "enterprise_contract":
      return "ENTERPRISE_CONTRACT";
    default:
      return null;
  }
}

function resolveCohortCluster(
  cohort: readonly PreparedFunnelEvent[],
  cohortStart: PreparedFunnelEvent,
) {
  if (cohortStart.clusterKey !== null) return cohortStart.clusterKey;
  const clusters = new Set(
    cohort.map((event) => event.clusterKey).filter((value): value is string => value !== null),
  );
  return clusters.size === 1 ? [...clusters][0] ?? null : null;
}

function ratioCard(input: Readonly<{
  key: AdminFunnelCard["key"];
  title: string;
  metricKey: AnalyticsMetricKeyV1;
  result: ReturnType<typeof calculateCandidateActivation7dV1>;
  numeratorLabel: string;
  denominatorLabel: string;
  appliedDimensions: readonly AdminFunnelDimension[];
  unavailableDimensions: readonly Exclude<AdminFunnelDimension, "COHORT_DATE">[];
}>): AdminFunnelCard {
  return multiStageCard({
    key: input.key,
    title: input.title,
    metricKey: input.metricKey,
    status: input.result.status,
    stages: input.result.status === "VALUE"
      ? [
          { label: input.denominatorLabel, value: input.result.denominator },
          { label: input.numeratorLabel, value: input.result.numerator },
        ]
      : suppressedStages([input.denominatorLabel, input.numeratorLabel]),
    rateBps: input.result.rateBps,
    appliedDimensions: input.appliedDimensions,
    unavailableDimensions: input.unavailableDimensions,
  });
}

function multiStageCard(input: Readonly<{
  key: AdminFunnelCard["key"];
  title: string;
  metricKey: AnalyticsMetricKeyV1;
  status: "VALUE" | "SUPPRESSED";
  stages: readonly Readonly<{ label: string; value: AdminFunnelValue }>[];
  rateBps: AdminFunnelValue;
  appliedDimensions: readonly AdminFunnelDimension[];
  unavailableDimensions: readonly Exclude<AdminFunnelDimension, "COHORT_DATE">[];
}>): AdminFunnelCard {
  const definition = METRIC_DEFINITIONS_V1[input.metricKey];
  return Object.freeze({
    key: input.key,
    title: input.title,
    metricKey: input.metricKey,
    metricVersion: definition.version,
    formula: definition.formula,
    window: definition.window,
    denominatorSubject: definition.denominatorSubject,
    status: input.status,
    stages: Object.freeze(input.stages.map((stage) => Object.freeze({ ...stage }))),
    rateBps: input.rateBps,
    appliedDimensions: Object.freeze([...input.appliedDimensions]),
    unavailableDimensions: Object.freeze([...input.unavailableDimensions]),
  });
}

function suppressedStages(labels: readonly string[]) {
  return labels.map((label) => Object.freeze({
    label,
    value: "SUPPRESSED" as const,
  }));
}

function selectedDimensions(
  filters: Pick<AdminFunnelFilters, "channel" | "clusterKey" | "plan">,
  supported: readonly Exclude<AdminFunnelDimension, "COHORT_DATE">[],
): readonly AdminFunnelDimension[] {
  const selected: AdminFunnelDimension[] = ["COHORT_DATE"];
  if (filters.clusterKey !== null && supported.includes("CLUSTER")) selected.push("CLUSTER");
  if (filters.channel !== "ALL" && supported.includes("CHANNEL")) selected.push("CHANNEL");
  if (filters.plan !== "ALL" && supported.includes("PLAN")) selected.push("PLAN");
  return Object.freeze(selected);
}

function isBoundedDateWindow(from: string, to: string, today: string) {
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return false;
  const fromDate = parseCalendarDate(from);
  const toDate = parseCalendarDate(to);
  const earliestFrom = parseCalendarDate(
    shiftCalendarDate(today, -ADMIN_FUNNEL_POLICY_V1.maximumCohortDays),
  );
  if (
    fromDate === null ||
    toDate === null ||
    earliestFrom === null ||
    to > today ||
    fromDate.getTime() < earliestFrom.getTime()
  ) return false;
  const days = (toDate.getTime() - fromDate.getTime()) / DAY_MILLISECONDS;
  return Number.isInteger(days) && days >= 1 && days <= ADMIN_FUNNEL_POLICY_V1.maximumCohortDays;
}

function parseCalendarDate(value: string) {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (![year, month, day].every(Number.isInteger)) return null;
  const result = new Date(Date.UTC(year, month - 1, day));
  return result.getUTCFullYear() === year &&
      result.getUTCMonth() === month - 1 &&
      result.getUTCDate() === day
    ? result
    : null;
}

function shiftCalendarDate(value: string, days: number) {
  const date = parseCalendarDate(value);
  if (date === null) throw new RangeError("A valid calendar date is required.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveZurichMidnight(value: string) {
  const date = parseCalendarDate(value);
  if (date === null) throw new RangeError("A valid Zurich business date is required.");
  const target = date.getTime();
  let candidate = target;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const represented = parseCalendarDate(getZurichBusinessDateV1(new Date(candidate)));
    if (represented === null) throw new RangeError("Zurich midnight could not be resolved.");
    candidate += target - represented.getTime();
    const localHour = zurichHour(new Date(candidate));
    candidate -= localHour * 3_600_000;
  }
  const result = new Date(candidate);
  if (getZurichBusinessDateV1(result) !== value || zurichHour(result) !== 0) {
    throw new RangeError("Zurich midnight could not be resolved.");
  }
  return result;
}

function zurichHour(value: Date) {
  const part = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUNNEL_DEFINITIONS_V1.businessTimezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).find((candidate) => candidate.type === "hour");
  const hour = Number(part?.value);
  if (!Number.isInteger(hour)) throw new RangeError("Zurich hour could not be resolved.");
  return hour;
}

function scalar(value: string | readonly string[] | undefined) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringProperty(properties: Readonly<Record<string, unknown>>, key: string) {
  const value = properties[key];
  return typeof value === "string" ? value : null;
}

function clusterKey(cantonCode: string, categorySlug: string) {
  return `${cantonCode}:${categorySlug}`;
}
