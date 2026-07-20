import "server-only";

import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { DatabaseClient } from "@/lib/db/factory";
import type { ApplicationStatus } from "@/lib/policies/status/application";
import { getPublicJobBySlug } from "@/lib/jobs/public-read-model";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import {
  applicationListFilterSchema,
  type ApplicationListFilter,
} from "@/lib/applications/contracts";

export const CANDIDATE_APPLICATION_PAGE_SIZE = 25;
const MAXIMUM_APPLICATION_TIMELINE_EVENTS = 200;

export type CandidateApplicationListItem = Readonly<{
  id: string;
  jobTitle: string;
  companyName: string;
  submittedAt: Date;
  status: ApplicationStatus;
  lastUpdatedAt: Date;
  employerResponseMinutes: number;
  employerHasResponded: boolean;
  hasCandidateNote: boolean;
  conversationId: string | null;
}>;

export type CandidateApplicationPage = Readonly<{
  items: readonly CandidateApplicationListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  from: number;
  to: number;
}>;

export type CandidateApplicationDetail = Readonly<{
  id: string;
  jobTitle: string;
  companyName: string;
  submittedAt: Date;
  status: ApplicationStatus;
  rejectionReason: string | null;
  rejectionNote: string | null;
  candidateNote: string | null;
  conversationId: string | null;
  jobContext: Readonly<{
    current: boolean;
    slug: string;
    label: string;
  }>;
  timeline: readonly Readonly<{
    id: string;
    kind: string;
    fromStatus: ApplicationStatus | null;
    toStatus: ApplicationStatus | null;
    actorLabel: "Du" | "Unternehmen" | "System";
    createdAt: Date;
  }>[];
}>;

export async function listCandidateApplications(
  candidateUserId: string,
  rawFilter: unknown,
  database: DatabaseClient,
  options: Readonly<{ now?: Date; page?: number }> = {},
): Promise<CandidateApplicationPage> {
  const filter = applicationListFilterSchema.safeParse(rawFilter);
  if (!filter.success) return emptyCandidateApplicationPage();
  const now = options.now ?? new Date();
  const requestedPage = normalizeCandidateApplicationPage(options.page);
  const where = applicationListWhere(candidateUserId, filter.data);
  return database.$transaction(
    async (transaction) => {
      const total = await transaction.application.count({ where });
      const totalPages = Math.max(
        1,
        Math.ceil(total / CANDIDATE_APPLICATION_PAGE_SIZE),
      );
      const page = Math.min(requestedPage, totalPages);
      const rows = await transaction.application.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * CANDIDATE_APPLICATION_PAGE_SIZE,
        take: CANDIDATE_APPLICATION_PAGE_SIZE,
        select: {
          id: true,
          status: true,
          submittedAt: true,
          updatedAt: true,
          submittedJobRevision: { select: { title: true } },
          job: { select: { company: { select: { name: true } } } },
          candidateNote: { select: { id: true } },
          conversation: {
            select: {
              id: true,
              participants: {
                where: { userId: candidateUserId, leftAt: null },
                select: { id: true },
                take: 1,
              },
            },
          },
          events: {
            where: {
              kind: "STATUS_CHANGE",
              actorUserId: { not: candidateUserId },
              toStatus: { not: "SUBMITTED" },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { createdAt: true },
          },
        },
      });
      const items = Object.freeze(
        rows.map((row) => toCandidateApplicationListItem(row, now)),
      );
      const from = total === 0 ? 0 : (page - 1) * CANDIDATE_APPLICATION_PAGE_SIZE + 1;
      return Object.freeze({
        items,
        total,
        page,
        pageSize: CANDIDATE_APPLICATION_PAGE_SIZE,
        totalPages,
        from,
        to: total === 0 ? 0 : from + items.length - 1,
      });
    },
    { isolationLevel: "RepeatableRead" },
  );
}

function applicationListWhere(
  candidateUserId: string,
  filter: ApplicationListFilter,
): Prisma.ApplicationWhereInput {
  return {
    candidateProfile: { userId: candidateUserId },
    ...(filter.status === undefined ? {} : { status: filter.status }),
    ...(filter.query === undefined || filter.query.length === 0
      ? {}
      : {
          OR: [
            {
              submittedJobRevision: {
                title: { contains: filter.query, mode: "insensitive" as const },
              },
            },
            {
              job: {
                company: {
                  name: { contains: filter.query, mode: "insensitive" as const },
                },
              },
            },
          ],
        }),
  };
}

function toCandidateApplicationListItem(
  row: Readonly<{
    id: string;
    status: ApplicationStatus;
    submittedAt: Date;
    updatedAt: Date;
    submittedJobRevision: Readonly<{ title: string }>;
    job: Readonly<{ company: Readonly<{ name: string }> }>;
    candidateNote: Readonly<{ id: string }> | null;
    conversation: Readonly<{
      id: string;
      participants: readonly Readonly<{ id: string }>[];
    }> | null;
    events: readonly Readonly<{ createdAt: Date }>[];
  }>,
  now: Date,
): CandidateApplicationListItem {
  const firstEmployerResponse = row.events[0]?.createdAt;
  const responseEnd = firstEmployerResponse ?? now;
  return Object.freeze({
    id: row.id,
    jobTitle: stripUnsafeHtml(row.submittedJobRevision.title),
    companyName: stripUnsafeHtml(row.job.company.name),
    submittedAt: new Date(row.submittedAt),
    status: row.status,
    lastUpdatedAt: new Date(row.updatedAt),
    employerResponseMinutes: Math.max(
      0,
      Math.floor((responseEnd.getTime() - row.submittedAt.getTime()) / 60_000),
    ),
    employerHasResponded: firstEmployerResponse !== undefined,
    hasCandidateNote: row.candidateNote !== null,
    conversationId:
      row.conversation !== null && row.conversation.participants.length === 1
        ? row.conversation.id
        : null,
  });
}

function emptyCandidateApplicationPage(): CandidateApplicationPage {
  return Object.freeze({
    items: Object.freeze([]),
    total: 0,
    page: 1,
    pageSize: CANDIDATE_APPLICATION_PAGE_SIZE,
    totalPages: 1,
    from: 0,
    to: 0,
  });
}

export async function getCandidateApplicationDetail(
  candidateUserId: string,
  applicationId: string,
  database: DatabaseClient,
  options: Readonly<{ now?: Date }> = {},
): Promise<CandidateApplicationDetail | null> {
  if (!z.uuid().safeParse(applicationId).success) return null;
  const row = await database.application.findFirst({
    where: {
      id: applicationId,
      candidateProfile: { userId: candidateUserId },
    },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      rejectionReason: true,
      rejectionNote: true,
      candidateProfile: { select: { userId: true } },
      submittedJobRevision: { select: { title: true } },
      candidateNote: { select: { body: true } },
      job: {
        select: {
          slug: true,
          status: true,
          company: { select: { name: true } },
        },
      },
      conversation: {
        select: {
          id: true,
          participants: {
            where: { userId: candidateUserId, leftAt: null },
            select: { id: true },
            take: 1,
          },
        },
      },
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAXIMUM_APPLICATION_TIMELINE_EVENTS,
        select: {
          id: true,
          kind: true,
          actorUserId: true,
          fromStatus: true,
          toStatus: true,
          createdAt: true,
        },
      },
    },
  });
  if (row === null) return null;
  const currentJob = await getPublicJobBySlug(row.job.slug, { now: options.now });
  return Object.freeze({
    id: row.id,
    jobTitle: stripUnsafeHtml(row.submittedJobRevision.title),
    companyName: stripUnsafeHtml(row.job.company.name),
    submittedAt: new Date(row.submittedAt),
    status: row.status,
    rejectionReason: row.rejectionReason,
    rejectionNote:
      row.rejectionNote === null ? null : stripUnsafeHtml(row.rejectionNote),
    candidateNote:
      row.candidateNote === null ? null : stripUnsafeHtml(row.candidateNote.body),
    conversationId:
      row.conversation !== null && row.conversation.participants.length === 1
        ? row.conversation.id
        : null,
    jobContext: Object.freeze({
      current: currentJob !== null,
      slug: row.job.slug,
      label: currentJob !== null
        ? "Stelle ist aktuell veröffentlicht"
        : row.job.status === "CLOSED"
          ? "Stelle wurde geschlossen"
          : row.job.status === "EXPIRED"
            ? "Stelle ist abgelaufen"
            : "Stelle ist nicht mehr öffentlich",
    }),
    timeline: Object.freeze(
      [...row.events].reverse().map((event) =>
        Object.freeze({
          id: event.id,
          kind: event.kind,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          actorLabel:
            event.actorUserId === row.candidateProfile.userId
              ? "Du"
              : event.actorUserId === null
                ? "System"
                : "Unternehmen",
          createdAt: new Date(event.createdAt),
        }),
      ),
    ),
  });
}

export function normalizeApplicationListFilter(input: Readonly<{
  status?: string | string[];
  query?: string | string[];
}>): ApplicationListFilter {
  const status = Array.isArray(input.status) ? input.status[0] : input.status;
  const query = Array.isArray(input.query) ? input.query[0] : input.query;
  const parsed = applicationListFilterSchema.safeParse({
    ...(status === undefined || status === "" ? {} : { status }),
    ...(query === undefined || query.trim() === "" ? {} : { query }),
  });
  return parsed.success ? Object.freeze(parsed.data) : Object.freeze({});
}

export function normalizeCandidateApplicationPage(
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
