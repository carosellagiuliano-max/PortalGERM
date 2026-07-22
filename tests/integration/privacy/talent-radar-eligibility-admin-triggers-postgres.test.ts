import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  revokeCompanyVerification,
  suspendCompany,
} from "@/lib/admin/companies";
import type { AdminDependencies } from "@/lib/admin/common";
import { applyModerationRestriction } from "@/lib/admin/moderation";
import { suspendUser } from "@/lib/admin/users";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { buildNotificationStorageDedupeKey } from "@/lib/notifications/writer";
import { RADAR_CONSENT_NOTICE_V1 } from "@/lib/privacy/radar-consent";
import type { RadarEligibilityLossReason } from "@/lib/talentradar/eligibility-loss-effects";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const DAY = 86_400_000;
const NOW = new Date("2026-07-22T12:00:00.000Z");
const AUDIT_RETENTION_MS = 10 * 365 * DAY;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let adminUserId = "";
let cantonId = "";
let cityId = "";
let skillId = "";
let sequence = 0;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase14_talent_radar_eligibility_admin_triggers",
  );
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  const admin = await database.user.create({
    data: {
      email: "phase14-eligibility-admin@example.test",
      emailNormalized: "phase14-eligibility-admin@example.test",
      role: "ADMIN",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
    },
  });
  adminUserId = admin.id;
  const canton = await database.canton.create({
    data: {
      code: "ZH",
      name: "Zürich Eligibility Integration",
      slug: "zurich-eligibility-integration",
      language: "DE",
    },
  });
  cantonId = canton.id;
  cityId = (
    await database.city.create({
      data: {
        cantonId,
        name: "Zürich Eligibility Integration",
        slug: "zurich-eligibility-integration-city",
      },
    })
  ).id;
  skillId = (
    await database.skill.create({
      data: {
        name: "Phase 14 Eligibility Engineering",
        slug: "phase-14-eligibility-engineering",
      },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 14 admin eligibility-loss triggers", () => {
  it("runs direct User suspension through the complete candidate-loss chain", async () => {
    await verifyAdminTrigger({
      suffix: "direct-user-suspension",
      reason: "CANDIDATE_USER_UNAVAILABLE",
      async trigger(fixture, dependencies) {
        const idempotencyKey = randomUUID();
        requireSuccess(
          await suspendUser(
            {
              userId: fixture.candidateUserId,
              expectedStatus: "ACTIVE",
              reasonCode: "RADAR_ELIGIBILITY_REVIEW",
              idempotencyKey,
            },
            dependencies,
          ),
        );
        return idempotencyKey;
      },
    });
  });

  it("runs Company verification revocation through the complete company-loss chain", async () => {
    await verifyAdminTrigger({
      suffix: "verification-revocation",
      reason: "COMPANY_VERIFICATION_LOST",
      async trigger(fixture, dependencies) {
        requireSuccess(
          await revokeCompanyVerification(
            {
              verificationRequestId: fixture.verificationRequestId,
              expectedStatus: "VERIFIED",
              reasonCode: "VERIFICATION_EVIDENCE_REVOKED",
              idempotencyKey: randomUUID(),
            },
            dependencies,
          ),
        );
        return dependencies.correlationId;
      },
    });
  });

  it("runs direct Company suspension through the complete company-loss chain", async () => {
    await verifyAdminTrigger({
      suffix: "direct-company-suspension",
      reason: "COMPANY_INACTIVE",
      async trigger(fixture, dependencies) {
        requireSuccess(
          await suspendCompany(
            {
              companyId: fixture.companyId,
              expectedStatus: "ACTIVE",
              reasonCode: "RADAR_ELIGIBILITY_REVIEW",
              idempotencyKey: randomUUID(),
            },
            dependencies,
          ),
        );
        return dependencies.correlationId;
      },
    });
  });

  it("runs PAUSE_COMPANY moderation through the complete company-loss chain", async () => {
    await verifyAdminTrigger({
      suffix: "moderation-pause-company",
      reason: "COMPANY_INACTIVE",
      async trigger(fixture, dependencies) {
        const reportId = await createReport("COMPANY", fixture.companyId);
        requireSuccess(
          await applyModerationRestriction(
            {
              reportId,
              expectedReportVersion: 1,
              restrictionType: "PAUSE_COMPANY",
              affectedResourceId: fixture.companyId,
              impactConfirmed: true,
              reason: "Confirmed company risk requires a temporary pause.",
              idempotencyKey: randomUUID(),
            },
            dependencies,
          ),
        );
        return dependencies.correlationId;
      },
    });
  });

  it("runs SUSPEND_USER moderation through the complete candidate-loss chain", async () => {
    await verifyAdminTrigger({
      suffix: "moderation-suspend-user",
      reason: "CANDIDATE_USER_UNAVAILABLE",
      async trigger(fixture, dependencies) {
        const reportId = await createReport("USER", fixture.candidateUserId);
        requireSuccess(
          await applyModerationRestriction(
            {
              reportId,
              expectedReportVersion: 1,
              restrictionType: "SUSPEND_USER",
              affectedResourceId: fixture.candidateUserId,
              impactConfirmed: true,
              reason: "Confirmed user risk requires a temporary suspension.",
              idempotencyKey: randomUUID(),
            },
            dependencies,
          ),
        );
        return dependencies.correlationId;
      },
    });
  });
});

type EligibilityFixture = Readonly<{
  candidateProfileId: string;
  candidateUserId: string;
  companyId: string;
  contactRequestId: string;
  creditAccountId: string;
  mappingId: string;
  requestingUserId: string;
  verificationRequestId: string;
}>;

type TriggerInput = Readonly<{
  suffix: string;
  reason: RadarEligibilityLossReason;
  trigger: (
    fixture: EligibilityFixture,
    dependencies: AdminDependencies,
  ) => Promise<string>;
}>;

async function verifyAdminTrigger(input: TriggerInput): Promise<void> {
  const fixture = await createEligibilityFixture(input.suffix);
  const activeMapping = await db().radarOpaqueMapping.findUniqueOrThrow({
    where: { id: fixture.mappingId },
    select: { revokedAt: true, revocationReason: true, validFrom: true, validTo: true },
  });
  expect(activeMapping).toMatchObject({
    revokedAt: null,
    revocationReason: null,
  });
  expect(activeMapping.validFrom.getTime()).toBeLessThanOrEqual(NOW.getTime());
  expect(activeMapping.validTo.getTime()).toBeGreaterThan(NOW.getTime());
  const effectivePending = await db().employerContactRequest.findUniqueOrThrow({
    where: { id: fixture.contactRequestId },
    select: { createdAt: true, expiresAt: true, status: true, terminalAt: true },
  });
  expect(effectivePending).toMatchObject({ status: "PENDING", terminalAt: null });
  expect(effectivePending.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
  expect(effectivePending.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());

  const dependencies = adminDependencies();
  const correlationId = await input.trigger(fixture, dependencies);

  await expect(
    db().radarOpaqueMapping.findUniqueOrThrow({
      where: { id: fixture.mappingId },
      select: { revokedAt: true, revocationReason: true },
    }),
  ).resolves.toEqual({
    revokedAt: NOW,
    revocationReason: input.reason,
  });

  await expect(
    db().employerContactRequest.findUniqueOrThrow({
      where: { id: fixture.contactRequestId },
      select: { status: true, terminalAt: true, updatedAt: true },
    }),
  ).resolves.toEqual({
    status: "CANCELLED",
    terminalAt: NOW,
    updatedAt: NOW,
  });

  const events = await db().contactRequestEvent.findMany({
    where: {
      contactRequestId: fixture.contactRequestId,
      kind: "CANCELLED",
    },
    select: {
      actorUserId: true,
      correlationId: true,
      createdAt: true,
      idempotencyKey: true,
      kind: true,
      reasonCode: true,
    },
  });
  expect(events).toEqual([
    {
      actorUserId: adminUserId,
      correlationId,
      createdAt: NOW,
      idempotencyKey: `eligibility-loss:${input.reason}:${fixture.contactRequestId}`,
      kind: "CANCELLED",
      reasonCode: input.reason,
    },
  ]);

  const rawNotificationDedupeKey =
    `eligibility-loss:${input.reason}:${fixture.contactRequestId}`;
  const notifications = await db().notification.findMany({
    where: {
      kind: "CONTACT_REQUEST_CANCELLED",
      recipientUserId: {
        in: [fixture.candidateUserId, fixture.requestingUserId],
      },
    },
    orderBy: { recipientUserId: "asc" },
    select: {
      dedupeKey: true,
      kind: true,
      payload: true,
      recipientUserId: true,
      schemaVersion: true,
    },
  });
  expect(notifications).toHaveLength(2);
  expect(notifications).toEqual(
    [fixture.candidateUserId, fixture.requestingUserId]
      .sort()
      .map((recipientUserId) => ({
        dedupeKey: buildNotificationStorageDedupeKey({
          recipientUserId,
          kind: "CONTACT_REQUEST_CANCELLED",
          dedupeKey: rawNotificationDedupeKey,
        }),
        kind: "CONTACT_REQUEST_CANCELLED",
        payload: {
          requestId: fixture.contactRequestId,
          status: "CANCELLED",
          reasonCode: input.reason,
        },
        recipientUserId,
        schemaVersion: "1",
      })),
  );

  const audits = await db().auditLog.findMany({
    where: {
      action: "CONTACT_REQUEST_CANCELLED",
      targetId: fixture.contactRequestId,
    },
    select: {
      action: true,
      actorKind: true,
      actorUserId: true,
      capability: true,
      companyId: true,
      correlationId: true,
      createdAt: true,
      metadata: true,
      reasonCode: true,
      result: true,
      retainUntil: true,
      targetId: true,
      targetType: true,
    },
  });
  expect(audits).toEqual([
    {
      action: "CONTACT_REQUEST_CANCELLED",
      actorKind: "USER",
      actorUserId: adminUserId,
      capability: "RADAR_ELIGIBILITY_LOSS",
      companyId: fixture.companyId,
      correlationId,
      createdAt: expect.any(Date),
      metadata: null,
      reasonCode: input.reason,
      result: "SUCCEEDED",
      retainUntil: new Date(NOW.getTime() + AUDIT_RETENTION_MS),
      targetId: fixture.contactRequestId,
      targetType: "CONTACT_REQUEST",
    },
  ]);

  await expect(
    db().creditLedgerEntry.findMany({
      where: { accountId: fixture.creditAccountId },
      orderBy: { createdAt: "asc" },
      select: { amount: true, kind: true, reversalOfEntryId: true },
    }),
  ).resolves.toEqual([
    { amount: 1, kind: "GRANT", reversalOfEntryId: null },
    { amount: -1, kind: "CONSUME", reversalOfEntryId: null },
  ]);
  await expect(
    db().conversation.count({
      where: { contactRequestId: fixture.contactRequestId },
    }),
  ).resolves.toBe(0);
  await expect(
    db().identityRevealGrant.count({
      where: { contactRequestId: fixture.contactRequestId },
    }),
  ).resolves.toBe(0);
}

async function createEligibilityFixture(suffix: string): Promise<EligibilityFixture> {
  const localSequence = ++sequence;
  const normalizedSuffix = suffix.replaceAll(/[^a-z0-9]+/giu, "-").toLowerCase();
  const contactCreatedAt = new Date(NOW.getTime() - DAY);
  const periodStart = new Date(NOW.getTime() - 2 * DAY);
  const periodEnd = new Date(NOW.getTime() + 30 * DAY);

  const candidateUser = await db().user.create({
    data: {
      email: `phase14-eligibility-candidate-${localSequence}@example.test`,
      emailNormalized: `phase14-eligibility-candidate-${localSequence}@example.test`,
      role: "CANDIDATE",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
    },
  });
  const candidateProfile = await db().candidateProfile.create({
    data: {
      userId: candidateUser.id,
      cantonId,
      firstName: `Candidate${localSequence}`,
      lastName: "Eligibility",
      onboardingStatus: "DRAFT",
    },
  });
  await db().$transaction(async (transaction) => {
    await transaction.candidatePreference.create({
      data: {
        candidateProfileId: candidateProfile.id,
        desiredTitles: ["Software Engineer"],
        desiredJobTypes: ["PERMANENT"],
        workloadMin: 80,
        workloadMax: 100,
        remotePreference: "HYBRID",
      },
    });
    await transaction.candidateSkill.create({
      data: {
        candidateProfileId: candidateProfile.id,
        skillId,
        level: 4,
        years: 5,
      },
    });
    await transaction.candidateLanguage.create({
      data: {
        candidateProfileId: candidateProfile.id,
        code: "de",
        level: "C1",
      },
    });
    await transaction.candidateProfile.update({
      where: { id: candidateProfile.id },
      data: { onboardingStatus: "COMPLETE" },
    });
  });
  await db().candidateConsent.create({
    data: {
      candidateProfileId: candidateProfile.id,
      kind: RADAR_CONSENT_NOTICE_V1.kind,
      granted: true,
      noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
      noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
      actorUserId: candidateUser.id,
      effectiveAt: new Date(contactCreatedAt.getTime() - 1_000),
    },
  });
  await db().radarProfile.create({
    data: {
      candidateProfileId: candidateProfile.id,
      displayLabel: `Anonymous eligibility profile ${localSequence}`,
      cantonBucket: "ZH",
      categoryBucket: "software-engineering",
      seniority: "MID",
      remotePreference: "HYBRID",
      availabilityBucket: "NOW",
      workloadMin: 80,
      workloadMax: 100,
      salaryYearlyMinChf: 100_000,
      salaryYearlyMaxChf: 120_000,
      languageCodes: ["de"],
      skillSlugs: ["phase-14-eligibility-engineering"],
      publishedAt: contactCreatedAt,
      withdrawnAt: null,
      projectionVersion: "v1",
      projectionHash: createHash("sha256")
        .update(`eligibility-radar-profile:${localSequence}`, "utf8")
        .digest("hex"),
    },
  });
  const requestingUser = await db().user.create({
    data: {
      email: `phase14-eligibility-employer-${localSequence}@example.test`,
      emailNormalized: `phase14-eligibility-employer-${localSequence}@example.test`,
      role: "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
    },
  });
  const company = await db().company.create({
    data: {
      name: `Phase 14 Eligibility ${localSequence} AG`,
      slug: `phase-14-eligibility-${normalizedSuffix}-${localSequence}`,
      industry: "Technology",
      size: "10-49",
      website: `https://eligibility-${localSequence}.example.test`,
      about: "Complete isolated employer for Talent Radar eligibility testing.",
      status: "DRAFT",
      dataProvenance: "TEST",
      values: ["Privacy"],
      benefits: ["Testing"],
    },
  });
  await db().companyLocation.create({
    data: {
      companyId: company.id,
      cantonId,
      cityId,
      address: "Teststrasse 14",
      postalCode: "8000",
      isPrimary: true,
    },
  });
  const membership = await db().companyMembership.create({
    data: {
      companyId: company.id,
      userId: requestingUser.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  const verificationRequest = await db().companyVerificationRequest.create({
    data: {
      companyId: company.id,
      requestedByUserId: requestingUser.id,
      status: "VERIFIED",
    },
  });
  await db().company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });

  const mapping = await db().radarOpaqueMapping.create({
    data: {
      candidateProfileId: candidateProfile.id,
      companyId: company.id,
      epoch: new Date("2026-07-01T00:00:00.000Z"),
      lookupHmac: createHash("sha256")
        .update(`eligibility-mapping:${localSequence}`, "utf8")
        .digest("hex"),
      encryptedToken: Buffer.alloc(32, localSequence),
      nonce: Buffer.alloc(12, localSequence),
      authTag: Buffer.alloc(16, localSequence),
      lookupKeyVersion: "eligibility-lookup-v1",
      encryptionKeyVersion: "eligibility-encryption-v1",
      validFrom: periodStart,
      validTo: periodEnd,
    },
  });

  const searchSession = await db().radarSearchSession.create({
    data: {
      companyId: company.id,
      membershipId: membership.id,
      requestingUserId: requestingUser.id,
      filterHash: createHash("sha256")
        .update(`eligibility-filter:${localSequence}`, "utf8")
        .digest("hex"),
      calendarDate: new Date("2026-07-22T00:00:00.000Z"),
      policyVersion: "radar-privacy-v1",
      normalizedFilters: {},
      resultCount: 1,
      expiresAt: new Date(NOW.getTime() + DAY),
      createdAt: contactCreatedAt,
    },
  });
  await db().radarSearchSessionCandidate.create({
    data: {
      radarSearchSessionId: searchSession.id,
      candidateProfileId: candidateProfile.id,
      position: 0,
    },
  });

  const creditAccount = await db().creditAccount.create({
    data: {
      companyId: company.id,
      creditType: "TALENT_CONTACT",
      fundingSource: "ADMIN_GRANT",
      periodStart,
      periodEnd,
    },
  });
  const grant = await db().creditLedgerEntry.create({
    data: {
      accountId: creditAccount.id,
      fundingSource: "ADMIN_GRANT",
      kind: "GRANT",
      amount: 1,
      validFrom: periodStart,
      validTo: periodEnd,
      idempotencyKey: `eligibility-grant-${localSequence}`,
      reasonCode: "INTEGRATION_TEST_FIXTURE",
      actorUserId: adminUserId,
      createdAt: new Date(contactCreatedAt.getTime() - 1_000),
    },
  });
  const consume = await db().creditLedgerEntry.create({
    data: {
      accountId: creditAccount.id,
      fundingSource: "ADMIN_GRANT",
      kind: "CONSUME",
      amount: -1,
      consumedGrantEntryId: grant.id,
      validFrom: periodStart,
      validTo: periodEnd,
      idempotencyKey: `eligibility-consume-${localSequence}`,
      reasonCode: "TALENT_CONTACT_REQUEST",
      actorUserId: requestingUser.id,
      createdAt: contactCreatedAt,
    },
  });
  const contactRequest = await db().employerContactRequest.create({
    data: {
      companyId: company.id,
      candidateProfileId: candidateProfile.id,
      radarSearchSessionId: searchSession.id,
      requestingUserId: requestingUser.id,
      creditLedgerEntryId: consume.id,
      subject: "Privacy-safe contact request",
      messagePreview: "Would you like to discuss this anonymous opportunity?",
      idempotencyKey: `eligibility-contact-${localSequence}`,
      commandFingerprint: createHash("sha256")
        .update(`eligibility-contact-command:${localSequence}`, "utf8")
        .digest("hex"),
      status: "PENDING",
      fundingSource: "ADMIN_GRANT",
      clusterPolicyVersion: "radar-privacy-v1",
      cantonBucketSnapshot: "ZH",
      categoryBucketSnapshot: "software-engineering",
      expiresAt: new Date(contactCreatedAt.getTime() + 14 * DAY),
      createdAt: contactCreatedAt,
      updatedAt: contactCreatedAt,
    },
  });
  await db().contactRequestEvent.create({
    data: {
      contactRequestId: contactRequest.id,
      kind: "CREATED",
      actorUserId: requestingUser.id,
      reasonCode: "CONTACT_REQUEST_CREATED",
      correlationId: randomUUID(),
      idempotencyKey: `eligibility-created-${localSequence}`,
      createdAt: contactCreatedAt,
    },
  });

  return Object.freeze({
    candidateProfileId: candidateProfile.id,
    candidateUserId: candidateUser.id,
    companyId: company.id,
    contactRequestId: contactRequest.id,
    creditAccountId: creditAccount.id,
    mappingId: mapping.id,
    requestingUserId: requestingUser.id,
    verificationRequestId: verificationRequest.id,
  });
}

async function createReport(
  targetType: "COMPANY" | "USER",
  targetId: string,
): Promise<string> {
  const report = await db().abuseReport.create({
    data: {
      targetType,
      targetId,
      reporterUserId: adminUserId,
      reasonCode: "PHASE_14_ELIGIBILITY_TEST",
      description: "Bounded integration fixture for a confirmed eligibility loss.",
      severity: "HIGH",
      status: "OPEN",
      dueAt: new Date(NOW.getTime() + 4 * 3_600_000),
      createdAt: new Date(NOW.getTime() - 1_000),
      updatedAt: new Date(NOW.getTime() - 1_000),
    },
  });
  return report.id;
}

function adminDependencies(): AdminDependencies {
  return Object.freeze({
    actor: Object.freeze({
      userId: adminUserId,
      email: "phase14-eligibility-admin@example.test",
      role: "ADMIN",
      status: "ACTIVE",
    }),
    correlationId: randomUUID(),
    database: db(),
    now: NOW,
  });
}

function db(): DatabaseClient {
  if (database === undefined) throw new Error("Test database is not ready.");
  return database;
}

function requireSuccess<T>(
  result: Readonly<{ ok: true; value: T } | { ok: false; code: string }>,
): Readonly<{ ok: true; value: T }> {
  if (!result.ok) throw new Error(`Expected success, received ${result.code}.`);
  return result;
}
