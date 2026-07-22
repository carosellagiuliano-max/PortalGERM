import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  completeOwnedCandidateOnboarding,
  saveOwnedCandidateProfile,
  setOwnedTalentRadarVisibility,
} from "@/lib/candidate/profile";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { buildNotificationStorageDedupeKey } from "@/lib/notifications/writer";
import { isContactRequestEffectiveAt } from "@/lib/talentradar/contact-requests";
import {
  swissJobPassSchema,
  type SwissJobPassInput,
} from "@/lib/validation/candidate";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

type SharedFixture = Readonly<{
  cantonId: string;
  cityId: string;
  categoryId: string;
  skillId: string;
}>;

type EligibilityFixture = Readonly<{
  accountId: string;
  candidateProfileId: string;
  candidateUserId: string;
  companyId: string;
  employerUserId: string;
  mappingId: string;
  requestId: string;
}>;

type TriggerEvidence = Readonly<{
  actorUserId: string;
  correlationId: string;
}>;

const DAY = 86_400_000;
const MINUTE = 60_000;
const NOW = new Date("2026-07-22T12:00:00.000Z");
const VALID_REQUEST_CREATED_AT = new Date(NOW.getTime() - 5 * MINUTE);

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let shared: SharedFixture | undefined;
let sequence = 0;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase14_candidate_eligibility_loss",
  );
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  shared = await seedSharedFixture(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 14 candidate Talent Radar eligibility-loss effects", () => {
  it.each([
    {
      label: "full-profile opt-out",
      expectedReason: "CANDIDATE_OPTED_OUT" as const,
      expectedOnboardingStatus: "COMPLETE" as const,
      invoke: async (fixture: EligibilityFixture): Promise<TriggerEvidence> => {
        const correlationId = randomUUID();
        const profile = await db().candidateProfile.findUniqueOrThrow({
          where: { id: fixture.candidateProfileId },
          select: { updatedAt: true },
        });
        const result = await saveOwnedCandidateProfile(db(), {
          actorUserId: fixture.candidateUserId,
          correlationId,
          expectedUpdatedAt: profile.updatedAt,
          now: NOW,
          profile: profileInput({ radarVisible: false }),
        });
        expect(result).toMatchObject({
          outcome: "SAVED",
          onboardingStatus: "COMPLETE",
          consentChanged: true,
          radarState: "OFF",
        });
        return { actorUserId: fixture.candidateUserId, correlationId };
      },
    },
    {
      label: "onboarding reopen after required data removal",
      expectedReason: "CANDIDATE_PROFILE_INCOMPLETE" as const,
      expectedOnboardingStatus: "DRAFT" as const,
      invoke: async (fixture: EligibilityFixture): Promise<TriggerEvidence> => {
        const correlationId = randomUUID();
        const profile = await db().candidateProfile.findUniqueOrThrow({
          where: { id: fixture.candidateProfileId },
          select: { updatedAt: true },
        });
        const result = await saveOwnedCandidateProfile(db(), {
          actorUserId: fixture.candidateUserId,
          correlationId,
          expectedUpdatedAt: profile.updatedAt,
          now: NOW,
          profile: profileInput({ skillIds: [], radarVisible: true }),
        });
        expect(result).toMatchObject({
          outcome: "SAVED",
          onboardingStatus: "DRAFT",
          reopened: true,
          consentChanged: false,
          radarState: "INCOMPLETE",
        });
        return { actorUserId: fixture.candidateUserId, correlationId };
      },
    },
    {
      label: "separate visibility opt-out",
      expectedReason: "CANDIDATE_OPTED_OUT" as const,
      expectedOnboardingStatus: "COMPLETE" as const,
      invoke: async (fixture: EligibilityFixture): Promise<TriggerEvidence> => {
        const correlationId = randomUUID();
        const result = await setOwnedTalentRadarVisibility(db(), {
          actorUserId: fixture.candidateUserId,
          correlationId,
          granted: false,
          now: NOW,
        });
        expect(result).toEqual({
          outcome: "CHANGED",
          granted: false,
          radarState: "OFF",
        });
        return { actorUserId: fixture.candidateUserId, correlationId };
      },
    },
  ])(
    "runs the complete cancellation chain for $label",
    async ({
      label,
      expectedReason,
      expectedOnboardingStatus,
      invoke,
    }) => {
      const fixture = await createEligibilityFixture(
        label,
        VALID_REQUEST_CREATED_AT,
      );
      const ledgerBefore = await ledgerSnapshot(fixture.accountId);

      const evidence = await invoke(fixture);

      await expectEligibilityCancellation(fixture, {
        ...evidence,
        expectedOnboardingStatus,
        reason: expectedReason,
      });
      await expect(ledgerSnapshot(fixture.accountId)).resolves.toEqual(
        ledgerBefore,
      );
    },
    30_000,
  );

  it("does not turn an expired unprojected PENDING request into an eligibility cancellation", async () => {
    const requestCreatedAt = new Date(NOW.getTime() - 14 * DAY);
    const fixture = await createEligibilityFixture(
      "expiry-boundary",
      requestCreatedAt,
    );
    const ledgerBefore = await ledgerSnapshot(fixture.accountId);

    const result = await setOwnedTalentRadarVisibility(db(), {
      actorUserId: fixture.candidateUserId,
      correlationId: randomUUID(),
      granted: false,
      now: NOW,
    });
    expect(result).toMatchObject({ outcome: "CHANGED", radarState: "OFF" });

    const [request, mapping, cancellationEvents, cancellationNotifications,
      cancellationAudits, conversations, revealGrants] = await Promise.all([
      db().employerContactRequest.findUniqueOrThrow({
        where: { id: fixture.requestId },
        select: {
          status: true,
          terminalAt: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
      db().radarOpaqueMapping.findUniqueOrThrow({
        where: { id: fixture.mappingId },
        select: { revokedAt: true, revocationReason: true },
      }),
      db().contactRequestEvent.count({
        where: { contactRequestId: fixture.requestId, kind: "CANCELLED" },
      }),
      db().notification.count({
        where: {
          kind: "CONTACT_REQUEST_CANCELLED",
          recipientUserId: {
            in: [fixture.candidateUserId, fixture.employerUserId],
          },
        },
      }),
      db().auditLog.count({
        where: {
          action: "CONTACT_REQUEST_CANCELLED",
          targetId: fixture.requestId,
        },
      }),
      db().conversation.count({ where: { contactRequestId: fixture.requestId } }),
      db().identityRevealGrant.count({
        where: { contactRequestId: fixture.requestId },
      }),
    ]);

    expect(request).toMatchObject({ status: "PENDING", terminalAt: null });
    expect(request.expiresAt).toEqual(NOW);
    expect(isContactRequestEffectiveAt(request, NOW)).toBe(false);
    expect(mapping).toEqual({
      revokedAt: NOW,
      revocationReason: "CANDIDATE_OPTED_OUT",
    });
    expect(cancellationEvents).toBe(0);
    expect(cancellationNotifications).toBe(0);
    expect(cancellationAudits).toBe(0);
    expect(conversations).toBe(0);
    expect(revealGrants).toBe(0);
    await expect(ledgerSnapshot(fixture.accountId)).resolves.toEqual(
      ledgerBefore,
    );
  }, 30_000);
});

async function expectEligibilityCancellation(
  fixture: EligibilityFixture,
  input: Readonly<{
    actorUserId: string;
    correlationId: string;
    expectedOnboardingStatus: "COMPLETE" | "DRAFT";
    reason:
      | "CANDIDATE_OPTED_OUT"
      | "CANDIDATE_PROFILE_INCOMPLETE";
  }>,
) {
  const [mapping, request, cancellationEvents, notifications, audits,
    conversations, revealGrants, profile] = await Promise.all([
    db().radarOpaqueMapping.findUniqueOrThrow({
      where: { id: fixture.mappingId },
      select: { revokedAt: true, revocationReason: true },
    }),
    db().employerContactRequest.findUniqueOrThrow({
      where: { id: fixture.requestId },
      select: { status: true, terminalAt: true },
    }),
    db().contactRequestEvent.findMany({
      where: { contactRequestId: fixture.requestId, kind: "CANCELLED" },
      select: {
        kind: true,
        actorUserId: true,
        reasonCode: true,
        correlationId: true,
      },
    }),
    db().notification.findMany({
      where: {
        kind: "CONTACT_REQUEST_CANCELLED",
        recipientUserId: {
          in: [fixture.candidateUserId, fixture.employerUserId],
        },
      },
      orderBy: { recipientUserId: "asc" },
      select: {
        recipientUserId: true,
        kind: true,
        payload: true,
        dedupeKey: true,
      },
    }),
    db().auditLog.findMany({
      where: {
        action: "CONTACT_REQUEST_CANCELLED",
        targetId: fixture.requestId,
      },
      select: {
        action: true,
        actorKind: true,
        actorUserId: true,
        capability: true,
        companyId: true,
        correlationId: true,
        reasonCode: true,
        result: true,
        targetId: true,
        targetType: true,
      },
    }),
    db().conversation.count({ where: { contactRequestId: fixture.requestId } }),
    db().identityRevealGrant.count({
      where: { contactRequestId: fixture.requestId },
    }),
    db().candidateProfile.findUniqueOrThrow({
      where: { id: fixture.candidateProfileId },
      select: {
        onboardingStatus: true,
        radarProfile: { select: { withdrawnAt: true } },
      },
    }),
  ]);

  expect(mapping).toEqual({ revokedAt: NOW, revocationReason: input.reason });
  expect(request).toEqual({ status: "CANCELLED", terminalAt: NOW });
  expect(cancellationEvents).toEqual([
    {
      kind: "CANCELLED",
      actorUserId: input.actorUserId,
      reasonCode: input.reason,
      correlationId: input.correlationId,
    },
  ]);
  expect(notifications).toHaveLength(2);
  expect(notifications.map(({ recipientUserId }) => recipientUserId).sort()).toEqual(
    [fixture.candidateUserId, fixture.employerUserId].sort(),
  );
  for (const notification of notifications) {
    expect(notification).toMatchObject({
      kind: "CONTACT_REQUEST_CANCELLED",
      dedupeKey: buildNotificationStorageDedupeKey({
        recipientUserId: notification.recipientUserId,
        kind: "CONTACT_REQUEST_CANCELLED",
        dedupeKey: `eligibility-loss:${input.reason}:${fixture.requestId}`,
      }),
      payload: {
        requestId: fixture.requestId,
        status: "CANCELLED",
        reasonCode: input.reason,
      },
    });
  }
  expect(audits).toEqual([
    {
      action: "CONTACT_REQUEST_CANCELLED",
      actorKind: "USER",
      actorUserId: input.actorUserId,
      capability: "RADAR_ELIGIBILITY_LOSS",
      companyId: fixture.companyId,
      correlationId: input.correlationId,
      reasonCode: input.reason,
      result: "SUCCEEDED",
      targetId: fixture.requestId,
      targetType: "CONTACT_REQUEST",
    },
  ]);
  expect(conversations).toBe(0);
  expect(revealGrants).toBe(0);
  expect(profile).toEqual({
    onboardingStatus: input.expectedOnboardingStatus,
    radarProfile: { withdrawnAt: NOW },
  });
}

async function seedSharedFixture(client: DatabaseClient): Promise<SharedFixture> {
  const canton = await client.canton.create({
    data: {
      code: "ZG",
      name: "Zug Eligibility Integration",
      slug: "zug-eligibility-integration",
      language: "DE",
    },
  });
  const category = await client.category.create({
    data: {
      name: "Eligibility Engineering",
      slug: "eligibility-engineering",
    },
  });
  const skill = await client.skill.create({
    data: {
      name: "Eligibility Testing",
      slug: "eligibility-testing",
    },
  });
  const city = await client.city.create({
    data: {
      cantonId: canton.id,
      name: "Zug Eligibility Integration",
      slug: "zug-eligibility-integration-city",
    },
  });
  return Object.freeze({
    cantonId: canton.id,
    cityId: city.id,
    categoryId: category.id,
    skillId: skill.id,
  });
}

async function createEligibilityFixture(
  label: string,
  requestCreatedAt: Date,
): Promise<EligibilityFixture> {
  const client = db();
  const references = requireShared();
  const localSequence = ++sequence;
  const suffix = `${label.replaceAll(/[^a-z0-9]+/giu, "-").toLowerCase()}-${localSequence}`;
  const saveAt = new Date(requestCreatedAt.getTime() - 10 * MINUTE);
  const completeAt = new Date(requestCreatedAt.getTime() - 9 * MINUTE);
  const candidateEmail = `candidate-eligibility-${localSequence}@example.test`;
  const candidate = await client.user.create({
    data: {
      email: candidateEmail,
      emailNormalized: candidateEmail,
      role: "CANDIDATE",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: saveAt,
      createdAt: saveAt,
      updatedAt: saveAt,
    },
  });
  const initialProfile = await client.candidateProfile.create({
    data: {
      userId: candidate.id,
      createdAt: saveAt,
      updatedAt: saveAt,
    },
  });
  await saveOwnedCandidateProfile(client, {
    actorUserId: candidate.id,
    correlationId: randomUUID(),
    expectedUpdatedAt: initialProfile.updatedAt,
    now: saveAt,
    profile: profileInput({ radarVisible: true }),
  });
  const completed = await completeOwnedCandidateOnboarding(client, {
    actorUserId: candidate.id,
    correlationId: randomUUID(),
    now: completeAt,
  });
  expect(completed).toMatchObject({
    outcome: "COMPLETED",
    radarState: "CURRENT",
  });

  const employerEmail = `employer-eligibility-${localSequence}@example.test`;
  const employer = await client.user.create({
    data: {
      email: employerEmail,
      emailNormalized: employerEmail,
      role: "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: saveAt,
      createdAt: saveAt,
      updatedAt: saveAt,
    },
  });
  const company = await client.company.create({
    data: {
      name: `Eligibility ${localSequence} AG`,
      slug: `eligibility-${suffix}`,
      industry: "Technology",
      size: "10-49",
      website: `https://eligibility-${localSequence}.example.test`,
      about: "Complete employer fixture for eligibility-loss integration tests.",
      status: "DRAFT",
      dataProvenance: "TEST",
      createdAt: saveAt,
      updatedAt: saveAt,
    },
  });
  await client.companyLocation.create({
    data: {
      companyId: company.id,
      cantonId: references.cantonId,
      cityId: references.cityId,
      address: "Teststrasse 14",
      postalCode: "6300",
      isPrimary: true,
      createdAt: saveAt,
      updatedAt: saveAt,
    },
  });
  await client.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE", updatedAt: saveAt },
  });
  const membership = await client.companyMembership.create({
    data: {
      companyId: company.id,
      userId: employer.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: saveAt,
      createdAt: saveAt,
      updatedAt: saveAt,
    },
  });

  const mapping = await client.radarOpaqueMapping.create({
    data: {
      candidateProfileId: initialProfile.id,
      companyId: company.id,
      epoch: utcDateOnly(requestCreatedAt),
      lookupHmac: sha256(`eligibility-mapping:${suffix}`),
      encryptedToken: Buffer.alloc(32, localSequence),
      nonce: Buffer.alloc(12, localSequence),
      authTag: Buffer.alloc(16, localSequence),
      lookupKeyVersion: "eligibility-v1",
      encryptionKeyVersion: "eligibility-v1",
      validFrom: completeAt,
      validTo: new Date(NOW.getTime() + DAY),
    },
  });
  const session = await client.radarSearchSession.create({
    data: {
      companyId: company.id,
      membershipId: membership.id,
      requestingUserId: employer.id,
      filterHash: sha256(`eligibility-filter:${suffix}`),
      calendarDate: utcDateOnly(requestCreatedAt),
      policyVersion: "radar-privacy-v1",
      normalizedFilters: {},
      resultCount: 1,
      expiresAt: new Date(requestCreatedAt.getTime() + 15 * MINUTE),
      createdAt: new Date(requestCreatedAt.getTime() - MINUTE),
    },
  });
  await client.radarSearchSessionCandidate.create({
    data: {
      radarSearchSessionId: session.id,
      candidateProfileId: initialProfile.id,
      position: 0,
    },
  });

  const periodStart = new Date(requestCreatedAt.getTime() - DAY);
  const periodEnd = new Date(requestCreatedAt.getTime() + 30 * DAY);
  const account = await client.creditAccount.create({
    data: {
      companyId: company.id,
      creditType: "TALENT_CONTACT",
      fundingSource: "ADMIN_GRANT",
      periodStart,
      periodEnd,
      createdAt: periodStart,
    },
  });
  const grant = await client.creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "ADMIN_GRANT",
      kind: "GRANT",
      amount: 1,
      validFrom: periodStart,
      validTo: periodEnd,
      idempotencyKey: `eligibility-grant:${localSequence}`,
      reasonCode: "TEST_ADMIN_GRANT",
      actorUserId: employer.id,
      createdAt: periodStart,
    },
  });
  const consumption = await client.creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "ADMIN_GRANT",
      kind: "CONSUME",
      amount: -1,
      consumedGrantEntryId: grant.id,
      validFrom: periodStart,
      validTo: periodEnd,
      idempotencyKey: `eligibility-consume:${localSequence}`,
      reasonCode: "CONTACT_REQUEST_SENT",
      actorUserId: employer.id,
      createdAt: requestCreatedAt,
    },
  });
  const request = await client.employerContactRequest.create({
    data: {
      companyId: company.id,
      candidateProfileId: initialProfile.id,
      radarSearchSessionId: session.id,
      requestingUserId: employer.id,
      creditLedgerEntryId: consumption.id,
      subject: "Eligibility chain integration",
      messagePreview: "Privacy-safe test message without candidate identity.",
      idempotencyKey: `eligibility-request:${localSequence}`,
      commandFingerprint: sha256(`eligibility-command:${suffix}`),
      status: "PENDING",
      fundingSource: "ADMIN_GRANT",
      clusterPolicyVersion: "radar-privacy-v1",
      cantonBucketSnapshot: "ZG",
      categoryBucketSnapshot: "eligibility-engineering",
      expiresAt: new Date(requestCreatedAt.getTime() + 14 * DAY),
      createdAt: requestCreatedAt,
      updatedAt: requestCreatedAt,
    },
  });
  await client.contactRequestEvent.create({
    data: {
      contactRequestId: request.id,
      kind: "CREATED",
      actorUserId: employer.id,
      correlationId: randomUUID(),
      idempotencyKey: `eligibility-created:${localSequence}`,
      createdAt: requestCreatedAt,
    },
  });

  return Object.freeze({
    accountId: account.id,
    candidateProfileId: initialProfile.id,
    candidateUserId: candidate.id,
    companyId: company.id,
    employerUserId: employer.id,
    mappingId: mapping.id,
    requestId: request.id,
  });
}

function profileInput(overrides: Partial<SwissJobPassInput> = {}) {
  const references = requireShared();
  return swissJobPassSchema.parse({
    firstName: "Mira",
    lastName: "Muster",
    phone: "+41 79 123 45 67",
    cantonId: references.cantonId,
    cityLabel: "Zug",
    summary: "Erfahrene Fachperson mit einem vollständigen Testprofil.",
    desiredTitles: ["Softwareentwicklerin"],
    skillIds: [references.skillId],
    languages: [{ code: "de", level: "C1" }],
    categoryIds: [references.categoryId],
    workloadMin: 60,
    workloadMax: 80,
    desiredSalaryMin: 100_000,
    desiredSalaryMax: 120_000,
    desiredSalaryPeriod: "YEARLY",
    jobTypes: ["PERMANENT"],
    remotePreference: "HYBRID",
    mobilityRadiusKm: 30,
    availabilityDate: new Date("2026-08-01T00:00:00.000Z"),
    workPermitType: "C",
    radarVisible: true,
    ...overrides,
  });
}

async function ledgerSnapshot(accountId: string) {
  const [entries, aggregate, reversals] = await Promise.all([
    db().creditLedgerEntry.count({ where: { accountId } }),
    db().creditLedgerEntry.aggregate({
      where: { accountId },
      _sum: { amount: true },
    }),
    db().creditLedgerEntry.count({
      where: { accountId, kind: "REVERSAL" },
    }),
  ]);
  return Object.freeze({
    entries,
    balance: aggregate._sum.amount,
    reversals,
  });
}

function utcDateOnly(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function db(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Candidate eligibility-loss test database unavailable.");
  }
  return database;
}

function requireShared(): SharedFixture {
  if (shared === undefined) {
    throw new Error("Candidate eligibility-loss shared fixture unavailable.");
  }
  return shared;
}
