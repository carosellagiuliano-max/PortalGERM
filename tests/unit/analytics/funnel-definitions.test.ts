// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  calculateCandidateActivation7dV1,
  calculateCheckoutConversionV1,
  calculateEmployerActivation14dV1,
  calculateLeadFunnelV1,
  calculateSearchToApply7dV1,
  getZurichBusinessDateV1,
  type FunnelEventV1,
  isAdmissibleAnalyticsEventV1,
} from "@/lib/analytics/funnel-definitions";

const DAY_MS = 86_400_000;
const base = new Date("2026-01-01T00:00:00.000Z");

function event(
  kind: FunnelEventV1["kind"],
  offsetMs: number,
  rest: Omit<
    FunnelEventV1,
    | "kind"
    | "occurredAt"
    | "actorProvenance"
    | "companyProvenance"
    | "jobProvenance"
  > & Partial<Pick<
    FunnelEventV1,
    "actorProvenance" | "companyProvenance" | "jobProvenance"
  >> = {},
): FunnelEventV1 {
  return {
    kind,
    occurredAt: new Date(base.getTime() + offsetMs),
    actorProvenance: "LIVE",
    companyProvenance: "LIVE",
    jobProvenance: "LIVE",
    ...rest,
  };
}

describe("funnel definitions v1", () => {
  it("counts distinct candidate activations inside the half-open seven-day window", () => {
    const events: FunnelEventV1[] = Array.from(
      { length: 20 },
      (_, index) => [
        event("CANDIDATE_REGISTERED", 0, { subjectId: `candidate-${index}` }),
        event(
          "CANDIDATE_PROFILE_COMPLETED",
          index === 19 ? 7 * DAY_MS : 7 * DAY_MS - 1,
          { subjectId: `candidate-${index}` },
        ),
      ],
    ).flat();
    events.push(
      event("CANDIDATE_PROFILE_COMPLETED", 2 * DAY_MS, {
        subjectId: "candidate-0",
      }),
      {
        ...event("CANDIDATE_REGISTERED", 0, { subjectId: "demo" }),
        actorProvenance: "DEMO",
      },
      {
        ...event("CANDIDATE_PROFILE_COMPLETED", DAY_MS, { subjectId: "demo" }),
        actorProvenance: "DEMO",
      },
    );
    expect(calculateCandidateActivation7dV1(events)).toEqual({
      status: "VALUE",
      numerator: 19,
      denominator: 20,
      rateBps: 9_500,
    });
  });

  it("counts employer activation before but not at day fourteen", () => {
    const events = Array.from({ length: 20 }, (_, index) => [
      event("COMPANY_ONBOARDING_COMPLETED", 0, {
        companyId: `company-${index}`,
      }),
      event(
        "JOB_PUBLISHED",
        index === 19 ? 14 * DAY_MS : 14 * DAY_MS - 1,
        { companyId: `company-${index}` },
      ),
    ]).flat();
    expect(
      calculateEmployerActivation14dV1(events),
    ).toEqual({ status: "VALUE", numerator: 19, denominator: 20, rateBps: 9_500 });
  });

  it("requires one ordered same-session Search to Apply chain", () => {
    const events = Array.from({ length: 18 }, (_, index) => [
      event("SEARCH_RESULTS_VIEWED", 0, {
        pseudonymousSessionId: `complete-${index}`,
      }),
      event("JOB_DETAIL_VIEWED", 1, {
        pseudonymousSessionId: `complete-${index}`,
      }),
      event("APPLY_INTENT_STARTED", 2, {
        pseudonymousSessionId: `complete-${index}`,
      }),
      event("APPLICATION_SUBMITTED", 3, {
        pseudonymousSessionId: `complete-${index}`,
      }),
    ]).flat();
    events.push(
      event("SEARCH_RESULTS_VIEWED", 0, { pseudonymousSessionId: "wrong-order" }),
      event("APPLY_INTENT_STARTED", 1, { pseudonymousSessionId: "wrong-order" }),
      event("JOB_DETAIL_VIEWED", 2, { pseudonymousSessionId: "wrong-order" }),
      event("APPLICATION_SUBMITTED", 3, { pseudonymousSessionId: "wrong-order" }),
      event("SEARCH_RESULTS_VIEWED", 0, { pseudonymousSessionId: "boundary" }),
      event("JOB_DETAIL_VIEWED", 1, { pseudonymousSessionId: "boundary" }),
      event("APPLY_INTENT_STARTED", 2, { pseudonymousSessionId: "boundary" }),
      event("APPLICATION_SUBMITTED", 7 * DAY_MS, { pseudonymousSessionId: "boundary" }),
    );
    expect(calculateSearchToApply7dV1(events)).toEqual({
      status: "VALUE",
      resultSessions: 20,
      detailSessions: 20,
      intentSessions: 19,
      submittedSessions: 18,
      resultToApplyRateBps: 9_000,
    });
  });

  it("uses first ordered events for Lead and Checkout funnels", () => {
    const leadEvents = Array.from({ length: 18 }, (_, index) => [
      event("LEAD_SUBMITTED", 0, { leadId: `won-${index}` }),
      event("LEAD_QUALIFIED", 1, { leadId: `won-${index}` }),
      event("LEAD_WON", 2, { leadId: `won-${index}` }),
    ]).flat();
    leadEvents.push(
      event("LEAD_SUBMITTED", 0, { leadId: "out-of-order" }),
      event("LEAD_WON", 1, { leadId: "out-of-order" }),
      event("LEAD_QUALIFIED", 2, { leadId: "out-of-order" }),
      event("LEAD_SUBMITTED", 0, { leadId: "submitted-only" }),
    );
    expect(
      calculateLeadFunnelV1(leadEvents),
    ).toEqual({
      status: "VALUE",
      submitted: 20,
      qualified: 19,
      won: 18,
      submittedToWonBps: 9_000,
    });

    const checkoutEvents = Array.from({ length: 19 }, (_, index) => [
      event("CHECKOUT_STARTED", 0, {
        companyId: "company",
        orderId: `paid-${index}`,
      }),
      event("CHECKOUT_COMPLETED", 1, {
        companyId: "company",
        orderId: `paid-${index}`,
      }),
    ]).flat();
    checkoutEvents.push(
      event("CHECKOUT_STARTED", 0, { companyId: "company", orderId: "open" }),
      event("CHECKOUT_COMPLETED", -1, { companyId: "company", orderId: "open" }),
    );
    expect(
      calculateCheckoutConversionV1(checkoutEvents),
    ).toEqual({ status: "VALUE", started: 20, completed: 19, conversionBps: 9_500 });
  });

  it("suppresses every raw funnel value at 19 distinct denominator subjects", () => {
    const candidates = Array.from({ length: 19 }, (_, index) => [
      event("CANDIDATE_REGISTERED", 0, { subjectId: `candidate-${index}` }),
      event("CANDIDATE_PROFILE_COMPLETED", 1, { subjectId: `candidate-${index}` }),
    ]).flat();
    const search = Array.from({ length: 19 }, (_, index) =>
      event("SEARCH_RESULTS_VIEWED", 0, { pseudonymousSessionId: `session-${index}` })
    );
    const leads = Array.from({ length: 19 }, (_, index) =>
      event("LEAD_SUBMITTED", 0, { leadId: `lead-${index}` })
    );
    const checkout = Array.from({ length: 19 }, (_, index) =>
      event("CHECKOUT_STARTED", 0, {
        companyId: "company",
        orderId: `order-${index}`,
      })
    );

    expect(calculateCandidateActivation7dV1(candidates)).toEqual({
      status: "SUPPRESSED",
      numerator: "SUPPRESSED",
      denominator: "SUPPRESSED",
      rateBps: "SUPPRESSED",
    });
    expect(calculateSearchToApply7dV1(search)).toEqual({
      status: "SUPPRESSED",
      resultSessions: "SUPPRESSED",
      detailSessions: "SUPPRESSED",
      intentSessions: "SUPPRESSED",
      submittedSessions: "SUPPRESSED",
      resultToApplyRateBps: "SUPPRESSED",
    });
    expect(calculateLeadFunnelV1(leads)).toEqual({
      status: "SUPPRESSED",
      submitted: "SUPPRESSED",
      qualified: "SUPPRESSED",
      won: "SUPPRESSED",
      submittedToWonBps: "SUPPRESSED",
    });
    expect(calculateCheckoutConversionV1(checkout)).toEqual({
      status: "SUPPRESSED",
      started: "SUPPRESSED",
      completed: "SUPPRESSED",
      conversionBps: "SUPPRESSED",
    });
  });

  it("exposes an actual zero only for a population of at least 20", () => {
    const twentyRegistrations = Array.from({ length: 20 }, (_, index) =>
      event("CANDIDATE_REGISTERED", 0, { subjectId: `candidate-${index}` })
    );
    expect(calculateCandidateActivation7dV1(twentyRegistrations)).toEqual({
      status: "VALUE",
      numerator: 0,
      denominator: 20,
      rateBps: 0,
    });
    expect(calculateCandidateActivation7dV1([])).toEqual({
      status: "SUPPRESSED",
      numerator: "SUPPRESSED",
      denominator: "SUPPRESSED",
      rateBps: "SUPPRESSED",
    });
  });

  it("excludes separate DEMO/TEST snapshots and events at the late cutoff", () => {
    const live = event("JOB_PUBLISHED", 0);
    expect(isAdmissibleAnalyticsEventV1(live)).toBe(true);
    expect(
      isAdmissibleAnalyticsEventV1({ ...live, actorProvenance: "TEST" }),
    ).toBe(false);
    expect(
      isAdmissibleAnalyticsEventV1({ ...live, companyProvenance: "DEMO" }),
    ).toBe(false);
    expect(
      isAdmissibleAnalyticsEventV1({ ...live, jobProvenance: "TEST" }),
    ).toBe(false);
    expect(
      isAdmissibleAnalyticsEventV1({
        ...live,
        receivedAt: new Date(live.occurredAt.getTime() + 7 * DAY_MS),
      }),
    ).toBe(false);
  });

  it("attributes business dates in Europe/Zurich, including DST", () => {
    expect(getZurichBusinessDateV1(new Date("2026-01-31T23:30:00.000Z"))).toBe(
      "2026-02-01",
    );
    expect(getZurichBusinessDateV1(new Date("2026-03-29T00:30:00.000Z"))).toBe(
      "2026-03-29",
    );
    expect(getZurichBusinessDateV1(new Date("2026-03-29T01:30:00.000Z"))).toBe(
      "2026-03-29",
    );
  });
});
