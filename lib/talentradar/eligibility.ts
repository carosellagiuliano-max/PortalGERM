import type {
  DataProvenance,
  OnboardingStatus,
  RadarConsentKind,
  UserStatus,
} from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import { RADAR_CONSENT_NOTICE_V1 } from "@/lib/privacy/radar-consent";

export type RadarEligibilityEnvironment =
  | "production"
  | "staging"
  | "development"
  | "test";

export type RadarApplicationEnvironment =
  | "local"
  | "ci"
  | "preview"
  | "staging"
  | "production";

export type RadarCandidateEligibilityInput = Readonly<{
  userStatus: UserStatus;
  onboardingStatus: OnboardingStatus;
  candidateProvenance: DataProvenance;
  latestVisibilityConsent: Readonly<{
    kind: RadarConsentKind;
    granted: boolean;
    noticeVersion: string;
    noticeHash: string;
    effectiveAt: Date;
  }> | null;
  radarProfile: Readonly<{
    publishedAt: Date | null;
    withdrawnAt: Date | null;
  }> | null;
}>;

export const RADAR_CANDIDATE_ELIGIBILITY_POLICY_V1 = Object.freeze({
  version: "v1" as const,
  visibilityConsentKind: RADAR_CONSENT_NOTICE_V1.kind,
  noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
  noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
  productionLikeProvenance: Object.freeze(["LIVE"] as const),
  developmentTestProvenance: Object.freeze(["LIVE", "DEMO"] as const),
});

/**
 * The one strict in-memory Radar eligibility predicate. Callers must load the
 * latest effective visibility consent (ordered by effectiveAt, then createdAt)
 * and must not substitute a historical `some(granted)` check for this result.
 */
export function isRadarCandidateEligible(
  input: RadarCandidateEligibilityInput | null,
  now: Date,
  environment: RadarEligibilityEnvironment,
): boolean {
  if (
    input === null ||
    !isValidDate(now) ||
    !isKnownEnvironment(environment) ||
    input.userStatus !== "ACTIVE" ||
    input.onboardingStatus !== "COMPLETE" ||
    !isAllowedProvenance(input.candidateProvenance, environment)
  ) {
    return false;
  }

  const consent = input.latestVisibilityConsent;
  if (
    consent === null ||
    consent.kind !== RADAR_CANDIDATE_ELIGIBILITY_POLICY_V1.visibilityConsentKind ||
    consent.granted !== true ||
    consent.noticeVersion !== RADAR_CANDIDATE_ELIGIBILITY_POLICY_V1.noticeVersion ||
    consent.noticeHash !== RADAR_CANDIDATE_ELIGIBILITY_POLICY_V1.noticeHash ||
    !isValidDate(consent.effectiveAt) ||
    consent.effectiveAt.getTime() > now.getTime()
  ) {
    return false;
  }

  const radarProfile = input.radarProfile;
  return (
    radarProfile !== null &&
    isValidDate(radarProfile.publishedAt) &&
    radarProfile.publishedAt.getTime() <= now.getTime() &&
    radarProfile.withdrawnAt === null
  );
}

/**
 * Maps the repository APP_ENV vocabulary onto the smaller eligibility policy.
 * CI is test-like; local and preview are development-like. Production and
 * staging remain live-only.
 */
export function toRadarEligibilityEnvironment(
  environment: RadarApplicationEnvironment,
): RadarEligibilityEnvironment {
  switch (environment) {
    case "production":
    case "staging":
      return environment;
    case "ci":
      return "test";
    case "local":
    case "preview":
      return "development";
  }
}

/**
 * Identity-safe Prisma projection for the canonical predicate. It deliberately
 * omits name, email, phone, address, city, CV and every other identity-bearing
 * column. The internal CandidateProfile id is required only for server-side
 * joins and must never be copied into an employer DTO.
 */
export function buildRadarCandidateEligibilitySelect(now: Date) {
  assertValidDate(now);
  return {
    id: true,
    onboardingStatus: true,
    user: {
      select: {
        status: true,
        dataProvenance: true,
      },
    },
    radarConsents: {
      where: {
        kind: RADAR_CONSENT_NOTICE_V1.kind,
        effectiveAt: { lte: now },
      },
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      take: 1,
      select: {
        kind: true,
        granted: true,
        noticeVersion: true,
        noticeHash: true,
        effectiveAt: true,
      },
    },
    radarProfile: {
      select: {
        publishedAt: true,
        withdrawnAt: true,
      },
    },
  } as const satisfies Prisma.CandidateProfileSelect;
}

export type RadarCandidateEligibilityRow = Prisma.CandidateProfileGetPayload<{
  select: ReturnType<typeof buildRadarCandidateEligibilitySelect>;
}>;

export function toRadarCandidateEligibilityInput(
  row: RadarCandidateEligibilityRow,
): RadarCandidateEligibilityInput {
  const consent = row.radarConsents[0] ?? null;
  return Object.freeze({
    userStatus: row.user.status,
    onboardingStatus: row.onboardingStatus,
    candidateProvenance: row.user.dataProvenance,
    latestVisibilityConsent:
      consent === null
        ? null
        : Object.freeze({
            kind: consent.kind,
            granted: consent.granted,
            noticeVersion: consent.noticeVersion,
            noticeHash: consent.noticeHash,
            effectiveAt: new Date(consent.effectiveAt),
          }),
    radarProfile:
      row.radarProfile === null
        ? null
        : Object.freeze({
            publishedAt:
              row.radarProfile.publishedAt === null
                ? null
                : new Date(row.radarProfile.publishedAt),
            withdrawnAt:
              row.radarProfile.withdrawnAt === null
                ? null
                : new Date(row.radarProfile.withdrawnAt),
          }),
  });
}

/**
 * Safe coarse SQL prefilter. This is intentionally named a prefilter: Prisma
 * cannot express "the latest effective append-only consent is granted" with a
 * simple relation predicate, so every returned row must still pass through
 * `isRadarCandidateEligible` using the select above.
 */
export function buildRadarCandidateEligibilityPrefilter(
  now: Date,
  environment: RadarEligibilityEnvironment,
): Prisma.CandidateProfileWhereInput {
  assertValidDate(now);
  if (!isKnownEnvironment(environment)) {
    throw new TypeError("Radar eligibility environment is invalid.");
  }
  const provenance = isProductionLike(environment)
    ? [...RADAR_CANDIDATE_ELIGIBILITY_POLICY_V1.productionLikeProvenance]
    : [...RADAR_CANDIDATE_ELIGIBILITY_POLICY_V1.developmentTestProvenance];

  return {
    onboardingStatus: "COMPLETE",
    user: {
      status: "ACTIVE",
      dataProvenance: { in: provenance },
    },
    radarProfile: {
      is: {
        publishedAt: { lte: now },
        withdrawnAt: null,
      },
    },
    radarConsents: {
      some: {
        kind: RADAR_CONSENT_NOTICE_V1.kind,
        granted: true,
        noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
        noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
        effectiveAt: { lte: now },
      },
    },
  };
}

function isAllowedProvenance(
  provenance: DataProvenance,
  environment: RadarEligibilityEnvironment,
): boolean {
  return isProductionLike(environment)
    ? provenance === "LIVE"
    : provenance === "LIVE" || provenance === "DEMO";
}

function isProductionLike(environment: RadarEligibilityEnvironment): boolean {
  return environment === "production" || environment === "staging";
}

function isKnownEnvironment(
  environment: RadarEligibilityEnvironment,
): boolean {
  return (
    environment === "production" ||
    environment === "staging" ||
    environment === "development" ||
    environment === "test"
  );
}

function assertValidDate(value: Date): void {
  if (!isValidDate(value)) {
    throw new TypeError("Radar eligibility time is invalid.");
  }
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
