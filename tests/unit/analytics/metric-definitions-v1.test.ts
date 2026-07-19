// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_METRIC_KEYS_V1,
  calculateClusterBaselineBpsV1,
  buildCockpitSignalTaskKeyV1,
  COCKPIT_SIGNAL_POLICY_V1,
  COCKPIT_SIGNAL_REASONS_V1,
  evaluateBoostTestCandidateV1,
  evaluateFreeUpgradeCandidateV1,
  evaluateJobContentDiagnosticV1,
  evaluateNearJobLimitV1,
  evaluateRadarPackCandidateV1,
  evaluateSlowResponseV1,
  evaluateSupplyGapV1,
  getSignalFollowUpAtV1,
  isDismissalEffectiveV1,
  METRIC_DEFINITIONS_V1,
  qualifyNorthStarConversationV1,
  selectCanonicalEmployerResponseV1,
  type EmployerResponseSourceV1,
} from "@/lib/analytics/metric-definitions-v1";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const now = new Date("2026-06-30T12:00:00.000Z");

function response(
  overrides: Partial<EmployerResponseSourceV1> = {},
): EmployerResponseSourceV1 {
  return {
    applicationId: "application-1",
    companyId: "company-1",
    jobId: "job-1",
    revisionId: "revision-1",
    occurredAt: now,
    commitOrder: 1,
    source: "MESSAGE",
    actorKind: "COMPANY_USER",
    actorRole: "OWNER",
    actorActive: true,
    authorized: true,
    actorProvenance: "LIVE",
    companyProvenance: "LIVE",
    jobProvenance: "LIVE",
    messageBody: "Guten Tag",
    ...overrides,
  };
}

describe("METRIC_DEFINITIONS_V1", () => {
  it("exhaustively freezes every metric and cockpit-signal contract", () => {
    expect(Object.keys(METRIC_DEFINITIONS_V1).sort()).toEqual(
      [...ANALYTICS_METRIC_KEYS_V1].sort(),
    );
    expect(Object.keys(COCKPIT_SIGNAL_POLICY_V1).sort()).toEqual(
      [...COCKPIT_SIGNAL_REASONS_V1].sort(),
    );
    for (const definition of Object.values(METRIC_DEFINITIONS_V1)) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.requiredLiveProvenance)).toBe(true);
    }
    for (const definition of Object.values(COCKPIT_SIGNAL_POLICY_V1)) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.window)).toBe(true);
      expect(Object.isFrozen(definition.evidence)).toBe(true);
      expect(definition.evidence.length).toBeGreaterThan(0);
      expect(Object.isFrozen(definition.thresholds)).toBe(true);
    }
  });

  it("selects exactly the earliest committed candidate-visible human response", () => {
    const selected = selectCanonicalEmployerResponseV1([
      response({ source: "MESSAGE", commitOrder: 2 }),
      response({
        source: "STATUS",
        commitOrder: 1,
        messageBody: undefined,
        fromStatus: "IN_REVIEW",
        toStatus: "SHORTLISTED",
      }),
    ]);
    expect(selected).toEqual({
      applicationId: "application-1",
      companyId: "company-1",
      jobId: "job-1",
      revisionId: "revision-1",
      occurredAt: now,
      dedupeKey: "EMPLOYER_RESPONSE:application-1",
      source: "STATUS",
      actorProvenance: "LIVE",
      companyProvenance: "LIVE",
      jobProvenance: "LIVE",
    });
  });

  it("excludes notes, empty messages, routine review, and unauthorized actors", () => {
    expect(
      selectCanonicalEmployerResponseV1([
        response({ messageBody: "  " }),
        response({ actorKind: "SYSTEM" }),
        response({ actorKind: "PLATFORM_ADMIN" }),
        response({ actorActive: false }),
        response({ authorized: false }),
        response({ actorRole: "RECRUITER", assignmentRole: "REVIEWER" }),
        response({
          source: "STATUS",
          messageBody: undefined,
          fromStatus: "SUBMITTED",
          toStatus: "IN_REVIEW",
        }),
      ]),
    ).toBeNull();
    expect(
      selectCanonicalEmployerResponseV1([
        response({ actorRole: "RECRUITER", assignmentRole: "PIPELINE" }),
      ]),
    ).not.toBeNull();
  });

  it("qualifies Application and Radar North-Star boundaries exactly once by key", () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(
      qualifyNorthStarConversationV1({
        kind: "APPLICATION",
        applicationId: "app",
        submittedAt,
        responseTargetDays: 2,
        responseAt: new Date(submittedAt.getTime() + 2 * DAY_MS),
        cantonId: "canton-zh",
        categoryId: "category-it",
        actorProvenance: "LIVE",
        companyProvenance: "LIVE",
        jobProvenance: "LIVE",
        actorsActive: true,
        clusterAssessmentActive: true,
      }),
    ).toEqual({
      qualifies: true,
      key: "APPLICATION:app",
      qualifyingAt: new Date("2026-01-03T00:00:00.000Z"),
      attribution: {
        cantonId: "canton-zh",
        categoryId: "category-it",
        monthZurich: "2026-01",
      },
    });
    expect(
      qualifyNorthStarConversationV1({
        kind: "APPLICATION",
        applicationId: "app",
        submittedAt,
        responseTargetDays: null,
        responseAt: submittedAt,
        cantonId: "canton-zh",
        categoryId: "category-it",
        actorProvenance: "LIVE",
        companyProvenance: "LIVE",
        jobProvenance: "LIVE",
        actorsActive: true,
        clusterAssessmentActive: true,
      }).qualifies,
    ).toBe(false);
    expect(
      qualifyNorthStarConversationV1({
        kind: "RADAR",
        contactRequestId: "request",
        acceptedAt: submittedAt,
        responseAt: new Date(submittedAt.getTime() + 48 * HOUR_MS),
        cantonId: "canton-zh",
        categoryId: "category-it",
        actorProvenance: "LIVE",
        companyProvenance: "LIVE",
        jobProvenance: null,
        actorsActive: true,
        clusterAssessmentActive: true,
      }).qualifies,
    ).toBe(true);
    expect(
      qualifyNorthStarConversationV1({
        kind: "RADAR",
        contactRequestId: "request",
        acceptedAt: submittedAt,
        responseAt: new Date(submittedAt.getTime() + 48 * HOUR_MS + 1),
        cantonId: "canton-zh",
        categoryId: "category-it",
        actorProvenance: "LIVE",
        companyProvenance: "LIVE",
        jobProvenance: null,
        actorsActive: true,
        clusterAssessmentActive: true,
      }).qualifies,
    ).toBe(false);
  });

  it("requires separate LIVE actor, company, and Job provenance for Application North Star", () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    const input = {
      kind: "APPLICATION" as const,
      applicationId: "app",
      submittedAt,
      responseTargetDays: 2,
      responseAt: new Date(submittedAt.getTime() + DAY_MS),
      cantonId: "canton-zh",
      categoryId: "category-it",
      actorProvenance: "LIVE" as const,
      companyProvenance: "LIVE" as const,
      jobProvenance: "LIVE" as const,
      actorsActive: true,
      clusterAssessmentActive: true,
    };
    expect(qualifyNorthStarConversationV1(input).qualifies).toBe(true);
    expect(
      qualifyNorthStarConversationV1({ ...input, actorProvenance: "DEMO" }).qualifies,
    ).toBe(false);
    expect(
      qualifyNorthStarConversationV1({ ...input, companyProvenance: "TEST" }).qualifies,
    ).toBe(false);
    expect(
      qualifyNorthStarConversationV1({ ...input, jobProvenance: "DEMO" }).qualifies,
    ).toBe(false);
  });

  it("freezes near-limit, response, Radar-pack, and supply-gap thresholds", () => {
    expect(evaluateNearJobLimitV1({ activeJobs: 4, jobLimit: 5, submittedApplications: 3 })).toBe(true);
    expect(evaluateNearJobLimitV1({ activeJobs: 4, jobLimit: 5, submittedApplications: 2 })).toBe(false);
    expect(evaluateSlowResponseV1({ dueApplications: 10, onTimeRateBps: 6_999 })).toBe(true);
    expect(evaluateSlowResponseV1({ dueApplications: 10, onTimeRateBps: 7_000 })).toBe(false);
    expect(
      evaluateRadarPackCandidateV1({
        includedContactsUsed: 8,
        includedContactsLimit: 10,
        acceptedRequests: 5,
      }),
    ).toBe(true);
    expect(
      evaluateSupplyGapV1({
        searchResultSessions: 200,
        eligibleLiveJobs: 49,
        queryCoverageBps: 10_000,
      }),
    ).toBe(true);
    expect(
      evaluateSupplyGapV1({
        searchResultSessions: 200,
        eligibleLiveJobs: 50,
        queryCoverageBps: 8_000,
      }),
    ).toBe(false);
  });

  it("requires every Free-upgrade condition and honors the 30-day dismissal window", () => {
    const base = {
      companyActive: true,
      companyVerified: true,
      isFreePlan: true,
      firstPublishedAt: new Date(now.getTime() - 14 * DAY_MS),
      submittedApplications: 5,
      hasOpenQualifiedLead: false,
      dismissedAt: null,
      now,
    };
    expect(evaluateFreeUpgradeCandidateV1(base)).toBe(true);
    expect(
      evaluateFreeUpgradeCandidateV1({
        ...base,
        dismissedAt: new Date(now.getTime() - 30 * DAY_MS + 1),
      }),
    ).toBe(false);
    expect(isDismissalEffectiveV1(new Date(now.getTime() - 30 * DAY_MS), now)).toBe(false);
  });

  it("separates content diagnosis from an eligible Boost experiment", () => {
    const blocked = {
      organicDetailSessions: 100,
      applyIntentRateBps: 199,
      publishedAt: new Date(now.getTime() - 14 * DAY_MS),
      now,
      fairScoreV2: 69,
      salaryEvidencePresent: true,
      processEvidencePresent: true,
      applicationEffort: "SIMPLE" as const,
      applyPathBroken: false,
    };
    expect(evaluateJobContentDiagnosticV1(blocked)).toBe(true);

    const clean = { ...blocked, fairScoreV2: 70 };
    expect(evaluateJobContentDiagnosticV1(clean)).toBe(false);
    expect(
      evaluateBoostTestCandidateV1({
        content: clean,
        hasActiveBoost: false,
        baselineBps: 600,
      }),
    ).toBe(true);
    expect(
      evaluateBoostTestCandidateV1({
        content: { ...clean, applyIntentRateBps: 300 },
        hasActiveBoost: false,
        baselineBps: 600,
      }),
    ).toBe(false);
  });

  it("requires an exact rolling-90-day, same-pair 20-job LIVE baseline", () => {
    const measuredFrom = new Date(now.getTime() - 90 * DAY_MS);
    const query = { cantonId: "canton-zh", categoryId: "category-it", now };
    const eligible = Array.from({ length: 20 }, (_, index) => ({
      jobId: `job-${index}`,
      cantonId: query.cantonId,
      categoryId: query.categoryId,
      measuredFrom,
      measuredTo: now,
      companyProvenance: "LIVE" as const,
      jobProvenance: "LIVE" as const,
      organicDetailSessions: 100,
      conversionBps: 100 + index,
    }));
    expect(calculateClusterBaselineBpsV1(eligible.slice(0, 19), query)).toBeNull();
    expect(calculateClusterBaselineBpsV1(eligible, query)).toBe(110);
    expect(
      calculateClusterBaselineBpsV1([
        ...eligible.slice(0, 19),
        { ...eligible[19]!, companyProvenance: "DEMO", conversionBps: 500 },
      ], query),
    ).toBeNull();
    expect(
      calculateClusterBaselineBpsV1([
        ...eligible.slice(0, 19),
        { ...eligible[19]!, cantonId: "canton-be" },
      ], query),
    ).toBeNull();
    expect(
      calculateClusterBaselineBpsV1([
        ...eligible.slice(0, 19),
        { ...eligible[19]!, categoryId: "category-care" },
      ], query),
    ).toBeNull();
    expect(
      calculateClusterBaselineBpsV1([
        ...eligible.slice(0, 19),
        { ...eligible[19]!, measuredFrom: new Date(measuredFrom.getTime() + 1) },
      ], query),
    ).toBeNull();
    expect(
      calculateClusterBaselineBpsV1(
        eligible.map((job) => ({ ...job, jobId: "same-job" })),
        query,
      ),
    ).toBeNull();
  });

  it("schedules follow-up exactly 14 days after action", () => {
    expect(getSignalFollowUpAtV1(now)).toEqual(new Date(now.getTime() + 14 * DAY_MS));
    const keyInput = {
      entityType: "COMPANY",
      entityId: "company-1",
      reason: "NEAR_JOB_LIMIT",
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
    } as const;
    expect(buildCockpitSignalTaskKeyV1(keyInput)).toBe(
      "COMPANY:company-1:NEAR_JOB_LIMIT:2026-06-01T00:00:00.000Z",
    );
    expect(buildCockpitSignalTaskKeyV1(keyInput)).toBe(
      buildCockpitSignalTaskKeyV1({ ...keyInput }),
    );
  });
});
