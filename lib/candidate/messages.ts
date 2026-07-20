import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import { buildNotificationPersistenceRecord } from "@/lib/notifications/writer";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

const UUID = z.string().uuid();
export const CANDIDATE_CONVERSATION_PAGE_SIZE = 25;
export const CANDIDATE_MESSAGE_PAGE_SIZE = 200;
export const candidateMessageInputSchema = z.strictObject({
  conversationId: UUID,
  body: z.string().trim().min(1).max(5_000),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export type CandidateConversationListItem = Readonly<{
  id: string;
  kind: "APPLICATION" | "TALENT_RADAR";
  subject: string;
  company: Readonly<{ name: string; slug: string }>;
  applicationId: string | null;
  lastMessage: Readonly<{ body: string; createdAt: Date; own: boolean }> | null;
  unreadCount: number;
  updatedAt: Date;
}>;

export type CandidateConversationPage = Readonly<{
  items: readonly CandidateConversationListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  from: number;
  to: number;
}>;

export async function listCandidateConversations(
  database: DatabaseClient,
  userId: string,
  options: Readonly<{ page?: number }> = {},
): Promise<CandidateConversationPage> {
  if (!UUID.safeParse(userId).success) return emptyCandidateConversationPage();
  const requestedPage = normalizeCandidateConversationPage(options.page);
  const where = candidateConversationWhere(userId);
  return database.$transaction(
    async (transaction) => {
      const total = await transaction.conversation.count({ where });
      const totalPages = Math.max(
        1,
        Math.ceil(total / CANDIDATE_CONVERSATION_PAGE_SIZE),
      );
      const page = Math.min(requestedPage, totalPages);
      const conversations = await transaction.conversation.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * CANDIDATE_CONVERSATION_PAGE_SIZE,
        take: CANDIDATE_CONVERSATION_PAGE_SIZE,
        select: {
          id: true,
          kind: true,
          subject: true,
          applicationId: true,
          updatedAt: true,
          company: { select: { name: true, slug: true } },
          participants: {
            where: { kind: "USER", userId, leftAt: null },
            take: 1,
            select: { lastReadAt: true },
          },
          messages: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { body: true, createdAt: true, senderUserId: true },
          },
        },
      });
      const pageItems: CandidateConversationListItem[] = [];
      for (const conversation of conversations) {
        const lastReadAt = conversation.participants[0]?.lastReadAt ?? new Date(0);
        const unreadCount = await transaction.message.count({
          where: {
            conversationId: conversation.id,
            senderUserId: { not: userId },
            createdAt: { gt: lastReadAt },
          },
        });
        const latest = conversation.messages[0];
        pageItems.push(Object.freeze({
          id: conversation.id,
          kind: conversation.kind,
          subject: conversation.subject,
          company: Object.freeze(conversation.company),
          applicationId: conversation.applicationId,
          lastMessage: latest === undefined ? null : Object.freeze({
            body: latest.body,
            createdAt: new Date(latest.createdAt),
            own: latest.senderUserId === userId,
          }),
          unreadCount,
          updatedAt: new Date(conversation.updatedAt),
        }));
      }
      const items = Object.freeze(pageItems);
      const from = total === 0
        ? 0
        : (page - 1) * CANDIDATE_CONVERSATION_PAGE_SIZE + 1;
      return Object.freeze({
        items,
        total,
        page,
        pageSize: CANDIDATE_CONVERSATION_PAGE_SIZE,
        totalPages,
        from,
        to: total === 0 ? 0 : from + items.length - 1,
      });
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export function normalizeCandidateConversationPage(
  value: number | string | readonly string[] | undefined,
): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = z.coerce
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .safeParse(candidate);
  return parsed.success ? parsed.data : 1;
}

function emptyCandidateConversationPage(): CandidateConversationPage {
  return Object.freeze({
    items: Object.freeze([]),
    total: 0,
    page: 1,
    pageSize: CANDIDATE_CONVERSATION_PAGE_SIZE,
    totalPages: 1,
    from: 0,
    to: 0,
  });
}

export async function getCandidateConversation(
  database: DatabaseClient,
  userId: string,
  conversationId: string,
  options: Readonly<{ beforeMessageId?: string }> = {},
) {
  if (
    !UUID.safeParse(userId).success ||
    !UUID.safeParse(conversationId).success ||
    (options.beforeMessageId !== undefined &&
      !UUID.safeParse(options.beforeMessageId).success)
  ) {
    return null;
  }
  const ownedConversationWhere = candidateConversationWhere(userId);
  return database.$transaction(
    async (transaction) => {
      const conversation = await transaction.conversation.findFirst({
        where: { id: conversationId, ...ownedConversationWhere },
        select: {
          id: true,
          kind: true,
          subject: true,
          applicationId: true,
          contactRequestId: true,
          company: { select: { id: true, name: true, slug: true } },
          participants: {
            where: { kind: "USER", userId, leftAt: null },
            take: 1,
            select: { lastReadAt: true },
          },
        },
      });
      if (conversation === null) return null;

      const anchor = options.beforeMessageId === undefined
        ? null
        : await transaction.message.findFirst({
            where: {
              id: options.beforeMessageId,
              conversationId,
              conversation: ownedConversationWhere,
            },
            select: { id: true, createdAt: true },
          });
      if (options.beforeMessageId !== undefined && anchor === null) return null;

      const descendingMessages = await transaction.message.findMany({
        where: {
          conversationId,
          conversation: ownedConversationWhere,
          ...(anchor === null
            ? {}
            : {
                OR: [
                  { createdAt: { lt: anchor.createdAt } },
                  { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                ],
              }),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: CANDIDATE_MESSAGE_PAGE_SIZE + 1,
        select: {
          id: true,
          body: true,
          senderUserId: true,
          createdAt: true,
          editedAt: true,
        },
      });
      const pageMessages = descendingMessages.slice(0, CANDIDATE_MESSAGE_PAGE_SIZE);
      const olderCursor = descendingMessages.length > CANDIDATE_MESSAGE_PAGE_SIZE
        ? pageMessages.at(-1)?.id ?? null
        : null;

      return Object.freeze({
        ...conversation,
        messages: Object.freeze(
          [...pageMessages]
            .reverse()
            .map((message) => Object.freeze({
              ...message,
              own: message.senderUserId === userId,
            })),
        ),
        olderCursor,
      });
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export type SendCandidateMessageResult =
  | Readonly<{ ok: true; messageId: string; duplicate: boolean }>
  | Readonly<{ ok: false; code: "INVALID" | "NOT_FOUND" | "CONFLICT" }>;

export async function sendCandidateMessage(
  database: DatabaseClient,
  userId: string,
  rawInput: unknown,
  now = new Date(),
): Promise<SendCandidateMessageResult> {
  const parsed = candidateMessageInputSchema.safeParse(rawInput);
  if (!parsed.success || !UUID.safeParse(userId).success || !Number.isFinite(now.getTime())) {
    return Object.freeze({ ok: false, code: "INVALID" });
  }
  const body = stripUnsafeHtml(parsed.data.body);
  if (body.length === 0 || [...body].length > 5_000) {
    return Object.freeze({ ok: false, code: "INVALID" });
  }

  try {
    return await database.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.findFirst({
        where: {
          id: parsed.data.conversationId,
          ...candidateConversationWhere(userId),
        },
        select: {
          id: true,
          companyId: true,
          applicationId: true,
          application: { select: { jobId: true } },
        },
      });
      if (conversation === null) return Object.freeze({ ok: false as const, code: "NOT_FOUND" as const });

      const existing = await transaction.message.findUnique({
        where: { idempotencyKey: parsed.data.idempotencyKey },
        select: { id: true, conversationId: true, senderUserId: true, body: true },
      });
      if (existing !== null) {
        return existing.conversationId === conversation.id &&
          existing.senderUserId === userId && existing.body === body
          ? Object.freeze({ ok: true as const, messageId: existing.id, duplicate: true })
          : Object.freeze({ ok: false as const, code: "CONFLICT" as const });
      }

      const created = await transaction.message.create({
        data: {
          conversationId: conversation.id,
          senderUserId: userId,
          idempotencyKey: parsed.data.idempotencyKey,
          body,
          createdAt: now,
        },
        select: { id: true },
      });
      await transaction.conversationParticipant.updateMany({
        where: { conversationId: conversation.id, kind: "USER", userId, leftAt: null },
        data: { lastReadAt: now },
      });
      if (conversation.applicationId !== null) {
        await transaction.applicationEvent.create({
          data: {
            applicationId: conversation.applicationId,
            actorUserId: userId,
            kind: "MESSAGE_SENT",
            idempotencyKey: `message:${created.id}`,
            correlationId: randomUUID(),
            metadata: Prisma.JsonNull,
            createdAt: now,
          },
        });
      }

      const recipients = await loadCandidateReplyNotificationRecipients(
        transaction,
        conversation.companyId,
        conversation.application?.jobId ?? null,
        now,
      );
      for (const recipient of recipients) {
        const notification = buildNotificationPersistenceRecord({
          recipientUserId: recipient,
          kind: "MESSAGE_RECEIVED",
          dedupeKey: `message:${created.id}`,
          payload: { conversationId: conversation.id, status: "UNREAD" },
        });
        await transaction.notification.upsert({
          where: {
            recipientUserId_kind_dedupeKey: {
              recipientUserId: notification.recipientUserId,
              kind: notification.kind,
              dedupeKey: notification.dedupeKey,
            },
          },
          update: {},
          create: {
            ...notification,
            payload: notification.payload as Prisma.InputJsonObject,
          },
        });
      }

      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "MESSAGE_SENT",
        actorKind: "USER",
        actorUserId: userId,
        capability: "CANDIDATE_CONVERSATION_MESSAGE_SEND",
        companyId: conversation.companyId,
        correlationId: randomUUID(),
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + 400 * 86_400_000),
        targetId: created.id,
        targetType: "MESSAGE",
      });
      return Object.freeze({ ok: true as const, messageId: created.id, duplicate: false });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return resolveCandidateMessageUniqueRace(
        database,
        userId,
        parsed.data.conversationId,
        parsed.data.idempotencyKey,
        body,
      );
    }
    throw error;
  }
}

async function loadCandidateReplyNotificationRecipients(
  transaction: Prisma.TransactionClient,
  companyId: string,
  applicationJobId: string | null,
  now: Date,
): Promise<readonly string[]> {
  const memberships = await transaction.companyMembership.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      OR: [
        { role: { in: ["OWNER", "ADMIN"] } },
        ...(applicationJobId === null
          ? []
          : [{
              jobAssignments: {
                some: {
                  jobId: applicationJobId,
                  role: "PIPELINE" as const,
                  status: "ACTIVE" as const,
                  validFrom: { lte: now },
                  revokedAt: null,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                },
              },
            }]),
      ],
    },
    select: { userId: true },
  });
  return Object.freeze([...new Set(memberships.map(({ userId }) => userId))]);
}

async function resolveCandidateMessageUniqueRace(
  database: DatabaseClient,
  userId: string,
  conversationId: string,
  idempotencyKey: string,
  body: string,
): Promise<SendCandidateMessageResult> {
  const existing = await database.message.findFirst({
    where: {
      idempotencyKey,
      conversation: candidateConversationWhere(userId),
    },
    select: { id: true, conversationId: true, senderUserId: true, body: true },
  });
  if (
    existing !== null &&
    existing.conversationId === conversationId &&
    existing.senderUserId === userId &&
    existing.body === body
  ) {
    return Object.freeze({ ok: true, messageId: existing.id, duplicate: true });
  }
  return Object.freeze({ ok: false, code: "CONFLICT" });
}

export async function markCandidateConversationRead(
  database: DatabaseClient,
  userId: string,
  conversationId: string,
  now = new Date(),
): Promise<boolean> {
  if (!UUID.safeParse(userId).success || !UUID.safeParse(conversationId).success) return false;
  const owned = await database.conversation.findFirst({
    where: { id: conversationId, ...candidateConversationWhere(userId) },
    select: { id: true },
  });
  if (owned === null) return false;
  const updated = await database.conversationParticipant.updateMany({
    where: { conversationId, kind: "USER", userId, leftAt: null },
    data: { lastReadAt: now },
  });
  return updated.count === 1;
}

function candidateConversationWhere(userId: string): Prisma.ConversationWhereInput {
  return {
    participants: { some: { kind: "USER", userId, leftAt: null } },
    OR: [
      {
        kind: "APPLICATION",
        application: { candidateProfile: { userId } },
      },
      {
        kind: "TALENT_RADAR",
        contactRequest: { status: "ACCEPTED", candidateProfile: { userId } },
      },
    ],
  };
}
