import { z } from "zod";

import {
  AnalyticsEventKind,
  type AnalyticsEventKind as AnalyticsEventKindValue,
  AnalyticsPurpose,
  type AnalyticsPurpose as AnalyticsPurposeValue,
} from "@/lib/generated/prisma/enums";
import type { AnalyticsMetricKeyV1 } from "@/lib/analytics/metric-definitions-v1";

export const ANALYTICS_SCHEMA_VERSION_V1 = "1" as const;
export const PRODUCT_ANALYTICS_RETENTION_DAYS_V1 = 90;
export const ESSENTIAL_ANALYTICS_RETENTION_DAYS_V1 = 400;
export const METRIC_DAILY_RETENTION_MONTHS_V1 = 25;

export const ANALYTICS_EVENT_KINDS_V1 = Object.freeze(
  Object.values(AnalyticsEventKind),
);

export const PRODUCT_ANALYTICS_KINDS_V1 = Object.freeze([
  AnalyticsEventKind.PUBLIC_VALUE_VIEWED,
  AnalyticsEventKind.SEARCH_SUBMITTED,
  AnalyticsEventKind.SEARCH_RESULTS_VIEWED,
  AnalyticsEventKind.JOB_DETAIL_VIEWED,
  AnalyticsEventKind.JOB_SAVED,
  AnalyticsEventKind.APPLY_INTENT_STARTED,
  AnalyticsEventKind.PRICING_VIEWED,
] as const);

const boundedSlug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const locale = z.enum(["de-CH", "fr-CH", "it-CH", "en-CH"]);
const surface = z.enum([
  "HOMEPAGE",
  "JOB_SEARCH",
  "JOB_DETAIL",
  "CANDIDATE_DASHBOARD",
  "EMPLOYER_DASHBOARD",
  "PRICING",
]);
const searchSort = z.enum([
  "relevance",
  "newest",
  "fair-score",
  "salary",
  "response",
]);
const intent = z.enum(["BROWSE", "SAVE", "APPLY", "COMPARE"]);
const resultCountBucket = z.enum(["0", "1-9", "10-24", "25-49", "50+"]);
const placement = z.enum([
  "ORGANIC",
  "SEARCH_SPONSORED",
  "HOMEPAGE_SPONSORED",
]);
const completionPercentBucket = z.enum([
  "0-24",
  "25-49",
  "50-74",
  "75-99",
  "100",
]);
const applicationEffort = z.enum(["SIMPLE", "MEDIUM", "LONG"]);
const workflowStatus = z.enum([
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "PUBLISHED",
  "PAUSED",
  "EXPIRED",
  "CLOSED",
  "REJECTED",
  "REMOVED",
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "WITHDRAWN",
  "OPEN",
  "RESOLVED",
  "DISMISSED",
]);
const alertFrequency = z.enum(["DAILY", "WEEKLY"]);
const fundingSource = z.enum([
  "PLAN_ALLOWANCE",
  "PURCHASED_PACK",
  "ADMIN_GRANT",
]);
const leadPurpose = z.enum([
  "EMPLOYER_DEMO",
  "SALES_CONTACT",
  "ENTERPRISE",
  "IMPORT",
]);

const emptyProperties = z.object({}).strict();
const publicValueProperties = z
  .object({
    surface,
    locale,
    cantonCode: z.string().regex(/^[A-Z]{2}$/).optional(),
    categorySlug: boundedSlug.optional(),
  })
  .strict();
const searchSubmittedProperties = publicValueProperties
  .extend({ sort: searchSort.optional(), intent: intent.optional() })
  .strict();
const searchResultsProperties = searchSubmittedProperties
  .extend({ resultCountBucket })
  .strict();
const jobDetailProperties = z
  .object({ surface, locale, placement: placement.optional() })
  .strict();
const intentProperties = z
  .object({ surface, intent: intent.optional() })
  .strict();
const pricingProperties = z
  .object({ surface, planSlug: boundedSlug.optional() })
  .strict();
const onboardingProperties = z
  .object({
    onboardingRuleVersion: z.string().min(1).max(32),
    completionPercentBucket: completionPercentBucket.optional(),
  })
  .strict();
const alertProperties = onboardingProperties
  .extend({ alertFrequency })
  .strict();
const workflowProperties = z
  .object({
    fromStatus: workflowStatus.optional(),
    toStatus: workflowStatus.optional(),
    applicationEffort: applicationEffort.optional(),
  })
  .strict();
const fundingProperties = z.object({ fundingSource: fundingSource.optional() }).strict();
const commercialProperties = z
  .object({
    planSlug: boundedSlug.optional(),
    productSlug: boundedSlug.optional(),
    amountRappen: z.number().int().nonnegative().safe().optional(),
  })
  .strict();
const limitProperties = commercialProperties.omit({ amountRappen: true }).strict();
const leadProperties = z.object({ leadPurpose: leadPurpose.optional() }).strict();
const boostProperties = z
  .object({
    productSlug: boundedSlug.optional(),
    fundingSource: fundingSource.optional(),
    placement: placement.optional(),
  })
  .strict();

export const ANALYTICS_EVENT_PROPERTIES_V1 = {
  PUBLIC_VALUE_VIEWED: publicValueProperties,
  SEARCH_SUBMITTED: searchSubmittedProperties,
  SEARCH_RESULTS_VIEWED: searchResultsProperties,
  JOB_DETAIL_VIEWED: jobDetailProperties,
  JOB_SAVED: intentProperties,
  APPLY_INTENT_STARTED: intentProperties,
  APPLICATION_SUBMITTED: workflowProperties,
  APPLICATION_STATUS_CHANGED: workflowProperties,
  CANDIDATE_REGISTERED: onboardingProperties,
  CANDIDATE_PROFILE_COMPLETED: onboardingProperties,
  RADAR_OPTED_IN: onboardingProperties,
  JOB_ALERT_ACTIVATED: alertProperties,
  EMPLOYER_REGISTERED: onboardingProperties,
  COMPANY_ONBOARDING_COMPLETED: onboardingProperties,
  COMPANY_VERIFICATION_SUBMITTED: emptyProperties,
  COMPANY_VERIFIED: emptyProperties,
  JOB_DRAFT_CREATED: workflowProperties,
  JOB_SUBMITTED: workflowProperties,
  JOB_PUBLISHED: workflowProperties,
  EMPLOYER_RESPONSE_RECORDED: emptyProperties,
  CONTACT_REQUEST_SENT: fundingProperties,
  CONTACT_REQUEST_ACCEPTED: fundingProperties,
  CONTACT_REQUEST_DECLINED: fundingProperties,
  IDENTITY_REVEAL_GRANTED: fundingProperties,
  PRICING_VIEWED: pricingProperties,
  LIMIT_REACHED: limitProperties,
  CHECKOUT_STARTED: commercialProperties,
  CHECKOUT_COMPLETED: commercialProperties,
  SUBSCRIPTION_CHANGED: commercialProperties,
  LEAD_SUBMITTED: leadProperties,
  LEAD_QUALIFIED: leadProperties,
  LEAD_WON: leadProperties,
  BOOST_ACTIVATED: boostProperties,
  MODERATION_ACTIONED: workflowProperties,
} as const satisfies Record<AnalyticsEventKindValue, z.ZodType>;

type AnalyticsOwnerV1 =
  | "DISCOVERY"
  | "CANDIDATE"
  | "EMPLOYER"
  | "MARKETPLACE"
  | "BILLING"
  | "SALES"
  | "TRUST_SAFETY";

export type AnalyticsEventContractV1 = Readonly<{
  owner: AnalyticsOwnerV1;
  purpose: AnalyticsPurposeValue;
  retentionDays: number;
  metricMappings: readonly AnalyticsMetricKeyV1[];
  propertiesSchema: z.ZodType;
}>;

function productContract(
  propertiesSchema: z.ZodType,
  owner: AnalyticsOwnerV1,
  metricMappings: readonly AnalyticsMetricKeyV1[],
): AnalyticsEventContractV1 {
  return Object.freeze({
    owner,
    purpose: AnalyticsPurpose.PRODUCT_ANALYTICS,
    retentionDays: PRODUCT_ANALYTICS_RETENTION_DAYS_V1,
    metricMappings: Object.freeze([...metricMappings]),
    propertiesSchema,
  });
}

function essentialContract(
  propertiesSchema: z.ZodType,
  owner: AnalyticsOwnerV1,
  metricMappings: readonly AnalyticsMetricKeyV1[],
): AnalyticsEventContractV1 {
  return Object.freeze({
    owner,
    purpose: AnalyticsPurpose.ESSENTIAL_OPERATIONAL,
    retentionDays: ESSENTIAL_ANALYTICS_RETENTION_DAYS_V1,
    metricMappings: Object.freeze([...metricMappings]),
    propertiesSchema,
  });
}

export const ANALYTICS_EVENT_CONTRACTS_V1 = Object.freeze({
  PUBLIC_VALUE_VIEWED: productContract(publicValueProperties, "DISCOVERY", ["PUBLIC_VALUE"]),
  SEARCH_SUBMITTED: productContract(searchSubmittedProperties, "DISCOVERY", ["SEARCH_FUNNEL"]),
  SEARCH_RESULTS_VIEWED: productContract(searchResultsProperties, "DISCOVERY", ["SEARCH_FUNNEL"]),
  JOB_DETAIL_VIEWED: productContract(jobDetailProperties, "DISCOVERY", ["SEARCH_FUNNEL", "JOB_CONTENT"]),
  JOB_SAVED: productContract(intentProperties, "CANDIDATE", ["CANDIDATE_VALUE"]),
  APPLY_INTENT_STARTED: productContract(intentProperties, "CANDIDATE", ["SEARCH_FUNNEL", "JOB_CONTENT"]),
  APPLICATION_SUBMITTED: essentialContract(workflowProperties, "CANDIDATE", ["SEARCH_FUNNEL", "CANDIDATE_ACTIVATION"]),
  APPLICATION_STATUS_CHANGED: essentialContract(workflowProperties, "EMPLOYER", ["EMPLOYER_RESPONSE"]),
  CANDIDATE_REGISTERED: essentialContract(onboardingProperties, "CANDIDATE", ["CANDIDATE_ACTIVATION"]),
  CANDIDATE_PROFILE_COMPLETED: essentialContract(onboardingProperties, "CANDIDATE", ["CANDIDATE_ACTIVATION"]),
  RADAR_OPTED_IN: essentialContract(onboardingProperties, "CANDIDATE", ["CANDIDATE_ACTIVATION"]),
  JOB_ALERT_ACTIVATED: essentialContract(alertProperties, "CANDIDATE", ["CANDIDATE_ACTIVATION"]),
  EMPLOYER_REGISTERED: essentialContract(onboardingProperties, "EMPLOYER", ["EMPLOYER_ACTIVATION"]),
  COMPANY_ONBOARDING_COMPLETED: essentialContract(onboardingProperties, "EMPLOYER", ["EMPLOYER_ACTIVATION"]),
  COMPANY_VERIFICATION_SUBMITTED: essentialContract(emptyProperties, "EMPLOYER", ["EMPLOYER_ACTIVATION"]),
  COMPANY_VERIFIED: essentialContract(emptyProperties, "TRUST_SAFETY", ["EMPLOYER_ACTIVATION"]),
  JOB_DRAFT_CREATED: essentialContract(workflowProperties, "EMPLOYER", ["EMPLOYER_ACTIVATION"]),
  JOB_SUBMITTED: essentialContract(workflowProperties, "EMPLOYER", ["EMPLOYER_ACTIVATION"]),
  JOB_PUBLISHED: essentialContract(workflowProperties, "MARKETPLACE", ["EMPLOYER_ACTIVATION", "NORTH_STAR"]),
  EMPLOYER_RESPONSE_RECORDED: essentialContract(emptyProperties, "EMPLOYER", ["EMPLOYER_RESPONSE", "NORTH_STAR"]),
  CONTACT_REQUEST_SENT: essentialContract(fundingProperties, "MARKETPLACE", ["RADAR_FUNNEL"]),
  CONTACT_REQUEST_ACCEPTED: essentialContract(fundingProperties, "MARKETPLACE", ["RADAR_FUNNEL", "NORTH_STAR"]),
  CONTACT_REQUEST_DECLINED: essentialContract(fundingProperties, "MARKETPLACE", ["RADAR_FUNNEL"]),
  IDENTITY_REVEAL_GRANTED: essentialContract(fundingProperties, "MARKETPLACE", ["RADAR_FUNNEL"]),
  PRICING_VIEWED: productContract(pricingProperties, "BILLING", ["CHECKOUT_FUNNEL"]),
  LIMIT_REACHED: essentialContract(limitProperties, "BILLING", ["COMMERCIAL_INTENT"]),
  CHECKOUT_STARTED: essentialContract(commercialProperties, "BILLING", ["CHECKOUT_FUNNEL"]),
  CHECKOUT_COMPLETED: essentialContract(commercialProperties, "BILLING", ["CHECKOUT_FUNNEL"]),
  SUBSCRIPTION_CHANGED: essentialContract(commercialProperties, "BILLING", ["SUBSCRIPTION"]),
  LEAD_SUBMITTED: essentialContract(leadProperties, "SALES", ["LEAD_FUNNEL"]),
  LEAD_QUALIFIED: essentialContract(leadProperties, "SALES", ["LEAD_FUNNEL"]),
  LEAD_WON: essentialContract(leadProperties, "SALES", ["LEAD_FUNNEL"]),
  BOOST_ACTIVATED: essentialContract(boostProperties, "BILLING", ["BOOST"]),
  MODERATION_ACTIONED: essentialContract(workflowProperties, "TRUST_SAFETY", ["MODERATION"]),
} satisfies Record<AnalyticsEventKindValue, AnalyticsEventContractV1>);

const commonEventFields = {
  schemaVersion: z.literal(ANALYTICS_SCHEMA_VERSION_V1),
  producerEventId: z.string().min(1).max(160),
  occurredAt: z.date(),
  pseudonymousActorId: z.string().min(1).max(128).optional(),
  pseudonymousSessionId: z.string().min(1).max(128).optional(),
  companyId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
} as const;

function eventSchema<
  TKind extends AnalyticsEventKindValue,
  TProperties extends z.ZodType,
>(kind: TKind, properties: TProperties) {
  return z
    .object({
      ...commonEventFields,
      kind: z.literal(kind),
      properties,
    })
    .strict();
}

export const analyticsEventV1Schema = z.discriminatedUnion("kind", [
  eventSchema(AnalyticsEventKind.PUBLIC_VALUE_VIEWED, publicValueProperties),
  eventSchema(AnalyticsEventKind.SEARCH_SUBMITTED, searchSubmittedProperties),
  eventSchema(AnalyticsEventKind.SEARCH_RESULTS_VIEWED, searchResultsProperties),
  eventSchema(AnalyticsEventKind.JOB_DETAIL_VIEWED, jobDetailProperties),
  eventSchema(AnalyticsEventKind.JOB_SAVED, intentProperties),
  eventSchema(AnalyticsEventKind.APPLY_INTENT_STARTED, intentProperties),
  eventSchema(AnalyticsEventKind.APPLICATION_SUBMITTED, workflowProperties),
  eventSchema(AnalyticsEventKind.APPLICATION_STATUS_CHANGED, workflowProperties),
  eventSchema(AnalyticsEventKind.CANDIDATE_REGISTERED, onboardingProperties),
  eventSchema(AnalyticsEventKind.CANDIDATE_PROFILE_COMPLETED, onboardingProperties),
  eventSchema(AnalyticsEventKind.RADAR_OPTED_IN, onboardingProperties),
  eventSchema(AnalyticsEventKind.JOB_ALERT_ACTIVATED, alertProperties),
  eventSchema(AnalyticsEventKind.EMPLOYER_REGISTERED, onboardingProperties),
  eventSchema(AnalyticsEventKind.COMPANY_ONBOARDING_COMPLETED, onboardingProperties),
  eventSchema(AnalyticsEventKind.COMPANY_VERIFICATION_SUBMITTED, emptyProperties),
  eventSchema(AnalyticsEventKind.COMPANY_VERIFIED, emptyProperties),
  eventSchema(AnalyticsEventKind.JOB_DRAFT_CREATED, workflowProperties),
  eventSchema(AnalyticsEventKind.JOB_SUBMITTED, workflowProperties),
  eventSchema(AnalyticsEventKind.JOB_PUBLISHED, workflowProperties),
  eventSchema(AnalyticsEventKind.EMPLOYER_RESPONSE_RECORDED, emptyProperties),
  eventSchema(AnalyticsEventKind.CONTACT_REQUEST_SENT, fundingProperties),
  eventSchema(AnalyticsEventKind.CONTACT_REQUEST_ACCEPTED, fundingProperties),
  eventSchema(AnalyticsEventKind.CONTACT_REQUEST_DECLINED, fundingProperties),
  eventSchema(AnalyticsEventKind.IDENTITY_REVEAL_GRANTED, fundingProperties),
  eventSchema(AnalyticsEventKind.PRICING_VIEWED, pricingProperties),
  eventSchema(AnalyticsEventKind.LIMIT_REACHED, limitProperties),
  eventSchema(AnalyticsEventKind.CHECKOUT_STARTED, commercialProperties),
  eventSchema(AnalyticsEventKind.CHECKOUT_COMPLETED, commercialProperties),
  eventSchema(AnalyticsEventKind.SUBSCRIPTION_CHANGED, commercialProperties),
  eventSchema(AnalyticsEventKind.LEAD_SUBMITTED, leadProperties),
  eventSchema(AnalyticsEventKind.LEAD_QUALIFIED, leadProperties),
  eventSchema(AnalyticsEventKind.LEAD_WON, leadProperties),
  eventSchema(AnalyticsEventKind.BOOST_ACTIVATED, boostProperties),
  eventSchema(AnalyticsEventKind.MODERATION_ACTIONED, workflowProperties),
]);

export type AnalyticsEventInputV1 = z.infer<typeof analyticsEventV1Schema>;

export function getAnalyticsRetainUntilV1(
  kind: AnalyticsEventKindValue,
  occurredAt: Date,
) {
  const retentionDays = ANALYTICS_EVENT_CONTRACTS_V1[kind].retentionDays;
  return new Date(occurredAt.getTime() + retentionDays * 86_400_000);
}
