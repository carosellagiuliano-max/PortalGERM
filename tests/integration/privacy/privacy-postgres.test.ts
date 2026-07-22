import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  createPostgresPrivacyRequestRepository,
  createPostgresRevealConfirmationPort,
} from "@/lib/privacy/postgres-adapters";
import { createPrivacyRequest } from "@/lib/privacy/requests";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let database: MigratedDatabase | undefined;
let firstClient: DatabaseClient | undefined;
let secondClient: DatabaseClient | undefined;

const NOW = new Date("2026-07-19T10:00:00.000Z");

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase03_privacy_atomicity");
  firstClient = createDatabaseClient(database.connectionString);
  secondClient = createDatabaseClient(database.connectionString);
});

afterAll(async () => {
  await Promise.allSettled([
    firstClient?.$disconnect() ?? Promise.resolve(),
    secondClient?.$disconnect() ?? Promise.resolve(),
  ]);
  await database?.dispose();
});

describe("PostgreSQL atomic Privacy intake", () => {
  it("serializes concurrent semantic duplicates and writes one Request/Event/Audit", async () => {
    const clients = requireClients();
    const user = await createUser(clients.first, "privacy-parallel@example.test", "CANDIDATE");
    const firstRepository = createPostgresPrivacyRequestRepository(clients.first);
    const secondRepository = createPostgresPrivacyRequestRepository(clients.second);

    const [first, second] = await Promise.all([
      createPrivacyRequest(
        { userId: user.id, userStatus: "ACTIVE" },
        exportInput("parallel-export-a"),
        NOW,
        firstRepository,
      ),
      createPrivacyRequest(
        { userId: user.id, userStatus: "ACTIVE" },
        exportInput("parallel-export-b"),
        NOW,
        secondRepository,
      ),
    ]);

    expect([first, second].filter((result) => result.ok && result.created)).toHaveLength(1);
    expect([first, second].filter((result) => result.ok && !result.created)).toHaveLength(1);
    expect(first.ok && second.ok && first.requestId === second.requestId).toBe(true);

    const requests = await clients.first.privacyRequest.findMany({
      where: { requesterUserId: user.id, type: "EXPORT" },
      include: { events: true },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.events).toHaveLength(1);
    expect(requests[0]?.events[0]).toMatchObject({
      kind: "CREATED",
      fromStatus: null,
      toStatus: "PENDING",
      actorUserId: user.id,
    });
    const audits = await clients.first.auditLog.findMany({
      where: { targetId: requests[0]?.id, action: "PRIVACY_REQUEST_CREATED" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: user.id,
      actorKind: "USER",
      targetType: "PRIVACY_REQUEST",
      result: "SUCCEEDED",
      metadata: {},
    });
  });

  it("scopes idempotency to the requester and returns each stored retry", async () => {
    const clients = requireClients();
    const firstUser = await createUser(clients.first, "privacy-idempotent-a@example.test", "CANDIDATE");
    const secondUser = await createUser(clients.first, "privacy-idempotent-b@example.test", "CANDIDATE");
    const key = "same-harmless-client-key";
    const firstRepository = createPostgresPrivacyRequestRepository(clients.first);
    const secondRepository = createPostgresPrivacyRequestRepository(clients.second);

    const [first, second] = await Promise.all([
      createPrivacyRequest(
        { userId: firstUser.id, userStatus: "ACTIVE" },
        exportInput(key),
        NOW,
        firstRepository,
      ),
      createPrivacyRequest(
        { userId: secondUser.id, userStatus: "ACTIVE" },
        exportInput(key),
        NOW,
        secondRepository,
      ),
    ]);
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: true });
    expect(first.ok && second.ok && first.requestId).not.toBe(second.ok && second.requestId);

    const retry = await createPrivacyRequest(
      { userId: firstUser.id, userStatus: "ACTIVE" },
      exportInput(key),
      new Date(NOW.getTime() + 1_000),
      firstRepository,
    );
    expect(retry).toMatchObject({
      ok: true,
      created: false,
      requestId: first.ok ? first.requestId : "",
    });
  });

  it("enforces the rolling five-case limit inside the same requester lock", async () => {
    const clients = requireClients();
    const user = await createUser(clients.first, "privacy-rate@example.test", "CANDIDATE");
    await clients.first.privacyRequest.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        requesterUserId: user.id,
        type: "EXPORT" as const,
        status: "CANCELLED" as const,
        dueAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000),
        idempotencyKey: `historic-export-${index}`,
        deletionDependencies: [],
        createdAt: new Date(NOW.getTime() - (index + 1) * 24 * 60 * 60 * 1_000),
        updatedAt: NOW,
      })),
    });

    const result = await createPrivacyRequest(
      { userId: user.id, userStatus: "ACTIVE" },
      exportInput("sixth-export-case"),
      NOW,
      createPostgresPrivacyRequestRepository(clients.first),
    );
    expect(result).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      supportPath: "/candidate/support",
    });
    await expect(clients.first.privacyRequest.count({
      where: { requesterUserId: user.id },
    })).resolves.toBe(5);
  });

  it("rolls Request and CREATED event back when Required Audit cannot commit", async () => {
    const clients = requireClients();
    const isolated = requireDatabase();
    const user = await createUser(clients.first, "privacy-audit-rollback@example.test", "CANDIDATE");
    await isolated.pool.query(`
      CREATE FUNCTION reject_privacy_created_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW."action" = 'PRIVACY_REQUEST_CREATED' THEN
          RAISE EXCEPTION 'isolated required-audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await isolated.pool.query(`
      CREATE TRIGGER reject_privacy_created_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION reject_privacy_created_audit()
    `);
    try {
      await expect(createPrivacyRequest(
        { userId: user.id, userStatus: "ACTIVE" },
        exportInput("audit-rollback-export"),
        NOW,
        createPostgresPrivacyRequestRepository(clients.first),
      )).rejects.toThrow(/Required audit write failed/i);
      await expect(clients.first.privacyRequest.count({
        where: { requesterUserId: user.id },
      })).resolves.toBe(0);
      await expect(clients.first.privacyRequestEvent.count({
        where: { actorUserId: user.id },
      })).resolves.toBe(0);
    } finally {
      await isolated.pool.query(
        'DROP TRIGGER IF EXISTS reject_privacy_created_audit_trigger ON "AuditLog"',
      );
      await isolated.pool.query("DROP FUNCTION IF EXISTS reject_privacy_created_audit() CASCADE");
    }
  });

  it("rechecks the current database User status inside the transaction", async () => {
    const clients = requireClients();
    const user = await createUser(clients.first, "privacy-suspended@example.test", "CANDIDATE");
    await clients.first.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    const result = await createPrivacyRequest(
      { userId: user.id, userStatus: "ACTIVE" },
      exportInput("stale-session-status"),
      NOW,
      createPostgresPrivacyRequestRepository(clients.first),
    );
    expect(result).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});

describe("PostgreSQL locked Reveal authorization", () => {
  it("denies cross-candidate scope and holds revocation behind the request/grant lock", async () => {
    const clients = requireClients();
    const fixture = await createRevealFixture(clients.first);
    const port = createPostgresRevealConfirmationPort(clients.first);

    const crossScopeOperation = vi.fn(async () => "should-not-run");
    await expect(port.withLockedAuthorization({
      actorUserId: fixture.employerUserId,
      contactRequestId: fixture.contactRequestId,
      conversationId: fixture.conversationId,
    }, crossScopeOperation)).resolves.toEqual({
      authorized: false,
      code: "REVEAL_CONFIRMATION_UNAVAILABLE",
    });
    expect(crossScopeOperation).not.toHaveBeenCalled();

    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    let releaseLock: (() => void) | undefined;
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockedRead = port.withLockedAuthorization({
      actorUserId: fixture.candidateUserId,
      contactRequestId: fixture.contactRequestId,
      conversationId: fixture.conversationId,
    }, async (authorization) => {
      markEntered?.();
      await release;
      return authorization.existingGrant?.revokedAt ?? null;
    });
    await entered;

    const revoke = (async () => clients.second.identityRevealGrant.update({
      where: { id: fixture.grantId },
      data: {
        revokedAt: new Date(NOW.getTime() + 1_000),
        revokedByUserId: fixture.candidateUserId,
        revokeReason: "PRIVACY_CHOICE",
      },
    }))();
    const race = await Promise.race([
      revoke.then(() => "updated" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 150)),
    ]);
    expect(race).toBe("blocked");
    releaseLock?.();
    await expect(lockedRead).resolves.toEqual({ authorized: true, value: null });
    await revoke;

    const afterRevokeOperation = vi.fn(async () => "should-not-run");
    await expect(port.withLockedAuthorization({
      actorUserId: fixture.candidateUserId,
      contactRequestId: fixture.contactRequestId,
      conversationId: fixture.conversationId,
    }, afterRevokeOperation)).resolves.toEqual({
      authorized: false,
      code: "REVEAL_CONFIRMATION_UNAVAILABLE",
    });
    expect(afterRevokeOperation).not.toHaveBeenCalled();
  });

  it("accepts exactly one unsuperseded VERIFIED Company evidence", async () => {
    const clients = requireClients();
    const fixture = await createRevealFixture(clients.first, "verification");
    const port = createPostgresRevealConfirmationPort(clients.first);
    await clients.first.companyVerificationRequest.update({
      where: { id: fixture.verificationRequestId },
      data: { status: "REVOKED" },
    });
    const currentVerification = await clients.first.companyVerificationRequest.create({
      data: {
        companyId: fixture.companyId,
        requestedByUserId: fixture.employerUserId,
        supersedesRequestId: fixture.verificationRequestId,
        status: "VERIFIED",
      },
    });
    await expect(port.withLockedAuthorization({
      actorUserId: fixture.candidateUserId,
      contactRequestId: fixture.contactRequestId,
      conversationId: fixture.conversationId,
    }, async () => "authorized")).resolves.toEqual({
      authorized: true,
      value: "authorized",
    });

    await clients.first.companyVerificationRequest.create({
      data: {
        companyId: fixture.companyId,
        requestedByUserId: fixture.employerUserId,
        status: "VERIFIED",
      },
    });
    const operation = vi.fn(async () => "should-not-run");
    await expect(port.withLockedAuthorization({
      actorUserId: fixture.candidateUserId,
      contactRequestId: fixture.contactRequestId,
      conversationId: fixture.conversationId,
    }, operation)).resolves.toEqual({
      authorized: false,
      code: "REVEAL_CONFIRMATION_UNAVAILABLE",
    });
    expect(operation).not.toHaveBeenCalled();
    expect(currentVerification.supersedesRequestId).toBe(fixture.verificationRequestId);
  });
});

function exportInput(idempotencyKey: string) {
  return {
    type: "EXPORT" as const,
    noticeVersion: "privacy-request-v1" as const,
    idempotencyKey,
  };
}

function requireClients() {
  if (!firstClient || !secondClient) throw new Error("Privacy test clients are unavailable.");
  return { first: firstClient, second: secondClient };
}

function requireDatabase() {
  if (!database) throw new Error("Privacy test database is unavailable.");
  return database;
}

async function createUser(
  client: DatabaseClient,
  email: string,
  role: "CANDIDATE" | "EMPLOYER",
) {
  return client.user.create({
    data: {
      email,
      emailNormalized: email.toLowerCase(),
      role,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
    },
  });
}

async function createRevealFixture(client: DatabaseClient, suffix = "lock") {
  const candidate = await createUser(client, `reveal-candidate-${suffix}@example.test`, "CANDIDATE");
  const employer = await createUser(client, `reveal-employer-${suffix}@example.test`, "EMPLOYER");
  const candidateProfile = await client.candidateProfile.create({
    data: {
      userId: candidate.id,
      publicDisplayName: "Reveal Candidate",
    },
  });
  const company = await client.company.create({
    data: {
      name: `Reveal ${suffix} Company`,
      slug: `reveal-${suffix}-company`,
      industry: "Technology",
      size: "11-50",
      website: `https://reveal-${suffix}.example.test`,
      about: "Complete isolated Reveal authorization test company.",
      values: [],
      benefits: [],
      dataProvenance: "TEST",
    },
  });
  const canton = await client.canton.create({
    data: {
      code: suffix === "lock" ? "ZH" : "BE",
      name: suffix === "lock" ? "Zürich" : "Bern",
      slug: `reveal-${suffix}-canton`,
      language: "DE",
    },
  });
  const city = await client.city.create({
    data: {
      cantonId: canton.id,
      name: `Reveal ${suffix} City`,
      slug: `reveal-${suffix}-city`,
    },
  });
  await client.companyLocation.create({
    data: {
      companyId: company.id,
      cantonId: canton.id,
      cityId: city.id,
      address: "Teststrasse 1",
      postalCode: "8000",
      isPrimary: true,
    },
  });
  await client.companyMembership.create({
    data: {
      companyId: company.id,
      userId: employer.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  await client.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
  const verification = await client.companyVerificationRequest.create({
    data: {
      companyId: company.id,
      requestedByUserId: employer.id,
      status: "VERIFIED",
    },
  });
  const account = await client.creditAccount.create({
    data: {
      companyId: company.id,
      creditType: "TALENT_CONTACT",
      fundingSource: "ADMIN_GRANT",
      periodStart: new Date(NOW.getTime() - DAY),
      periodEnd: new Date(NOW.getTime() + 30 * DAY),
    },
  });
  const contactCreditGrant = await client.creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "ADMIN_GRANT",
      kind: "GRANT",
      amount: 1,
      validFrom: new Date(NOW.getTime() - DAY),
      validTo: new Date(NOW.getTime() + 30 * DAY),
      idempotencyKey: `reveal-${suffix}-contact-grant`,
      actorUserId: employer.id,
    },
  });
  const ledger = await client.creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "ADMIN_GRANT",
      kind: "CONSUME",
      amount: -1,
      validFrom: new Date(NOW.getTime() - DAY),
      validTo: new Date(NOW.getTime() + 30 * DAY),
      idempotencyKey: `reveal-${suffix}-contact-consumption`,
      actorUserId: employer.id,
      consumedGrantEntryId: contactCreditGrant.id,
    },
  });
  const contactRequest = await client.employerContactRequest.create({
    data: {
      companyId: company.id,
      candidateProfileId: candidateProfile.id,
      requestingUserId: employer.id,
      creditLedgerEntryId: ledger.id,
      messagePreview: "Privacy-safe contact request",
      idempotencyKey: `reveal-${suffix}-contact-request`,
      status: "ACCEPTED",
      fundingSource: "ADMIN_GRANT",
      clusterPolicyVersion: "v1",
      cantonBucketSnapshot: "ZH",
      categoryBucketSnapshot: "software-engineering",
      expiresAt: new Date(NOW.getTime() + 14 * DAY),
      terminalAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  const conversation = await client.conversation.create({
    data: {
      companyId: company.id,
      kind: "TALENT_RADAR",
      contactRequestId: contactRequest.id,
      subject: "Reveal authorization lock",
    },
  });
  const grant = await client.$transaction(async (transaction) => {
    const created = await transaction.identityRevealGrant.create({
      data: {
        candidateProfileId: candidateProfile.id,
        companyId: company.id,
        contactRequestId: contactRequest.id,
        conversationId: conversation.id,
        noticeVersion: "identity-reveal-v1",
        confirmationSnapshotHash: "a".repeat(64),
        revealedAt: NOW,
      },
    });
    await transaction.identityRevealGrantField.create({
      data: {
        grantId: created.id,
        field: "DISPLAY_NAME",
        ciphertext: Buffer.from("encrypted-display-name"),
        nonce: Buffer.alloc(12, 1),
        authTag: Buffer.alloc(16, 2),
        encryptionKeyVersion: "test-pii-v1",
        schemaVersion: "v1",
        integrityHmac: "b".repeat(64),
      },
    });
    await transaction.identityRevealConfirmation.create({
      data: {
        grantId: created.id,
        actorUserId: candidate.id,
        contactRequestId: contactRequest.id,
        conversationId: conversation.id,
        completeFieldSet: ["DISPLAY_NAME"],
        newlyAddedFields: ["DISPLAY_NAME"],
        noticeVersion: "identity-reveal-v1",
        previewHmac: "a".repeat(64),
        idempotencyKey: `reveal-${suffix}-confirmation`,
        createdAt: NOW,
      },
    });
    return created;
  });
  return {
    candidateUserId: candidate.id,
    employerUserId: employer.id,
    contactRequestId: contactRequest.id,
    conversationId: conversation.id,
    grantId: grant.id,
    companyId: company.id,
    verificationRequestId: verification.id,
  };
}

const DAY = 24 * 60 * 60 * 1_000;
