// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CANDIDATE_ONBOARDING_RULE_V1,
  buildAnonymousProfilePreview,
  calculateCandidateProfileProgress,
  deriveRadarState,
  evaluateCandidateOnboarding,
  TALENT_RADAR_VISIBILITY_NOTICE_V1,
  type CandidateProfilePolicyInput,
} from "@/lib/candidate/profile";
import {
  candidateCvMetadataSchema,
  swissJobPassSchema,
} from "@/lib/validation/candidate";

const ID = "11111111-1111-4111-8111-111111111111";

function completeProfile(
  overrides: Partial<CandidateProfilePolicyInput> = {},
): CandidateProfilePolicyInput {
  return {
    firstName: "Mira",
    lastName: "Muster",
    cantonId: ID,
    desiredTitles: ["Softwareentwicklerin"],
    preferredCategoryIds: [],
    skillIds: [ID],
    languages: [{ code: "de", level: "C1" }],
    workloadMin: 60,
    workloadMax: 80,
    remotePreference: "HYBRID",
    desiredJobTypes: ["PERMANENT"],
    ...overrides,
  };
}

describe("Phase-09 candidate onboarding predicate", () => {
  it("accepts exactly the required profile while all optional data stays absent", () => {
    expect(evaluateCandidateOnboarding(completeProfile())).toEqual({
      complete: true,
      missing: [],
      ruleVersion: CANDIDATE_ONBOARDING_RULE_V1.version,
    });
  });

  it.each([
    ["FIRST_NAME", { firstName: null }],
    ["LAST_NAME", { lastName: "" }],
    ["CANTON", { cantonId: null }],
    ["SKILL", { skillIds: [] }],
    ["LANGUAGE", { languages: [] }],
    ["WORKLOAD_RANGE", { workloadMin: 0, workloadMax: 80 }],
    ["WORKLOAD_RANGE", { workloadMin: 90, workloadMax: 80 }],
    ["REMOTE_PREFERENCE", { remotePreference: null }],
    ["JOB_TYPE", { desiredJobTypes: [] }],
  ] as const)("rejects a profile missing %s", (code, overrides) => {
    const result = evaluateCandidateOnboarding(completeProfile(overrides));
    expect(result.complete).toBe(false);
    expect(result.missing).toContain(code);
  });

  it("requires a desired title or preferred category, but not both", () => {
    expect(
      evaluateCandidateOnboarding(
        completeProfile({ desiredTitles: [], preferredCategoryIds: [] }),
      ).missing,
    ).toContain("TITLE_OR_CATEGORY");
    expect(
      evaluateCandidateOnboarding(
        completeProfile({ desiredTitles: [], preferredCategoryIds: [ID] }),
      ).complete,
    ).toBe(true);
  });

  it("does not count a malformed language code toward onboarding completion", () => {
    expect(
      evaluateCandidateOnboarding(
        completeProfile({ languages: [{ code: "12", level: "C1" }] }),
      ).missing,
    ).toContain("LANGUAGE");
  });

  it("accepts the inclusive 1–100 workload boundary and rejects zero", () => {
    expect(
      evaluateCandidateOnboarding(
        completeProfile({ workloadMin: 1, workloadMax: 100 }),
      ).complete,
    ).toBe(true);
    expect(
      evaluateCandidateOnboarding(
        completeProfile({ workloadMin: 0, workloadMax: 100 }),
      ).missing,
    ).toContain("WORKLOAD_RANGE");
  });

  it("keeps progress informational and independent from completion state", () => {
    const progress = calculateCandidateProfileProgress({
      firstName: "Mira",
      lastName: "Muster",
      cantonId: ID,
      desiredTitles: ["Softwareentwicklerin"],
      preferredCategoryIds: [],
      skillIds: [ID],
      languages: [{ code: "de" }],
      workloadMin: 60,
      workloadMax: 80,
      remotePreference: "HYBRID",
      desiredJobTypes: ["PERMANENT"],
      hasActiveCv: false,
    });
    expect(evaluateCandidateOnboarding(completeProfile()).complete).toBe(true);
    expect(progress.percentage).toBeLessThan(100);
    expect(progress.completed).toBeLessThan(progress.total);
  });
});

describe("Phase-09 anonymous candidate-owned preview", () => {
  const safeSource = {
    cantonCode: "ZH",
    categorySlugs: ["informatik"],
    desiredTitles: ["Softwareentwicklerin"],
    skillSlugs: ["typescript", "react"],
    workloadMin: 60,
    workloadMax: 80,
    salaryMin: 105_000,
    salaryMax: 125_000,
    salaryPeriod: "YEARLY" as const,
    languageCodes: ["de", "en"],
    remotePreference: "HYBRID" as const,
    availableFrom: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("uses the central anonymous DTO and contains no PII or exact-city keys", () => {
    const preview = buildAnonymousProfilePreview(
      {
        ...safeSource,
        firstName: "PII_FIRST_CANARY",
        email: "pii@example.invalid",
        phone: "+41999999999",
        cityLabel: "PII_EXACT_CITY",
        cvFileName: "PII_CV.pdf",
      } as typeof safeSource,
      new Date("2026-07-20T12:00:00.000Z"),
    );
    expect(preview).toMatchObject({
      cantonBucket: "ZH",
      categoryBucket: "informatik",
      skillSlugs: ["react", "typescript"],
      workloadBucket: "60",
      salaryBucket: "CHF_100000",
      salaryPeriod: "YEARLY_FTE",
      languageCodes: ["de", "en"],
      remotePreference: "HYBRID",
      availabilityBucket: "WITHIN_30_DAYS",
    });
    const serialized = JSON.stringify(preview);
    for (const canary of [
      "PII_FIRST_CANARY",
      "pii@example.invalid",
      "+41999999999",
      "PII_EXACT_CITY",
      "PII_CV.pdf",
    ]) {
      expect(serialized).not.toContain(canary);
    }
    for (const key of [
      "firstName",
      "email",
      "phone",
      "cityLabel",
      "cvFileName",
    ]) {
      expect(serialized).not.toContain(`\"${key}\"`);
    }
  });

  it("cannot form a preview without a coarse canton", () => {
    expect(
      buildAnonymousProfilePreview({ ...safeSource, cantonCode: null }),
    ).toBeNull();
  });

  it("never derives a public Radar category from candidate-authored titles", () => {
    const titleOnlyProfile = {
      ...safeSource,
      categorySlugs: [],
      desiredTitles: ["PII_FREE_TEXT_TITLE"],
    };
    expect(buildAnonymousProfilePreview(titleOnlyProfile)).toBeNull();
  });

  it("derives current/off/incomplete states without treating consent alone as eligibility", () => {
    expect(
      deriveRadarState({
        consentGranted: true,
        onboardingStatus: "COMPLETE",
        requirementsComplete: true,
        publishedAt: new Date(),
        withdrawnAt: null,
      }),
    ).toBe("CURRENT");
    expect(
      deriveRadarState({
        consentGranted: true,
        onboardingStatus: "DRAFT",
        requirementsComplete: true,
        publishedAt: null,
        withdrawnAt: new Date(),
      }),
    ).toBe("INCOMPLETE");
    expect(
      deriveRadarState({
        consentGranted: false,
        onboardingStatus: "COMPLETE",
        requirementsComplete: true,
        publishedAt: new Date(),
        withdrawnAt: new Date(),
      }),
    ).toBe("OFF");
  });

  it("binds the visible consent wording to a versioned SHA-256 evidence hash", () => {
    expect(TALENT_RADAR_VISIBILITY_NOTICE_V1.noticeVersion).toBe(
      "talent-radar-v1",
    );
    expect(TALENT_RADAR_VISIBILITY_NOTICE_V1.hash).toMatch(/^[a-f0-9]{64}$/u);
  });
});

describe("Phase-09 progressive profile and CV validation", () => {
  it("accepts an empty progressive draft but rejects split ranges", () => {
    expect(swissJobPassSchema.safeParse({}).success).toBe(true);
    expect(swissJobPassSchema.safeParse({ workloadMin: 60 }).success).toBe(
      false,
    );
    expect(
      swissJobPassSchema.safeParse({ desiredSalaryMin: 80_000 }).success,
    ).toBe(false);
  });

  it("keeps candidate workload aligned with the database 1–100 constraint", () => {
    expect(
      swissJobPassSchema.safeParse({ workloadMin: 1, workloadMax: 100 })
        .success,
    ).toBe(true);
    expect(
      swissJobPassSchema.safeParse({ workloadMin: 0, workloadMax: 100 })
        .success,
    ).toBe(false);
    expect(
      swissJobPassSchema.safeParse({ workloadMin: 1, workloadMax: 101 })
        .success,
    ).toBe(false);
  });

  it("accepts only metadata-only CV types up to five MiB", () => {
    expect(
      candidateCvMetadataSchema.safeParse({
        fileName: "lebenslauf.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5 * 1024 * 1024,
      }).success,
    ).toBe(true);
    expect(
      candidateCvMetadataSchema.safeParse({
        fileName: "lebenslauf.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 1_000,
      }).success,
    ).toBe(false);
    expect(
      candidateCvMetadataSchema.safeParse({
        fileName: "lebenslauf.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });

  it("enforces the 500-character summary and closed work-permit enum", () => {
    expect(
      swissJobPassSchema.safeParse({ summary: "a".repeat(501) }).success,
    ).toBe(false);
    expect(swissJobPassSchema.safeParse({ workPermitType: "C" }).success).toBe(
      true,
    );
    expect(
      swissJobPassSchema.safeParse({ workPermitType: "UNBOUNDED" }).success,
    ).toBe(false);
  });
});
