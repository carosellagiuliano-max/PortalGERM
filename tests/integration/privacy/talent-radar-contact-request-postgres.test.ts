import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { RADAR_CONSENT_NOTICE_V1 } from "@/lib/privacy/radar-consent";
import type { RadarOpaqueKey } from "@/lib/privacy/radar-opaque";
import {
  cancelEmployerContactRequest,
  declineContactRequest,
  expireContactRequest,
  isContactRequestEffectiveAt,
} from "@/lib/talentradar/contact-requests";
import {
  getRadarOpaqueEpoch,
  mintRadarOpaqueIdForAuthorizedDto,
} from "@/lib/talentradar/opaque-id";
import { isCurrentRadarContactCohortAuthorized } from "@/lib/talentradar/list-candidates";
import {
  RADAR_PRIVACY_POLICY_V1,
  normalizeRadarFiltersV1,
} from "@/lib/talentradar/privacy-policy-v1";
import {
  TALENT_CONTACT_POLICY_V1,
  createPrismaRadarContactProofPort,
  sendContactRequest,
  signRadarContactSearchSessionProof,
  type EmployerRadarContactActor,
  type RadarContactRateLimitPort,
  type SendContactRequestInput,
} from "@/lib/talentradar/request-contact";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const DAY = 86_400_000;
const MINUTE = 60_000;
const NOW = new Date(Math.floor((Date.now() - MINUTE) / 1_000) * 1_000);
const SESSION_SECRET = Buffer.alloc(32, 0x31).toString("base64");
const LOOKUP_KEYS = Object.freeze([
  Object.freeze({
    version: "contact-lookup-v1",
    secret: Buffer.alloc(32, 0x32).toString("base64"),
  }),
]) satisfies readonly RadarOpaqueKey[];
const ENCRYPTION_KEYS = Object.freeze([
  Object.freeze({
    version: "contact-encryption-v1",
    secret: Buffer.alloc(32, 0x33).toString("base64"),
  }),
]) satisfies readonly RadarOpaqueKey[];
const SESSION_SIGNING_KEY = Object.freeze({
  withValue<TResult>(consumer: (secret: string) => TResult): TResult {
    return consumer(SESSION_SECRET);
  },
});
const PROOF_PORT = createPrismaRadarContactProofPort({
  sessionSigningKey: SESSION_SIGNING_KEY,
  opaqueLookupKeyring: LOOKUP_KEYS,
  opaqueEncryptionKeyring: ENCRYPTION_KEYS,
});
const ALLOW_RATE_LIMIT = Object.freeze({
  async consume() {
    return Object.freeze({ allowed: true as const });
  },
}) satisfies RadarContactRateLimitPort;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let sequence = 0;
let shared: SharedFixture | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase14_talent_radar_contact");
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

describe.sequential("Phase 14 Talent Radar ContactRequest transaction", () => {
  it("uses a signed member/company SearchSession proof, consumes exactly one Credit and replays after the last Credit", async () => {
    const employer = await createEmployerFixture("success-replay");
    const grantId = await createAdminGrant(employer, 1);
    const candidate = await createCandidateProof(employer, "success-replay");
    const input = contactInput(candidate, "success-replay-v1");

    const proofPrecondition = await db().$transaction((transaction) =>
      PROOF_PORT.authorizeForContact(
        {
          actorUserId: employer.actor.userId,
          companyId: employer.companyId,
          membershipId: employer.actor.membershipId,
          opaqueCandidateId: candidate.opaqueCandidateId,
          signedSearchSession: candidate.signedSearchSession,
          now: NOW,
        },
        transaction,
      ),
    );
    expect(proofPrecondition).toMatchObject({ ok: true });
    const cohortPrecondition = await isCurrentRadarContactCohortAuthorized(db(), {
      filters: normalizeRadarFiltersV1({}).filters,
      now: NOW,
      environment: "test",
      candidateProfileId: candidate.candidateProfileId,
    });
    expect(cohortPrecondition).toBe(true);

    const first = await send(input, employer, NOW);
    expect(first).toEqual({
      ok: true,
      value: {
        requestId: expect.any(String),
        status: "PENDING",
        expiresAt: new Date(
          NOW.getTime() + TALENT_CONTACT_POLICY_V1.requestLifetimeMilliseconds,
        ),
        fundingSource: "ADMIN_GRANT",
      },
    });
    if (!first.ok) throw new Error("Expected the first ContactRequest to succeed.");

    const persisted = await db().employerContactRequest.findUniqueOrThrow({
      where: { id: first.value.requestId },
      include: {
        creditLedgerEntry: true,
        events: true,
      },
    });
    expect(persisted).toMatchObject({
      companyId: employer.companyId,
      candidateProfileId: candidate.candidateProfileId,
      radarSearchSessionId: candidate.searchSessionId,
      requestingUserId: employer.actor.userId,
      subject: input.subject,
      messagePreview: input.messagePreview,
      status: "PENDING",
      fundingSource: "ADMIN_GRANT",
      clusterPolicyVersion: RADAR_PRIVACY_POLICY_V1.version,
      cantonBucketSnapshot: "ZH",
      categoryBucketSnapshot: "software-engineering",
      terminalAt: null,
      creditLedgerEntry: {
        amount: -1,
        kind: "CONSUME",
        consumedGrantEntryId: grantId,
        fundingSource: "ADMIN_GRANT",
      },
      events: [
        expect.objectContaining({
          kind: "CREATED",
          actorUserId: employer.actor.userId,
        }),
      ],
    });
    await expect(
      db().creditLedgerEntry.aggregate({
        where: { account: { companyId: employer.companyId } },
        _sum: { amount: true },
      }),
    ).resolves.toEqual({ _sum: { amount: 0 } });
    await expect(
      db().conversation.count({ where: { contactRequestId: persisted.id } }),
    ).resolves.toBe(0);
    await expect(
      db().identityRevealGrant.count({
        where: { contactRequestId: persisted.id },
      }),
    ).resolves.toBe(0);

    const notification = await db().notification.findFirstOrThrow({
      where: {
        recipientUserId: candidate.candidateUserId,
        kind: "CONTACT_REQUEST_RECEIVED",
      },
    });
    expect(notification.payload).toEqual({
      requestId: persisted.id,
      status: "PENDING",
    });
    const email = await db().emailLog.findFirstOrThrow({
      where: {
        recipient: candidate.email,
        templateKey: "talent_contact_request_received",
      },
    });
    expect(email).toMatchObject({
      purpose: "talent_contact_request_received",
      status: "MOCK_RECORDED",
    });
    const auditRows = await db().auditLog.findMany({
      where: { companyId: employer.companyId },
      orderBy: { createdAt: "asc" },
    });
    expect(auditRows.map(({ action }) => action)).toEqual([
      "CREDITS_CONSUMED",
      "CONTACT_REQUEST_SENT",
    ]);
    const operationalEvidence = JSON.stringify({
      notification,
      email: { ...email, recipient: "[recipient-required-for-delivery]" },
      auditRows,
    });
    for (const forbidden of [
      candidate.firstName,
      candidate.lastName,
      candidate.email,
      candidate.candidateProfileId,
      candidate.opaqueCandidateId,
      input.subject,
      input.messagePreview,
    ]) {
      expect(operationalEvidence).not.toContain(forbidden);
    }

    const replay = await send(
      input,
      employer,
      new Date(NOW.getTime() + 1_000),
    );
    expect(replay).toEqual({ ...first, replay: true });
    await expect(
      db().employerContactRequest.count({
        where: { companyId: employer.companyId },
      }),
    ).resolves.toBe(1);
    await expect(
      db().creditLedgerEntry.count({
        where: { account: { companyId: employer.companyId }, kind: "CONSUME" },
      }),
    ).resolves.toBe(1);
    await expect(
      db().notification.count({
        where: {
          recipientUserId: candidate.candidateUserId,
          kind: "CONTACT_REQUEST_RECEIVED",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      db().emailLog.count({ where: { recipient: candidate.email } }),
    ).resolves.toBe(1);

    const differentTarget = await createCandidateProof(
      employer,
      "success-replay-conflicting-target",
    );
    const differentSession = await createSearchProof({
      employer,
      candidateProfileId: differentTarget.candidateProfileId,
      candidateUserId: differentTarget.candidateUserId,
      email: differentTarget.email,
      firstName: differentTarget.firstName,
      lastName: differentTarget.lastName,
      opaqueCandidateId: differentTarget.opaqueCandidateId,
      suffix: "success-replay-conflicting-session",
      filters: { remotePreference: "HYBRID" },
      at: NOW,
    });
    await expect(
      send(
        {
          ...input,
          opaqueCandidateId: differentSession.opaqueCandidateId,
          signedSearchSession: differentSession.signedSearchSession,
        },
        employer,
        new Date(NOW.getTime() + 2_000),
      ),
    ).resolves.toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      db().employerContactRequest.count({
        where: { companyId: employer.companyId },
      }),
    ).resolves.toBe(1);
    await expect(
      db().creditLedgerEntry.count({
        where: { account: { companyId: employer.companyId }, kind: "CONSUME" },
      }),
    ).resolves.toBe(1);
  });

  it("requires an ACTIVE company/member, exactly one VERIFIED request and Talent Radar entitlement before proof use", async () => {
    const inactive = await createEmployerFixture("inactive-gate");
    await createAdminGrant(inactive, 1);
    const inactiveCandidate = await createCandidateProof(
      inactive,
      "inactive-gate",
    );
    await db().company.update({
      where: { id: inactive.companyId },
      data: { status: "SUSPENDED" },
    });

    const unverified = await createEmployerFixture("verification-gate", {
      verified: false,
    });
    await createAdminGrant(unverified, 1);
    const unverifiedCandidate = await createCandidateProof(
      unverified,
      "verification-gate",
    );

    const unentitled = await createEmployerFixture("entitlement-gate", {
      entitled: false,
    });
    await createAdminGrant(unentitled, 1);
    const unentitledCandidate = await createCandidateProof(
      unentitled,
      "entitlement-gate",
    );

    await expect(
      send(contactInput(inactiveCandidate, "inactive-gate-v1"), inactive, NOW),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(
      send(
        contactInput(unverifiedCandidate, "verification-gate-v1"),
        unverified,
        NOW,
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(
      send(
        contactInput(unentitledCandidate, "entitlement-gate-v1"),
        unentitled,
        NOW,
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });

    for (const employer of [inactive, unverified, unentitled]) {
      await expect(
        db().employerContactRequest.count({
          where: { companyId: employer.companyId },
        }),
      ).resolves.toBe(0);
      await expect(
        db().creditLedgerEntry.count({
          where: {
            account: { companyId: employer.companyId },
            kind: "CONSUME",
          },
        }),
      ).resolves.toBe(0);
    }
  });

  it("serializes two different candidates against balance one to one request and one LIMIT", async () => {
    const employer = await createEmployerFixture("parallel-one");
    await createAdminGrant(employer, 1);
    const firstCandidate = await createCandidateProof(
      employer,
      "parallel-one-a",
    );
    const secondCandidate = await createCandidateProof(
      employer,
      "parallel-one-b",
    );
    const results = await Promise.all([
      send(contactInput(firstCandidate, "parallel-contact-a"), employer, NOW),
      send(contactInput(secondCandidate, "parallel-contact-b"), employer, NOW),
    ]);

    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results.filter(({ ok }) => !ok)).toEqual([
      {
        ok: false,
        code: "LIMIT",
        suggestedProductSlug: "contact-pack-10",
      },
    ]);
    await expect(
      db().employerContactRequest.count({
        where: { companyId: employer.companyId },
      }),
    ).resolves.toBe(1);
    await expect(
      db().creditLedgerEntry.count({
        where: { account: { companyId: employer.companyId }, kind: "CONSUME" },
      }),
    ).resolves.toBe(1);
    await expect(
      db().auditLog.count({
        where: {
          companyId: employer.companyId,
          action: "CREDITS_CONSUMED",
        },
      }),
    ).resolves.toBe(1);
  });

  it("funds in plan then purchased pack then admin order and ignores an expired Grant", async () => {
    const employer = await createEmployerFixture("funding-order");
    const expiredGrantId = await createAdminGrant(employer, 1, {
      periodStart: new Date(NOW.getTime() - 10 * DAY),
      periodEnd: NOW,
    });
    const planGrantId = await createPlanGrant(employer, 1);
    const purchasedGrantId = await createPurchasedGrant(employer, 1);
    const adminGrantId = await createAdminGrant(employer, 1);
    const candidates = [];
    for (const suffix of ["plan", "pack", "admin"]) {
      candidates.push(
        await createCandidateProof(employer, `funding-order-${suffix}`),
      );
    }

    const results = [];
    for (const [index, candidate] of candidates.entries()) {
      results.push(
        await send(
          contactInput(candidate, `funding-order-${index + 1}`),
          employer,
          new Date(NOW.getTime() + index * 1_000),
        ),
      );
    }
    expect(
      results.map((result) => (result.ok ? result.value.fundingSource : result)),
    ).toEqual(["PLAN_ALLOWANCE", "PURCHASED_PACK", "ADMIN_GRANT"]);

    const requestIds = results.map((result) => {
      if (!result.ok) throw new Error(`Funding-order request failed: ${result.code}`);
      return result.value.requestId;
    });
    const requests = await db().employerContactRequest.findMany({
      where: { id: { in: requestIds } },
      include: { creditLedgerEntry: true },
    });
    const consumedByRequest = new Map(
      requests.map((request) => [
        request.id,
        request.creditLedgerEntry.consumedGrantEntryId,
      ]),
    );
    expect(requestIds.map((id) => consumedByRequest.get(id))).toEqual([
      planGrantId,
      purchasedGrantId,
      adminGrantId,
    ]);
    await expect(
      db().creditLedgerEntry.count({
        where: { consumedGrantEntryId: expiredGrantId },
      }),
    ).resolves.toBe(0);
  });

  it("enforces pending duplicate and the half-open 30-day cooldown without extra consumption", async () => {
    const employer = await createEmployerFixture("cooldown");
    await createAdminGrant(employer, 3);
    const candidate = await createCandidateProof(employer, "cooldown");
    const first = await send(
      contactInput(candidate, "cooldown-first-v1"),
      employer,
      NOW,
    );
    if (!first.ok) throw new Error("Cooldown fixture request did not persist.");

    await expect(
      send(
        contactInput(candidate, "cooldown-pending-duplicate-v1"),
        employer,
        new Date(NOW.getTime() + 1_000),
      ),
    ).resolves.toEqual({ ok: false, code: "PENDING_DUPLICATE" });
    await expect(
      db().creditLedgerEntry.count({
        where: { account: { companyId: employer.companyId }, kind: "CONSUME" },
      }),
    ).resolves.toBe(1);

    const declinedAt = new Date(NOW.getTime() + MINUTE);
    await expect(
      declineContactRequest(
        {
          requestId: first.value.requestId,
          idempotencyKey: "cooldown-decline-v1",
        },
        { userId: candidate.candidateUserId },
        { database: db(), correlationId: randomUUID(), now: declinedAt },
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: "DECLINED" } });

    const beforeBoundary = new Date(
      declinedAt.getTime() +
        TALENT_CONTACT_POLICY_V1.recontactCooldownMilliseconds -
        1,
    );
    const boundary = new Date(beforeBoundary.getTime() + 1);
    const futureOpaque = await createOpaqueMapping(
      employer,
      candidate.candidateProfileId,
      beforeBoundary,
    );
    const beforeProof = await createSearchProof({
      employer,
      candidateProfileId: candidate.candidateProfileId,
      opaqueCandidateId: futureOpaque,
      suffix: "cooldown-before-boundary",
      at: beforeBoundary,
    });
    await expect(
      send(
        contactInput(beforeProof, "cooldown-before-boundary-v1"),
        employer,
        beforeBoundary,
      ),
    ).resolves.toEqual({ ok: false, code: "RECONTACT_COOLDOWN" });

    const boundaryProof = await createSearchProof({
      employer,
      candidateProfileId: candidate.candidateProfileId,
      opaqueCandidateId: futureOpaque,
      suffix: "cooldown-at-boundary",
      at: boundary,
    });
    await expect(
      send(
        contactInput(boundaryProof, "cooldown-at-boundary-v1"),
        employer,
        boundary,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: "PENDING", fundingSource: "ADMIN_GRANT" },
    });
    await expect(
      db().creditLedgerEntry.count({
        where: { account: { companyId: employer.companyId }, kind: "CONSUME" },
      }),
    ).resolves.toBe(2);
  });

  it("collapses cross-company, tampered and expired opaque mappings to NOT_FOUND", async () => {
    const owner = await createEmployerFixture("proof-owner");
    await createAdminGrant(owner, 3);
    const candidate = await createCandidateProof(owner, "proof-owner");

    const other = await createEmployerFixture("proof-other");
    await createAdminGrant(other, 1);
    const crossCompanyProof = await createSearchProof({
      employer: other,
      candidateProfileId: candidate.candidateProfileId,
      opaqueCandidateId: candidate.opaqueCandidateId,
      suffix: "cross-company-token",
      at: NOW,
    });
    await expect(
      send(
        contactInput(crossCompanyProof, "cross-company-token-v1"),
        other,
        NOW,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    const tampered = {
      ...candidate,
      opaqueCandidateId: tamperOpaqueId(candidate.opaqueCandidateId),
    };
    await expect(
      send(contactInput(tampered, "tampered-token-v1"), owner, NOW),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    const expiredAt = getRadarOpaqueEpoch(NOW).validTo;
    const expiredProof = await createSearchProof({
      employer: owner,
      candidateProfileId: candidate.candidateProfileId,
      opaqueCandidateId: candidate.opaqueCandidateId,
      suffix: "expired-token",
      at: expiredAt,
    });
    await expect(
      send(
        contactInput(expiredProof, "expired-token-v1"),
        owner,
        expiredAt,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    for (const employer of [owner, other]) {
      await expect(
        db().employerContactRequest.count({
          where: { companyId: employer.companyId },
        }),
      ).resolves.toBe(0);
      await expect(
        db().creditLedgerEntry.count({
          where: { account: { companyId: employer.companyId }, kind: "CONSUME" },
        }),
      ).resolves.toBe(0);
    }
  });

  it("uses a half-open 14-day lifetime and decline, expiry and cancel never refund Credits", async () => {
    const declined = await createTerminalFixture("terminal-decline");
    const cancelled = await createTerminalFixture("terminal-cancel");
    const expired = await createTerminalFixture("terminal-expire");
    const expiresAt = expired.request.value.expiresAt;
    const persistedBefore = await db().employerContactRequest.findUniqueOrThrow({
      where: { id: expired.request.value.requestId },
      select: { status: true, createdAt: true, expiresAt: true },
    });
    expect(
      isContactRequestEffectiveAt(
        persistedBefore,
        new Date(expiresAt.getTime() - 1),
      ),
    ).toBe(true);
    expect(isContactRequestEffectiveAt(persistedBefore, expiresAt)).toBe(false);

    await expect(
      declineContactRequest(
        {
          requestId: declined.request.value.requestId,
          idempotencyKey: "terminal-decline-transition-v1",
        },
        { userId: declined.candidate.candidateUserId },
        {
          database: db(),
          correlationId: randomUUID(),
          now: new Date(NOW.getTime() + MINUTE),
        },
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: "DECLINED" } });
    await expect(
      cancelEmployerContactRequest(
        {
          requestId: cancelled.request.value.requestId,
          idempotencyKey: "terminal-cancel-transition-v1",
        },
        cancelled.employer.actor,
        {
          database: db(),
          correlationId: randomUUID(),
          now: new Date(NOW.getTime() + MINUTE),
        },
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: "CANCELLED" } });
    await expect(
      expireContactRequest(
        {
          requestId: expired.request.value.requestId,
          idempotencyKey: "terminal-expire-before-v1",
        },
        {
          database: db(),
          correlationId: randomUUID(),
          now: new Date(expiresAt.getTime() - 1),
        },
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      expireContactRequest(
        {
          requestId: expired.request.value.requestId,
          idempotencyKey: "terminal-expire-at-v1",
        },
        { database: db(), correlationId: randomUUID(), now: expiresAt },
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: "EXPIRED" } });
    const terminalAudits = await db().auditLog.findMany({
      where: {
        targetId: {
          in: [
            declined.request.value.requestId,
            cancelled.request.value.requestId,
            expired.request.value.requestId,
          ],
        },
        action: {
          in: [
            "CONTACT_REQUEST_DECLINED",
            "CONTACT_REQUEST_CANCELLED",
            "CONTACT_REQUEST_EXPIRED",
          ],
        },
      },
      select: { action: true, targetId: true, targetType: true },
    });
    expect(terminalAudits).toEqual(
      expect.arrayContaining([
        {
          action: "CONTACT_REQUEST_DECLINED",
          targetId: declined.request.value.requestId,
          targetType: "CONTACT_REQUEST",
        },
        {
          action: "CONTACT_REQUEST_CANCELLED",
          targetId: cancelled.request.value.requestId,
          targetType: "CONTACT_REQUEST",
        },
        {
          action: "CONTACT_REQUEST_EXPIRED",
          targetId: expired.request.value.requestId,
          targetType: "CONTACT_REQUEST",
        },
      ]),
    );

    for (const fixture of [declined, cancelled, expired]) {
      await expect(
        db().creditLedgerEntry.count({
          where: {
            account: { companyId: fixture.employer.companyId },
            kind: "CONSUME",
          },
        }),
      ).resolves.toBe(1);
      await expect(
        db().creditLedgerEntry.count({
          where: {
            account: { companyId: fixture.employer.companyId },
            kind: "REVERSAL",
          },
        }),
      ).resolves.toBe(0);
      await expect(
        db().creditLedgerEntry.aggregate({
          where: { account: { companyId: fixture.employer.companyId } },
          _sum: { amount: true },
        }),
      ).resolves.toEqual({ _sum: { amount: 0 } });
      await expect(
        db().conversation.count({
          where: { contactRequestId: fixture.request.value.requestId },
        }),
      ).resolves.toBe(0);
      await expect(
        db().identityRevealGrant.count({
          where: { contactRequestId: fixture.request.value.requestId },
        }),
      ).resolves.toBe(0);
    }
  });
});

type SharedFixture = Readonly<{
  adminUserId: string;
  cantonId: string;
  cityId: string;
  categoryId: string;
  skillId: string;
  proPlanVersionId: string;
  contactProductVersionId: string;
  taxRateVersionId: string;
}>;

type EmployerFixture = Readonly<{
  companyId: string;
  companyName: string;
  actor: EmployerRadarContactActor;
  subscriptionId: string | null;
  subscriptionStart: Date | null;
  subscriptionEnd: Date | null;
}>;

type CandidateProofFixture = Readonly<{
  candidateUserId: string;
  candidateProfileId: string;
  email: string;
  firstName: string;
  lastName: string;
  opaqueCandidateId: string;
  signedSearchSession: string;
  searchSessionId: string;
}>;

type SuccessfulRequest = Extract<
  Awaited<ReturnType<typeof sendContactRequest>>,
  { ok: true }
>;

async function seedSharedFixture(client: DatabaseClient): Promise<SharedFixture> {
  const admin = await client.user.create({
    data: {
      email: "phase14-contact-admin@example.test",
      emailNormalized: "phase14-contact-admin@example.test",
      role: "ADMIN",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
    },
  });
  const canton = await client.canton.create({
    data: {
      code: "ZH",
      name: "Zürich Contact Integration",
      slug: "zurich-contact-integration",
      language: "DE",
    },
  });
  const city = await client.city.create({
    data: {
      cantonId: canton.id,
      name: "Zürich Contact Integration",
      slug: "zurich-contact-integration-city",
    },
  });
  const skill = await client.skill.create({
    data: {
      name: "Phase 14 Contact Engineering",
      slug: "phase-14-contact-engineering",
    },
  });
  const category = await client.category.create({
    data: {
      name: "Phase 14 Software Engineering",
      slug: "software-engineering",
      isActive: true,
    },
  });
  await seedBaselineRadarCohort(client, {
    cantonId: canton.id,
    categoryId: category.id,
    skillId: skill.id,
  });
  const freeVersion = await createPlanVersion(client, {
    code: "PHASE14_CONTACT_FREE",
    name: "Phase 14 Contact Free",
    isDefaultFree: true,
    radarAccess: false,
    contactAllowance: 0,
  });
  const proVersion = await createPlanVersion(client, {
    code: "PHASE14_CONTACT_PRO",
    name: "Phase 14 Contact Pro",
    isDefaultFree: false,
    radarAccess: true,
    contactAllowance: 50,
  });
  if (freeVersion.length === 0) {
    throw new Error("The default plan fixture was not created.");
  }

  const product = await client.product.create({
    data: {
      code: "PHASE14_CONTACT_PACK_ONE",
      name: "Phase 14 Contact Pack One",
      type: "CONTACT_PACK",
    },
  });
  const productVersion = await client.productVersion.create({
    data: {
      productId: product.id,
      version: 1,
      status: "DRAFT",
      netPriceRappen: 100,
      currency: "CHF",
      creditType: "TALENT_CONTACT",
      creditAmount: 1,
      isPublic: false,
      isSelfService: false,
      validFrom: new Date(NOW.getTime() - DAY),
    },
  });
  await client.productVersion.update({
    where: { id: productVersion.id },
    data: { status: "ACTIVE" },
  });
  const taxRate = await client.taxRateVersion.create({
    data: {
      jurisdiction: "CH",
      taxType: "MWST_PHASE14_CONTACT",
      rateBasisPoints: 0,
      validFrom: new Date(NOW.getTime() - 30 * DAY),
      source: "Phase 14 isolated ContactRequest test fixture",
      reviewStatus: "APPROVED",
      reviewedByUserId: admin.id,
      reviewedAt: NOW,
    },
  });
  return Object.freeze({
    adminUserId: admin.id,
    cantonId: canton.id,
    cityId: city.id,
    categoryId: category.id,
    skillId: skill.id,
    proPlanVersionId: proVersion,
    contactProductVersionId: productVersion.id,
    taxRateVersionId: taxRate.id,
  });
}

async function seedBaselineRadarCohort(
  client: DatabaseClient,
  input: Readonly<{
    cantonId: string;
    categoryId: string;
    skillId: string;
  }>,
): Promise<void> {
  for (
    let index = 0;
    index < RADAR_PRIVACY_POLICY_V1.cohort.minimumSize;
    index += 1
  ) {
    const email = `phase14-contact-cohort-${index}@example.test`;
    const user = await client.user.create({
      data: {
        email,
        emailNormalized: email,
        role: "CANDIDATE",
        status: "ACTIVE",
        dataProvenance: "LIVE",
        emailVerifiedAt: NOW,
      },
    });
    const candidate = await client.candidateProfile.create({
      data: {
        userId: user.id,
        cantonId: input.cantonId,
        firstName: `Cohort${index}`,
        lastName: "Candidate",
        publicDisplayName: `Cohort Candidate ${index}`,
        onboardingStatus: "DRAFT",
      },
    });
    await client.$transaction(async (transaction) => {
      const preference = await transaction.candidatePreference.create({
        data: {
          candidateProfileId: candidate.id,
          desiredTitles: ["Software Engineer"],
          desiredJobTypes: ["PERMANENT"],
          workloadMin: 80,
          workloadMax: 100,
          remotePreference: "HYBRID",
        },
      });
      await transaction.candidatePreferenceCategory.create({
        data: {
          candidatePreferenceId: preference.id,
          categoryId: input.categoryId,
        },
      });
      await transaction.candidateSkill.create({
        data: {
          candidateProfileId: candidate.id,
          skillId: input.skillId,
          level: 4,
          years: 5,
        },
      });
      await transaction.candidateLanguage.create({
        data: {
          candidateProfileId: candidate.id,
          code: "de",
          level: "C1",
        },
      });
      await transaction.candidateProfile.update({
        where: { id: candidate.id },
        data: { onboardingStatus: "COMPLETE" },
      });
    });
    await client.candidateConsent.create({
      data: {
        candidateProfileId: candidate.id,
        kind: RADAR_CONSENT_NOTICE_V1.kind,
        granted: true,
        noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
        noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
        actorUserId: user.id,
        effectiveAt: new Date(NOW.getTime() - 30_000),
      },
    });
    await client.radarProfile.create({
      data: {
        candidateProfileId: candidate.id,
        displayLabel: `Anonymous cohort profile ${index}`,
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
        skillSlugs: ["phase-14-contact-engineering"],
        publishedAt: new Date(NOW.getTime() - 10_000),
        withdrawnAt: null,
        projectionVersion: "v1",
        projectionHash: createHash("sha256")
          .update(`phase14-contact-cohort:${index}`, "utf8")
          .digest("hex"),
      },
    });
  }
}

async function createPlanVersion(
  client: DatabaseClient,
  input: Readonly<{
    code: string;
    name: string;
    isDefaultFree: boolean;
    radarAccess: boolean;
    contactAllowance: number;
  }>,
): Promise<string> {
  const plan = await client.plan.create({
    data: {
      code: input.code,
      name: input.name,
      isDefaultFree: input.isDefaultFree,
    },
  });
  const version = await client.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: input.isDefaultFree ? 0 : 5_000,
      monthlyEquivalentRappen: input.isDefaultFree ? 0 : 5_000,
      currency: "CHF",
      validFrom: new Date(NOW.getTime() - 365 * DAY),
    },
  });
  await client.planEntitlement.createMany({
    data: [
      integerEntitlement(version.id, "ACTIVE_JOB_LIMIT", 1),
      integerEntitlement(version.id, "SEAT_LIMIT", 5),
      booleanEntitlement(
        version.id,
        "TALENT_RADAR_ACCESS",
        input.radarAccess,
      ),
      integerEntitlement(
        version.id,
        "TALENT_CONTACT_ALLOWANCE",
        input.contactAllowance,
      ),
      integerEntitlement(version.id, "JOB_BOOST_ALLOWANCE", 0),
      {
        planVersionId: version.id,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        analyticsLevelValue: "BASIC",
      },
      booleanEntitlement(version.id, "ENHANCED_COMPANY_PROFILE", false),
      booleanEntitlement(version.id, "EMPLOYER_IMPORT_ACCESS", false),
    ],
  });
  await client.planVersion.update({
    where: { id: version.id },
    data: { status: "ACTIVE" },
  });
  return version.id;
}

function integerEntitlement(
  planVersionId: string,
  key: "ACTIVE_JOB_LIMIT" | "SEAT_LIMIT" | "TALENT_CONTACT_ALLOWANCE" | "JOB_BOOST_ALLOWANCE",
  integerValue: number,
) {
  return {
    planVersionId,
    key,
    valueType: "INTEGER" as const,
    integerValue,
  };
}

function booleanEntitlement(
  planVersionId: string,
  key:
    | "TALENT_RADAR_ACCESS"
    | "ENHANCED_COMPANY_PROFILE"
    | "EMPLOYER_IMPORT_ACCESS",
  booleanValue: boolean,
) {
  return {
    planVersionId,
    key,
    valueType: "BOOLEAN" as const,
    booleanValue,
  };
}

async function createEmployerFixture(
  suffix: string,
  options: Readonly<{ verified?: boolean; entitled?: boolean }> = {},
): Promise<EmployerFixture> {
  const fixture = requireShared();
  const localSequence = ++sequence;
  const normalizedSuffix = suffix.replaceAll(/[^a-z0-9]+/giu, "-").toLowerCase();
  const email = `phase14-contact-employer-${localSequence}@example.test`;
  const user = await db().user.create({
    data: {
      email,
      emailNormalized: email,
      role: "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "LIVE",
      emailVerifiedAt: NOW,
    },
  });
  const companyName = `Phase 14 Contact ${localSequence} AG`;
  const company = await db().company.create({
    data: {
      name: companyName,
      slug: `phase-14-contact-${normalizedSuffix}-${localSequence}`,
      industry: "Technology",
      size: "10-49",
      website: `https://contact-${localSequence}.example.test`,
      about: "Complete isolated employer for Talent Radar ContactRequest testing.",
      values: ["Privacy"],
      benefits: ["Testing"],
      dataProvenance: "TEST",
    },
  });
  await db().companyLocation.create({
    data: {
      companyId: company.id,
      cantonId: fixture.cantonId,
      cityId: fixture.cityId,
      address: "Teststrasse 14",
      postalCode: "8000",
      isPrimary: true,
    },
  });
  const membership = await db().companyMembership.create({
    data: {
      companyId: company.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  await db().company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
  await db().companyVerificationRequest.create({
    data: {
      companyId: company.id,
      requestedByUserId: user.id,
      status: options.verified === false ? "DRAFT" : "VERIFIED",
    },
  });

  let subscriptionId: string | null = null;
  let subscriptionStart: Date | null = null;
  let subscriptionEnd: Date | null = null;
  if (options.entitled !== false) {
    subscriptionStart = new Date(NOW.getTime() - DAY);
    subscriptionEnd = new Date(NOW.getTime() + 120 * DAY);
    const subscription = await db().employerSubscription.create({
      data: {
        companyId: company.id,
        planVersionId: fixture.proPlanVersionId,
        status: "ACTIVE",
        currentPeriodStart: subscriptionStart,
        currentPeriodEnd: subscriptionEnd,
        billingIntervalSnapshot: "MONTHLY",
        termMonthsSnapshot: 1,
        recurringNetRappenSnapshot: 5_000,
        monthlyEquivalentRappenSnapshot: 5_000,
        currencySnapshot: "CHF",
        activatedAt: subscriptionStart,
      },
    });
    subscriptionId = subscription.id;
  }

  return Object.freeze({
    companyId: company.id,
    companyName,
    actor: Object.freeze({
      userId: user.id,
      companyId: company.id,
      membershipId: membership.id,
    }),
    subscriptionId,
    subscriptionStart,
    subscriptionEnd,
  });
}

async function createCandidateProof(
  employer: EmployerFixture,
  suffix: string,
): Promise<CandidateProofFixture> {
  const fixture = requireShared();
  const localSequence = ++sequence;
  const email = `phase14-contact-candidate-${localSequence}@example.test`;
  const firstName = `Contact${localSequence}`;
  const lastName = "Candidate";
  const user = await db().user.create({
    data: {
      email,
      emailNormalized: email,
      role: "CANDIDATE",
      status: "ACTIVE",
      dataProvenance: "LIVE",
      emailVerifiedAt: NOW,
    },
  });
  const candidate = await db().candidateProfile.create({
    data: {
      userId: user.id,
      cantonId: fixture.cantonId,
      firstName,
      lastName,
      publicDisplayName: `${firstName} ${lastName}`,
      phone: "+41791234567",
      onboardingStatus: "DRAFT",
    },
  });
  await db().$transaction(async (transaction) => {
    const preference = await transaction.candidatePreference.create({
      data: {
        candidateProfileId: candidate.id,
        desiredTitles: ["Software Engineer"],
        desiredJobTypes: ["PERMANENT"],
        workloadMin: 80,
        workloadMax: 100,
        remotePreference: "HYBRID",
      },
    });
    await transaction.candidatePreferenceCategory.create({
      data: {
        candidatePreferenceId: preference.id,
        categoryId: fixture.categoryId,
      },
    });
    await transaction.candidateSkill.create({
      data: {
        candidateProfileId: candidate.id,
        skillId: fixture.skillId,
        level: 4,
        years: 5,
      },
    });
    await transaction.candidateLanguage.create({
      data: {
        candidateProfileId: candidate.id,
        code: "de",
        level: "C1",
      },
    });
    await transaction.candidateProfile.update({
      where: { id: candidate.id },
      data: { onboardingStatus: "COMPLETE" },
    });
  });
  await db().candidateConsent.create({
    data: {
      candidateProfileId: candidate.id,
      kind: RADAR_CONSENT_NOTICE_V1.kind,
      granted: true,
      noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
      noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
      actorUserId: user.id,
      effectiveAt: new Date(NOW.getTime() - 30_000),
    },
  });
  await db().radarProfile.create({
    data: {
      candidateProfileId: candidate.id,
      displayLabel: `Anonymous profile ${localSequence}`,
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
      skillSlugs: ["phase-14-contact-engineering"],
      publishedAt: new Date(NOW.getTime() - 10_000),
      withdrawnAt: null,
      projectionVersion: "v1",
      projectionHash: createHash("sha256")
        .update(`phase14-contact-radar-${localSequence}`, "utf8")
        .digest("hex"),
    },
  });
  const opaqueCandidateId = await createOpaqueMapping(
    employer,
    candidate.id,
    NOW,
  );
  return createSearchProof({
    employer,
    candidateProfileId: candidate.id,
    candidateUserId: user.id,
    email,
    firstName,
    lastName,
    opaqueCandidateId,
    suffix,
    at: NOW,
  });
}

async function createOpaqueMapping(
  employer: EmployerFixture,
  candidateProfileId: string,
  at: Date,
): Promise<string> {
  const issued = mintRadarOpaqueIdForAuthorizedDto({
    candidateProfileId,
    companyId: employer.companyId,
    now: at,
    lookupKeyring: LOOKUP_KEYS,
    encryptionKeyring: ENCRYPTION_KEYS,
  });
  await db().radarOpaqueMapping.create({
    data: {
      ...issued.mapping,
      encryptedToken: Buffer.from(issued.mapping.encryptedToken),
      nonce: Buffer.from(issued.mapping.nonce),
      authTag: Buffer.from(issued.mapping.authTag),
    },
  });
  return issued.opaqueId;
}

async function createSearchProof(input: Readonly<{
  employer: EmployerFixture;
  candidateProfileId: string;
  opaqueCandidateId: string;
  suffix: string;
  at: Date;
  candidateUserId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  filters?: unknown;
}>): Promise<CandidateProofFixture> {
  const normalized = normalizeRadarFiltersV1(input.filters ?? {});
  const calendarDate = utcDateOnly(input.at);
  let session = await db().radarSearchSession.findFirst({
    where: {
      companyId: input.employer.companyId,
      membershipId: input.employer.actor.membershipId,
      filterHash: normalized.filterHash,
      calendarDate,
      policyVersion: RADAR_PRIVACY_POLICY_V1.version,
    },
  });
  if (session === null) {
    session = await db().radarSearchSession.create({
      data: {
        companyId: input.employer.companyId,
        membershipId: input.employer.actor.membershipId,
        requestingUserId: input.employer.actor.userId,
        filterHash: normalized.filterHash,
        calendarDate,
        policyVersion: RADAR_PRIVACY_POLICY_V1.version,
        normalizedFilters: normalized.filters,
        resultCount: RADAR_PRIVACY_POLICY_V1.cohort.minimumSize,
        expiresAt: new Date(input.at.getTime() + 10 * MINUTE),
        createdAt: input.at,
      },
    });
  }
  const existingEntry = await db().radarSearchSessionCandidate.findUnique({
    where: {
      radarSearchSessionId_candidateProfileId: {
        radarSearchSessionId: session.id,
        candidateProfileId: input.candidateProfileId,
      },
    },
  });
  if (existingEntry === null) {
    const position = await db().radarSearchSessionCandidate.count({
      where: { radarSearchSessionId: session.id },
    });
    await db().radarSearchSessionCandidate.create({
      data: {
        radarSearchSessionId: session.id,
        candidateProfileId: input.candidateProfileId,
        position,
      },
    });
  }
  const signedSearchSession = signRadarContactSearchSessionProof(
    {
      searchSessionId: session.id,
      actorUserId: input.employer.actor.userId,
      companyId: input.employer.companyId,
      membershipId: input.employer.actor.membershipId,
      filterHash: normalized.filterHash,
      sessionExpiresAt: session.expiresAt,
      now: input.at,
    },
    SESSION_SIGNING_KEY,
  );
  return Object.freeze({
    candidateUserId: input.candidateUserId ?? randomUUID(),
    candidateProfileId: input.candidateProfileId,
    email: input.email ?? "not-used@example.test",
    firstName: input.firstName ?? "NotUsed",
    lastName: input.lastName ?? "NotUsed",
    opaqueCandidateId: input.opaqueCandidateId,
    signedSearchSession,
    searchSessionId: session.id,
  });
}

function contactInput(
  candidate: Pick<
    CandidateProofFixture,
    "opaqueCandidateId" | "signedSearchSession"
  >,
  idempotencyKey: string,
): SendContactRequestInput {
  return {
    opaqueCandidateId: candidate.opaqueCandidateId,
    signedSearchSession: candidate.signedSearchSession,
    subject: "Gespräch über eine passende Rolle",
    messagePreview:
      "Guten Tag, wir möchten Ihnen gern eine passende Position vorstellen.",
    idempotencyKey,
  };
}

function send(
  input: SendContactRequestInput,
  employer: EmployerFixture,
  now: Date,
) {
  return sendContactRequest(input, {
    actor: employer.actor,
    correlationId: randomUUID(),
    database: db(),
    eligibilityEnvironment: "test",
    proofPort: PROOF_PORT,
    rateLimitPort: ALLOW_RATE_LIMIT,
    now,
  });
}

async function createAdminGrant(
  employer: EmployerFixture,
  amount: number,
  period: Readonly<{ periodStart: Date; periodEnd: Date }> = {
    periodStart: new Date(NOW.getTime() - DAY),
    periodEnd: new Date(NOW.getTime() + 120 * DAY),
  },
): Promise<string> {
  const account = await db().creditAccount.create({
    data: {
      companyId: employer.companyId,
      creditType: "TALENT_CONTACT",
      fundingSource: "ADMIN_GRANT",
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    },
  });
  const grant = await db().creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "ADMIN_GRANT",
      kind: "GRANT",
      amount,
      validFrom: period.periodStart,
      validTo: period.periodEnd,
      idempotencyKey: `phase14-contact-admin-grant:${account.id}`,
      reasonCode: "TEST_ADMIN_GRANT",
      actorUserId: requireShared().adminUserId,
      createdAt: period.periodStart,
    },
  });
  return grant.id;
}

async function createPlanGrant(
  employer: EmployerFixture,
  amount: number,
): Promise<string> {
  const fixture = requireShared();
  if (
    employer.subscriptionId === null ||
    employer.subscriptionStart === null ||
    employer.subscriptionEnd === null
  ) {
    throw new Error("Plan Grant requires the entitled Subscription fixture.");
  }
  const account = await db().creditAccount.create({
    data: {
      companyId: employer.companyId,
      creditType: "TALENT_CONTACT",
      fundingSource: "PLAN_ALLOWANCE",
      periodStart: employer.subscriptionStart,
      periodEnd: employer.subscriptionEnd,
    },
  });
  const grant = await db().creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "PLAN_ALLOWANCE",
      kind: "GRANT",
      amount,
      sourcePlanVersionId: fixture.proPlanVersionId,
      sourceSubscriptionId: employer.subscriptionId,
      validFrom: employer.subscriptionStart,
      validTo: employer.subscriptionEnd,
      idempotencyKey: `phase14-contact-plan-grant:${account.id}`,
      reasonCode: "SUBSCRIPTION_ALLOWANCE",
      createdAt: employer.subscriptionStart,
    },
  });
  return grant.id;
}

async function createPurchasedGrant(
  employer: EmployerFixture,
  amount: number,
): Promise<string> {
  const fixture = requireShared();
  if (amount !== 1) {
    throw new Error("The isolated Contact Pack fixture contains exactly one Credit.");
  }
  const line = await db().$transaction(async (transaction) => {
    const order = await transaction.order.create({
      data: {
        companyId: employer.companyId,
        createdByUserId: employer.actor.userId,
        status: "DRAFT",
        provider: "MOCK",
        clientIdempotencyKey: `phase14-contact-pack-client:${employer.companyId}`,
        providerIdempotencyKey: `phase14-contact-pack-provider:${employer.companyId}`,
        providerReference: `phase14-contact-pack-reference:${employer.companyId}`,
        requestFingerprint: createHash("sha256")
          .update(`phase14-contact-order:${employer.companyId}`, "utf8")
          .digest("hex"),
        billingLegalNameSnapshot: employer.companyName,
        billingContactEmailSnapshot: "billing@example.test",
        billingStreetSnapshot: "Teststrasse 14",
        billingPostalCodeSnapshot: "8000",
        billingCitySnapshot: "Zürich",
        billingCountryCodeSnapshot: "CH",
        currency: "CHF",
        netTotalRappen: 100,
        vatTotalRappen: 0,
        totalRappen: 100,
        expiresAt: new Date(NOW.getTime() + DAY),
        createdAt: new Date(NOW.getTime() - MINUTE),
      },
    });
    const orderLine = await transaction.orderLine.create({
      data: {
        orderId: order.id,
        productVersionId: fixture.contactProductVersionId,
        taxRateVersionId: fixture.taxRateVersionId,
        quantity: 1,
        unitNetRappen: 100,
        netRappen: 100,
        taxRateBasisPoints: 0,
        vatRappen: 0,
        totalRappen: 100,
        currency: "CHF",
        descriptionSnapshot: "One Talent Contact Credit",
        fulfillmentContext: "CONTACT_PACK",
        targetCreditType: "TALENT_CONTACT",
        createdAt: NOW,
      },
    });
    await transaction.order.update({
      where: { id: order.id },
      data: { status: "PENDING" },
    });
    await transaction.order.update({
      where: { id: order.id },
      data: { status: "PAID", paidAt: NOW },
    });
    return orderLine;
  });
  const periodStart = new Date(NOW.getTime() - 30_000);
  const periodEnd = new Date(NOW.getTime() + 90 * DAY);
  const account = await db().creditAccount.create({
    data: {
      companyId: employer.companyId,
      creditType: "TALENT_CONTACT",
      fundingSource: "PURCHASED_PACK",
      periodStart,
      periodEnd,
    },
  });
  const grant = await db().creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "PURCHASED_PACK",
      kind: "GRANT",
      amount,
      sourceOrderLineId: line.id,
      validFrom: periodStart,
      validTo: periodEnd,
      idempotencyKey: `phase14-contact-pack-grant:${account.id}`,
      reasonCode: "PAID_CONTACT_PACK",
      createdAt: NOW,
    },
  });
  return grant.id;
}

async function createTerminalFixture(suffix: string): Promise<Readonly<{
  employer: EmployerFixture;
  candidate: CandidateProofFixture;
  request: SuccessfulRequest;
}>> {
  const employer = await createEmployerFixture(suffix);
  await createAdminGrant(employer, 1);
  const candidate = await createCandidateProof(employer, suffix);
  const request = await send(
    contactInput(candidate, `${suffix}-request-v1`),
    employer,
    NOW,
  );
  if (!request.ok) {
    throw new Error(`Terminal fixture request failed: ${request.code}`);
  }
  return Object.freeze({ employer, candidate, request });
}

function tamperOpaqueId(value: string): string {
  const final = value.at(-1);
  if (final === undefined) throw new Error("Opaque fixture is empty.");
  return `${value.slice(0, -1)}${final === "A" ? "B" : "A"}`;
}

function utcDateOnly(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function db(): DatabaseClient {
  if (!database) throw new Error("ContactRequest integration database unavailable.");
  return database;
}

function requireShared(): SharedFixture {
  if (!shared) throw new Error("ContactRequest shared fixture unavailable.");
  return shared;
}
