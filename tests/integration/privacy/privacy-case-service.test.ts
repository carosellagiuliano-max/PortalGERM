import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  createPostgresPrivacyCaseService,
  PRIVACY_CASE_SERVICE_POLICY_V1,
  type PrivacyCaseAdminActor,
} from "@/lib/privacy/privacy-case-service";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-22T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1_000;

let database: MigratedDatabase | undefined;
let firstClient: DatabaseClient | undefined;
let secondClient: DatabaseClient | undefined;

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase14_privacy_case_service");
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

describe("Phase-14 persisted Privacy case service", () => {
  it("returns a bounded redacted queue and audits assigned or justified detail access", async () => {
    const client = requireClients().first;
    const fixture = await createFixture(client, "safe-read");
    const privacyCase = await createPrivacyRequest(client, fixture.requester.id, {
      type: "CORRECT",
      status: "PENDING",
      version: 3,
      assignedAdminUserId: fixture.admin.id,
      assignmentReasonCode: "PRIVACY_CASE_ASSIGNED",
      createdAt: new Date(NOW.getTime() - 5 * DAY),
      dueAt: new Date(NOW.getTime() + 4 * DAY),
    });
    await client.privacyRequestCorrectionField.create({
      data: {
        privacyRequestId: privacyCase.id,
        fieldCode: "EMAIL",
        correctionText: "CORRECTION_TEXT_CANARY must be reviewed safely.",
      },
    });

    const service = createPostgresPrivacyCaseService(client);
    await expect(
      service.listAdminQueue(
        { userId: fixture.admin.id, capabilities: [] },
        {},
        NOW,
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });

    const queue = await service.listAdminQueue(readActor(fixture.admin.id), {
      status: "PENDING",
      limit: 10,
    }, NOW);
    expect(queue).toEqual({
      ok: true,
      cases: [
        {
          id: privacyCase.id,
          type: "CORRECT",
          status: "PENDING",
          ageBucket: "FOUR_TO_SEVEN_DAYS",
          dueBucket: "DUE_WITHIN_SEVEN_DAYS",
        },
      ],
    });
    const queuePayload = JSON.stringify(queue);
    expect(queuePayload).not.toContain("CORRECTION_TEXT_CANARY");
    expect(queuePayload).not.toContain(fixture.requester.email);
    expect(queuePayload).not.toContain(fixture.requester.name!);
    expect(queuePayload).not.toContain(fixture.requester.id);
    expect(queuePayload).not.toContain("dueAt");
    expect(queuePayload).not.toContain("createdAt");

    await expect(
      service.getAdminDetail(readActor(fixture.otherAdmin.id), {
        requestId: privacyCase.id,
      }, NOW),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    const assignedDetail = await service.getAdminDetail(
      readActor(fixture.admin.id),
      { requestId: privacyCase.id },
      NOW,
    );
    expect(assignedDetail).toMatchObject({
      ok: true,
      privacyCase: {
        id: privacyCase.id,
        requesterUserId: fixture.requester.id,
        noticeVersion: "privacy-request-v1",
        correction: {
          fields: [
            {
              fieldCode: "EMAIL",
              correctionText: "CORRECTION_TEXT_CANARY must be reviewed safely.",
              reviewedAt: null,
            },
          ],
          outcomeCode: null,
          domainEventRefs: [],
        },
      },
    });
    expect(JSON.stringify(assignedDetail)).not.toContain(fixture.requester.email);
    expect(JSON.stringify(assignedDetail)).not.toContain(fixture.requester.name!);

    await expect(
      service.getAdminDetail(readActor(fixture.otherAdmin.id), {
        requestId: privacyCase.id,
        justificationCode: "SUPERVISORY_REVIEW",
      }, NOW),
    ).resolves.toMatchObject({ ok: true, privacyCase: { id: privacyCase.id } });

    const accessAudits = await client.auditLog.findMany({
      where: { targetId: privacyCase.id, action: "PRIVACY_CASE_ACCESSED" },
      orderBy: { createdAt: "asc" },
    });
    expect(accessAudits).toHaveLength(3);
    expect(accessAudits.map(({ reasonCode }) => reasonCode).sort()).toEqual([
      "ASSIGNED_CASE",
      "QUEUE_READ",
      "SUPERVISORY_REVIEW",
    ]);
    expect(
      accessAudits.every(
        (audit) =>
          audit.capability === "PRIVACY_CASE_READ" &&
          JSON.stringify(audit.metadata) === "{}",
      ),
    ).toBe(true);
  });

  it("runs the 15-minute, five-attempt identity flow and completes DELETE without erasure", async () => {
    const client = requireClients().first;
    const fixture = await createFixture(client, "delete-flow");
    const profile = await client.candidateProfile.create({
      data: {
        userId: fixture.requester.id,
        firstName: "DELETE_NO_ERASURE_CANARY",
        publicDisplayName: "Privacy requester",
      },
    });
    const privacyCase = await createPrivacyRequest(client, fixture.requester.id, {
      type: "DELETE",
      status: "PENDING",
      version: 1,
      dueAt: new Date(NOW.getTime() + 30 * DAY),
    });
    const service = createPostgresPrivacyCaseService(client);
    const verifier = verifyActor(fixture.admin.id);

    const startCommand = {
      requestId: privacyCase.id,
      version: 1,
      idempotencyKey: "delete-start-check-v1",
    } as const;
    await expect(
      service.startIdentityCheck(verifier, startCommand, NOW),
    ).resolves.toEqual({
      ok: true,
      idempotent: false,
      requestId: privacyCase.id,
      status: "IDENTITY_CHECK",
      version: 2,
    });
    await expect(
      service.startIdentityCheck(verifier, startCommand, NOW),
    ).resolves.toMatchObject({ ok: true, idempotent: true });

    const challengeAfterStart =
      await client.privacyIdentityChallenge.findFirstOrThrow({
        where: { privacyRequestId: privacyCase.id },
      });
    expect(challengeAfterStart.expiresAt).toEqual(
      new Date(
        NOW.getTime() +
          PRIVACY_CASE_SERVICE_POLICY_V1.challengeLifetimeMinutes * 60_000,
      ),
    );
    expect(challengeAfterStart.attempts).toBe(0);

    const wrongAttempt = {
      requestId: privacyCase.id,
      version: 2,
      idempotencyKey: "delete-wrong-password-v1",
    } as const;
    await expect(
      service.completeIdentityChallenge(
        { userId: fixture.requester.id },
        wrongAttempt,
        { credentialVerified: false },
        new Date(NOW.getTime() + 60_000),
      ),
    ).resolves.toEqual({ ok: false, code: "CHALLENGE_UNAVAILABLE" });
    await expect(
      service.completeIdentityChallenge(
        { userId: fixture.requester.id },
        wrongAttempt,
        { credentialVerified: false },
        new Date(NOW.getTime() + 60_000),
      ),
    ).resolves.toEqual({ ok: false, code: "CHALLENGE_UNAVAILABLE" });
    await expect(
      client.privacyIdentityChallenge.findFirstOrThrow({
        where: { privacyRequestId: privacyCase.id },
        select: { attempts: true },
      }),
    ).resolves.toEqual({ attempts: 1 });

    await expect(
      service.completeIdentityChallenge(
        { userId: fixture.requester.id },
        {
          requestId: privacyCase.id,
          version: 2,
          idempotencyKey: "delete-password-ok-v1",
        },
        {
          credentialVerified: true,
          password: "MUST_NEVER_REACH_SERVICE",
        } as never,
        new Date(NOW.getTime() + 2 * 60_000),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_COMMAND" });

    const verifiedCommand = {
      requestId: privacyCase.id,
      version: 2,
      idempotencyKey: "delete-password-ok-v2",
    } as const;
    await expect(
      service.completeIdentityChallenge(
        { userId: fixture.requester.id },
        verifiedCommand,
        { credentialVerified: true },
        new Date(NOW.getTime() + 2 * 60_000),
      ),
    ).resolves.toMatchObject({
      ok: true,
      idempotent: false,
      status: "IDENTITY_CHECK",
      version: 3,
    });
    await expect(
      service.completeIdentityChallenge(
        { userId: fixture.requester.id },
        verifiedCommand,
        { credentialVerified: true },
        new Date(NOW.getTime() + 3 * 60_000),
      ),
    ).resolves.toMatchObject({ ok: true, idempotent: true });

    await expect(
      service.verifyIdentity(verifier, {
        requestId: privacyCase.id,
        version: 3,
        idempotencyKey: "delete-admin-verify-v1",
      }, new Date(NOW.getTime() + 4 * 60_000)),
    ).resolves.toMatchObject({
      ok: true,
      status: "IN_PROGRESS",
      version: 4,
    });

    const completionNote =
      "Assessment complete; retention dependencies remain and no erasure ran.";
    const completeCommand: Parameters<
      typeof service.completeDeletionAssessment
    >[1] = {
      requestId: privacyCase.id,
      version: 4,
      idempotencyKey: "delete-assessment-complete-v1",
      dependencyCodes: ["ACCOUNTING_RETENTION", "MESSAGES"],
      outcomeCode: "ASSESSMENT_COMPLETED_NO_ERASURE",
      safeNote: completionNote,
    };
    await expect(
      service.completeDeletionAssessment(
        processActor(fixture.admin.id),
        completeCommand,
        new Date(NOW.getTime() + 5 * 60_000),
      ),
    ).resolves.toMatchObject({
      ok: true,
      idempotent: false,
      status: "COMPLETED",
      version: 5,
    });
    await expect(
      service.completeDeletionAssessment(
        processActor(fixture.admin.id),
        completeCommand,
        new Date(NOW.getTime() + 6 * 60_000),
      ),
    ).resolves.toMatchObject({ ok: true, idempotent: true });

    const stored = await client.privacyRequest.findUniqueOrThrow({
      where: { id: privacyCase.id },
      include: { challenges: true, events: { orderBy: { createdAt: "asc" } } },
    });
    expect(stored).toMatchObject({
      status: "COMPLETED",
      version: 5,
      assignedAdminUserId: fixture.admin.id,
      noticeVersion: "privacy-request-v1",
      deletionDependencies: ["ACCOUNTING_RETENTION", "MESSAGES"],
      deletionOutcome: "ASSESSMENT_COMPLETED_NO_ERASURE",
      safeOutcomeNote: completionNote,
    });
    expect(stored.challenges).toHaveLength(1);
    expect(stored.challenges[0]).toMatchObject({
      attempts: 2,
      verifiedAt: new Date(NOW.getTime() + 2 * 60_000),
      consumedAt: new Date(NOW.getTime() + 4 * 60_000),
    });
    expect(stored.events.map(({ kind }) => kind)).toEqual([
      "IDENTITY_REQUESTED",
      "VERIFIED",
      "PROCESSING_STARTED",
      "COMPLETED",
    ]);

    await expect(
      client.user.findUniqueOrThrow({
        where: { id: fixture.requester.id },
        select: { status: true, name: true },
      }),
    ).resolves.toEqual({ status: "ACTIVE", name: fixture.requester.name });
    await expect(
      client.candidateProfile.findUnique({ where: { id: profile.id } }),
    ).resolves.not.toBeNull();

    const notifications = await client.notification.findMany({
      where: {
        recipientUserId: fixture.requester.id,
        kind: "PRIVACY_REQUEST_CHANGED",
      },
      orderBy: { createdAt: "asc" },
    });
    expect(notifications.map(({ payload }) => payload)).toEqual([
      {
        requestId: privacyCase.id,
        type: "DELETE",
        status: "IDENTITY_CHECK",
        reasonCode: "IDENTITY_CHECK_REQUIRED",
      },
      {
        requestId: privacyCase.id,
        type: "DELETE",
        status: "IN_PROGRESS",
        reasonCode: "PROCESSING_STARTED",
      },
      {
        requestId: privacyCase.id,
        type: "DELETE",
        status: "COMPLETED",
        reasonCode: "COMPLETED",
      },
    ]);
    const redactedEvidence = JSON.stringify({
      notifications,
      audits: await client.auditLog.findMany({
        where: { targetId: privacyCase.id },
      }),
    });
    expect(redactedEvidence).not.toContain(completionNote);
    expect(redactedEvidence).not.toContain("MUST_NEVER_REACH_SERVICE");
    expect(redactedEvidence).not.toContain("DELETE_NO_ERASURE_CANARY");
  });

  it("caps failed credential attempts at five without changing case status", async () => {
    const client = requireClients().first;
    const fixture = await createFixture(client, "attempt-cap");
    const privacyCase = await createPrivacyRequest(client, fixture.requester.id, {
      type: "EXPORT",
      status: "IDENTITY_CHECK",
      version: 6,
      assignedAdminUserId: fixture.admin.id,
      assignmentReasonCode: "PRIVACY_CASE_ASSIGNED",
      dueAt: new Date(NOW.getTime() + DAY),
    });
    await client.privacyIdentityChallenge.create({
      data: {
        privacyRequestId: privacyCase.id,
        userId: fixture.requester.id,
        attempts: 0,
        expiresAt: new Date(NOW.getTime() + 15 * 60_000),
        idempotencyKey: "attempt-cap-created-v1",
        createdAt: NOW,
      },
    });
    const service = createPostgresPrivacyCaseService(client);

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await expect(
        service.completeIdentityChallenge(
          { userId: fixture.requester.id },
          {
            requestId: privacyCase.id,
            version: 6,
            idempotencyKey: `attempt-cap-wrong-${attempt}`,
          },
          { credentialVerified: false },
          new Date(NOW.getTime() + attempt * 10_000),
        ),
      ).resolves.toEqual({ ok: false, code: "CHALLENGE_UNAVAILABLE" });
    }
    await expect(
      client.privacyIdentityChallenge.findFirstOrThrow({
        where: { privacyRequestId: privacyCase.id },
        select: { attempts: true, verifiedAt: true },
      }),
    ).resolves.toEqual({ attempts: 5, verifiedAt: null });
    await expect(
      client.privacyRequest.findUniqueOrThrow({
        where: { id: privacyCase.id },
        select: { status: true, version: true },
      }),
    ).resolves.toEqual({ status: "IDENTITY_CHECK", version: 6 });
  });

  it("records only reviewed correction fields/domain refs and keeps notes out of audit and notifications", async () => {
    const client = requireClients().first;
    const fixture = await createFixture(client, "correction");
    const privacyCase = await createPrivacyRequest(client, fixture.requester.id, {
      type: "CORRECT",
      status: "IN_PROGRESS",
      version: 7,
      assignedAdminUserId: fixture.admin.id,
      assignmentReasonCode: "PRIVACY_CASE_ASSIGNED",
      verifiedAt: new Date(NOW.getTime() - DAY),
      processingStartedAt: new Date(NOW.getTime() - 60_000),
      dueAt: new Date(NOW.getTime() + DAY),
    });
    await client.privacyRequestCorrectionField.createMany({
      data: [
        {
          privacyRequestId: privacyCase.id,
          fieldCode: "EMAIL",
          correctionText: "CORRECTION_BODY_CANARY requires canonical review.",
        },
        {
          privacyRequestId: privacyCase.id,
          fieldCode: "LOCATION",
          correctionText: "CORRECTION_BODY_CANARY requires canonical review.",
        },
      ],
    });
    const service = createPostgresPrivacyCaseService(client);
    const actor = processActor(fixture.admin.id);
    const note = "INTERNAL_NOTE_CANARY belongs only on the restricted timeline.";

    await expect(
      service.addInternalNote(actor, {
        requestId: privacyCase.id,
        version: 7,
        idempotencyKey: "correction-note-v1",
        note,
      }, NOW),
    ).resolves.toMatchObject({ ok: true, version: 8 });

    await expect(
      service.completeCorrectionOutcome(actor, {
        requestId: privacyCase.id,
        version: 8,
        idempotencyKey: "correction-invalid-field-v1",
        reviewedFieldCodes: ["DISPLAY_NAME"],
        outcomeCode: "NO_CHANGE_REQUIRED",
      }, NOW),
    ).resolves.toEqual({ ok: false, code: "OUTCOME_MISMATCH" });

    const domainEventRef = randomUUID();
    const completion: Parameters<
      typeof service.completeCorrectionOutcome
    >[1] = {
      requestId: privacyCase.id,
      version: 8,
      idempotencyKey: "correction-complete-v1",
      reviewedFieldCodes: ["EMAIL"],
      outcomeCode: "CORRECTED_VIA_CANONICAL_COMMAND",
      domainEventRefs: [domainEventRef],
      safeNote: "The canonical account command was reviewed and recorded.",
    };
    await expect(
      service.completeCorrectionOutcome(actor, completion, NOW),
    ).resolves.toMatchObject({ ok: true, status: "COMPLETED", version: 9 });
    await expect(
      service.completeCorrectionOutcome(actor, completion, NOW),
    ).resolves.toMatchObject({ ok: true, idempotent: true });

    const stored = await client.privacyRequest.findUniqueOrThrow({
      where: { id: privacyCase.id },
      include: { correctionFields: { orderBy: { fieldCode: "asc" } } },
    });
    expect(stored).toMatchObject({
      status: "COMPLETED",
      version: 9,
      correctionOutcome: "CORRECTED_VIA_CANONICAL_COMMAND",
      domainEventRefs: [domainEventRef],
    });
    expect(stored.correctionFields).toMatchObject([
      { fieldCode: "EMAIL", reviewedAt: NOW },
      { fieldCode: "LOCATION", reviewedAt: null },
    ]);

    const noteEvent = await client.privacyRequestEvent.findUniqueOrThrow({
      where: { idempotencyKey: "correction-note-v1" },
    });
    expect(noteEvent).toMatchObject({
      kind: "NOTE_ADDED",
      fromStatus: "IN_PROGRESS",
      toStatus: "IN_PROGRESS",
      safeNote: note,
    });
    const publicEvidence = JSON.stringify({
      notifications: await client.notification.findMany({
        where: { recipientUserId: fixture.requester.id },
      }),
      audits: await client.auditLog.findMany({
        where: { targetId: privacyCase.id },
      }),
    });
    expect(publicEvidence).not.toContain("INTERNAL_NOTE_CANARY");
    expect(publicEvidence).not.toContain("CORRECTION_BODY_CANARY");
  });

  it("enforces owner-safe cancellation, closed rejection and optimistic concurrency", async () => {
    const clients = requireClients();
    const fixture = await createFixture(clients.first, "terminal");
    const cancellable = await createPrivacyRequest(
      clients.first,
      fixture.requester.id,
      {
        type: "EXPORT",
        status: "PENDING",
        version: 2,
        assignedAdminUserId: fixture.admin.id,
        assignmentReasonCode: "PRIVACY_CASE_ASSIGNED",
        dueAt: new Date(NOW.getTime() + DAY),
      },
    );
    const firstService = createPostgresPrivacyCaseService(clients.first);
    await expect(
      firstService.cancelOwnedRequest(
        { userId: fixture.foreignRequester.id },
        {
          requestId: cancellable.id,
          version: 2,
          idempotencyKey: "foreign-cancel-v1",
        },
        NOW,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    const cancellation = {
      requestId: cancellable.id,
      version: 2,
      idempotencyKey: "owner-cancel-v1",
    } as const;
    await expect(
      firstService.cancelOwnedRequest(
        { userId: fixture.requester.id },
        cancellation,
        NOW,
      ),
    ).resolves.toMatchObject({ ok: true, status: "CANCELLED", version: 3 });
    await expect(
      firstService.cancelOwnedRequest(
        { userId: fixture.requester.id },
        cancellation,
        NOW,
      ),
    ).resolves.toMatchObject({ ok: true, idempotent: true });
    await expect(
      clients.first.notification.count({
        where: {
          recipientUserId: fixture.admin.id,
          kind: "PRIVACY_REQUEST_CHANGED",
        },
      }),
    ).resolves.toBe(1);

    const rejectable = await createPrivacyRequest(
      clients.first,
      fixture.requester.id,
      {
        type: "DELETE",
        status: "PENDING",
        version: 4,
        dueAt: new Date(NOW.getTime() + DAY),
      },
    );
    await expect(
      firstService.rejectRequest(processActor(fixture.admin.id), {
        requestId: rejectable.id,
        version: 4,
        idempotencyKey: "reject-case-v1",
        reasonCode: "INSUFFICIENT_INFORMATION",
        safeNote: "Please submit the missing bounded evidence through Support.",
      }, NOW),
    ).resolves.toMatchObject({ ok: true, status: "REJECTED", version: 5 });

    const concurrent = await createPrivacyRequest(
      clients.first,
      fixture.requester.id,
      {
        type: "CORRECT",
        status: "IN_PROGRESS",
        version: 10,
        assignedAdminUserId: fixture.admin.id,
        assignmentReasonCode: "PRIVACY_CASE_ASSIGNED",
        verifiedAt: NOW,
        processingStartedAt: NOW,
        dueAt: new Date(NOW.getTime() + DAY),
      },
    );
    await clients.first.privacyRequestCorrectionField.create({
      data: {
        privacyRequestId: concurrent.id,
        fieldCode: "EMAIL",
        correctionText: "Concurrent privacy note fixture with enough characters.",
      },
    });
    const [first, second] = await Promise.all([
      firstService.addInternalNote(processActor(fixture.admin.id), {
        requestId: concurrent.id,
        version: 10,
        idempotencyKey: "parallel-note-first-v1",
        note: "First serialized note",
      }, NOW),
      createPostgresPrivacyCaseService(clients.second).addInternalNote(
        processActor(fixture.admin.id),
        {
          requestId: concurrent.id,
          version: 10,
          idempotencyKey: "parallel-note-second-v1",
          note: "Second serialized note",
        },
        NOW,
      ),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].filter((result) => !result.ok)).toEqual([
      { ok: false, code: "STALE_VERSION" },
    ]);
    await expect(
      clients.first.privacyRequestEvent.count({
        where: { privacyRequestId: concurrent.id, kind: "NOTE_ADDED" },
      }),
    ).resolves.toBe(1);
  });

  it("rolls back state, challenge, event and notification when required audit persistence fails", async () => {
    const client = requireClients().first;
    const isolated = requireDatabase();
    const fixture = await createFixture(client, "rollback");
    const privacyCase = await createPrivacyRequest(client, fixture.requester.id, {
      type: "EXPORT",
      status: "PENDING",
      version: 1,
      dueAt: new Date(NOW.getTime() + DAY),
    });
    await isolated.pool.query(`
      CREATE FUNCTION reject_phase14_privacy_case_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW."targetId" = '${privacyCase.id}'::uuid THEN
          RAISE EXCEPTION 'isolated required privacy-case audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await isolated.pool.query(`
      CREATE TRIGGER reject_phase14_privacy_case_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION reject_phase14_privacy_case_audit()
    `);

    try {
      await expect(
        createPostgresPrivacyCaseService(client).startIdentityCheck(
          verifyActor(fixture.admin.id),
          {
            requestId: privacyCase.id,
            version: 1,
            idempotencyKey: "rollback-identity-start-v1",
          },
          NOW,
        ),
      ).rejects.toThrow("Privacy case operation is unavailable.");
      await expect(
        client.privacyRequest.findUniqueOrThrow({
          where: { id: privacyCase.id },
          select: {
            status: true,
            version: true,
            assignedAdminUserId: true,
          },
        }),
      ).resolves.toEqual({
        status: "PENDING",
        version: 1,
        assignedAdminUserId: null,
      });
      await expect(
        client.privacyIdentityChallenge.count({
          where: { privacyRequestId: privacyCase.id },
        }),
      ).resolves.toBe(0);
      await expect(
        client.privacyRequestEvent.count({
          where: { privacyRequestId: privacyCase.id },
        }),
      ).resolves.toBe(0);
      await expect(
        client.notification.count({
          where: {
            recipientUserId: fixture.requester.id,
            kind: "PRIVACY_REQUEST_CHANGED",
          },
        }),
      ).resolves.toBe(0);
    } finally {
      await isolated.pool.query(
        'DROP TRIGGER IF EXISTS reject_phase14_privacy_case_audit_trigger ON "AuditLog"',
      );
      await isolated.pool.query(
        "DROP FUNCTION IF EXISTS reject_phase14_privacy_case_audit() CASCADE",
      );
    }
  });
});

function requireClients() {
  if (!firstClient || !secondClient) {
    throw new Error("Privacy case test clients are unavailable.");
  }
  return { first: firstClient, second: secondClient };
}

function requireDatabase() {
  if (!database) throw new Error("Privacy case test database is unavailable.");
  return database;
}

function readActor(userId: string): PrivacyCaseAdminActor {
  return Object.freeze({
    userId,
    capabilities: ["PRIVACY_CASE_READ"] as const,
  });
}

function verifyActor(userId: string): PrivacyCaseAdminActor {
  return Object.freeze({
    userId,
    capabilities: ["PRIVACY_CASE_VERIFY"] as const,
  });
}

function processActor(userId: string): PrivacyCaseAdminActor {
  return Object.freeze({
    userId,
    capabilities: ["PRIVACY_CASE_PROCESS"] as const,
  });
}

async function createFixture(client: DatabaseClient, suffix: string) {
  const requester = await createUser(
    client,
    `privacy-requester-${suffix}@example.test`,
    "CANDIDATE",
    `REQUESTER_NAME_CANARY_${suffix}`,
  );
  const foreignRequester = await createUser(
    client,
    `privacy-foreign-${suffix}@example.test`,
    "CANDIDATE",
    `FOREIGN_NAME_CANARY_${suffix}`,
  );
  const admin = await createUser(
    client,
    `privacy-admin-${suffix}@example.test`,
    "ADMIN",
    `ADMIN_NAME_CANARY_${suffix}`,
  );
  const otherAdmin = await createUser(
    client,
    `privacy-other-admin-${suffix}@example.test`,
    "ADMIN",
    `OTHER_ADMIN_NAME_CANARY_${suffix}`,
  );
  return { requester, foreignRequester, admin, otherAdmin };
}

async function createUser(
  client: DatabaseClient,
  email: string,
  role: "ADMIN" | "CANDIDATE",
  name: string,
) {
  return client.user.create({
    data: {
      email,
      emailNormalized: email.toLowerCase(),
      role,
      name,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
    },
  });
}

async function createPrivacyRequest(
  client: DatabaseClient,
  requesterUserId: string,
  input: Readonly<{
    type: "EXPORT" | "DELETE" | "CORRECT";
    status: "PENDING" | "IDENTITY_CHECK" | "IN_PROGRESS";
    version: number;
    dueAt: Date;
    assignedAdminUserId?: string;
    assignmentReasonCode?: string;
    verifiedAt?: Date;
    processingStartedAt?: Date;
    createdAt?: Date;
  }>,
) {
  return client.privacyRequest.create({
    data: {
      requesterUserId,
      type: input.type,
      status: input.status,
      version: input.version,
      dueAt: input.dueAt,
      assignedAdminUserId: input.assignedAdminUserId,
      assignmentReasonCode: input.assignmentReasonCode,
      verifiedAt: input.verifiedAt,
      processingStartedAt: input.processingStartedAt,
      idempotencyKey: `privacy-fixture-${randomUUID()}`,
      noticeVersion: "privacy-request-v1",
      domainEventRefs: [],
      deletionDependencies: [],
      createdAt: input.createdAt ?? NOW,
      updatedAt: input.createdAt ?? NOW,
    },
  });
}
