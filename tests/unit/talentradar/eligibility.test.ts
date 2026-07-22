// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildRadarCandidateEligibilityPrefilter,
  buildRadarCandidateEligibilitySelect,
  isRadarCandidateEligible,
  toRadarEligibilityEnvironment,
  type RadarCandidateEligibilityInput,
  type RadarEligibilityEnvironment,
} from "@/lib/talentradar/eligibility";
import { RADAR_CONSENT_NOTICE_V1 } from "@/lib/privacy/radar-consent";

const now = new Date("2026-07-22T10:00:00.000Z");

function eligibleInput(
  override: Partial<RadarCandidateEligibilityInput> = {},
): RadarCandidateEligibilityInput {
  return {
    userStatus: "ACTIVE",
    onboardingStatus: "COMPLETE",
    candidateProvenance: "LIVE",
    latestVisibilityConsent: {
      kind: "TALENT_RADAR_VISIBILITY",
      granted: true,
      noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
      noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
      effectiveAt: new Date("2026-07-20T10:00:00.000Z"),
    },
    radarProfile: {
      publishedAt: new Date("2026-07-20T10:00:00.000Z"),
      withdrawnAt: null,
    },
    ...override,
  };
}

describe("canonical Radar candidate eligibility", () => {
  it.each(["production", "staging", "development", "test"] as const)(
    "accepts a fully eligible LIVE candidate in %s",
    (environment) => {
      expect(isRadarCandidateEligible(eligibleInput(), now, environment)).toBe(true);
    },
  );

  it.each(["development", "test"] as const)(
    "allows DEMO provenance only in %s",
    (environment) => {
      expect(
        isRadarCandidateEligible(
          eligibleInput({ candidateProvenance: "DEMO" }),
          now,
          environment,
        ),
      ).toBe(true);
    },
  );

  it.each(["production", "staging"] as const)(
    "requires LIVE provenance in %s",
    (environment) => {
      expect(
        isRadarCandidateEligible(
          eligibleInput({ candidateProvenance: "DEMO" }),
          now,
          environment,
        ),
      ).toBe(false);
    },
  );

  it("rejects TEST provenance in every runtime", () => {
    for (const environment of [
      "production",
      "staging",
      "development",
      "test",
    ] satisfies RadarEligibilityEnvironment[]) {
      expect(
        isRadarCandidateEligible(
          eligibleInput({ candidateProvenance: "TEST" }),
          now,
          environment,
        ),
      ).toBe(false);
    }
  });

  it.each([
    ["inactive User", { userStatus: "SUSPENDED" }],
    ["incomplete onboarding", { onboardingStatus: "DRAFT" }],
    ["missing consent", { latestVisibilityConsent: null }],
    [
      "withdrawn profile",
      {
        radarProfile: {
          publishedAt: new Date("2026-07-20T10:00:00.000Z"),
          withdrawnAt: new Date("2026-07-21T10:00:00.000Z"),
        },
      },
    ],
    ["missing Radar profile", { radarProfile: null }],
  ] as const)("rejects %s", (_label, override) => {
    expect(
      isRadarCandidateEligible(
        eligibleInput(override as Partial<RadarCandidateEligibilityInput>),
        now,
        "development",
      ),
    ).toBe(false);
  });

  it("requires the latest effective grant under the accepted notice", () => {
    expect(
      isRadarCandidateEligible(
        eligibleInput({
          latestVisibilityConsent: {
            ...eligibleInput().latestVisibilityConsent!,
            granted: false,
          },
        }),
        now,
        "development",
      ),
    ).toBe(false);
    expect(
      isRadarCandidateEligible(
        eligibleInput({
          latestVisibilityConsent: {
            ...eligibleInput().latestVisibilityConsent!,
            noticeVersion: "talent-radar-v0",
          },
        }),
        now,
        "development",
      ),
    ).toBe(false);
    expect(
      isRadarCandidateEligible(
        eligibleInput({
          latestVisibilityConsent: {
            ...eligibleInput().latestVisibilityConsent!,
            noticeHash: "a".repeat(64),
          },
        }),
        now,
        "development",
      ),
    ).toBe(false);
    expect(
      isRadarCandidateEligible(
        eligibleInput({
          latestVisibilityConsent: {
            ...eligibleInput().latestVisibilityConsent!,
            effectiveAt: new Date("2026-07-22T10:00:00.001Z"),
          },
        }),
        now,
        "development",
      ),
    ).toBe(false);
  });

  it("uses half-open time checks for publication and fails closed on invalid dates", () => {
    expect(
      isRadarCandidateEligible(
        eligibleInput({ radarProfile: { publishedAt: now, withdrawnAt: null } }),
        now,
        "development",
      ),
    ).toBe(true);
    expect(
      isRadarCandidateEligible(
        eligibleInput({
          radarProfile: {
            publishedAt: new Date(now.getTime() + 1),
            withdrawnAt: null,
          },
        }),
        now,
        "development",
      ),
    ).toBe(false);
    expect(
      isRadarCandidateEligible(
        eligibleInput(),
        new Date(Number.NaN),
        "development",
      ),
    ).toBe(false);
  });

  it("ships an identity-safe select and labels the relation predicate as a prefilter", () => {
    const select = buildRadarCandidateEligibilitySelect(now);
    const serialized = JSON.stringify(select);
    for (const forbidden of [
      "firstName",
      "lastName",
      "email",
      "phone",
      "postalCode",
      "cityLabel",
      "documents",
      "cvFileName",
      "cvStorageKey",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(select.radarConsents.take).toBe(1);
    expect(select.radarConsents.orderBy).toEqual([
      { effectiveAt: "desc" },
      { createdAt: "desc" },
    ]);

    const production = buildRadarCandidateEligibilityPrefilter(now, "production");
    const development = buildRadarCandidateEligibilityPrefilter(now, "development");
    expect(JSON.stringify(production)).toContain('"in":["LIVE"]');
    expect(JSON.stringify(development)).toContain('"in":["LIVE","DEMO"]');
  });

  it("maps repository application environments without weakening staging", () => {
    expect(toRadarEligibilityEnvironment("production")).toBe("production");
    expect(toRadarEligibilityEnvironment("staging")).toBe("staging");
    expect(toRadarEligibilityEnvironment("ci")).toBe("test");
    expect(toRadarEligibilityEnvironment("local")).toBe("development");
    expect(toRadarEligibilityEnvironment("preview")).toBe("development");
  });
});
