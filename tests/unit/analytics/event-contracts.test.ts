// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENT_CONTRACTS_V1,
  ANALYTICS_EVENT_KINDS_V1,
  ANALYTICS_EVENT_PROPERTIES_V1,
  ANALYTICS_SCHEMA_VERSION_V1,
  analyticsEventV1Schema,
  ESSENTIAL_ANALYTICS_RETENTION_DAYS_V1,
  getAnalyticsRetainUntilV1,
  METRIC_DAILY_RETENTION_MONTHS_V1,
  PRODUCT_ANALYTICS_KINDS_V1,
  PRODUCT_ANALYTICS_RETENTION_DAYS_V1,
} from "@/lib/analytics/event-contracts";
import {
  AnalyticsEventKind,
  type AnalyticsEventKind as AnalyticsEventKindValue,
} from "@/lib/generated/prisma/enums";

const validProperties = {
  PUBLIC_VALUE_VIEWED: { surface: "HOMEPAGE", locale: "de-CH" },
  SEARCH_SUBMITTED: { surface: "JOB_SEARCH", locale: "de-CH", sort: "relevance" },
  SEARCH_RESULTS_VIEWED: {
    surface: "JOB_SEARCH",
    locale: "de-CH",
    resultCountBucket: "10-24",
  },
  JOB_DETAIL_VIEWED: { surface: "JOB_DETAIL", locale: "de-CH" },
  JOB_SAVED: { surface: "JOB_DETAIL", intent: "SAVE" },
  APPLY_INTENT_STARTED: { surface: "JOB_DETAIL", intent: "APPLY" },
  EXTERNAL_APPLY_CLICKED: {
    surface: "JOB_DETAIL",
    intent: "APPLY",
    destinationKind: "EXTERNAL_HTTP_URL",
  },
  APPLICATION_SUBMITTED: { fromStatus: "DRAFT", toStatus: "SUBMITTED" },
  APPLICATION_STATUS_CHANGED: { fromStatus: "SUBMITTED", toStatus: "IN_REVIEW" },
  CANDIDATE_REGISTERED: { onboardingRuleVersion: "candidate-v1" },
  CANDIDATE_PROFILE_COMPLETED: {
    onboardingRuleVersion: "candidate-v1",
    completionPercentBucket: "100",
  },
  RADAR_OPTED_IN: { onboardingRuleVersion: "radar-v1" },
  JOB_ALERT_ACTIVATED: {
    onboardingRuleVersion: "candidate-v1",
    completionPercentBucket: "100",
    alertFrequency: "WEEKLY",
  },
  EMPLOYER_REGISTERED: { onboardingRuleVersion: "employer-v1" },
  COMPANY_ONBOARDING_COMPLETED: { onboardingRuleVersion: "company-v1" },
  COMPANY_VERIFICATION_SUBMITTED: {},
  COMPANY_VERIFIED: {},
  JOB_DRAFT_CREATED: { toStatus: "DRAFT" },
  JOB_SUBMITTED: { fromStatus: "DRAFT", toStatus: "SUBMITTED" },
  JOB_PUBLISHED: { fromStatus: "APPROVED", toStatus: "PUBLISHED" },
  EMPLOYER_RESPONSE_RECORDED: {},
  CONTACT_REQUEST_SENT: { fundingSource: "PLAN_ALLOWANCE" },
  CONTACT_REQUEST_ACCEPTED: {},
  CONTACT_REQUEST_DECLINED: {},
  IDENTITY_REVEAL_GRANTED: {},
  PRICING_VIEWED: { surface: "PRICING", planSlug: "pro" },
  LIMIT_REACHED: { planSlug: "free-basic", productSlug: "contact-pack-10" },
  CHECKOUT_STARTED: { planSlug: "pro", amountRappen: 39_900 },
  CHECKOUT_COMPLETED: { productSlug: "job-boost-7d", amountRappen: 9_900 },
  SUBSCRIPTION_CHANGED: { planSlug: "starter" },
  LEAD_SUBMITTED: { leadPurpose: "EMPLOYER_DEMO" },
  LEAD_QUALIFIED: { leadPurpose: "ENTERPRISE" },
  LEAD_WON: {},
  BOOST_ACTIVATED: {
    productSlug: "job-boost-7d",
    fundingSource: "PURCHASED_PACK",
    placement: "SEARCH_SPONSORED",
  },
  MODERATION_ACTIONED: { fromStatus: "OPEN", toStatus: "RESOLVED" },
} as const satisfies Record<AnalyticsEventKindValue, Readonly<Record<string, unknown>>>;

describe("analytics event contracts v1", () => {
  it("covers all and only the 35 Prisma event kinds", () => {
    expect(ANALYTICS_EVENT_KINDS_V1).toHaveLength(35);
    expect(Object.keys(ANALYTICS_EVENT_CONTRACTS_V1).sort()).toEqual(
      Object.values(AnalyticsEventKind).sort(),
    );
    expect(Object.keys(ANALYTICS_EVENT_PROPERTIES_V1).sort()).toEqual(
      Object.values(AnalyticsEventKind).sort(),
    );
  });

  it("classifies exactly eight kinds as PRODUCT_ANALYTICS", () => {
    const productKinds = Object.entries(ANALYTICS_EVENT_CONTRACTS_V1)
      .filter(([, contract]) => contract.purpose === "PRODUCT_ANALYTICS")
      .map(([kind]) => kind)
      .sort();

    expect(productKinds).toEqual([...PRODUCT_ANALYTICS_KINDS_V1].sort());
    expect(productKinds).toHaveLength(8);
    expect(METRIC_DAILY_RETENTION_MONTHS_V1).toBe(25);
    for (const [kind, contract] of Object.entries(ANALYTICS_EVENT_CONTRACTS_V1)) {
      expect(contract.retentionDays).toBe(
        productKinds.includes(kind)
          ? PRODUCT_ANALYTICS_RETENTION_DAYS_V1
          : ESSENTIAL_ANALYTICS_RETENTION_DAYS_V1,
      );
    }
  });

  it("parses one strict, versioned event for every kind", () => {
    for (const kind of Object.values(AnalyticsEventKind)) {
      expect(
        analyticsEventV1Schema.safeParse({
          kind,
          schemaVersion: ANALYTICS_SCHEMA_VERSION_V1,
          producerEventId: `producer:${kind}`,
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
          properties: validProperties[kind],
        }).success,
        kind,
      ).toBe(true);
    }
  });

  it("enforces the exact product-property subsets", () => {
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.PUBLIC_VALUE_VIEWED.safeParse({
        surface: "HOMEPAGE",
        locale: "de-CH",
        cantonCode: "ZH",
        categorySlug: "informatik",
      }).success,
    ).toBe(true);
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.PUBLIC_VALUE_VIEWED.safeParse({
        surface: "HOMEPAGE",
        locale: "de-CH",
        sort: "relevance",
      }).success,
    ).toBe(false);
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.SEARCH_RESULTS_VIEWED.safeParse({
        surface: "JOB_SEARCH",
        locale: "de-CH",
      }).success,
    ).toBe(false);
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.JOB_DETAIL_VIEWED.safeParse({
        surface: "JOB_DETAIL",
        locale: "de-CH",
        resultCountBucket: "10-24",
      }).success,
    ).toBe(false);
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.PRICING_VIEWED.safeParse({
        surface: "PRICING",
        amountRappen: 100,
      }).success,
    ).toBe(false);
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.SEARCH_SUBMITTED.safeParse({
        surface: "JOB_SEARCH",
        locale: "de-CH",
        sort: "fair-score",
      }).success,
    ).toBe(true);
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.SEARCH_SUBMITTED.safeParse({
        surface: "JOB_SEARCH",
        locale: "de-CH",
        sort: "fairjobscore",
      }).success,
    ).toBe(false);
  });

  it("keeps JOB_ALERT_ACTIVATED inside the candidate-onboarding subset", () => {
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.JOB_ALERT_ACTIVATED.safeParse({
        onboardingRuleVersion: "candidate-v1",
        completionPercentBucket: "100",
        alertFrequency: "DAILY",
      }).success,
    ).toBe(true);
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.JOB_ALERT_ACTIVATED.safeParse({
        alertFrequency: "DAILY",
      }).success,
    ).toBe(false);
  });

  it("keeps external apply clicks distinct and tightly allowlisted", () => {
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.EXTERNAL_APPLY_CLICKED.safeParse({
        surface: "JOB_DETAIL",
        intent: "APPLY",
        destinationKind: "EXTERNAL_HTTP_URL",
      }).success,
    ).toBe(true);
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.EXTERNAL_APPLY_CLICKED.safeParse({
        surface: "JOB_DETAIL",
        intent: "APPLY",
        destinationKind: "EXTERNAL_HTTP_URL",
        destinationUrl: "https://employer.example/private-campaign",
      }).success,
    ).toBe(false);
    expect(
      ANALYTICS_EVENT_CONTRACTS_V1.EXTERNAL_APPLY_CLICKED.metricMappings,
    ).not.toContain("CANDIDATE_ACTIVATION");
  });

  it("rejects unknown properties and PII canaries for every kind", () => {
    for (const kind of Object.values(AnalyticsEventKind)) {
      const schema = ANALYTICS_EVENT_PROPERTIES_V1[kind];
      expect(
        schema.safeParse({
          ...validProperties[kind],
          email: "candidate-canary@example.test",
        }).success,
        kind,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...validProperties[kind],
          message: "private-message-canary",
        }).success,
        kind,
      ).toBe(false);
    }
  });

  it("rejects unknown kinds, versions, and top-level request payloads", () => {
    const base = {
      kind: AnalyticsEventKind.JOB_DETAIL_VIEWED,
      schemaVersion: "1",
      producerEventId: "detail-1",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      properties: validProperties.JOB_DETAIL_VIEWED,
    };
    expect(analyticsEventV1Schema.safeParse({ ...base, schemaVersion: "2" }).success).toBe(false);
    expect(analyticsEventV1Schema.safeParse({ ...base, kind: "UNKNOWN" }).success).toBe(false);
    expect(analyticsEventV1Schema.safeParse({ ...base, rawRequest: {} }).success).toBe(false);
    expect(
      ANALYTICS_EVENT_PROPERTIES_V1.JOB_PUBLISHED.safeParse({
        fromStatus: "APPROVED",
        toStatus: "CLIENT_SUPPLIED_STATUS",
      }).success,
    ).toBe(false);
  });

  it("computes immutable raw-retention boundaries from occurredAt", () => {
    const occurredAt = new Date("2026-01-01T00:00:00.000Z");
    expect(
      getAnalyticsRetainUntilV1(AnalyticsEventKind.JOB_DETAIL_VIEWED, occurredAt),
    ).toEqual(new Date("2026-04-01T00:00:00.000Z"));
    expect(
      getAnalyticsRetainUntilV1(AnalyticsEventKind.APPLICATION_SUBMITTED, occurredAt),
    ).toEqual(new Date("2027-02-05T00:00:00.000Z"));
  });
});
