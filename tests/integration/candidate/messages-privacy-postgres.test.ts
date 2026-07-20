import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  countCandidateUnreadMessages,
  markCandidateNotificationRead,
} from "@/lib/candidate/dashboard";
import {
  getCandidateConversation,
  listCandidateConversations,
  sendCandidateMessage,
} from "@/lib/candidate/messages";
import { getCandidatePrivacyDashboard } from "@/lib/candidate/privacy-dashboard";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { buildNotificationPersistenceRecord } from "@/lib/notifications/writer";
import { seedCandidateWorkflows } from "@/prisma/seed/blocks/candidate-workflows";
import { seedDemoAccountsCompaniesAndJobs } from "@/prisma/seed/blocks/companies-jobs";
import { seedReferenceCatalog } from "@/prisma/seed/blocks/reference-catalog";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type Isolated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let isolated: Isolated | undefined;
let database: DatabaseClient | undefined;
let candidateUsers: readonly Readonly<{ id: string; userId: string }>[] = [];

const ANCHOR = new Date("2026-07-20T00:00:00.000Z");

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase09_messages_privacy");
  database = createDatabaseClient(isolated.connectionString);
  await seedReferenceCatalog(client());
  const dependencies = await seedDemoAccountsCompaniesAndJobs(client(), ANCHOR);
  const seeded = await seedCandidateWorkflows(client(), ANCHOR, dependencies);
  candidateUsers = seeded.candidates;
}, 180_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  await isolated?.dispose();
  database = undefined;
  isolated = undefined;
});

describe.sequential("Phase 09 candidate messages and privacy", () => {
  it("scopes conversation reads, sanitizes writes and makes retries idempotent", async () => {
    const owner = candidateUsers[0]!;
    const foreign = candidateUsers[1]!;
    const conversation = await client().conversation.findFirstOrThrow({
      where: { application: { candidateProfileId: owner.id } },
      select: { id: true },
    });

    await expect(getCandidateConversation(client(), owner.userId, conversation.id)).resolves.not.toBeNull();
    await expect(getCandidateConversation(client(), foreign.userId, conversation.id)).resolves.toBeNull();

    const idempotencyKey = `message-test-${randomUUID()}`;
    const first = await sendCandidateMessage(client(), owner.userId, {
      conversationId: conversation.id,
      body: "<script>steal()</script> Hallo aus dem sicheren Test.",
      idempotencyKey,
    }, ANCHOR);
    expect(first).toMatchObject({ ok: true, duplicate: false });
    const retry = await sendCandidateMessage(client(), owner.userId, {
      conversationId: conversation.id,
      body: "<script>steal()</script> Hallo aus dem sicheren Test.",
      idempotencyKey,
    }, ANCHOR);
    expect(retry).toMatchObject({ ok: true, duplicate: true });

    const stored = await client().message.findMany({ where: { idempotencyKey } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.body).toBe("Hallo aus dem sicheren Test.");
    await expect(sendCandidateMessage(client(), foreign.userId, {
      conversationId: conversation.id,
      body: "Fremder Zugriff darf nicht funktionieren.",
      idempotencyKey: `foreign-${randomUUID()}`,
    }, ANCHOR)).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("notifies the active application pipeline assignee but excludes inactive recipients", async () => {
    const owner = candidateUsers[0]!;
    const conversation = await client().conversation.findFirstOrThrow({
      where: { application: { candidateProfileId: owner.id } },
      select: {
        id: true,
        application: {
          select: {
            jobId: true,
            job: { select: { companyId: true, createdByUserId: true } },
          },
        },
      },
    });
    const application = conversation.application;
    if (application === null) {
      throw new Error("Expected an application conversation for notification policy testing.");
    }

    const suffix = randomUUID();
    const recipients = [
      {
        userId: randomUUID(),
        membershipId: randomUUID(),
        email: `pipeline-active-${suffix}@example.test`,
        userStatus: "ACTIVE" as const,
        membershipRole: "RECRUITER" as const,
        assignmentStatus: "ACTIVE" as const,
        revokedAt: null,
      },
      {
        userId: randomUUID(),
        membershipId: randomUUID(),
        email: `pipeline-user-inactive-${suffix}@example.test`,
        userStatus: "SUSPENDED" as const,
        membershipRole: "ADMIN" as const,
        assignmentStatus: "ACTIVE" as const,
        revokedAt: null,
      },
      {
        userId: randomUUID(),
        membershipId: randomUUID(),
        email: `pipeline-assignment-inactive-${suffix}@example.test`,
        userStatus: "ACTIVE" as const,
        membershipRole: "RECRUITER" as const,
        assignmentStatus: "REVOKED" as const,
        revokedAt: new Date(ANCHOR.getTime() - 60_000),
      },
    ] as const;
    const replyAt = ANCHOR;

    await client().user.createMany({
      data: recipients.map((recipient) => ({
        id: recipient.userId,
        email: recipient.email,
        emailNormalized: recipient.email,
        role: "RECRUITER" as const,
        status: recipient.userStatus,
        dataProvenance: "TEST" as const,
        emailVerifiedAt: ANCHOR,
      })),
    });
    await client().companyMembership.createMany({
      data: recipients.map((recipient) => ({
        id: recipient.membershipId,
        companyId: application.job.companyId,
        userId: recipient.userId,
        role: recipient.membershipRole,
        status: "ACTIVE" as const,
        joinedAt: new Date(ANCHOR.getTime() - 60 * 60_000),
      })),
    });
    await client().jobAssignment.createMany({
      data: recipients.map((recipient) => ({
        id: randomUUID(),
        membershipId: recipient.membershipId,
        companyId: application.job.companyId,
        jobId: application.jobId,
        userId: recipient.userId,
        role: "PIPELINE" as const,
        status: recipient.assignmentStatus,
        assignedByUserId: application.job.createdByUserId,
        validFrom: new Date(ANCHOR.getTime() - 60 * 60_000),
        expiresAt: null,
        revokedAt: recipient.revokedAt,
      })),
    });
    const eligibleFixtureRecipients = await client().companyMembership.findMany({
      where: {
        companyId: application.job.companyId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
        OR: [
          { role: { in: ["OWNER", "ADMIN"] } },
          {
            jobAssignments: {
              some: {
                jobId: application.jobId,
                role: "PIPELINE",
                status: "ACTIVE",
                validFrom: { lte: replyAt },
                revokedAt: null,
                OR: [{ expiresAt: null }, { expiresAt: { gt: replyAt } }],
              },
            },
          },
        ],
        userId: { in: recipients.map(({ userId }) => userId) },
      },
      select: { userId: true },
    });
    expect(eligibleFixtureRecipients).toEqual([
      { userId: recipients[0].userId },
    ]);

    const result = await sendCandidateMessage(client(), owner.userId, {
      conversationId: conversation.id,
      body: "Antwort der Kandidatin an das verantwortliche Pipeline-Team.",
      idempotencyKey: `message-pipeline-recipient-${suffix}`,
    }, replyAt);
    expect(result).toMatchObject({ ok: true, duplicate: false });
    if (!result.ok) throw new Error("Expected candidate reply creation to succeed.");

    const messageNotifications = await client().notification.findMany({
      where: {
        kind: "MESSAGE_RECEIVED",
        recipientUserId: { in: recipients.map(({ userId }) => userId) },
      },
      orderBy: { recipientUserId: "asc" },
      select: { recipientUserId: true },
    });
    expect(messageNotifications).toEqual(expect.arrayContaining([
      { recipientUserId: recipients[0].userId },
    ]));
    expect(messageNotifications).not.toEqual(expect.arrayContaining([
      { recipientUserId: recipients[1].userId },
      { recipientUserId: recipients[2].userId },
    ]));
  });

  it("resolves concurrent message idempotency races without weakening conflicts", async () => {
    const owner = candidateUsers[0]!;
    const conversation = await client().conversation.findFirstOrThrow({
      where: { application: { candidateProfileId: owner.id } },
      select: { id: true },
    });
    await installConcurrentMessageDelay();
    const left = createDatabaseClient(isolated!.connectionString);
    const right = createDatabaseClient(isolated!.connectionString);

    try {
      const matchingKey = `message-concurrent-match-${randomUUID()}`;
      const matchingInput = {
        conversationId: conversation.id,
        body: "<script>ignored()</script> Identischer paralleler Replay.",
        idempotencyKey: matchingKey,
      };
      const matching = await Promise.all([
        sendCandidateMessage(left, owner.userId, matchingInput, ANCHOR),
        sendCandidateMessage(right, owner.userId, matchingInput, ANCHOR),
      ]);

      expect(matching).toEqual(expect.arrayContaining([
        expect.objectContaining({ ok: true, duplicate: false }),
        expect.objectContaining({ ok: true, duplicate: true }),
      ]));
      const matchingStored = await client().message.findMany({
        where: { idempotencyKey: matchingKey },
        select: { body: true },
      });
      expect(matchingStored).toEqual([{ body: "Identischer paralleler Replay." }]);

      const conflictingKey = `message-concurrent-conflict-${randomUUID()}`;
      const conflicting = await Promise.all([
        sendCandidateMessage(left, owner.userId, {
          conversationId: conversation.id,
          body: "Paralleler Inhalt A",
          idempotencyKey: conflictingKey,
        }, ANCHOR),
        sendCandidateMessage(right, owner.userId, {
          conversationId: conversation.id,
          body: "Paralleler Inhalt B",
          idempotencyKey: conflictingKey,
        }, ANCHOR),
      ]);

      expect(conflicting).toEqual(expect.arrayContaining([
        expect.objectContaining({ ok: true, duplicate: false }),
        { ok: false, code: "CONFLICT" },
      ]));
      await expect(client().message.count({
        where: { idempotencyKey: conflictingKey },
      })).resolves.toBe(1);
    } finally {
      await Promise.all([
        left.$disconnect().catch(() => undefined),
        right.$disconnect().catch(() => undefined),
      ]);
      await removeConcurrentMessageDelay();
    }
  });

  it("lists only real application or accepted Radar conversations", async () => {
    const owner = candidateUsers[0]!;
    const conversationPage = await listCandidateConversations(client(), owner.userId);
    const conversations = conversationPage.items;
    expect(conversations.length).toBeGreaterThan(0);
    expect(conversationPage).toMatchObject({ page: 1, pageSize: 25, from: 1 });
    expect(conversations.every((item) => item.kind === "APPLICATION" || item.kind === "TALENT_RADAR")).toBe(true);
    const pendingConversationCount = await client().conversation.count({
      where: {
        participants: { some: { kind: "USER", userId: owner.userId } },
        contactRequest: { status: { in: ["PENDING", "DECLINED"] } },
      },
    });
    expect(pendingConversationCount).toBe(0);
  });

  it("counts unread messages across more than 50 candidate conversations", async () => {
    const owner = candidateUsers[0]!;
    const unreadBefore = await countCandidateUnreadMessages(client(), owner.userId, owner.id);
    const jobs = await client().job.findMany({
      where: {
        publishedRevisionId: { not: null },
        applications: { none: { candidateProfileId: owner.id } },
        company: {
          memberships: {
            some: { status: "ACTIVE", user: { status: "ACTIVE" } },
          },
        },
      },
      orderBy: { id: "asc" },
      take: 51,
      select: {
        id: true,
        companyId: true,
        publishedRevisionId: true,
        company: {
          select: {
            memberships: {
              where: { status: "ACTIVE", user: { status: "ACTIVE" } },
              orderBy: { id: "asc" },
              take: 1,
              select: { userId: true },
            },
          },
        },
      },
    });
    expect(jobs).toHaveLength(51);

    const fixtures = jobs.map((job, index) => ({
      applicationId: randomUUID(),
      conversationId: randomUUID(),
      companyId: job.companyId,
      employerUserId: job.company.memberships[0]!.userId,
      jobId: job.id,
      revisionId: job.publishedRevisionId!,
      suffix: `${String(index).padStart(2, "0")}-${randomUUID()}`,
    }));
    const unreadAt = new Date(ANCHOR.getTime() + 12 * 60 * 60 * 1_000);

    await client().application.createMany({
      data: fixtures.map((fixture) => ({
        id: fixture.applicationId,
        jobId: fixture.jobId,
        submittedJobRevisionId: fixture.revisionId,
        candidateProfileId: owner.id,
        idempotencyKey: `unread-app-${fixture.suffix}`,
        submissionPayloadHash: "c".repeat(64),
        submittedAt: ANCHOR,
      })),
    });
    await client().conversation.createMany({
      data: fixtures.map((fixture, index) => ({
        id: fixture.conversationId,
        companyId: fixture.companyId,
        kind: "APPLICATION" as const,
        applicationId: fixture.applicationId,
        subject: `Unread aggregation regression ${index + 1}`,
        createdAt: ANCHOR,
      })),
    });
    await client().conversationParticipant.createMany({
      data: fixtures.flatMap((fixture) => [
        {
          id: randomUUID(),
          conversationId: fixture.conversationId,
          kind: "USER" as const,
          userId: owner.userId,
          joinedAt: ANCHOR,
          lastReadAt: ANCHOR,
        },
        {
          id: randomUUID(),
          conversationId: fixture.conversationId,
          kind: "COMPANY_PRINCIPAL" as const,
          companyId: fixture.companyId,
          joinedAt: ANCHOR,
          lastReadAt: ANCHOR,
        },
      ]),
    });
    await client().message.createMany({
      data: fixtures.map((fixture) => ({
        id: randomUUID(),
        conversationId: fixture.conversationId,
        senderUserId: fixture.employerUserId,
        idempotencyKey: `unread-message-${fixture.suffix}`,
        body: "Unread aggregation regression message",
        createdAt: unreadAt,
      })),
    });

    await expect(
      countCandidateUnreadMessages(client(), owner.userId, owner.id),
    ).resolves.toBe(unreadBefore + 51);
  });

  it("paginates every candidate conversation beyond 50 without loss", async () => {
    const owner = candidateUsers[0]!;
    const scopedTotal = await client().conversation.count({
      where: {
        participants: { some: { kind: "USER", userId: owner.userId, leftAt: null } },
        OR: [
          { kind: "APPLICATION", application: { candidateProfileId: owner.id } },
          {
            kind: "TALENT_RADAR",
            contactRequest: { candidateProfileId: owner.id, status: "ACCEPTED" },
          },
        ],
      },
    });
    expect(scopedTotal).toBeGreaterThan(50);

    const first = await listCandidateConversations(client(), owner.userId, { page: 1 });
    expect(first).toMatchObject({
      total: scopedTotal,
      page: 1,
      pageSize: 25,
      from: 1,
      to: 25,
    });
    const pages = [first];
    for (let page = 2; page <= first.totalPages; page += 1) {
      pages.push(await listCandidateConversations(client(), owner.userId, { page }));
    }

    for (const [index, page] of pages.entries()) {
      expect(page.page).toBe(index + 1);
      expect(page.items.length).toBeLessThanOrEqual(25);
      expect(page.from).toBe(index * 25 + 1);
      expect(page.to).toBe(Math.min((index + 1) * 25, scopedTotal));
      expect(page.total).toBe(scopedTotal);
    }
    const allItems = pages.flatMap(({ items }) => items);
    const allIds = allItems.map(({ id }) => id);
    expect(allIds).toHaveLength(scopedTotal);
    expect(new Set(allIds).size).toBe(scopedTotal);
    const stablySorted = [...allItems].sort((left, right) => {
      const updatedAt = right.updatedAt.getTime() - left.updatedAt.getTime();
      if (updatedAt !== 0) return updatedAt;
      return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
    });
    expect(allIds).toEqual(stablySorted.map(({ id }) => id));

    const clamped = await listCandidateConversations(client(), owner.userId, {
      page: Number.MAX_SAFE_INTEGER,
    });
    expect(clamped.page).toBe(first.totalPages);
    expect(clamped.items.map(({ id }) => id)).toEqual(
      pages.at(-1)!.items.map(({ id }) => id),
    );
  });

  it("paginates more than 200 owned messages without gaps or duplicates", async () => {
    const owner = candidateUsers[0]!;
    const foreign = candidateUsers[1]!;
    const conversation = await client().conversation.findFirstOrThrow({
      where: { application: { candidateProfileId: owner.id } },
      select: { id: true },
    });
    await client().message.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        conversationId: conversation.id,
        senderUserId: owner.userId,
        idempotencyKey: `message-history-${String(index).padStart(3, "0")}`,
        body: `history-${String(index).padStart(3, "0")}`,
        createdAt: new Date(
          ANCHOR.getTime() + 24 * 60 * 60 * 1_000 + Math.floor(index / 2) * 1_000,
        ),
      })),
    });

    const pages = [];
    let beforeMessageId: string | undefined;
    do {
      const detail = await getCandidateConversation(
        client(),
        owner.userId,
        conversation.id,
        beforeMessageId === undefined ? {} : { beforeMessageId },
      );
      expect(detail).not.toBeNull();
      if (detail === null) throw new Error("Expected an owned conversation page.");
      expect(detail.messages.every(
        (message, index, messages) =>
          index === 0 ||
          messages[index - 1]!.createdAt < message.createdAt ||
          (messages[index - 1]!.createdAt.getTime() === message.createdAt.getTime() &&
            messages[index - 1]!.id < message.id),
      )).toBe(true);
      pages.push(detail.messages);
      beforeMessageId = detail.olderCursor ?? undefined;
    } while (beforeMessageId !== undefined);

    const expected = await client().message.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const chronological = [...pages].reverse().flatMap((page) => page);
    const allIds = chronological.map(({ id }) => id);
    expect(pages[0]).toHaveLength(200);
    expect(allIds).toHaveLength(expected.length);
    expect(new Set(allIds).size).toBe(expected.length);
    expect(allIds).toEqual(expected.map(({ id }) => id));
    expect(chronological.filter(({ body }) => body.startsWith("history-"))).toHaveLength(205);

    const firstPage = await getCandidateConversation(
      client(),
      owner.userId,
      conversation.id,
    );
    expect(firstPage?.olderCursor).not.toBeNull();
    await expect(getCandidateConversation(
      client(),
      foreign.userId,
      conversation.id,
      { beforeMessageId: firstPage!.olderCursor! },
    )).resolves.toBeNull();

    const foreignMessage = await client().message.findFirstOrThrow({
      where: {
        conversation: { application: { candidateProfileId: foreign.id } },
      },
      select: { id: true },
    });
    await expect(getCandidateConversation(
      client(),
      owner.userId,
      conversation.id,
      { beforeMessageId: foreignMessage.id },
    )).resolves.toBeNull();
  });

  it("returns a privacy-safe contact and consent dashboard", async () => {
    const owner = candidateUsers[0]!;
    const dashboard = await getCandidatePrivacyDashboard(client(), owner.userId);
    expect(dashboard).not.toBeNull();
    expect(dashboard?.consents.length).toBeGreaterThan(0);
    expect(dashboard?.contacts.length).toBeGreaterThan(0);
    expect(JSON.stringify(dashboard)).not.toContain("candidate@demo.ch");
    expect(JSON.stringify(dashboard)).not.toContain("phone");
  });

  it("scopes notification reads and keeps notification payload immutable", async () => {
    const owner = candidateUsers[0]!;
    const foreign = candidateUsers[1]!;
    const application = await client().application.findFirstOrThrow({
      where: { candidateProfileId: owner.id },
      select: { id: true },
    });
    const notification = buildNotificationPersistenceRecord({
      recipientUserId: owner.userId,
      kind: "APPLICATION_SUBMITTED",
      dedupeKey: `phase09-test:${application.id}`,
      payload: { applicationId: application.id, status: "SUBMITTED" },
    });
    const created = await client().notification.create({
      data: {
        ...notification,
        payload: notification.payload as Prisma.InputJsonObject,
      },
    });

    await expect(markCandidateNotificationRead(client(), foreign.userId, created.id, ANCHOR)).resolves.toBe(false);
    await expect(markCandidateNotificationRead(client(), owner.userId, created.id, ANCHOR)).resolves.toBe(true);
    await expect(client().notification.update({
      where: { id: created.id },
      data: { payload: { applicationId: application.id, status: "WITHDRAWN" } },
    })).rejects.toThrow();
  });

  it("withdraws Radar on explicit revoke and rejects obsolete notice publication", async () => {
    const owner = candidateUsers[0]!;
    const profile = await client().candidateProfile.findUniqueOrThrow({
      where: { id: owner.id },
      select: { radarProfile: { select: { id: true } } },
    });
    expect(profile.radarProfile).not.toBeNull();
    await client().candidateConsent.create({
      data: {
        candidateProfileId: owner.id,
        kind: "TALENT_RADAR_VISIBILITY",
        granted: false,
        noticeVersion: "talent-radar-v1",
        noticeHash: "a".repeat(64),
        actorUserId: owner.userId,
        effectiveAt: new Date(ANCHOR.getTime() + 1_000),
      },
    });
    const withdrawn = await client().radarProfile.findUniqueOrThrow({
      where: { candidateProfileId: owner.id },
      select: { withdrawnAt: true },
    });
    expect(withdrawn.withdrawnAt).not.toBeNull();

    await client().candidateConsent.create({
      data: {
        candidateProfileId: owner.id,
        kind: "TALENT_RADAR_VISIBILITY",
        granted: true,
        noticeVersion: "obsolete-radar-v0",
        noticeHash: "b".repeat(64),
        actorUserId: owner.userId,
        effectiveAt: new Date(ANCHOR.getTime() + 2_000),
      },
    });
    await expect(client().radarProfile.update({
      where: { candidateProfileId: owner.id },
      data: { publishedAt: new Date(ANCHOR.getTime() + 3_000), withdrawnAt: null },
    })).rejects.toThrow();
  });
});

function client() {
  if (database === undefined) throw new Error("Phase 09 integration database is unavailable.");
  return database;
}

async function installConcurrentMessageDelay() {
  await client().$executeRawUnsafe(`
    CREATE FUNCTION phase09_test_delay_concurrent_message() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."idempotencyKey" LIKE 'message-concurrent-%' THEN
        PERFORM pg_sleep(0.5);
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await client().$executeRawUnsafe(`
    CREATE TRIGGER phase09_test_delay_concurrent_message_trigger
    BEFORE INSERT ON "Message"
    FOR EACH ROW EXECUTE FUNCTION phase09_test_delay_concurrent_message()
  `);
}

async function removeConcurrentMessageDelay() {
  await client().$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS phase09_test_delay_concurrent_message_trigger ON "Message"
  `);
  await client().$executeRawUnsafe(`
    DROP FUNCTION IF EXISTS phase09_test_delay_concurrent_message()
  `);
}
