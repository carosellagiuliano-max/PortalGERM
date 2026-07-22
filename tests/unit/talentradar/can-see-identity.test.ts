// @vitest-environment node

import { describe, expect, it } from "vitest";

import { canSeeRadarIdentity } from "@/lib/talentradar/can-see-identity";

const requestId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";

function scope(overrides: Record<string, unknown> = {}) {
  return {
    candidateUserStatus: "ACTIVE",
    companyStatus: "ACTIVE",
    companyVerificationCount: 1,
    conversationKind: "TALENT_RADAR",
    requestId,
    requestStatus: "ACCEPTED",
    requestCompanyId: companyId,
    requestCandidateProfileId: candidateId,
    requestConversationId: conversationId,
    grantRequestId: requestId,
    grantCompanyId: companyId,
    grantCandidateProfileId: candidateId,
    grantConversationId: conversationId,
    viewerCompanyId: companyId,
    revokedAt: null,
    ...overrides,
  };
}

describe("canSeeRadarIdentity", () => {
  it("allows only the exact accepted, active, verified and unrevoked Radar scope", () => {
    expect(canSeeRadarIdentity(scope())).toBe(true);
  });

  it.each([
    ["candidateUserStatus", "SUSPENDED"],
    ["companyStatus", "SUSPENDED"],
    ["companyVerificationCount", 0],
    ["companyVerificationCount", 2],
    ["conversationKind", "APPLICATION"],
    ["requestStatus", "PENDING"],
    ["grantRequestId", "55555555-5555-4555-8555-555555555555"],
    ["grantCompanyId", "55555555-5555-4555-8555-555555555555"],
    ["grantCandidateProfileId", "55555555-5555-4555-8555-555555555555"],
    ["grantConversationId", "55555555-5555-4555-8555-555555555555"],
    ["viewerCompanyId", "55555555-5555-4555-8555-555555555555"],
    ["revokedAt", new Date("2026-07-22T10:00:00Z")],
  ])("denies when %s is no longer trusted", (field, value) => {
    expect(canSeeRadarIdentity(scope({ [field]: value }))).toBe(false);
  });
});
