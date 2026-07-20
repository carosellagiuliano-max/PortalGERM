import { createHash } from "node:crypto";

import type { SeedIdentityRecord } from "@/prisma/seed/contract";
import { createSeedIdentity, stableSeedId } from "@/prisma/seed/ids";
import {
  DEMO_ACCOUNT_FIXTURES,
  RADAR_DEMO_COMPANY_SLUG,
} from "@/prisma/seed/fixtures/companies-jobs";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const HOUR_MILLISECONDS = 60 * 60 * 1_000;

export const SUSPENDED_AUTH_ACTOR_EMAIL =
  "suspended-auth@demo.swisstalenthub.test" as const;

const RECRUITER_EMAIL = "recruiter@demo.ch" as const;
const CANDIDATE_EMAIL = "candidate@demo.ch" as const;
const EMPLOYER_EMAIL = "employer@demo.ch" as const;
const RECRUITER_MEMBERSHIP_NATURAL_KEY =
  `${RADAR_DEMO_COMPANY_SLUG}:${RECRUITER_EMAIL}` as const;
const RECRUITER_MEMBERSHIP_EVENT_NATURAL_KEY =
  `${RECRUITER_MEMBERSHIP_NATURAL_KEY}:created` as const;
const EXPIRED_SESSION_NATURAL_KEY =
  `${CANDIDATE_EMAIL}:expired-phase-06` as const;
const EXPIRED_RESET_NATURAL_KEY =
  `${CANDIDATE_EMAIL}:expired-phase-06` as const;
const USED_RESET_NATURAL_KEY =
  `${EMPLOYER_EMAIL}:used-phase-06` as const;

export const AUTH_RBAC_SEED_IDENTITIES: readonly SeedIdentityRecord[] =
  Object.freeze([
    createSeedIdentity("user", SUSPENDED_AUTH_ACTOR_EMAIL),
    createSeedIdentity("credential", SUSPENDED_AUTH_ACTOR_EMAIL),
    createSeedIdentity(
      "company-membership",
      RECRUITER_MEMBERSHIP_NATURAL_KEY,
    ),
    createSeedIdentity(
      "company-membership-event",
      RECRUITER_MEMBERSHIP_EVENT_NATURAL_KEY,
    ),
    createSeedIdentity("session", EXPIRED_SESSION_NATURAL_KEY),
    createSeedIdentity("password-reset-token", EXPIRED_RESET_NATURAL_KEY),
    createSeedIdentity("password-reset-token", USED_RESET_NATURAL_KEY),
  ]);

export type AuthRbacSeedFixtures = ReturnType<typeof buildAuthRbacSeedFixtures>;

export function buildAuthRbacSeedFixtures(anchorAt: Date) {
  assertAnchor(anchorAt);
  const recruiter = requireDemoAccount(RECRUITER_EMAIL);
  const candidate = requireDemoAccount(CANDIDATE_EMAIL);
  const employer = requireDemoAccount(EMPLOYER_EMAIL);
  const companyId = stableSeedId("company", RADAR_DEMO_COMPANY_SLUG);
  const companyOwnerUserId = stableSeedId(
    "user",
    `owner+${RADAR_DEMO_COMPANY_SLUG}@demo.swisstalenthub.test`,
  );
  const membershipId = stableSeedId(
    "company-membership",
    RECRUITER_MEMBERSHIP_NATURAL_KEY,
  );
  const expiredSessionId = stableSeedId(
    "session",
    EXPIRED_SESSION_NATURAL_KEY,
  );
  const expiredResetId = stableSeedId(
    "password-reset-token",
    EXPIRED_RESET_NATURAL_KEY,
  );
  const usedResetId = stableSeedId(
    "password-reset-token",
    USED_RESET_NATURAL_KEY,
  );

  return Object.freeze({
    suspendedActor: Object.freeze({
      id: stableSeedId("user", SUSPENDED_AUTH_ACTOR_EMAIL),
      credentialId: stableSeedId("credential", SUSPENDED_AUTH_ACTOR_EMAIL),
      email: SUSPENDED_AUTH_ACTOR_EMAIL,
      name: "Gesperrter Demo-Auth-Akteur",
      role: "CANDIDATE" as const,
      status: "SUSPENDED" as const,
      createdAt: addDays(anchorAt, -200),
      emailVerifiedAt: addDays(anchorAt, -199),
      passwordChangedAt: addDays(anchorAt, -200),
    }),
    recruiterMembership: Object.freeze({
      id: membershipId,
      naturalKey: RECRUITER_MEMBERSHIP_NATURAL_KEY,
      companyId,
      companySlug: RADAR_DEMO_COMPANY_SLUG,
      userId: recruiter.id,
      userEmail: recruiter.email,
      role: "RECRUITER" as const,
      status: "ACTIVE" as const,
      joinedAt: addDays(anchorAt, -120),
      event: Object.freeze({
        id: stableSeedId(
          "company-membership-event",
          RECRUITER_MEMBERSHIP_EVENT_NATURAL_KEY,
        ),
        naturalKey: RECRUITER_MEMBERSHIP_EVENT_NATURAL_KEY,
        kind: "CREATED" as const,
        actorUserId: companyOwnerUserId,
        reasonCode: "PHASE_06_MULTI_COMPANY_DEMO",
        correlationId: "seed-phase-06-auth-rbac",
        createdAt: addDays(anchorAt, -120),
      }),
    }),
    expiredSession: Object.freeze({
      id: expiredSessionId,
      naturalKey: EXPIRED_SESSION_NATURAL_KEY,
      userId: candidate.id,
      tokenHash: inertTokenHash(expiredSessionId, 1),
      createdAt: addDays(anchorAt, -40),
      expiresAt: addDays(anchorAt, -32),
      absoluteExpiresAt: addDays(anchorAt, -10),
      rotatedAt: null,
      revokedAt: null,
      userAgent: "Phase-06 deterministic expired-session fixture",
    }),
    expiredReset: Object.freeze({
      id: expiredResetId,
      naturalKey: EXPIRED_RESET_NATURAL_KEY,
      userId: candidate.id,
      tokenHash: inertTokenHash(expiredResetId, 2),
      createdAt: addDays(anchorAt, -3),
      expiresAt: addDays(anchorAt, -2),
      usedAt: null,
      requestedUserAgent: "Phase-06 deterministic expired-reset fixture",
    }),
    usedReset: Object.freeze({
      id: usedResetId,
      naturalKey: USED_RESET_NATURAL_KEY,
      userId: employer.id,
      tokenHash: inertTokenHash(usedResetId, 3),
      createdAt: addDays(anchorAt, -1),
      expiresAt: addDays(anchorAt, 1),
      usedAt: addHours(anchorAt, -12),
      requestedUserAgent: "Phase-06 deterministic used-reset fixture",
    }),
  });
}

/**
 * Derives inert evidence directly from binary UUID material. There is no raw
 * cookie/reset token in fixtures or source, and every resulting row is already
 * unusable through expiry or usedAt.
 */
function inertTokenHash(id: string, discriminator: number): string {
  const binaryId = Buffer.from(id.replaceAll("-", ""), "hex");
  return createHash("sha256")
    .update(Buffer.from([0x53, 0x54, 0x48, 0x06, discriminator]))
    .update(binaryId)
    .digest("hex");
}

function requireDemoAccount(email: string) {
  const account = DEMO_ACCOUNT_FIXTURES.find(
    (candidate) => candidate.email === email,
  );
  if (account === undefined) {
    throw new Error(`Missing official demo account ${email}.`);
  }
  return account;
}

function assertAnchor(anchorAt: Date): void {
  if (!(anchorAt instanceof Date) || Number.isNaN(anchorAt.valueOf())) {
    throw new TypeError("Phase-06 auth/RBAC seed requires a valid anchor.");
  }
}

function addDays(anchorAt: Date, days: number): Date {
  return new Date(anchorAt.getTime() + days * DAY_MILLISECONDS);
}

function addHours(anchorAt: Date, hours: number): Date {
  return new Date(anchorAt.getTime() + hours * HOUR_MILLISECONDS);
}
