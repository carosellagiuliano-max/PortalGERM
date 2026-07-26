// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decideLiveAnalyticsWriteV1,
  optionalAnalyticsFamilyForEventV1,
} from "@/lib/analytics/live-consent-policy";
import type { AnalyticsEventInputV1 } from "@/lib/analytics/event-contracts";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const PUBLICATION_ID = "11111111-1111-4111-8111-111111111111";
const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";
const NOTICE_HASH = "a".repeat(64);

const OPTIONAL_EVENT = Object.freeze({
  schemaVersion: "1",
  producerEventId: "phase22-navigation-1",
  occurredAt: NOW,
  kind: "PUBLIC_VALUE_VIEWED",
  properties: { surface: "HOMEPAGE", locale: "de-CH" },
} satisfies AnalyticsEventInputV1);

const ESSENTIAL_EVENT = Object.freeze({
  schemaVersion: "1",
  producerEventId: "phase22-essential-1",
  occurredAt: NOW,
  kind: "APPLICATION_SUBMITTED",
  properties: { fromStatus: "DRAFT", toStatus: "SUBMITTED" },
} satisfies AnalyticsEventInputV1);

function decide(
  overrides: Readonly<Record<string, unknown>> = {},
  event: AnalyticsEventInputV1 = OPTIONAL_EVENT,
) {
  return decideLiveAnalyticsWriteV1({
    event,
    familyEnabled: true,
    searchLearningCollection: false,
    provenance: "LIVE",
    consent: {
      granted: true,
      eventFamily: "NAVIGATION",
      policyVersion: "analytics-v1",
      noticeHash: NOTICE_HASH,
      effectiveAt: new Date(NOW.getTime() - 1),
      legalPublicationId: PUBLICATION_ID,
      processingApprovalId: APPROVAL_ID,
    },
    requiredPolicyVersion: "analytics-v1",
    now: NOW,
    legalGateAllowed: true,
    currentPublicationId: PUBLICATION_ID,
    currentPublicationHash: NOTICE_HASH,
    ...overrides,
  });
}

describe("Phase-22 live analytics consent policy", () => {
  it("maps optional event families and leaves essential events outside consent", () => {
    expect(optionalAnalyticsFamilyForEventV1("PUBLIC_VALUE_VIEWED")).toBe(
      "NAVIGATION",
    );
    expect(optionalAnalyticsFamilyForEventV1("PRICING_VIEWED")).toBe(
      "CONVERSION",
    );
    expect(optionalAnalyticsFamilyForEventV1("APPLICATION_SUBMITTED")).toBeNull();
    expect(decide({}, ESSENTIAL_EVENT)).toEqual({
      allowed: false,
      code: "ESSENTIAL_EVENT",
    });
  });

  it("permits an exact, current LIVE consent and legal gate", () => {
    expect(decide()).toEqual({ allowed: true, family: "NAVIGATION" });
  });

  it.each([
    ["FEATURE_DISABLED", { familyEnabled: false }],
    ["PROVENANCE_BLOCKED", { provenance: "DEMO" }],
    ["CONSENT_MISSING", { consent: null }],
    [
      "CONSENT_REVOKED",
      { consent: { ...decideInputConsent(), granted: false } },
    ],
    [
      "CONSENT_STALE",
      { consent: { ...decideInputConsent(), policyVersion: "analytics-v0" } },
    ],
    ["LEGAL_GATE_BLOCKED", { legalGateAllowed: false }],
    ["SEARCH_LEARNING_BLOCKED", { searchLearningCollection: true }],
  ])("fails closed with %s", (code, overrides) => {
    expect(decide(overrides)).toEqual({ allowed: false, code });
  });

  it("rejects PII and raw search-learning properties even before persistence", () => {
    expect(
      decide(
        {},
        {
          ...OPTIONAL_EVENT,
          properties: {
            ...OPTIONAL_EVENT.properties,
            email: "not-allowed@example.invalid",
          },
        } as AnalyticsEventInputV1,
      ),
    ).toEqual({ allowed: false, code: "PII_PROPERTY_BLOCKED" });
    expect(
      decide(
        {},
        {
          ...OPTIONAL_EVENT,
          properties: {
            ...OPTIONAL_EVENT.properties,
            rawQuery: "rare identifying query",
          },
        } as AnalyticsEventInputV1,
      ),
    ).toEqual({ allowed: false, code: "SEARCH_LEARNING_BLOCKED" });
  });
});

function decideInputConsent() {
  return {
    granted: true,
    eventFamily: "NAVIGATION",
    policyVersion: "analytics-v1",
    noticeHash: NOTICE_HASH,
    effectiveAt: new Date(NOW.getTime() - 1),
    legalPublicationId: PUBLICATION_ID,
    processingApprovalId: APPROVAL_ID,
  };
}
