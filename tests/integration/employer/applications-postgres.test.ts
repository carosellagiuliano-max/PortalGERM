import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicJobBySlug: vi.fn(async () => null),
}));

import { getCandidateApplicationDetail } from "@/lib/applications/queries";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  addEmployerApplicationNote,
  getEmployerApplicationDetail,
  listEmployerApplications,
  normalizeEmployerApplicationFilter,
  resolveEmployerApplicantReportTarget,
  sendEmployerApplicationMessage,
  transitionEmployerApplication,
  type EmployerApplicationAccess,
} from "@/lib/employer/applications";
import { revokeJobAssignment } from "@/lib/employer/team";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
import { MockEmailProvider } from "@/lib/providers/email/mock-email-provider";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const id = (sequence: number) =>
  `b1000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
const NOW = new Date("2026-07-21T14:00:00.000Z");
const APP_URL = "http://phase10-applications.test";
const PRIVATE_NOTE = "VERTRAULICHE-PHASE10-NOTIZ-NICHT-AN-KANDIDAT";
const MESSAGE_BODY = "Guten Tag, wir möchten den nächsten Schritt besprechen.";

const IDS = Object.freeze({
  owner: id(1),
  admin: id(2),
  editor: id(3),
  pipeline: id(4),
  reviewer: id(5),
  unassigned: id(6),
  viewer: id(7),
  foreignOwner: id(8),
  candidate: id(9),
  candidateProfile: id(10),
  company: id(11),
  foreignCompany: id(12),
  ownerMembership: id(13),
  adminMembership: id(14),
  editorMembership: id(15),
  pipelineMembership: id(16),
  reviewerMembership: id(17),
  unassignedMembership: id(18),
  viewerMembership: id(19),
  foreignOwnerMembership: id(20),
  canton: id(21),
  city: id(22),
  category: id(23),
  companyLocation: id(24),
  foreignCompanyLocation: id(25),
  accessJob: id(30),
  accessRevision: id(31),
  accessApplication: id(32),
  accessSnapshot: id(33),
  statusJob: id(40),
  statusRevision: id(41),
  statusApplication: id(42),
  statusSnapshot: id(43),
  noteJob: id(50),
  noteRevision: id(51),
  noteApplication: id(52),
  noteSnapshot: id(53),
  messageJob: id(60),
  messageRevision: id(61),
  messageApplication: id(62),
  messageSnapshot: id(63),
  secondMessageJob: id(70),
  secondMessageRevision: id(71),
  secondMessageApplication: id(72),
  secondMessageSnapshot: id(73),
  foreignJob: id(80),
  foreignRevision: id(81),
  foreignApplication: id(82),
  foreignSnapshot: id(83),
  editorAssignment: id(90),
  pipelineAssignment: id(91),
  reviewerAssignment: id(92),
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase_10_employer_applications");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = parseEnvironment(
    createValidEnvironment({
      APP_URL,
      DATABASE_URL: migrated.connectionString,
      RATE_LIMIT_BACKEND: "postgres",
    }),
  );
  await seed(client());
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  environment = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-10 employer applications PostgreSQL contracts", () => {
  it("enforces company scope and assignment roles for reads and transitions", async () => {
    const ownerRows = await listEmployerApplications(
      access("owner"),
      client(),
      normalizeEmployerApplicationFilter({}),
      NOW,
    );
    const adminRows = await listEmployerApplications(
      access("admin"),
      client(),
      normalizeEmployerApplicationFilter({}),
      NOW,
    );
    const expectedCompanyApplications = [
      IDS.accessApplication,
      IDS.statusApplication,
      IDS.noteApplication,
      IDS.messageApplication,
      IDS.secondMessageApplication,
    ];
    expect(ownerRows.applications.map(({ id: applicationId }) => applicationId).sort()).toEqual(
      [...expectedCompanyApplications].sort(),
    );
    expect(adminRows.applications.map(({ id: applicationId }) => applicationId).sort()).toEqual(
      [...expectedCompanyApplications].sort(),
    );
    expect(await getEmployerApplicationDetail(IDS.foreignApplication, access("owner"), client(), NOW)).toBeNull();
    await expect(
      getEmployerApplicationDetail(IDS.accessApplication, access("admin"), client(), NOW),
    ).resolves.not.toBeNull();

    for (const actor of [access("editor"), access("pipeline")]) {
      const rows = await listEmployerApplications(
        actor,
        client(),
        normalizeEmployerApplicationFilter({}),
        NOW,
      );
      expect(rows.applications.map(({ id: applicationId }) => applicationId)).toEqual([
        IDS.accessApplication,
      ]);
      await expect(
        getEmployerApplicationDetail(IDS.accessApplication, actor, client(), NOW),
      ).resolves.not.toBeNull();
    }

    for (const actor of [
      access("reviewer"),
      access("unassigned"),
      access("viewer"),
    ]) {
      const rows = await listEmployerApplications(
        actor,
        client(),
        normalizeEmployerApplicationFilter({}),
        NOW,
      );
      expect(rows.applications).toEqual([]);
      await expect(
        getEmployerApplicationDetail(IDS.accessApplication, actor, client(), NOW),
      ).resolves.toBeNull();
    }

    const foreignRows = await listEmployerApplications(
      access("foreignOwner"),
      client(),
      normalizeEmployerApplicationFilter({}),
      NOW,
    );
    expect(foreignRows.applications.map(({ id: applicationId }) => applicationId)).toEqual([
      IDS.foreignApplication,
    ]);
    await expect(
      getEmployerApplicationDetail(IDS.accessApplication, access("foreignOwner"), client(), NOW),
    ).resolves.toBeNull();

    await expect(
      transitionEmployerApplication(
        access("editor"),
        {
          applicationId: IDS.accessApplication,
          nextStatus: "IN_REVIEW",
          idempotencyKey: "phase10-editor-start-review",
        },
        dependencies(1),
      ),
    ).resolves.toEqual({ ok: true, duplicate: false });
    await expect(
      transitionEmployerApplication(
        access("pipeline"),
        {
          applicationId: IDS.accessApplication,
          nextStatus: "SHORTLISTED",
          idempotencyKey: "phase10-pipeline-shortlist",
        },
        dependencies(2),
      ),
    ).resolves.toEqual({ ok: true, duplicate: false });

    for (const [index, actor] of [
      access("reviewer"),
      access("unassigned"),
      access("foreignOwner"),
    ].entries()) {
      await expect(
        transitionEmployerApplication(
          actor,
          {
            applicationId: IDS.accessApplication,
            nextStatus: "INTERVIEW",
            idempotencyKey: `phase10-denied-transition-${index}`,
          },
          dependencies(10 + index),
        ),
      ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    }
    await expect(
      client().application.findUniqueOrThrow({
        where: { id: IDS.accessApplication },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "SHORTLISTED" });
  });

  it("resolves reportable applicant identities only through the employer application scope", async () => {
    await expect(
      resolveEmployerApplicantReportTarget(
        IDS.accessApplication,
        access("owner"),
        client(),
        NOW,
      ),
    ).resolves.toEqual({
      userId: IDS.candidate,
      companyId: IDS.company,
    });
    await expect(
      resolveEmployerApplicantReportTarget(
        IDS.accessApplication,
        access("pipeline"),
        client(),
        NOW,
      ),
    ).resolves.toEqual({
      userId: IDS.candidate,
      companyId: IDS.company,
    });

    const inaccessible = await resolveEmployerApplicantReportTarget(
      IDS.foreignApplication,
      access("owner"),
      client(),
      NOW,
    );
    const missing = await resolveEmployerApplicantReportTarget(
      id(9_999),
      access("owner"),
      client(),
      NOW,
    );
    expect(inaccessible).toBeNull();
    expect(missing).toEqual(inaccessible);
    await expect(
      resolveEmployerApplicantReportTarget(
        IDS.accessApplication,
        access("viewer"),
        client(),
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it("writes one status event, required audit and notification across a retry", async () => {
    const emailProvider = new MockEmailProvider(
      new PrismaEmailLogRepository(client()),
    );
    const sendSpy = vi.spyOn(emailProvider, "send");
    const input = {
      applicationId: IDS.statusApplication,
      nextStatus: "IN_REVIEW" as const,
      idempotencyKey: "phase10-status-transition-once",
    };
    const first = await transitionEmployerApplication(
      access("owner"),
      input,
      dependencies(20, emailProvider),
    );
    const retry = await transitionEmployerApplication(
      access("owner"),
      input,
      dependencies(21, emailProvider),
    );
    expect(first).toEqual({ ok: true, duplicate: false });
    expect(retry).toEqual({ ok: true, duplicate: true });
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "candidate-phase10-applications@example.test",
        templateKey: "application_status_changed",
      }),
    );

    const [application, events, audits, notifications, emailLogs, responseAnalyticsCount] = await Promise.all([
      client().application.findUniqueOrThrow({
        where: { id: IDS.statusApplication },
        select: { status: true },
      }),
      client().applicationEvent.findMany({
        where: { applicationId: IDS.statusApplication, kind: "STATUS_CHANGE" },
        select: {
          fromStatus: true,
          toStatus: true,
          correlationId: true,
          metadata: true,
        },
      }),
      client().auditLog.findMany({
        where: {
          action: "APPLICATION_STATUS_CHANGED",
          targetId: IDS.statusApplication,
        },
        select: {
          actorUserId: true,
          capability: true,
          companyId: true,
          result: true,
          metadata: true,
        },
      }),
      client().notification.findMany({
        where: {
          recipientUserId: IDS.candidate,
          kind: "APPLICATION_STATUS_CHANGED",
          payload: { path: ["applicationId"], equals: IDS.statusApplication },
        },
        select: { schemaVersion: true, payload: true },
      }),
      client().emailLog.findMany({
        where: {
          recipient: "candidate-phase10-applications@example.test",
          templateKey: "application_status_changed",
        },
        select: {
          purpose: true,
          templateKey: true,
          payload: true,
          status: true,
        },
      }),
      client().analyticsEvent.count({
        where: {
          producer: "employer-application",
          dedupeKey: `EMPLOYER_RESPONSE:${IDS.statusApplication}`,
        },
      }),
    ]);
    expect(application).toEqual({ status: "IN_REVIEW" });
    expect(events).toEqual([
      {
        fromStatus: "SUBMITTED",
        toStatus: "IN_REVIEW",
        correlationId: requestContext(20).correlationId,
        metadata: null,
      },
    ]);
    expect(audits).toEqual([
      {
        actorUserId: IDS.owner,
        capability: "COMPANY_APPLICATION_TRANSITION",
        companyId: IDS.company,
        result: "SUCCEEDED",
        metadata: null,
      },
    ]);
    expect(notifications).toEqual([
      {
        schemaVersion: "1",
        payload: {
          applicationId: IDS.statusApplication,
          status: "IN_REVIEW",
        },
      },
    ]);
    expect(emailLogs).toHaveLength(1);
    expect(emailLogs[0]).toMatchObject({
      purpose: "application_status_changed",
      templateKey: "application_status_changed",
      status: "MOCK_RECORDED",
      payload: {
        schemaVersion: "1",
        deliveryStatus: "mock_recorded",
        externalDeliveryClaimed: false,
      },
    });
    const serializedEmailLogs = JSON.stringify(emailLogs);
    expect(serializedEmailLogs).not.toContain(input.idempotencyKey);
    expect(serializedEmailLogs).not.toContain("Fiktives Motivationsschreiben");
    expect(serializedEmailLogs).not.toContain(PRIVATE_NOTE);
    expect(responseAnalyticsCount).toBe(0);
  });

  it("heals a transient status-email failure on an exact replay without duplicating domain artifacts", async () => {
    const mockProvider = new MockEmailProvider(
      new PrismaEmailLogRepository(client()),
    );
    let sendAttempts = 0;
    const attemptedEnvelopes: Parameters<EmailProvider["send"]>[0][] = [];
    const transientProvider: EmailProvider = {
      async send(input) {
        sendAttempts += 1;
        attemptedEnvelopes.push(input);
        const result = await mockProvider.send(input);
        if (sendAttempts === 1) {
          throw new Error("transient delivery acknowledgement failure");
        }
        return result;
      },
    };
    const input = {
      applicationId: IDS.noteApplication,
      nextStatus: "IN_REVIEW" as const,
      idempotencyKey: "phase10-status-email-healing",
    };

    await expect(
      transitionEmployerApplication(
        access("owner"),
        input,
        dependencies(27, transientProvider),
      ),
    ).resolves.toEqual({ ok: true, duplicate: false });
    await expect(
      transitionEmployerApplication(
        access("owner"),
        input,
        dependencies(28, transientProvider),
      ),
    ).resolves.toEqual({ ok: true, duplicate: true });

    const [events, audits, notifications, analytics, emailLogs] = await Promise.all([
      client().applicationEvent.count({
        where: { applicationId: IDS.noteApplication, kind: "STATUS_CHANGE" },
      }),
      client().auditLog.count({
        where: {
          action: "APPLICATION_STATUS_CHANGED",
          targetId: IDS.noteApplication,
        },
      }),
      client().notification.count({
        where: {
          recipientUserId: IDS.candidate,
          kind: "APPLICATION_STATUS_CHANGED",
          payload: { path: ["applicationId"], equals: IDS.noteApplication },
        },
      }),
      client().analyticsEvent.count({
        where: {
          producer: "employer-application",
          dedupeKey: `EMPLOYER_RESPONSE:${IDS.noteApplication}`,
        },
      }),
      client().emailLog.findMany({
        where: {
          recipient: "candidate-phase10-applications@example.test",
          templateKey: "application_status_changed",
        },
        select: { payload: true },
      }),
    ]);
    const healedLogs = emailLogs.filter(({ payload }) =>
      JSON.stringify(payload).includes("Private Arbeitgebernotiz"),
    );
    expect(sendAttempts).toBe(2);
    expect(attemptedEnvelopes[1]).toEqual(attemptedEnvelopes[0]);
    expect(events).toBe(1);
    expect(audits).toBe(1);
    expect(notifications).toBe(1);
    expect(analytics).toBe(0);
    expect(healedLogs).toHaveLength(1);
  });

  it("rejects missing, unknown and extraneous rejection reasons without writing artifacts", async () => {
    const before = await rejectionArtifactSnapshot(IDS.noteApplication);

    await expect(
      transitionEmployerApplication(
        access("owner"),
        {
          applicationId: IDS.noteApplication,
          nextStatus: "REJECTED",
          idempotencyKey: "phase10-rejection-missing-reason",
        },
        dependencies(29),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(
      transitionEmployerApplication(
        access("owner"),
        {
          applicationId: IDS.noteApplication,
          nextStatus: "REJECTED",
          rejectionReason: "FREE_TEXT_REASON",
          idempotencyKey: "phase10-rejection-unknown-reason",
        },
        dependencies(30),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(
      transitionEmployerApplication(
        access("owner"),
        {
          applicationId: IDS.noteApplication,
          nextStatus: "SHORTLISTED",
          rejectionReason: "NOT_A_MATCH",
          idempotencyKey: "phase10-rejection-extraneous-reason",
        },
        dependencies(31),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });

    expect(await rejectionArtifactSnapshot(IDS.noteApplication)).toEqual(before);
  });

  it("records only the first qualifying employer response and binds status replay payloads", async () => {
    const input = {
      applicationId: IDS.statusApplication,
      nextStatus: "REJECTED" as const,
      rejectionReason: "NOT_A_MATCH" as const,
      idempotencyKey: "phase10-status-payload-binding",
    };
    await expect(
      transitionEmployerApplication(access("owner"), input, dependencies(22)),
    ).resolves.toEqual({ ok: true, duplicate: false });
    await expect(
      transitionEmployerApplication(access("owner"), input, dependencies(23)),
    ).resolves.toEqual({ ok: true, duplicate: true });
    await expect(
      transitionEmployerApplication(
        access("owner"),
        { ...input, rejectionReason: "POSITION_FILLED" },
        dependencies(24),
      ),
    ).resolves.toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      transitionEmployerApplication(
        access("owner"),
        {
          applicationId: input.applicationId,
          nextStatus: "SHORTLISTED",
          idempotencyKey: input.idempotencyKey,
        },
        dependencies(25),
      ),
    ).resolves.toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });

    // The access fixture already produced its first response when it was
    // shortlisted. A later candidate-visible status must not add another one.
    await expect(
      transitionEmployerApplication(
        access("owner"),
        {
          applicationId: IDS.accessApplication,
          nextStatus: "INTERVIEW",
          idempotencyKey: "phase10-later-qualifying-response",
        },
        dependencies(26),
      ),
    ).resolves.toEqual({ ok: true, duplicate: false });

    const [statusEvents, statusAnalytics, accessAnalytics] = await Promise.all([
      client().applicationEvent.findMany({
        where: {
          applicationId: IDS.statusApplication,
          kind: "STATUS_CHANGE",
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { toStatus: true, metadata: true },
      }),
      client().analyticsEvent.findMany({
        where: {
          producer: "employer-application",
          dedupeKey: `EMPLOYER_RESPONSE:${IDS.statusApplication}`,
        },
        select: {
          producer: true,
          dedupeKey: true,
          kind: true,
          schemaVersion: true,
          purpose: true,
          occurredAt: true,
          pseudonymousActorId: true,
          pseudonymousSessionId: true,
          companyId: true,
          jobId: true,
          actorProvenanceSnapshot: true,
          companyProvenanceSnapshot: true,
          jobProvenanceSnapshot: true,
          properties: true,
          retainUntil: true,
        },
      }),
      client().analyticsEvent.findMany({
        where: {
          producer: "employer-application",
          dedupeKey: `EMPLOYER_RESPONSE:${IDS.accessApplication}`,
        },
        select: { id: true },
      }),
    ]);
    expect(statusEvents).toHaveLength(2);
    expect(statusEvents).toEqual(expect.arrayContaining([
      { toStatus: "IN_REVIEW", metadata: null },
      { toStatus: "REJECTED", metadata: { reasonCode: "NOT_A_MATCH" } },
    ]));
    expect(statusAnalytics).toEqual([
      {
        producer: "employer-application",
        dedupeKey: `EMPLOYER_RESPONSE:${IDS.statusApplication}`,
        kind: "EMPLOYER_RESPONSE_RECORDED",
        schemaVersion: "1",
        purpose: "ESSENTIAL_OPERATIONAL",
        occurredAt: NOW,
        pseudonymousActorId: null,
        pseudonymousSessionId: null,
        companyId: IDS.company,
        jobId: IDS.statusJob,
        actorProvenanceSnapshot: "TEST",
        companyProvenanceSnapshot: "TEST",
        jobProvenanceSnapshot: "TEST",
        properties: {},
        retainUntil: new Date(NOW.getTime() + 400 * 86_400_000),
      },
    ]);
    expect(accessAnalytics).toHaveLength(1);
    const serializedAnalytics = JSON.stringify(statusAnalytics);
    expect(serializedAnalytics).not.toContain("candidate-phase10-applications@example.test");
    expect(serializedAnalytics).not.toContain("Fiktives Motivationsschreiben");
    expect(serializedAnalytics).not.toContain(PRIVATE_NOTE);
  });

  it("keeps private employer notes out of candidate DTOs, notifications and audit metadata", async () => {
    const notificationsBefore = await client().notification.count({
      where: { recipientUserId: IDS.candidate },
    });
    const input = {
      applicationId: IDS.noteApplication,
      body: PRIVATE_NOTE,
      idempotencyKey: "phase10-private-note-once",
    };
    const first = await addEmployerApplicationNote(
      access("admin"),
      input,
      dependencies(30),
    );
    const retry = await addEmployerApplicationNote(
      access("admin"),
      input,
      dependencies(31),
    );
    expect(first).toEqual({ ok: true, duplicate: false });
    expect(retry).toEqual({ ok: true, duplicate: true });
    await expect(
      addEmployerApplicationNote(
        access("admin"),
        { ...input, body: "Veränderter vertraulicher Inhalt." },
        dependencies(32),
      ),
    ).resolves.toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });

    const [employerDetail, candidateDetail, notes, events, audits, notificationsAfter] =
      await Promise.all([
        getEmployerApplicationDetail(
          IDS.noteApplication,
          access("admin"),
          client(),
          NOW,
        ),
        getCandidateApplicationDetail(
          IDS.candidate,
          IDS.noteApplication,
          client(),
          { now: NOW },
        ),
        client().applicationEmployerNote.findMany({
          where: { applicationId: IDS.noteApplication },
          select: { body: true, companyId: true, authorUserId: true },
        }),
        client().applicationEvent.findMany({
          where: {
            applicationId: IDS.noteApplication,
            kind: "EMPLOYER_NOTE_ADDED",
          },
          select: { metadata: true },
        }),
        client().auditLog.findMany({
          where: {
            action: "APPLICATION_EMPLOYER_NOTE_ADDED",
            targetId: IDS.noteApplication,
          },
          select: { metadata: true, targetType: true },
        }),
        client().notification.count({ where: { recipientUserId: IDS.candidate } }),
      ]);

    expect(notes).toEqual([
      {
        body: PRIVATE_NOTE,
        companyId: IDS.company,
        authorUserId: IDS.admin,
      },
    ]);
    expect(employerDetail?.employerNotes.map(({ body }) => body)).toEqual([
      PRIVATE_NOTE,
    ]);
    expect(candidateDetail).not.toBeNull();
    expect(JSON.stringify(candidateDetail)).not.toContain(PRIVATE_NOTE);
    expect(candidateDetail).not.toHaveProperty("employerNotes");
    expect(events).toEqual([
      {
        metadata: {
          employerNoteId: expect.any(String),
          payloadBindingVersion: "employer-note-v1",
        },
      },
    ]);
    expect(audits).toEqual([{ metadata: null, targetType: "APPLICATION" }]);
    expect(JSON.stringify({ candidateDetail, events, audits })).not.toContain(
      PRIVATE_NOTE,
    );
    expect(notificationsAfter).toBe(notificationsBefore);
  });

  it("scopes messages to the application and deduplicates a legitimate replay", async () => {
    const mockProvider = new MockEmailProvider(
      new PrismaEmailLogRepository(client()),
    );
    let sendAttempts = 0;
    const attemptedEnvelopes: Parameters<EmailProvider["send"]>[0][] = [];
    const transientProvider: EmailProvider = {
      async send(envelope) {
        sendAttempts += 1;
        attemptedEnvelopes.push(envelope);
        const result = await mockProvider.send(envelope);
        if (sendAttempts === 1) {
          throw new Error("transient message delivery acknowledgement failure");
        }
        return result;
      },
    };
    const input = {
      applicationId: IDS.messageApplication,
      body: MESSAGE_BODY,
      idempotencyKey: "phase10-employer-message-once",
    };
    await expect(
      sendEmployerApplicationMessage(
        access("foreignOwner"),
        input,
        dependencies(40),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    const first = await sendEmployerApplicationMessage(
      access("owner"),
      input,
      dependencies(41, transientProvider),
    );
    const retry = await sendEmployerApplicationMessage(
      access("owner"),
      input,
      dependencies(42, transientProvider),
    );
    expect(first).toEqual({ ok: true, duplicate: false });
    expect(retry).toEqual({ ok: true, duplicate: true });
    await expect(
      sendEmployerApplicationMessage(
        access("owner"),
        { ...input, applicationId: IDS.secondMessageApplication },
        dependencies(43),
      ),
    ).resolves.toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });

    const [conversations, messages, events, audits, notifications, analytics, emailLogs] = await Promise.all([
      client().conversation.findMany({
        where: {
          applicationId: {
            in: [IDS.messageApplication, IDS.secondMessageApplication],
          },
        },
        select: { id: true, applicationId: true, companyId: true },
      }),
      client().message.findMany({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, body: true, conversation: { select: { applicationId: true } } },
      }),
      client().applicationEvent.findMany({
        where: { applicationId: IDS.messageApplication, kind: "MESSAGE_SENT" },
        select: { metadata: true },
      }),
      client().auditLog.findMany({
        where: { action: "MESSAGE_SENT", companyId: IDS.company },
        select: { targetId: true, targetType: true, metadata: true },
      }),
      client().notification.findMany({
        where: { recipientUserId: IDS.candidate, kind: "MESSAGE_RECEIVED" },
        select: { payload: true },
      }),
      client().analyticsEvent.findMany({
        where: {
          producer: "employer-application",
          dedupeKey: `EMPLOYER_RESPONSE:${IDS.messageApplication}`,
        },
        select: {
          kind: true,
          purpose: true,
          companyId: true,
          jobId: true,
          properties: true,
        },
      }),
      client().emailLog.findMany({
        where: {
          recipient: "candidate-phase10-applications@example.test",
          templateKey: "employer_message_received",
        },
        select: { payload: true },
      }),
    ]);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      applicationId: IDS.messageApplication,
      companyId: IDS.company,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      body: MESSAGE_BODY,
      conversation: { applicationId: IDS.messageApplication },
    });
    expect(events).toEqual([{ metadata: null }]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ targetType: "MESSAGE", metadata: null });
    expect(notifications).toHaveLength(1);
    expect(analytics).toEqual([
      {
        kind: "EMPLOYER_RESPONSE_RECORDED",
        purpose: "ESSENTIAL_OPERATIONAL",
        companyId: IDS.company,
        jobId: IDS.messageJob,
        properties: {},
      },
    ]);
    expect(sendAttempts).toBe(2);
    expect(attemptedEnvelopes[1]).toEqual(attemptedEnvelopes[0]);
    expect(emailLogs.filter(({ payload }) =>
      JSON.stringify(payload).includes("Nachricht zur Bewerbung"),
    )).toHaveLength(1);
    expect(JSON.stringify(notifications)).not.toContain(MESSAGE_BODY);
    expect(JSON.stringify(audits)).not.toContain(MESSAGE_BODY);
    expect(JSON.stringify(analytics)).not.toContain(MESSAGE_BODY);
  });

  it("deduplicates simultaneous message and qualifying status responses across retries", async () => {
    await expect(
      transitionEmployerApplication(
        access("owner"),
        {
          applicationId: IDS.secondMessageApplication,
          nextStatus: "IN_REVIEW",
          idempotencyKey: "phase10-concurrent-response-review",
        },
        dependencies(44),
      ),
    ).resolves.toEqual({ ok: true, duplicate: false });
    const messageInput = {
      applicationId: IDS.secondMessageApplication,
      body: "Erste sichtbare Antwort im konkurrierenden Ablauf.",
      idempotencyKey: "phase10-concurrent-response-message",
    };
    const statusInput = {
      applicationId: IDS.secondMessageApplication,
      nextStatus: "SHORTLISTED" as const,
      idempotencyKey: "phase10-concurrent-response-status",
    };

    const [messageResult, statusResult] = await Promise.all([
      sendEmployerApplicationMessage(
        access("owner"),
        messageInput,
        dependencies(45),
      ),
      transitionEmployerApplication(
        access("owner"),
        statusInput,
        dependencies(46),
      ),
    ]);
    expect(messageResult).toEqual({ ok: true, duplicate: false });
    expect(statusResult).toEqual({ ok: true, duplicate: false });
    await expect(
      sendEmployerApplicationMessage(
        access("owner"),
        messageInput,
        dependencies(47),
      ),
    ).resolves.toEqual({ ok: true, duplicate: true });
    await expect(
      transitionEmployerApplication(
        access("owner"),
        statusInput,
        dependencies(48),
      ),
    ).resolves.toEqual({ ok: true, duplicate: true });

    const concurrentConversation = await client().conversation.findUniqueOrThrow({
      where: { applicationId: IDS.secondMessageApplication },
      select: { id: true },
    });

    const [responseEvents, messages, statusEvents, messageNotifications] = await Promise.all([
      client().analyticsEvent.findMany({
        where: {
          producer: "employer-application",
          dedupeKey: `EMPLOYER_RESPONSE:${IDS.secondMessageApplication}`,
        },
        select: { id: true, kind: true, occurredAt: true },
      }),
      client().message.count({
        where: {
          idempotencyKey: messageInput.idempotencyKey,
          conversation: { applicationId: IDS.secondMessageApplication },
        },
      }),
      client().applicationEvent.findMany({
        where: {
          applicationId: IDS.secondMessageApplication,
          kind: "STATUS_CHANGE",
        },
        select: { toStatus: true },
      }),
      client().notification.count({
        where: {
          recipientUserId: IDS.candidate,
          kind: "MESSAGE_RECEIVED",
          payload: { path: ["conversationId"], equals: concurrentConversation.id },
        },
      }),
    ]);
    expect(responseEvents).toEqual([
      {
        id: expect.any(String),
        kind: "EMPLOYER_RESPONSE_RECORDED",
        occurredAt: NOW,
      },
    ]);
    expect(messages).toBe(1);
    expect(statusEvents).toHaveLength(2);
    expect(statusEvents).toEqual(expect.arrayContaining([
      { toStatus: "IN_REVIEW" },
      { toStatus: "SHORTLISTED" },
    ]));
    expect(messageNotifications).toBe(1);
  });

  it("rechecks exact assignment expiry and a real revocation before every application command", async () => {
    await expect(
      getEmployerApplicationDetail(
        IDS.accessApplication,
        access("pipeline"),
        client(),
        new Date(NOW.getTime() - 1),
      ),
    ).resolves.not.toBeNull();

    await client().jobAssignment.update({
      where: { id: IDS.pipelineAssignment },
      data: { expiresAt: NOW },
    });

    await expect(
      getEmployerApplicationDetail(
        IDS.accessApplication,
        access("pipeline"),
        client(),
        new Date(NOW.getTime() - 1),
      ),
    ).resolves.not.toBeNull();
    await expect(
      getEmployerApplicationDetail(
        IDS.accessApplication,
        access("pipeline"),
        client(),
        NOW,
      ),
    ).resolves.toBeNull();
    await expect(
      sendEmployerApplicationMessage(
        access("pipeline"),
        {
          applicationId: IDS.accessApplication,
          body: "Diese Nachricht darf am Ablaufzeitpunkt nicht entstehen.",
          idempotencyKey: "phase10-expired-assignment-message",
        },
        dependencies(60),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    await client().jobAssignment.update({
      where: { id: IDS.pipelineAssignment },
      data: { expiresAt: null },
    });
    const artifactsBeforeRevoke = await applicationCommandArtifactSnapshot(
      IDS.accessApplication,
    );
    await expect(
      revokeJobAssignment(
        IDS.company,
        {
          userId: IDS.owner,
          membershipId: IDS.ownerMembership,
          role: "OWNER",
        },
        IDS.pipelineAssignment,
        dependencies(61),
      ),
    ).resolves.toEqual({ ok: true });

    const rowsAfterRevoke = await listEmployerApplications(
      access("pipeline"),
      client(),
      normalizeEmployerApplicationFilter({}),
      NOW,
    );
    expect(rowsAfterRevoke.applications).toEqual([]);
    await expect(
      transitionEmployerApplication(
        access("pipeline"),
        {
          applicationId: IDS.accessApplication,
          nextStatus: "OFFER",
          idempotencyKey: "phase10-revoked-assignment-status",
        },
        dependencies(62),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      sendEmployerApplicationMessage(
        access("pipeline"),
        {
          applicationId: IDS.accessApplication,
          body: "Diese Nachricht darf nach dem Widerruf nicht entstehen.",
          idempotencyKey: "phase10-revoked-assignment-message",
        },
        dependencies(63),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      addEmployerApplicationNote(
        access("pipeline"),
        {
          applicationId: IDS.accessApplication,
          body: "Diese Notiz darf nach dem Widerruf nicht entstehen.",
          idempotencyKey: "phase10-revoked-assignment-note",
        },
        dependencies(64),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await applicationCommandArtifactSnapshot(IDS.accessApplication),
    ).toEqual(artifactsBeforeRevoke);
  });
});

async function rejectionArtifactSnapshot(applicationId: string) {
  const [application, events, audits, notifications, analytics] = await Promise.all([
    client().application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true, rejectionReason: true, rejectionNote: true },
    }),
    client().applicationEvent.count({ where: { applicationId } }),
    client().auditLog.count({ where: { targetId: applicationId } }),
    client().notification.count({
      where: {
        recipientUserId: IDS.candidate,
        payload: { path: ["applicationId"], equals: applicationId },
      },
    }),
    client().analyticsEvent.count({
      where: {
        producer: "employer-application",
        dedupeKey: `EMPLOYER_RESPONSE:${applicationId}`,
      },
    }),
  ]);
  return { application, events, audits, notifications, analytics };
}

async function applicationCommandArtifactSnapshot(applicationId: string) {
  const [application, events, notes, messages, audits, analytics] = await Promise.all([
    client().application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true, rejectionReason: true, updatedAt: true },
    }),
    client().applicationEvent.count({ where: { applicationId } }),
    client().applicationEmployerNote.count({ where: { applicationId } }),
    client().message.count({ where: { conversation: { applicationId } } }),
    client().auditLog.count({
      where: {
        OR: [
          { targetId: applicationId },
          { action: "MESSAGE_SENT", companyId: IDS.company },
        ],
      },
    }),
    client().analyticsEvent.count({
      where: {
        producer: "employer-application",
        dedupeKey: `EMPLOYER_RESPONSE:${applicationId}`,
      },
    }),
  ]);
  return { application, events, notes, messages, audits, analytics };
}

async function seed(target: DatabaseClient) {
  await target.user.createMany({
    data: [
      user(IDS.owner, "owner", "EMPLOYER"),
      user(IDS.admin, "admin", "EMPLOYER"),
      user(IDS.editor, "editor", "RECRUITER"),
      user(IDS.pipeline, "pipeline", "RECRUITER"),
      user(IDS.reviewer, "reviewer", "RECRUITER"),
      user(IDS.unassigned, "unassigned", "RECRUITER"),
      user(IDS.viewer, "viewer", "EMPLOYER"),
      user(IDS.foreignOwner, "foreign-owner", "EMPLOYER"),
      user(IDS.candidate, "candidate", "CANDIDATE"),
    ],
  });
  await target.canton.create({
    data: {
      id: IDS.canton,
      code: "ZH",
      name: "Zürich",
      slug: "phase10-applications-zuerich",
      language: "DE",
    },
  });
  await target.city.create({
    data: {
      id: IDS.city,
      cantonId: IDS.canton,
      name: "Zürich",
      slug: "phase10-applications-zuerich",
    },
  });
  await target.category.create({
    data: {
      id: IDS.category,
      name: "Phase 10 Applications",
      slug: "phase10-applications",
    },
  });
  await target.company.createMany({
    data: [
      {
        id: IDS.company,
        name: "Phase 10 Bewerbungen AG",
        slug: "phase10-bewerbungen-ag",
        industry: "Technologie",
        size: "51-200",
        website: "https://phase10-applications.test",
        about: "Fiktives Unternehmen für Phase-10-Integrationstests.",
        status: "DRAFT",
        dataProvenance: "TEST",
        values: [],
        benefits: [],
      },
      {
        id: IDS.foreignCompany,
        name: "Fremder Phase 10 Mandant AG",
        slug: "phase10-fremder-mandant-ag",
        industry: "Beratung",
        size: "11-50",
        website: "https://foreign-phase10-applications.test",
        about: "Fiktiver fremder Mandant für sichere Negativtests.",
        status: "DRAFT",
        dataProvenance: "TEST",
        values: [],
        benefits: [],
      },
    ],
  });
  await target.companyLocation.createMany({
    data: [
      {
        id: IDS.companyLocation,
        companyId: IDS.company,
        cantonId: IDS.canton,
        cityId: IDS.city,
        address: "Teststrasse 10",
        postalCode: "8000",
        isPrimary: true,
      },
      {
        id: IDS.foreignCompanyLocation,
        companyId: IDS.foreignCompany,
        cantonId: IDS.canton,
        cityId: IDS.city,
        address: "Fremdstrasse 10",
        postalCode: "8001",
        isPrimary: true,
      },
    ],
  });
  await target.company.updateMany({
    where: { id: { in: [IDS.company, IDS.foreignCompany] } },
    data: { status: "ACTIVE" },
  });
  await target.companyMembership.createMany({
    data: [
      membership(IDS.ownerMembership, IDS.company, IDS.owner, "OWNER"),
      membership(IDS.adminMembership, IDS.company, IDS.admin, "ADMIN"),
      membership(IDS.editorMembership, IDS.company, IDS.editor, "RECRUITER"),
      membership(IDS.pipelineMembership, IDS.company, IDS.pipeline, "RECRUITER"),
      membership(IDS.reviewerMembership, IDS.company, IDS.reviewer, "RECRUITER"),
      membership(IDS.unassignedMembership, IDS.company, IDS.unassigned, "RECRUITER"),
      membership(IDS.viewerMembership, IDS.company, IDS.viewer, "VIEWER"),
      membership(
        IDS.foreignOwnerMembership,
        IDS.foreignCompany,
        IDS.foreignOwner,
        "OWNER",
      ),
    ],
  });
  await target.candidateProfile.create({
    data: {
      id: IDS.candidateProfile,
      userId: IDS.candidate,
      cantonId: IDS.canton,
      firstName: "Mara",
      lastName: "Muster",
      onboardingStatus: "DRAFT",
    },
  });

  await createJobApplication(target, {
    companyId: IDS.company,
    ownerUserId: IDS.owner,
    jobId: IDS.accessJob,
    revisionId: IDS.accessRevision,
    applicationId: IDS.accessApplication,
    snapshotId: IDS.accessSnapshot,
    slug: "phase10-access-application",
    title: "Mandantensichere Bewerbung",
  });
  await createJobApplication(target, {
    companyId: IDS.company,
    ownerUserId: IDS.owner,
    jobId: IDS.statusJob,
    revisionId: IDS.statusRevision,
    applicationId: IDS.statusApplication,
    snapshotId: IDS.statusSnapshot,
    slug: "phase10-status-application",
    title: "Idempotenter Statuswechsel",
  });
  await createJobApplication(target, {
    companyId: IDS.company,
    ownerUserId: IDS.owner,
    jobId: IDS.noteJob,
    revisionId: IDS.noteRevision,
    applicationId: IDS.noteApplication,
    snapshotId: IDS.noteSnapshot,
    slug: "phase10-private-note-application",
    title: "Private Arbeitgebernotiz",
  });
  await createJobApplication(target, {
    companyId: IDS.company,
    ownerUserId: IDS.owner,
    jobId: IDS.messageJob,
    revisionId: IDS.messageRevision,
    applicationId: IDS.messageApplication,
    snapshotId: IDS.messageSnapshot,
    slug: "phase10-message-application",
    title: "Nachricht zur Bewerbung",
  });
  await createJobApplication(target, {
    companyId: IDS.company,
    ownerUserId: IDS.owner,
    jobId: IDS.secondMessageJob,
    revisionId: IDS.secondMessageRevision,
    applicationId: IDS.secondMessageApplication,
    snapshotId: IDS.secondMessageSnapshot,
    slug: "phase10-second-message-application",
    title: "Zweite Nachricht zur Bewerbung",
  });
  await createJobApplication(target, {
    companyId: IDS.foreignCompany,
    ownerUserId: IDS.foreignOwner,
    jobId: IDS.foreignJob,
    revisionId: IDS.foreignRevision,
    applicationId: IDS.foreignApplication,
    snapshotId: IDS.foreignSnapshot,
    slug: "phase10-foreign-application",
    title: "Fremde Bewerbung",
  });

  await target.jobAssignment.createMany({
    data: [
      assignment(
        IDS.editorAssignment,
        IDS.editorMembership,
        IDS.editor,
        "EDITOR",
      ),
      assignment(
        IDS.pipelineAssignment,
        IDS.pipelineMembership,
        IDS.pipeline,
        "PIPELINE",
      ),
      assignment(
        IDS.reviewerAssignment,
        IDS.reviewerMembership,
        IDS.reviewer,
        "REVIEWER",
      ),
    ],
  });
}

async function createJobApplication(
  target: DatabaseClient,
  input: Readonly<{
    companyId: string;
    ownerUserId: string;
    jobId: string;
    revisionId: string;
    applicationId: string;
    snapshotId: string;
    slug: string;
    title: string;
  }>,
) {
  await target.job.create({
    data: {
      id: input.jobId,
      companyId: input.companyId,
      slug: input.slug,
      status: "DRAFT",
      sourceReference: `integration:${input.slug}`,
      dataProvenance: "TEST",
      createdByUserId: input.ownerUserId,
      createdAt: NOW,
    },
  });
  await target.jobRevision.create({
    data: {
      id: input.revisionId,
      jobId: input.jobId,
      revisionNumber: 1,
      title: input.title,
      description: "Fiktive Stellenbeschreibung für den Phase-10-Vertrag.",
      tasks: ["Bewerbungen sicher bearbeiten"],
      requirements: ["Mandantentrennung verstehen"],
      niceToHave: [],
      applicationProcessSteps: ["Bewerbung", "Gespräch"],
      requiredDocumentKinds: ["NONE"],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId: IDS.category,
      cantonId: IDS.canton,
      cityId: IDS.city,
      locationLabel: "Zürich",
      workloadMin: 80,
      workloadMax: 100,
      startByArrangement: true,
      validThrough: new Date(NOW.getTime() + 30 * 86_400_000),
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@phase10-applications.test",
      authoredByUserId: input.ownerUserId,
      contentChecksum: createHash("sha256").update(input.slug).digest("hex"),
      version: 1,
      createdAt: NOW,
    },
  });
  await target.job.update({
    where: { id: input.jobId },
    data: { currentRevisionId: input.revisionId },
  });
  await target.application.create({
    data: {
      id: input.applicationId,
      jobId: input.jobId,
      submittedJobRevisionId: input.revisionId,
      candidateProfileId: IDS.candidateProfile,
      idempotencyKey: `submission:${input.slug}`,
      submissionPayloadHash: createHash("sha256")
        .update(`submission:${input.slug}`)
        .digest("hex"),
      status: "SUBMITTED",
      coverLetter: "Fiktives Motivationsschreiben.",
      submittedAt: NOW,
      submissionSnapshot: {
        create: {
          id: input.snapshotId,
          candidateFirstName: "Mara",
          candidateLastName: "Muster",
          candidateEmail: "candidate-phase10-applications@example.test",
          coverLetterSnapshot: "Fiktives Motivationsschreiben.",
          recipientCompanyName:
            input.companyId === IDS.company
              ? "Phase 10 Bewerbungen AG"
              : "Fremder Phase 10 Mandant AG",
          applicationContactKind: "EMAIL",
          applicationContactValue: "jobs@phase10-applications.test",
          responseTargetDays: 7,
          applicationEffort: "SIMPLE",
          requiredDocumentKinds: ["NONE"],
          confirmationNoticeVersion: "phase10-test-v1",
          confirmationNoticeHash: createHash("sha256")
            .update(`notice:${input.slug}`)
            .digest("hex"),
          confirmationSnapshotHash: createHash("sha256")
            .update(`snapshot:${input.slug}`)
            .digest("hex"),
          submittedAt: NOW,
        },
      },
    },
  });
}

function user(
  userId: string,
  label: string,
  role: "CANDIDATE" | "EMPLOYER" | "RECRUITER",
) {
  const email = `${label}-phase10-applications@example.test`;
  return {
    id: userId,
    email,
    emailNormalized: email,
    name: label,
    role,
    status: "ACTIVE" as const,
    dataProvenance: "TEST" as const,
  };
}

function membership(
  membershipId: string,
  companyId: string,
  userId: string,
  role: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER",
) {
  return {
    id: membershipId,
    companyId,
    userId,
    role,
    status: "ACTIVE" as const,
    joinedAt: NOW,
  };
}

function assignment(
  assignmentId: string,
  membershipId: string,
  userId: string,
  role: "EDITOR" | "PIPELINE" | "REVIEWER",
) {
  return {
    id: assignmentId,
    membershipId,
    companyId: IDS.company,
    jobId: IDS.accessJob,
    userId,
    role,
    status: "ACTIVE" as const,
    assignedByUserId: IDS.owner,
    validFrom: new Date(NOW.getTime() - 60_000),
  };
}

function access(
  actor:
    | "owner"
    | "admin"
    | "editor"
    | "pipeline"
    | "reviewer"
    | "unassigned"
    | "viewer"
    | "foreignOwner",
): EmployerApplicationAccess {
  const actors = {
    owner: {
      userId: IDS.owner,
      membershipId: IDS.ownerMembership,
      membershipRole: "OWNER" as const,
      companyId: IDS.company,
    },
    admin: {
      userId: IDS.admin,
      membershipId: IDS.adminMembership,
      membershipRole: "ADMIN" as const,
      companyId: IDS.company,
    },
    editor: {
      userId: IDS.editor,
      membershipId: IDS.editorMembership,
      membershipRole: "RECRUITER" as const,
      companyId: IDS.company,
    },
    pipeline: {
      userId: IDS.pipeline,
      membershipId: IDS.pipelineMembership,
      membershipRole: "RECRUITER" as const,
      companyId: IDS.company,
    },
    reviewer: {
      userId: IDS.reviewer,
      membershipId: IDS.reviewerMembership,
      membershipRole: "RECRUITER" as const,
      companyId: IDS.company,
    },
    unassigned: {
      userId: IDS.unassigned,
      membershipId: IDS.unassignedMembership,
      membershipRole: "RECRUITER" as const,
      companyId: IDS.company,
    },
    viewer: {
      userId: IDS.viewer,
      membershipId: IDS.viewerMembership,
      membershipRole: "VIEWER" as const,
      companyId: IDS.company,
    },
    foreignOwner: {
      userId: IDS.foreignOwner,
      membershipId: IDS.foreignOwnerMembership,
      membershipRole: "OWNER" as const,
      companyId: IDS.foreignCompany,
    },
  } satisfies Record<string, EmployerApplicationAccess>;
  return Object.freeze(actors[actor]);
}

function dependencies(index: number, emailProvider?: EmailProvider) {
  return Object.freeze({
    database: client(),
    environment: runtimeEnvironment(),
    request: requestContext(index),
    now: NOW,
    ...(emailProvider === undefined ? {} : { emailProvider }),
  });
}

function requestContext(index: number): AuthRequestContext {
  return Object.freeze({
    correlationId: `b2000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    expectedOrigin: APP_URL,
    origin: APP_URL,
    production: false,
    sourceIp: "203.0.113.210",
    userAgent: "SwissTalentHub Phase-10 application integration test",
  });
}

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The Phase-10 application test database is unavailable.");
  }
  return database;
}

function runtimeEnvironment(): ServerEnvironment {
  if (environment === undefined) {
    throw new Error("The Phase-10 application test environment is unavailable.");
  }
  return environment;
}
