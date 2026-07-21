import { createHash } from "node:crypto";

import type { SeedIdentityRecord } from "@/prisma/seed/contract";
import {
  assertSeedIdentityIntegrity,
  createSeedIdentity,
  stableSeedId,
} from "@/prisma/seed/ids";
import {
  DEMO_COMPANY_SLUG,
  RADAR_DEMO_COMPANY_SLUG,
} from "@/prisma/seed/fixtures/companies-jobs";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

export const EMPLOYER_CORE_ADMIN_EMAIL =
  "team-admin@demo.swisstalenthub.test" as const;
export const EMPLOYER_CORE_VIEWER_EMAIL =
  "team-viewer@demo.swisstalenthub.test" as const;
export const EMPLOYER_CORE_INVITEE_EMAIL =
  "future-recruiter@demo.swisstalenthub.test" as const;
export const EMPLOYER_CORE_OVER_LIMIT_COMPANY_SLUG =
  "bieler-kreislauf-logistik" as const;

const RECRUITER_EMAIL = "recruiter@demo.ch" as const;
const NOVARIGI_OWNER_EMAIL = "employer@demo.ch" as const;
const CAREVIA_OWNER_EMAIL =
  `owner+${RADAR_DEMO_COMPANY_SLUG}@demo.swisstalenthub.test` as const;

const PRINCIPAL_DEFINITIONS = Object.freeze([
  Object.freeze({
    email: EMPLOYER_CORE_ADMIN_EMAIL,
    name: "Demo Team-Admin",
  }),
  Object.freeze({
    email: EMPLOYER_CORE_VIEWER_EMAIL,
    name: "Demo Team-Viewer",
  }),
] as const);

const MEMBERSHIP_DEFINITIONS = Object.freeze([
  Object.freeze({
    email: EMPLOYER_CORE_ADMIN_EMAIL,
    role: "ADMIN" as const,
  }),
  Object.freeze({
    email: EMPLOYER_CORE_VIEWER_EMAIL,
    role: "VIEWER" as const,
  }),
] as const);

const ASSIGNMENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    companySlug: DEMO_COMPANY_SLUG,
    jobSlug: "zh-engineering-demo-024",
    role: "PIPELINE" as const,
    assignedByEmail: NOVARIGI_OWNER_EMAIL,
  }),
  Object.freeze({
    companySlug: DEMO_COMPANY_SLUG,
    jobSlug: "zh-engineering-demo-025",
    role: "REVIEWER" as const,
    assignedByEmail: NOVARIGI_OWNER_EMAIL,
  }),
  Object.freeze({
    companySlug: RADAR_DEMO_COMPANY_SLUG,
    jobSlug: "kv-administration-demo-054",
    role: "EDITOR" as const,
    assignedByEmail: CAREVIA_OWNER_EMAIL,
  }),
] as const);

export type EmployerCoreSeedFixtures = ReturnType<
  typeof buildEmployerCoreSeedFixtures
>;

export function buildEmployerCoreSeedFixtures(anchorAt: Date) {
  assertAnchor(anchorAt);
  const companyId = stableSeedId("company", DEMO_COMPANY_SLUG);
  const inviterUserId = stableSeedId("user", NOVARIGI_OWNER_EMAIL);
  const recruiterUserId = stableSeedId("user", RECRUITER_EMAIL);
  const joinedAt = addDays(anchorAt, -120);
  const assignedAt = addDays(anchorAt, -30);
  const invitationCreatedAt = addDays(anchorAt, -1);

  const principals = PRINCIPAL_DEFINITIONS.map((definition) =>
    Object.freeze({
      id: stableSeedId("user", definition.email),
      profileId: stableSeedId("employer-profile", definition.email),
      email: definition.email,
      name: definition.name,
      role: "EMPLOYER" as const,
      status: "ACTIVE" as const,
      createdAt: addDays(anchorAt, -150),
      emailVerifiedAt: addDays(anchorAt, -149),
    }),
  );

  const memberships = MEMBERSHIP_DEFINITIONS.map((definition) => {
    const naturalKey = `${DEMO_COMPANY_SLUG}:${definition.email}`;
    const id = stableSeedId("company-membership", naturalKey);
    const eventNaturalKey = `${naturalKey}:created`;
    return Object.freeze({
      id,
      naturalKey,
      companyId,
      companySlug: DEMO_COMPANY_SLUG,
      userId: stableSeedId("user", definition.email),
      userEmail: definition.email,
      role: definition.role,
      status: "ACTIVE" as const,
      joinedAt,
      event: Object.freeze({
        id: stableSeedId("company-membership-event", eventNaturalKey),
        naturalKey: eventNaturalKey,
        kind: "CREATED" as const,
        actorUserId: inviterUserId,
        reasonCode: "PHASE_10_EMPLOYER_CORE_DEMO",
        correlationId: "seed-phase-10-employer-core",
        createdAt: joinedAt,
      }),
    });
  });

  const invitationNaturalKey =
    `${DEMO_COMPANY_SLUG}:${EMPLOYER_CORE_INVITEE_EMAIL}:pending-v1` as const;
  const invitationId = stableSeedId("company-invitation", invitationNaturalKey);
  const invitationEventNaturalKey = `${invitationNaturalKey}:created`;
  const invitation = Object.freeze({
    id: invitationId,
    naturalKey: invitationNaturalKey,
    companyId,
    inviterUserId,
    inviteeEmailNormalized: EMPLOYER_CORE_INVITEE_EMAIL,
    intendedRole: "RECRUITER" as const,
    tokenHash: inertInvitationHash(invitationId),
    tokenVersion: 1,
    status: "PENDING" as const,
    createdAt: invitationCreatedAt,
    expiresAt: addDays(anchorAt, 14),
    event: Object.freeze({
      id: stableSeedId("company-invitation-event", invitationEventNaturalKey),
      naturalKey: invitationEventNaturalKey,
      kind: "CREATED" as const,
      actorUserId: inviterUserId,
      reasonCode: "PHASE_10_EMPLOYER_CORE_DEMO",
      correlationId: "seed-phase-10-employer-core",
      createdAt: invitationCreatedAt,
    }),
  });

  const assignments = ASSIGNMENT_DEFINITIONS.map((definition) => {
    const naturalKey = `${definition.jobSlug}:${RECRUITER_EMAIL}:${definition.role.toLowerCase()}`;
    const id = stableSeedId("job-assignment", naturalKey);
    const eventNaturalKey = `${naturalKey}:assigned`;
    return Object.freeze({
      id,
      naturalKey,
      membershipId: stableSeedId(
        "company-membership",
        `${definition.companySlug}:${RECRUITER_EMAIL}`,
      ),
      companyId: stableSeedId("company", definition.companySlug),
      companySlug: definition.companySlug,
      jobId: stableSeedId("job", definition.jobSlug),
      jobSlug: definition.jobSlug,
      userId: recruiterUserId,
      userEmail: RECRUITER_EMAIL,
      role: definition.role,
      status: "ACTIVE" as const,
      assignedByUserId: stableSeedId("user", definition.assignedByEmail),
      validFrom: assignedAt,
      expiresAt: null,
      event: Object.freeze({
        id: stableSeedId("job-assignment-event", eventNaturalKey),
        naturalKey: eventNaturalKey,
        kind: "ASSIGNED" as const,
        actorUserId: stableSeedId("user", definition.assignedByEmail),
        reasonCode: "PHASE_10_EMPLOYER_CORE_DEMO",
        correlationId: "seed-phase-10-employer-core",
        createdAt: assignedAt,
      }),
    });
  });

  return Object.freeze({
    principals: Object.freeze(principals),
    memberships: Object.freeze(memberships),
    invitation,
    assignments: Object.freeze(assignments),
    overLimitScenario: Object.freeze({
      companyId: stableSeedId("company", EMPLOYER_CORE_OVER_LIMIT_COMPANY_SLUG),
      companySlug: EMPLOYER_CORE_OVER_LIMIT_COMPANY_SLUG,
      scheduleId: stableSeedId(
        "subscription-change-schedule",
        `${EMPLOYER_CORE_OVER_LIMIT_COMPANY_SLUG}:downgrade-starter`,
      ),
      successorSubscriptionId: stableSeedId(
        "employer-subscription",
        `${EMPLOYER_CORE_OVER_LIMIT_COMPANY_SLUG}:successor-starter`,
      ),
      targetPlanCode: "STARTER" as const,
      targetActiveJobLimit: 3,
      publishedJobCount: 5,
    }),
    verificationScenario: Object.freeze({
      rejectedRequestId: stableSeedId(
        "company-verification-request",
        `${DEMO_COMPANY_SLUG}:rejected-v1`,
      ),
      currentRequestId: stableSeedId(
        "company-verification-request",
        `${DEMO_COMPANY_SLUG}:current`,
      ),
    }),
  });
}

export const EMPLOYER_CORE_SEED_IDENTITIES: readonly SeedIdentityRecord[] =
  assertSeedIdentityIntegrity(buildEmployerCoreSeedIdentities());

function buildEmployerCoreSeedIdentities(): SeedIdentityRecord[] {
  const identities: SeedIdentityRecord[] = [];
  const add = (entity: string, naturalKey: string) =>
    identities.push(createSeedIdentity(entity, naturalKey));

  for (const principal of PRINCIPAL_DEFINITIONS) {
    add("user", principal.email);
    add("employer-profile", principal.email);
  }
  for (const membership of MEMBERSHIP_DEFINITIONS) {
    const naturalKey = `${DEMO_COMPANY_SLUG}:${membership.email}`;
    add("company-membership", naturalKey);
    add("company-membership-event", `${naturalKey}:created`);
  }

  const invitationNaturalKey = `${DEMO_COMPANY_SLUG}:${EMPLOYER_CORE_INVITEE_EMAIL}:pending-v1`;
  add("company-invitation", invitationNaturalKey);
  add("company-invitation-event", `${invitationNaturalKey}:created`);

  for (const assignment of ASSIGNMENT_DEFINITIONS) {
    const naturalKey = `${assignment.jobSlug}:${RECRUITER_EMAIL}:${assignment.role.toLowerCase()}`;
    add("job-assignment", naturalKey);
    add("job-assignment-event", `${naturalKey}:assigned`);
  }

  return identities;
}

/**
 * Produces a one-way digest with no raw invitation credential or reversible
 * preimage in source. The pending row is useful for list/resend/revoke demos;
 * acceptance tests create their own raw one-time value through the real action.
 */
function inertInvitationHash(invitationId: string): string {
  return createHash("sha256")
    .update("phase-10-employer-core-inert-invitation-v1", "utf8")
    .update(Buffer.from(invitationId.replaceAll("-", ""), "hex"))
    .digest("hex");
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MILLISECONDS);
}

function assertAnchor(anchorAt: Date): void {
  if (!(anchorAt instanceof Date) || Number.isNaN(anchorAt.valueOf())) {
    throw new TypeError("Phase-10 employer-core seed requires a valid anchor.");
  }
}
