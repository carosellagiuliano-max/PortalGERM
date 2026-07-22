import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  aggregateRecommendationAnalytics,
  orderEmployerDashboardRecommendations,
  type EmployerDashboardRecommendation,
  type RecommendationAnalyticsRow,
} from "@/lib/employer/dashboard";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const WINDOW_30 = new Date("2026-06-22T12:00:00.000Z");
const WINDOW_90 = new Date("2026-04-23T12:00:00.000Z");

describe("Phase 13 employer boost recommendations", () => {
  it("orders content diagnostics before boost experiments across different jobs", () => {
    const boost = recommendation("BOOST_TEST_CANDIDATE", "job-a");
    const diagnostic = recommendation("JOB_CONTENT_DIAGNOSTIC", "job-z");

    expect(orderEmployerDashboardRecommendations([boost, diagnostic])).toEqual([
      diagnostic,
      boost,
    ]);
  });

  it("counts apply intent only for sessions with an organic detail view", () => {
    const rows: RecommendationAnalyticsRow[] = [
      event("JOB_DETAIL_VIEWED", "organic", { placement: "ORGANIC" }),
      event("JOB_DETAIL_VIEWED", "sponsored", {
        placement: "SEARCH_SPONSORED",
      }),
      event("APPLY_INTENT_STARTED", "organic"),
      event("APPLY_INTENT_STARTED", "sponsored"),
      event("APPLY_INTENT_STARTED", "no-detail"),
    ];

    expect(
      aggregateRecommendationAnalytics(rows, WINDOW_30, WINDOW_90, NOW).get(
        "job-1",
      ),
    ).toEqual({ views30: 1, intents30: 1, views90: 1, intents90: 1 });
  });
});

function recommendation(
  kind: EmployerDashboardRecommendation["kind"],
  jobId: string,
): EmployerDashboardRecommendation {
  return {
    kind,
    jobId,
    title: jobId,
    evidence: "evidence",
    suggestedAction: "action",
    expectedMetric: "metric",
    followUpAt: NOW,
  };
}

function event(
  kind: RecommendationAnalyticsRow["kind"],
  sessionId: string,
  properties: Record<string, unknown> = {},
): RecommendationAnalyticsRow {
  return {
    jobId: "job-1",
    kind,
    occurredAt: new Date("2026-07-01T12:00:00.000Z"),
    pseudonymousSessionId: sessionId,
    dedupeKey: `${kind}:${sessionId}`,
    properties,
  };
}
