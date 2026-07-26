// @vitest-environment node

import { describe, expect, it } from "vitest";

import { decideLegalGateV1 } from "@/lib/privacy/legal-gate-policy";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const APPROVAL_ID = "11111111-1111-4111-8111-111111111111";
const PUBLICATION_ID = "22222222-2222-4222-8222-222222222222";
const PUBLICATION_HASH = "a".repeat(64);

function approvedGate(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: APPROVAL_ID,
    scope: "PRIVACY_EXPORT",
    region: "ch-sandbox",
    processorKey: "postgres-primary",
    version: "v1",
    status: "APPROVED",
    legalPublicationId: PUBLICATION_ID,
    legalBasisRef: "counsel:privacy-export:v1",
    avgDecisionRef: null,
    dpaRef: null,
    dsfaDecision: "NOT_REQUIRED",
    dsfaDecisionRef: "dsfa:privacy-export:not-required:v1",
    owner: "Privacy Owner",
    approvedBy: "Independent Legal Reviewer",
    effectiveAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    reviewAt: new Date(NOW.getTime() + 43_200_000),
    revokedAt: null,
    publication: {
      status: "CURRENT",
      effectiveAt: new Date(NOW.getTime() - 60_000),
      expiresAt: null,
      revokedAt: null,
      publicationHash: PUBLICATION_HASH,
    },
    ...overrides,
  };
}

function decide(gate: unknown, overrides: Readonly<Record<string, unknown>> = {}) {
  return decideLegalGateV1({
    expectedScope: "PRIVACY_EXPORT",
    expectedRegion: "ch-sandbox",
    expectedProcessorKey: "postgres-primary",
    featureEnabled: true,
    cohortAllowed: true,
    now: NOW,
    gate,
    ...overrides,
  });
}

describe("Phase-22 legal gate policy", () => {
  it("allows only the exact current, independently approved scope", () => {
    expect(decide(approvedGate())).toEqual({
      allowed: true,
      approvalId: APPROVAL_ID,
      approvalVersion: "v1",
      publicationId: PUBLICATION_ID,
      publicationHash: PUBLICATION_HASH,
    });
  });

  it.each([
    ["FEATURE_DISABLED", { featureEnabled: false }, {}],
    ["COHORT_DENIED", { cohortAllowed: false }, {}],
    ["SCOPE_MISMATCH", {}, { scope: "PRIVACY_ERASURE" }],
    ["REGION_MISMATCH", {}, { region: "eu-west-1" }],
    ["PROCESSOR_MISMATCH", {}, { processorKey: "analytics-store" }],
    ["NOT_APPROVED", {}, { status: "DRAFT", approvedBy: null }],
    ["SEPARATION_OF_DUTIES_REQUIRED", {}, { approvedBy: "Privacy Owner" }],
    ["NOT_EFFECTIVE", {}, { effectiveAt: new Date(NOW.getTime() + 1) }],
    ["EXPIRED", {}, { expiresAt: NOW }],
    ["REVIEW_DUE", {}, { reviewAt: NOW }],
    ["REVOKED", {}, { status: "REVOKED", revokedAt: NOW }],
    ["LEGAL_BASIS_UNAVAILABLE", {}, { legalBasisRef: "pending" }],
    ["DSFA_UNAVAILABLE", {}, { dsfaDecision: "REQUIRED" }],
    [
      "PUBLICATION_UNAVAILABLE",
      {},
      { publication: { ...approvedGate().publication as object, status: "REVOKED", revokedAt: NOW } },
    ],
  ])("fails closed with %s", (code, inputOverrides, gateOverrides) => {
    expect(decide(approvedGate(gateOverrides), inputOverrides)).toEqual({
      allowed: false,
      code,
    });
  });

  it("requires AVG and DPA evidence only for their relevant scopes/processors", () => {
    expect(
      decide(
        approvedGate({
          scope: "TALENT_RADAR",
          processorKey: "document-object-store",
          dpaRef: null,
          avgDecisionRef: null,
        }),
        {
          expectedScope: "TALENT_RADAR",
          expectedProcessorKey: "document-object-store",
        },
      ),
    ).toEqual({ allowed: false, code: "AVG_DECISION_UNAVAILABLE" });

    expect(
      decide(
        approvedGate({
          processorKey: "document-object-store",
          dpaRef: null,
        }),
        { expectedProcessorKey: "document-object-store" },
      ),
    ).toEqual({ allowed: false, code: "DPA_UNAVAILABLE" });
  });
});
