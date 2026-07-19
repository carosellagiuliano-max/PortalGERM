import { medianInteger } from "@/lib/analytics/metric-contracts";
import { getZurichBusinessDateV1 } from "@/lib/analytics/funnel-definitions";
import type { DataProvenance, SystemTaskKind } from "@/lib/generated/prisma/enums";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const ANALYTICS_SUPPRESSION_V1 = Object.freeze({
  version: "v1",
  minimumDistinctDenominatorSubjects: 20,
  suppressedValue: "SUPPRESSED",
  parentRollup: "PREDECLARED_PARENT_ONLY",
  complementPolicy: "SUPPRESS_IF_CHILD_COULD_BE_DERIVED",
});

export const ANALYTICS_METRIC_KEYS_V1 = Object.freeze([
  "PUBLIC_VALUE",
  "SEARCH_FUNNEL",
  "JOB_CONTENT",
  "CANDIDATE_VALUE",
  "CANDIDATE_ACTIVATION",
  "EMPLOYER_RESPONSE",
  "EMPLOYER_ACTIVATION",
  "NORTH_STAR",
  "RADAR_FUNNEL",
  "CHECKOUT_FUNNEL",
  "COMMERCIAL_INTENT",
  "SUBSCRIPTION",
  "LEAD_FUNNEL",
  "BOOST",
  "MODERATION",
] as const);

export type AnalyticsMetricKeyV1 = (typeof ANALYTICS_METRIC_KEYS_V1)[number];

type MetricDefinitionV1 = Readonly<{
  version: "v1";
  owner:
    | "DISCOVERY"
    | "CANDIDATE"
    | "EMPLOYER"
    | "MARKETPLACE"
    | "BILLING"
    | "SALES"
    | "TRUST_SAFETY";
  formula: string;
  window: "EVENT" | "7_DAYS" | "14_DAYS" | "30_DAYS" | "90_DAYS" | "PERIOD";
  denominatorSubject: "ACTOR" | "SESSION" | "APPLICATION" | "COMPANY" | "JOB" | "ORDER" | "LEAD" | "REQUEST";
  requiredLiveProvenance: readonly ("ACTOR" | "COMPANY" | "JOB")[];
}>;

function metricDefinition<T extends MetricDefinitionV1>(definition: T): Readonly<T> {
  return Object.freeze({
    ...definition,
    requiredLiveProvenance: Object.freeze([
      ...definition.requiredLiveProvenance,
    ]),
  });
}

export const METRIC_DEFINITIONS_V1 = Object.freeze({
  PUBLIC_VALUE: metricDefinition({
    version: "v1", owner: "DISCOVERY", formula: "distinct public-value subjects",
    window: "30_DAYS", denominatorSubject: "ACTOR", requiredLiveProvenance: ["ACTOR"],
  }),
  SEARCH_FUNNEL: metricDefinition({
    version: "v1", owner: "DISCOVERY", formula: "ordered search-detail-intent-submit sessions",
    window: "7_DAYS", denominatorSubject: "SESSION", requiredLiveProvenance: ["ACTOR", "COMPANY", "JOB"],
  }),
  JOB_CONTENT: metricDefinition({
    version: "v1", owner: "EMPLOYER", formula: "organic apply-intent per detail session",
    window: "30_DAYS", denominatorSubject: "ACTOR", requiredLiveProvenance: ["ACTOR", "COMPANY", "JOB"],
  }),
  CANDIDATE_VALUE: metricDefinition({
    version: "v1", owner: "CANDIDATE", formula: "distinct saved jobs per candidate",
    window: "30_DAYS", denominatorSubject: "ACTOR", requiredLiveProvenance: ["ACTOR", "JOB"],
  }),
  CANDIDATE_ACTIVATION: metricDefinition({
    version: "v1", owner: "CANDIDATE", formula: "profile-completed within seven days of registration",
    window: "7_DAYS", denominatorSubject: "ACTOR", requiredLiveProvenance: ["ACTOR"],
  }),
  EMPLOYER_RESPONSE: metricDefinition({
    version: "v1", owner: "EMPLOYER", formula: "canonical first candidate-visible employer response",
    window: "90_DAYS", denominatorSubject: "APPLICATION", requiredLiveProvenance: ["ACTOR", "COMPANY", "JOB"],
    dedupePrefix: "EMPLOYER_RESPONSE",
    radarDedupePrefix: "RADAR_RESPONSE",
  }),
  EMPLOYER_ACTIVATION: metricDefinition({
    version: "v1", owner: "EMPLOYER", formula: "job-published within fourteen days of onboarding",
    window: "14_DAYS", denominatorSubject: "COMPANY", requiredLiveProvenance: ["COMPANY", "JOB"],
  }),
  NORTH_STAR: metricDefinition({
    version: "v1", owner: "MARKETPLACE", formula: "qualified timely conversation per active cluster and Zurich month",
    window: "EVENT", denominatorSubject: "APPLICATION", requiredLiveProvenance: ["ACTOR", "COMPANY", "JOB"],
    applicationPrefix: "APPLICATION",
    radarPrefix: "RADAR",
    radarResponseTargetHours: 48,
    attributionTimezone: "Europe/Zurich",
  }),
  RADAR_FUNNEL: metricDefinition({
    version: "v1", owner: "MARKETPLACE", formula: "sent-accepted-revealed contact requests",
    window: "PERIOD", denominatorSubject: "REQUEST", requiredLiveProvenance: ["ACTOR", "COMPANY"],
  }),
  CHECKOUT_FUNNEL: metricDefinition({
    version: "v1", owner: "BILLING", formula: "completed orders per started order",
    window: "EVENT", denominatorSubject: "ORDER", requiredLiveProvenance: ["COMPANY"],
  }),
  COMMERCIAL_INTENT: metricDefinition({
    version: "v1", owner: "BILLING", formula: "distinct limit-reached subjects",
    window: "30_DAYS", denominatorSubject: "COMPANY", requiredLiveProvenance: ["COMPANY"],
  }),
  SUBSCRIPTION: metricDefinition({
    version: "v1", owner: "BILLING", formula: "subscription state changes",
    window: "EVENT", denominatorSubject: "COMPANY", requiredLiveProvenance: ["COMPANY"],
  }),
  LEAD_FUNNEL: metricDefinition({
    version: "v1", owner: "SALES", formula: "ordered submitted-qualified-won leads",
    window: "EVENT", denominatorSubject: "LEAD", requiredLiveProvenance: ["COMPANY"],
  }),
  BOOST: metricDefinition({
    version: "v1", owner: "BILLING", formula: "eligible boost experiment outcomes",
    window: "90_DAYS", denominatorSubject: "JOB", requiredLiveProvenance: ["COMPANY", "JOB"],
  }),
  MODERATION: metricDefinition({
    version: "v1", owner: "TRUST_SAFETY", formula: "moderation outcomes by closed reason",
    window: "30_DAYS", denominatorSubject: "JOB", requiredLiveProvenance: ["ACTOR", "COMPANY", "JOB"],
  }),
} satisfies Record<AnalyticsMetricKeyV1, MetricDefinitionV1>);

export const COCKPIT_SIGNAL_REASONS_V1 = Object.freeze([
  "NEAR_JOB_LIMIT",
  "FREE_UPGRADE_CANDIDATE",
  "SLOW_RESPONSE",
  "RADAR_PACK_CANDIDATE",
  "SUPPLY_GAP",
  "JOB_CONTENT_DIAGNOSTIC",
  "BOOST_TEST_CANDIDATE",
] as const);

export type CockpitSignalReasonV1 =
  (typeof COCKPIT_SIGNAL_REASONS_V1)[number];

type CockpitSignalDefinitionV1 = Readonly<{
  version: "v1";
  owner: "SALES" | "CUSTOMER_SUCCESS" | "MARKETPLACE" | "GROWTH";
  taskKind: SystemTaskKind;
  window: Readonly<
    | { kind: "ROLLING_DAYS"; days: 30 }
    | { kind: "CURRENT_PERIOD" }
  >;
  dismissalSuppressionDays: 30;
  followUpDays: 14;
  actionCode: string;
  outcomeMetric: AnalyticsMetricKeyV1;
  evidence: readonly string[];
  thresholds: Readonly<Record<string, number>>;
}>;

export const COCKPIT_SIGNAL_POLICY_V1 = Object.freeze({
  NEAR_JOB_LIMIT: Object.freeze({
    version: "v1", owner: "SALES", taskKind: "USAGE_DIAGNOSTIC",
    window: Object.freeze({ kind: "ROLLING_DAYS", days: 30 }),
    dismissalSuppressionDays: 30, followUpDays: 14,
    actionCode: "REVIEW_PLAN_FIT", outcomeMetric: "COMMERCIAL_INTENT",
    evidence: Object.freeze(["activeJobs", "jobLimit", "submittedApplications"]),
    thresholds: Object.freeze({ usageBps: 8_000, minimumApplications: 3 }),
  }),
  FREE_UPGRADE_CANDIDATE: Object.freeze({
    version: "v1", owner: "SALES", taskKind: "SALES_FOLLOW_UP",
    window: Object.freeze({ kind: "ROLLING_DAYS", days: 30 }),
    dismissalSuppressionDays: 30, followUpDays: 14,
    actionCode: "OFFER_FREE_PLAN_REVIEW", outcomeMetric: "COMMERCIAL_INTENT",
    evidence: Object.freeze(["companyStatus", "verificationStatus", "planSlug", "firstPublishedAt", "submittedApplications", "openQualifiedLead", "dismissedAt"]),
    thresholds: Object.freeze({ minimumPublishedAgeDays: 14, minimumApplications: 5 }),
  }),
  SLOW_RESPONSE: Object.freeze({
    version: "v1", owner: "CUSTOMER_SUCCESS", taskKind: "RETENTION_RISK",
    window: Object.freeze({ kind: "ROLLING_DAYS", days: 30 }),
    dismissalSuppressionDays: 30, followUpDays: 14,
    actionCode: "REVIEW_RESPONSE_PROCESS", outcomeMetric: "EMPLOYER_RESPONSE",
    evidence: Object.freeze(["dueApplications", "onTimeRateBps"]),
    thresholds: Object.freeze({ minimumDueApplications: 10, onTimeRateBpsExclusive: 7_000 }),
  }),
  RADAR_PACK_CANDIDATE: Object.freeze({
    version: "v1", owner: "SALES", taskKind: "USAGE_DIAGNOSTIC",
    window: Object.freeze({ kind: "CURRENT_PERIOD" }),
    dismissalSuppressionDays: 30, followUpDays: 14,
    actionCode: "REVIEW_RADAR_PACK", outcomeMetric: "RADAR_FUNNEL",
    evidence: Object.freeze(["includedContactsUsed", "includedContactsLimit", "acceptedRequests"]),
    thresholds: Object.freeze({ usageBps: 8_000, minimumAcceptedRequests: 5 }),
  }),
  SUPPLY_GAP: Object.freeze({
    version: "v1", owner: "MARKETPLACE", taskKind: "SUPPLY_GAP",
    window: Object.freeze({ kind: "ROLLING_DAYS", days: 30 }),
    dismissalSuppressionDays: 30, followUpDays: 14,
    actionCode: "ACQUIRE_CLUSTER_SUPPLY", outcomeMetric: "SEARCH_FUNNEL",
    evidence: Object.freeze(["cantonId", "categoryId", "searchResultSessions", "eligibleLiveJobs", "queryCoverageBps"]),
    thresholds: Object.freeze({ minimumSearchSessions: 200, maximumEligibleJobsExclusive: 50, coverageBpsExclusive: 8_000 }),
  }),
  JOB_CONTENT_DIAGNOSTIC: Object.freeze({
    version: "v1", owner: "GROWTH", taskKind: "USAGE_DIAGNOSTIC",
    window: Object.freeze({ kind: "ROLLING_DAYS", days: 30 }),
    dismissalSuppressionDays: 30, followUpDays: 14,
    actionCode: "FIX_JOB_CONTENT", outcomeMetric: "JOB_CONTENT",
    evidence: Object.freeze(["organicDetailSessions", "applyIntentRateBps", "publishedAt", "fairScoreV2", "salaryEvidencePresent", "processEvidencePresent", "applicationEffort", "applyPathBroken"]),
    thresholds: Object.freeze({ minimumOrganicDetailSessions: 100, conversionBpsExclusive: 200, minimumPublishedAgeDays: 14, fairScoreExclusive: 70 }),
  }),
  BOOST_TEST_CANDIDATE: Object.freeze({
    version: "v1", owner: "GROWTH", taskKind: "USAGE_DIAGNOSTIC",
    window: Object.freeze({ kind: "ROLLING_DAYS", days: 30 }),
    dismissalSuppressionDays: 30, followUpDays: 14,
    actionCode: "OFFER_MEASURED_BOOST_TEST", outcomeMetric: "BOOST",
    evidence: Object.freeze(["organicDetailSessions", "applyIntentRateBps", "contentBlockers", "activeBoost", "clusterBaselineBps"]),
    thresholds: Object.freeze({ minimumOrganicDetailSessions: 100, conversionFloorBps: 200, fairScoreMinimum: 70, baselineWindowDays: 90, baselineMinimumJobs: 20, baselineMinimumViewsPerJob: 100 }),
  }),
} satisfies Record<CockpitSignalReasonV1, CockpitSignalDefinitionV1>);

export type EmployerResponseSourceV1 = Readonly<{
  applicationId: string;
  companyId: string;
  jobId: string;
  revisionId: string;
  occurredAt: Date;
  commitOrder: number;
  source: "MESSAGE" | "STATUS";
  actorKind: "COMPANY_USER" | "SYSTEM" | "PLATFORM_ADMIN";
  actorRole?: "OWNER" | "ADMIN" | "RECRUITER";
  assignmentRole?: "EDITOR" | "REVIEWER" | "PIPELINE";
  actorActive: boolean;
  authorized: boolean;
  actorProvenance: DataProvenance;
  companyProvenance: DataProvenance;
  jobProvenance: DataProvenance;
  messageBody?: string;
  fromStatus?: string;
  toStatus?: string;
}>;

export type EmployerResponseProjectionV1 = Readonly<{
  applicationId: string;
  companyId: string;
  jobId: string;
  revisionId: string;
  occurredAt: Date;
  dedupeKey: string;
  source: "MESSAGE" | "STATUS";
  actorProvenance: DataProvenance;
  companyProvenance: DataProvenance;
  jobProvenance: DataProvenance;
}>;

const QUALIFYING_RESPONSE_STATUSES = new Set([
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
]);

export function selectCanonicalEmployerResponseV1(
  sources: readonly EmployerResponseSourceV1[],
): EmployerResponseProjectionV1 | null {
  const qualifying = sources.filter(isQualifyingEmployerResponse).sort((left, right) => {
    const timestamp = left.occurredAt.getTime() - right.occurredAt.getTime();
    return timestamp !== 0 ? timestamp : left.commitOrder - right.commitOrder;
  });
  const first = qualifying[0];
  if (!first) {
    return null;
  }

  return Object.freeze({
    applicationId: first.applicationId,
    companyId: first.companyId,
    jobId: first.jobId,
    revisionId: first.revisionId,
    occurredAt: first.occurredAt,
    dedupeKey: `${METRIC_DEFINITIONS_V1.EMPLOYER_RESPONSE.dedupePrefix}:${first.applicationId}`,
    source: first.source,
    actorProvenance: first.actorProvenance,
    companyProvenance: first.companyProvenance,
    jobProvenance: first.jobProvenance,
  });
}

export type NorthStarConversationInputV1 =
  | Readonly<{
      kind: "APPLICATION";
      applicationId: string;
      submittedAt: Date;
      responseTargetDays: number | null;
      responseAt: Date | null;
      cantonId: string;
      categoryId: string;
      actorProvenance: DataProvenance;
      companyProvenance: DataProvenance;
      jobProvenance: DataProvenance;
      actorsActive: boolean;
      clusterAssessmentActive: boolean;
    }>
  | Readonly<{
      kind: "RADAR";
      contactRequestId: string;
      acceptedAt: Date;
      responseAt: Date | null;
      cantonId: string;
      categoryId: string;
      actorProvenance: DataProvenance;
      companyProvenance: DataProvenance;
      jobProvenance: DataProvenance | null;
      actorsActive: boolean;
      clusterAssessmentActive: boolean;
    }>;

export type NorthStarQualificationV1 = Readonly<{
  qualifies: boolean;
  key: string;
  qualifyingAt: Date | null;
  attribution: Readonly<{
    cantonId: string;
    categoryId: string;
    monthZurich: string;
  }> | null;
}>;

export function qualifyNorthStarConversationV1(
  input: NorthStarConversationInputV1,
): NorthStarQualificationV1 {
  const sharedEligible = input.actorProvenance === "LIVE" &&
    input.companyProvenance === "LIVE" &&
    (input.kind === "RADAR"
      ? input.jobProvenance === null || input.jobProvenance === "LIVE"
      : input.jobProvenance === "LIVE") &&
    input.actorsActive &&
    input.clusterAssessmentActive &&
    input.responseAt !== null;

  if (input.kind === "APPLICATION") {
    const key = `${METRIC_DEFINITIONS_V1.NORTH_STAR.applicationPrefix}:${input.applicationId}`;
    const validTarget = Number.isInteger(input.responseTargetDays) &&
      input.responseTargetDays !== null &&
      input.responseTargetDays >= 1 &&
      input.responseTargetDays <= 30;
    const deadline = validTarget
      ? input.submittedAt.getTime() + input.responseTargetDays * DAY_MS
      : 0;
    const qualifies = sharedEligible &&
      validTarget &&
      input.responseAt !== null &&
      input.responseAt.getTime() >= input.submittedAt.getTime() &&
      input.responseAt.getTime() <= deadline;
    return Object.freeze({
      qualifies,
      key,
      qualifyingAt: qualifies ? input.responseAt : null,
      attribution: qualifies && input.responseAt
        ? buildNorthStarAttribution(input, input.responseAt)
        : null,
    });
  }

  const key = `${METRIC_DEFINITIONS_V1.NORTH_STAR.radarPrefix}:${input.contactRequestId}`;
  const deadline = input.acceptedAt.getTime() +
    METRIC_DEFINITIONS_V1.NORTH_STAR.radarResponseTargetHours * HOUR_MS;
  const qualifies = sharedEligible &&
    input.responseAt !== null &&
    input.responseAt.getTime() >= input.acceptedAt.getTime() &&
    input.responseAt.getTime() <= deadline;
  return Object.freeze({
    qualifies,
    key,
    qualifyingAt: qualifies ? input.responseAt : null,
    attribution: qualifies && input.responseAt
      ? buildNorthStarAttribution(input, input.responseAt)
      : null,
  });
}

export function evaluateNearJobLimitV1(input: Readonly<{
  activeJobs: number;
  jobLimit: number;
  submittedApplications: number;
}>) {
  const usageBps = input.jobLimit > 0
    ? Math.floor((input.activeJobs / input.jobLimit) * 10_000)
    : 0;
  return usageBps >= COCKPIT_SIGNAL_POLICY_V1.NEAR_JOB_LIMIT.thresholds.usageBps &&
    input.submittedApplications >=
      COCKPIT_SIGNAL_POLICY_V1.NEAR_JOB_LIMIT.thresholds.minimumApplications;
}

export function evaluateFreeUpgradeCandidateV1(input: Readonly<{
  companyActive: boolean;
  companyVerified: boolean;
  isFreePlan: boolean;
  firstPublishedAt: Date | null;
  submittedApplications: number;
  hasOpenQualifiedLead: boolean;
  dismissedAt: Date | null;
  now: Date;
}>) {
  return input.companyActive &&
    input.companyVerified &&
    input.isFreePlan &&
    input.firstPublishedAt !== null &&
    input.firstPublishedAt.getTime() <= input.now.getTime() -
      COCKPIT_SIGNAL_POLICY_V1.FREE_UPGRADE_CANDIDATE.thresholds.minimumPublishedAgeDays * DAY_MS &&
    input.submittedApplications >=
      COCKPIT_SIGNAL_POLICY_V1.FREE_UPGRADE_CANDIDATE.thresholds.minimumApplications &&
    !input.hasOpenQualifiedLead &&
    !isDismissalEffectiveV1(input.dismissedAt, input.now);
}

export function evaluateSlowResponseV1(input: Readonly<{
  dueApplications: number;
  onTimeRateBps: number;
}>) {
  return input.dueApplications >=
      COCKPIT_SIGNAL_POLICY_V1.SLOW_RESPONSE.thresholds.minimumDueApplications &&
    input.onTimeRateBps <
      COCKPIT_SIGNAL_POLICY_V1.SLOW_RESPONSE.thresholds.onTimeRateBpsExclusive;
}

export function evaluateRadarPackCandidateV1(input: Readonly<{
  includedContactsUsed: number;
  includedContactsLimit: number;
  acceptedRequests: number;
}>) {
  const usageBps = input.includedContactsLimit > 0
    ? Math.floor((input.includedContactsUsed / input.includedContactsLimit) * 10_000)
    : 0;
  return usageBps >=
      COCKPIT_SIGNAL_POLICY_V1.RADAR_PACK_CANDIDATE.thresholds.usageBps &&
    input.acceptedRequests >=
      COCKPIT_SIGNAL_POLICY_V1.RADAR_PACK_CANDIDATE.thresholds.minimumAcceptedRequests;
}

export function evaluateSupplyGapV1(input: Readonly<{
  searchResultSessions: number;
  eligibleLiveJobs: number;
  queryCoverageBps: number;
}>) {
  return input.searchResultSessions >=
      COCKPIT_SIGNAL_POLICY_V1.SUPPLY_GAP.thresholds.minimumSearchSessions &&
    (input.eligibleLiveJobs <
      COCKPIT_SIGNAL_POLICY_V1.SUPPLY_GAP.thresholds.maximumEligibleJobsExclusive ||
      input.queryCoverageBps <
        COCKPIT_SIGNAL_POLICY_V1.SUPPLY_GAP.thresholds.coverageBpsExclusive);
}

export type JobContentSignalInputV1 = Readonly<{
  organicDetailSessions: number;
  applyIntentRateBps: number;
  publishedAt: Date;
  now: Date;
  fairScoreV2: number | null;
  salaryEvidencePresent: boolean;
  processEvidencePresent: boolean;
  applicationEffort: "SIMPLE" | "MEDIUM" | "LONG" | null;
  applyPathBroken: boolean;
}>;

export function evaluateJobContentDiagnosticV1(input: JobContentSignalInputV1) {
  const blocker = input.fairScoreV2 === null ||
    input.fairScoreV2 <
      COCKPIT_SIGNAL_POLICY_V1.JOB_CONTENT_DIAGNOSTIC.thresholds.fairScoreExclusive ||
    !input.salaryEvidencePresent ||
    !input.processEvidencePresent ||
    input.applicationEffort === "LONG" ||
    input.applyPathBroken;
  return input.organicDetailSessions >=
      COCKPIT_SIGNAL_POLICY_V1.JOB_CONTENT_DIAGNOSTIC.thresholds.minimumOrganicDetailSessions &&
    input.applyIntentRateBps <
      COCKPIT_SIGNAL_POLICY_V1.JOB_CONTENT_DIAGNOSTIC.thresholds.conversionBpsExclusive &&
    input.publishedAt.getTime() <= input.now.getTime() -
      COCKPIT_SIGNAL_POLICY_V1.JOB_CONTENT_DIAGNOSTIC.thresholds.minimumPublishedAgeDays * DAY_MS &&
    blocker;
}

export type ClusterBaselineJobV1 = Readonly<{
  jobId: string;
  cantonId: string;
  categoryId: string;
  measuredFrom: Date;
  measuredTo: Date;
  companyProvenance: DataProvenance;
  jobProvenance: DataProvenance;
  organicDetailSessions: number;
  conversionBps: number;
}>;

export function calculateClusterBaselineBpsV1(
  jobs: readonly ClusterBaselineJobV1[],
  query: Readonly<{
    cantonId: string;
    categoryId: string;
    now: Date;
  }>,
) {
  const expectedTo = query.now.getTime();
  const expectedFrom = expectedTo -
    COCKPIT_SIGNAL_POLICY_V1.BOOST_TEST_CANDIDATE.thresholds.baselineWindowDays * DAY_MS;
  if (
    !Number.isFinite(expectedTo) ||
    query.cantonId.length === 0 ||
    query.categoryId.length === 0
  ) {
    return null;
  }
  const eligible = jobs.filter(
    (job) =>
      job.cantonId === query.cantonId &&
      job.categoryId === query.categoryId &&
      job.measuredFrom.getTime() === expectedFrom &&
      job.measuredTo.getTime() === expectedTo &&
      job.companyProvenance === "LIVE" &&
      job.jobProvenance === "LIVE" &&
      job.organicDetailSessions >=
        COCKPIT_SIGNAL_POLICY_V1.BOOST_TEST_CANDIDATE.thresholds.baselineMinimumViewsPerJob,
  );
  const distinctEligible = new Map<string, ClusterBaselineJobV1>();
  for (const job of eligible) {
    if (job.jobId.length === 0 || distinctEligible.has(job.jobId)) {
      return null;
    }
    distinctEligible.set(job.jobId, job);
  }
  if (
    distinctEligible.size <
      COCKPIT_SIGNAL_POLICY_V1.BOOST_TEST_CANDIDATE.thresholds.baselineMinimumJobs
  ) {
    return null;
  }
  return medianInteger([...distinctEligible.values()].map((job) => job.conversionBps));
}

export function evaluateBoostTestCandidateV1(input: Readonly<{
  content: JobContentSignalInputV1;
  hasActiveBoost: boolean;
  baselineBps: number | null;
}>) {
  const contentBlocker = input.content.fairScoreV2 === null ||
    input.content.fairScoreV2 <
      COCKPIT_SIGNAL_POLICY_V1.BOOST_TEST_CANDIDATE.thresholds.fairScoreMinimum ||
    !input.content.salaryEvidencePresent ||
    !input.content.processEvidencePresent ||
    input.content.applicationEffort === "LONG" ||
    input.content.applyPathBroken;
  if (
    contentBlocker ||
    input.hasActiveBoost ||
    input.baselineBps === null ||
    input.content.organicDetailSessions <
      COCKPIT_SIGNAL_POLICY_V1.BOOST_TEST_CANDIDATE.thresholds.minimumOrganicDetailSessions
  ) {
    return false;
  }
  const threshold = Math.max(
    COCKPIT_SIGNAL_POLICY_V1.BOOST_TEST_CANDIDATE.thresholds.conversionFloorBps,
    Math.floor(input.baselineBps / 2),
  );
  return input.content.applyIntentRateBps < threshold;
}

export function isDismissalEffectiveV1(
  dismissedAt: Date | null,
  now: Date,
  reason: CockpitSignalReasonV1 = "FREE_UPGRADE_CANDIDATE",
) {
  return dismissedAt !== null &&
    dismissedAt.getTime() > now.getTime() -
      COCKPIT_SIGNAL_POLICY_V1[reason].dismissalSuppressionDays * DAY_MS &&
    dismissedAt.getTime() <= now.getTime();
}

export function getSignalFollowUpAtV1(
  actionAt: Date,
  reason: CockpitSignalReasonV1 = "JOB_CONTENT_DIAGNOSTIC",
) {
  return new Date(
    actionAt.getTime() + COCKPIT_SIGNAL_POLICY_V1[reason].followUpDays * DAY_MS,
  );
}

export function buildCockpitSignalTaskKeyV1(input: Readonly<{
  entityType: string;
  entityId: string;
  reason: CockpitSignalReasonV1;
  windowStart: Date;
}>) {
  if (
    !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.entityType) ||
    !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.reason) ||
    !COCKPIT_SIGNAL_REASONS_V1.includes(input.reason) ||
    input.entityId.length === 0 ||
    input.entityId.length > 128 ||
    !Number.isFinite(input.windowStart.getTime())
  ) {
    throw new RangeError("A bounded entity, reason, id, and window are required.");
  }
  return `${input.entityType}:${input.entityId}:${input.reason}:${input.windowStart.toISOString()}`;
}

function buildNorthStarAttribution(
  input: Readonly<{ cantonId: string; categoryId: string }>,
  qualifyingAt: Date,
) {
  return Object.freeze({
    cantonId: input.cantonId,
    categoryId: input.categoryId,
    monthZurich: getZurichBusinessDateV1(qualifyingAt).slice(0, 7),
  });
}

function isQualifyingEmployerResponse(source: EmployerResponseSourceV1) {
  if (
    source.actorKind !== "COMPANY_USER" ||
    !source.actorActive ||
    !source.authorized
  ) {
    return false;
  }
  const authorizedRole = source.actorRole === "OWNER" ||
    source.actorRole === "ADMIN" ||
    (source.actorRole === "RECRUITER" &&
      (source.assignmentRole === "EDITOR" || source.assignmentRole === "PIPELINE"));
  if (!authorizedRole) {
    return false;
  }
  if (source.source === "MESSAGE") {
    return (source.messageBody?.trim().length ?? 0) > 0;
  }
  return QUALIFYING_RESPONSE_STATUSES.has(source.toStatus ?? "");
}
