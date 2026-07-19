// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_CANDIDATE_POLICY_V1,
  toAnonymousCandidate,
  type RadarCohortPolicy,
} from "@/lib/privacy/anonymize-candidate";

const opaqueId = Buffer.alloc(16, 7).toString("base64url");
const policy: RadarCohortPolicy = {
  exposeSkills: true,
  exposeWorkload: true,
  exposeSalary: true,
  exposeLanguages: true,
  exposeRemotePreference: true,
  exposeAvailability: true,
  allowedCategoryBuckets: ["software-engineering"],
  allowedSkillSlugs: ["typescript", "react"],
  allowedLanguageCodes: ["de", "en"],
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    opaqueId,
    cantonBucket: "ZH",
    categoryBucket: "software-engineering",
    skillSlugs: ["typescript", "secret-skill", "react", "typescript"],
    workloadBucket: "80",
    salaryBucket: "CHF_120000",
    salaryPeriod: "YEARLY" as const,
    languageCodes: ["EN", "de", "fr"],
    remotePreference: "HYBRID" as const,
    availabilityBucket: "WITHIN_30_DAYS",
    radarConsentGranted: true,
    policy,
    ...overrides,
  };
}

describe("anonymous candidate DTO", () => {
  it("returns only the frozen, policy-allowlisted coarse DTO", () => {
    const dto = toAnonymousCandidate(candidate());
    expect(dto).toEqual({
      opaqueId,
      displayLabel: "software-engineering · ZH",
      cantonBucket: "ZH",
      categoryBucket: "software-engineering",
      skillSlugs: ["react", "typescript"],
      workloadBucket: "80",
      salaryBucket: "CHF_120000",
      salaryPeriod: "YEARLY_FTE",
      languageCodes: ["de", "en"],
      remotePreference: "HYBRID",
      availabilityBucket: "WITHIN_30_DAYS",
    });
    expect(Object.isFrozen(dto)).toBe(true);
    expect(Object.keys(dto ?? {})).toEqual(ANONYMOUS_CANDIDATE_POLICY_V1.allowedFields);
  });

  it("returns no card without the dedicated Radar consent", () => {
    expect(toAnonymousCandidate(candidate({ radarConsentGranted: false }))).toBeNull();
  });

  it("does not copy PII canaries or arbitrary source properties", () => {
    const canaries = {
      firstName: "PII_FIRST_8ebdf2",
      lastName: "PII_LAST_753c11",
      email: "pii-canary@example.invalid",
      phone: "+41999999999",
      exactCity: "PII_CITY_701",
      address: "PII_ADDRESS_702",
      cvFileName: "PII_CV_703.pdf",
      candidateProfileId: "77777777-7777-4777-8777-777777777777",
      displayLabel: "PII_NAME_704",
    };
    const serialized = JSON.stringify(toAnonymousCandidate(candidate(canaries)));
    for (const value of Object.values(canaries)) expect(serialized).not.toContain(value);
    for (const key of Object.keys(canaries).filter((key) => key !== "displayLabel")) {
      expect(serialized).not.toContain(`\"${key}\"`);
    }
  });

  it.each([
    "77777777-7777-4777-8777-777777777777",
    Buffer.alloc(15, 1).toString("base64url"),
    Buffer.alloc(17, 1).toString("base64url"),
    `${opaqueId}=`,
  ])("rejects a non-canonical 128-bit opaque id: %s", (badId) => {
    expect(() => toAnonymousCandidate(candidate({ opaqueId: badId }))).toThrow(/opaque id/i);
  });

  it("rejects non-allowlisted categories and invalid coarse buckets", () => {
    expect(() =>
      toAnonymousCandidate(candidate({ categoryBucket: "executive-secret" })),
    ).toThrow(/category/i);
    expect(() => toAnonymousCandidate(candidate({ cantonBucket: "Zurich" }))).toThrow(/canton/i);
    expect(() => toAnonymousCandidate(candidate({ workloadBucket: "87" }))).toThrow(/workload/i);
    expect(() => toAnonymousCandidate(candidate({ remotePreference: "SOMETIMES" }))).toThrow(/remote/i);
    expect(() => toAnonymousCandidate(candidate({ availabilityBucket: "2026-08-12" }))).toThrow(/availability/i);
  });

  it("omits disallowed fields and never projects non-yearly salary", () => {
    const hidden = toAnonymousCandidate(candidate({
      salaryPeriod: "MONTHLY",
      policy: {
        ...policy,
        exposeSkills: false,
        exposeWorkload: false,
        exposeLanguages: false,
        exposeRemotePreference: false,
        exposeAvailability: false,
      },
    }));
    expect(hidden).toEqual({
      opaqueId,
      displayLabel: "software-engineering · ZH",
      cantonBucket: "ZH",
      categoryBucket: "software-engineering",
    });
  });

  it("rejects invalid yearly salary buckets but ignores salary for other periods", () => {
    expect(() => toAnonymousCandidate(candidate({ salaryBucket: "CHF_123456" }))).toThrow(/salary/i);
    expect(toAnonymousCandidate(candidate({
      salaryBucket: "EXACT_CHF_123456",
      salaryPeriod: "HOURLY",
    }))).not.toHaveProperty("salaryBucket");
  });
});
