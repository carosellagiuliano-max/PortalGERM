import "server-only";

import { z } from "zod";

import type { DatabaseClient } from "@/lib/db/factory";
import type {
  JobType,
  LanguageLevel,
  RemotePreference,
  SalaryPeriod,
  WorkPermitType,
} from "@/lib/generated/prisma/enums";
import {
  emptyPublicJobSearchInput,
  getPublicJobBySlug,
  listPublicJobs,
} from "@/lib/jobs/public-read-model";
import { parseNotificationPayloadV1 } from "@/lib/notifications/payloads-v1";
import type { PublicJobCardModel, PublicJobDetailModel } from "@/lib/public/types";
import { calculateCandidateMatchV1 } from "@/lib/scoring/match-score";

import {
  calculateCandidateProfileProgress,
  TALENT_RADAR_VISIBILITY_NOTICE_V1,
} from "./profile";

const UUID = z.string().uuid();
const DASHBOARD_NOTIFICATION_KINDS = [
  "APPLICATION_SUBMITTED",
  "APPLICATION_STATUS_CHANGED",
  "MESSAGE_RECEIVED",
  "CONTACT_REQUEST_RECEIVED",
  "CONTACT_REQUEST_ACCEPTED",
  "CONTACT_REQUEST_DECLINED",
  "CONTACT_REQUEST_CANCELLED",
  "PRIVACY_REQUEST_CHANGED",
] as const;
const DASHBOARD_APPLICATION_STATUSES = [
  "SUBMITTED",
  "IN_REVIEW",
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export async function getCandidateDashboard(
  database: DatabaseClient,
  userId: string,
  now = new Date(),
) {
  if (!UUID.safeParse(userId).success || !Number.isFinite(now.getTime())) return null;
  const profile = await database.candidateProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      publicDisplayName: true,
      phone: true,
      cantonId: true,
      cityLabel: true,
      summary: true,
      workPermitType: true,
      onboardingStatus: true,
      canton: { select: { slug: true } },
      skills: { select: { skillId: true } },
      languages: { select: { code: true, level: true } },
      preference: {
        select: {
          desiredTitles: true,
          desiredJobTypes: true,
          salaryPeriod: true,
          salaryMinChf: true,
          salaryMaxChf: true,
          workloadMin: true,
          workloadMax: true,
          remotePreference: true,
          mobilityRadiusKm: true,
          availableFrom: true,
          categories: { select: { category: { select: { slug: true } } } },
        },
      },
      documents: { where: { status: "ACTIVE", purpose: "CV" }, take: 1, select: { id: true } },
      radarConsents: {
        where: { effectiveAt: { lte: now } },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { granted: true, noticeVersion: true, noticeHash: true },
      },
      radarProfile: { select: { publishedAt: true, withdrawnAt: true } },
    },
  });
  if (profile === null) return null;

  const [savedJobs, applicationGroups, recentApplications, alerts, unreadMessages, rawNotifications] = await Promise.all([
    database.savedJob.findMany({
      where: { candidateProfileId: profile.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
      select: {
        id: true,
        createdAt: true,
        job: {
          select: {
            slug: true,
            status: true,
            expiresAt: true,
            company: { select: { name: true } },
            publishedRevision: { select: { title: true } },
          },
        },
      },
    }),
    database.application.groupBy({
      by: ["status"],
      where: { candidateProfileId: profile.id },
      _count: { _all: true },
    }),
    database.application.findMany({
      where: { candidateProfileId: profile.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 5,
      select: {
        id: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        job: { select: { slug: true, company: { select: { name: true } } } },
        submittedJobRevision: { select: { title: true } },
        events: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 3,
          select: { id: true, kind: true, fromStatus: true, toStatus: true, createdAt: true },
        },
      },
    }),
    database.jobAlert.findMany({
      where: { candidateProfileId: profile.id, status: "ACTIVE" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 3,
      select: { id: true, query: true, frequency: true, nextDueAt: true },
    }),
    countCandidateUnreadMessages(database, userId, profile.id),
    database.notification.findMany({
      where: { recipientUserId: userId, kind: { in: [...DASHBOARD_NOTIFICATION_KINDS] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 12,
      select: { id: true, kind: true, payload: true, readAt: true, createdAt: true },
    }),
  ]);

  const recommendations = await loadRecommendations(profile, now);
  const notifications = [];
  for (const notification of rawNotifications) {
    if (!isDashboardNotificationKind(notification.kind)) continue;
    const link = await authorizeNotificationLink(database, userId, notification.kind, notification.payload);
    if (link !== null) notifications.push(Object.freeze({ ...notification, link }));
  }

  const radarVisible = profile.onboardingStatus === "COMPLETE" &&
    profile.radarConsents[0]?.granted === true &&
    profile.radarConsents[0]?.noticeVersion ===
      TALENT_RADAR_VISIBILITY_NOTICE_V1.noticeVersion &&
    profile.radarConsents[0]?.noticeHash ===
      TALENT_RADAR_VISIBILITY_NOTICE_V1.hash &&
    profile.radarProfile?.publishedAt !== null && profile.radarProfile?.withdrawnAt === null;
  return Object.freeze({
    profileId: profile.id,
    profileStatus: profile.onboardingStatus,
    profileCompletion: calculateCandidateProfileProgress({
      firstName: profile.firstName,
      lastName: profile.lastName,
      publicDisplayName: profile.publicDisplayName,
      phone: profile.phone,
      cantonId: profile.cantonId,
      cityLabel: profile.cityLabel,
      summary: profile.summary,
      desiredTitles: profile.preference?.desiredTitles ?? [],
      preferredCategoryIds:
        profile.preference?.categories.map(({ category }) => category.slug) ?? [],
      skillIds: profile.skills.map(({ skillId }) => skillId),
      languages: profile.languages,
      salaryMin: profile.preference?.salaryMinChf,
      salaryMax: profile.preference?.salaryMaxChf,
      salaryPeriod: profile.preference?.salaryPeriod,
      workloadMin: profile.preference?.workloadMin,
      workloadMax: profile.preference?.workloadMax,
      remotePreference: profile.preference?.remotePreference,
      mobilityRadiusKm: profile.preference?.mobilityRadiusKm,
      availableFrom: profile.preference?.availableFrom,
      workPermitType: profile.workPermitType,
      desiredJobTypes: profile.preference?.desiredJobTypes ?? [],
      hasActiveCv: profile.documents.length > 0,
    }).percentage,
    recommendations,
    savedJobs: Object.freeze(savedJobs),
    applicationCounts: Object.freeze(Object.fromEntries(
      DASHBOARD_APPLICATION_STATUSES.map((status) => [
        status,
        applicationGroups.find((group) => group.status === status)?._count._all ?? 0,
      ]),
    )),
    recentApplications: Object.freeze(recentApplications),
    alerts: Object.freeze(alerts),
    unreadMessages,
    notifications: Object.freeze(notifications),
    radarVisible,
  });
}

export async function countCandidateUnreadMessages(
  database: DatabaseClient,
  userId: string,
  candidateProfileId: string,
) {
  if (!UUID.safeParse(userId).success || !UUID.safeParse(candidateProfileId).success) return 0;
  const rows = await database.$queryRaw<readonly Readonly<{ unreadMessages: bigint }>[]>`
    SELECT COUNT(message."id")::bigint AS "unreadMessages"
    FROM "ConversationParticipant" AS participant
    INNER JOIN "Conversation" AS conversation
      ON conversation."id" = participant."conversationId"
    INNER JOIN "Message" AS message
      ON message."conversationId" = conversation."id"
    LEFT JOIN "Application" AS application
      ON application."id" = conversation."applicationId"
    LEFT JOIN "EmployerContactRequest" AS contact_request
      ON contact_request."id" = conversation."contactRequestId"
    WHERE participant."kind" = 'USER'
      AND participant."userId" = ${userId}::uuid
      AND participant."leftAt" IS NULL
      AND message."senderUserId" <> ${userId}::uuid
      AND message."createdAt" > COALESCE(
        participant."lastReadAt",
        TIMESTAMPTZ '1970-01-01 00:00:00+00'
      )
      AND (
        (
          conversation."kind" = 'APPLICATION'
          AND application."candidateProfileId" = ${candidateProfileId}::uuid
        )
        OR (
          conversation."kind" = 'TALENT_RADAR'
          AND contact_request."candidateProfileId" = ${candidateProfileId}::uuid
          AND contact_request."status" = 'ACCEPTED'
        )
      )
  `;
  const unreadMessages = rows[0]?.unreadMessages ?? 0n;
  return unreadMessages > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(unreadMessages);
}

function isDashboardNotificationKind(
  kind: string,
): kind is (typeof DASHBOARD_NOTIFICATION_KINDS)[number] {
  return (DASHBOARD_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

export async function markCandidateNotificationRead(
  database: DatabaseClient,
  userId: string,
  notificationId: string,
  now = new Date(),
) {
  if (!UUID.safeParse(userId).success || !UUID.safeParse(notificationId).success) return false;
  const result = await database.notification.updateMany({
    where: { id: notificationId, recipientUserId: userId, readAt: null },
    data: { readAt: now },
  });
  return result.count === 1;
}

type RecommendationProfile = Readonly<{
  firstName: string | null;
  lastName: string | null;
  publicDisplayName: string | null;
  phone: string | null;
  cantonId: string | null;
  cityLabel: string | null;
  summary: string | null;
  workPermitType: WorkPermitType | null;
  canton: Readonly<{ slug: string }> | null;
  skills: readonly Readonly<{ skillId: string }>[];
  languages: readonly Readonly<{ code: string; level: LanguageLevel }>[];
  documents: readonly Readonly<{ id: string }>[];
  preference: Readonly<{
    desiredTitles: readonly string[];
    desiredJobTypes: readonly JobType[];
    salaryPeriod: SalaryPeriod | null;
    salaryMinChf: number | null;
    salaryMaxChf: number | null;
    workloadMin: number | null;
    workloadMax: number | null;
    remotePreference: RemotePreference | null;
    mobilityRadiusKm: number | null;
    availableFrom: Date | null;
    categories: readonly Readonly<{ category: Readonly<{ slug: string }> }>[];
  }> | null;
}>;

async function loadRecommendations(profile: RecommendationProfile, now: Date) {
  const preference = profile.preference;
  const categorySlugs = preference?.categories.map((entry) => entry.category.slug) ?? [];
  const remoteTypes = preference?.remotePreference && preference.remotePreference !== "ANY"
    ? [preference.remotePreference]
    : [];
  const preferredInput = Object.freeze({
    ...emptyPublicJobSearchInput(),
    cantonSlugs: profile.canton?.slug ? Object.freeze([profile.canton.slug]) : Object.freeze([]),
    categorySlugs: Object.freeze(categorySlugs),
    jobTypes: Object.freeze(preference?.desiredJobTypes ?? []),
    remoteTypes: Object.freeze(remoteTypes),
  });
  const preferredPage = await listPublicJobs(preferredInput, { pageSize: 24, now });
  const jobs = [...preferredPage.jobs];
  if (jobs.length < 6) {
    const fallbackPage = await listPublicJobs(
      emptyPublicJobSearchInput(),
      { pageSize: 24, now },
    );
    const seen = new Set(jobs.map(({ id }) => id));
    jobs.push(...fallbackPage.jobs.filter(({ id }) => !seen.has(id)));
  }
  const details = (await Promise.all(jobs.map((job) => getPublicJobBySlug(job.slug, { now }))))
    .filter((job): job is PublicJobDetailModel => job !== null);
  const ranked = details.map((job) => Object.freeze({
    job: job as PublicJobCardModel,
    match: calculateCandidateMatchV1({
      candidate: {
        skills: profile.skills.map((entry) => entry.skillId),
        ...(profile.cantonId ? { acceptableCantonIds: [profile.cantonId] } : {}),
        ...(preference?.workloadMin == null ? {} : { workloadMin: preference.workloadMin }),
        ...(preference?.workloadMax == null ? {} : { workloadMax: preference.workloadMax }),
        ...(preference?.salaryMinChf == null ? {} : { desiredSalaryMin: preference.salaryMinChf }),
        ...(preference?.salaryMaxChf == null ? {} : { desiredSalaryMax: preference.salaryMaxChf }),
        ...(preference?.salaryPeriod == null ? {} : { desiredSalaryPeriod: preference.salaryPeriod }),
        ...(preference?.remotePreference == null ? {} : { remotePreference: preference.remotePreference }),
        languages: profile.languages,
        ...(preference?.desiredJobTypes.length ? { jobTypes: preference.desiredJobTypes } : {}),
        ...(preference?.availableFrom == null ? {} : { availabilityDate: preference.availableFrom }),
      },
      job: {
        requiredSkills: job.skills.filter((skill) => skill.required).map((skill) => skill.id),
        ...(job.canton === null ? {} : { cantonId: job.canton.id }),
        workloadMin: job.workloadMin,
        workloadMax: job.workloadMax,
        ...(job.salaryMin === null ? {} : { salaryMin: job.salaryMin }),
        ...(job.salaryMax === null ? {} : { salaryMax: job.salaryMax }),
        ...(job.salaryPeriod === null ? {} : { salaryPeriod: job.salaryPeriod }),
        remoteType: job.remoteType,
        requiredLanguages: job.languages,
        jobType: job.jobType,
        ...(job.startDate === null ? {} : { startDate: job.startDate }),
      },
    }),
  })).sort((left, right) => (right.match.score ?? -1) - (left.match.score ?? -1)).slice(0, 6);
  return Object.freeze(ranked);
}

async function authorizeNotificationLink(
  database: DatabaseClient,
  userId: string,
  kind: (typeof DASHBOARD_NOTIFICATION_KINDS)[number],
  payload: unknown,
): Promise<string | null> {
  try {
    const parsed = parseNotificationPayloadV1(kind, payload) as Record<string, unknown>;
    if ("applicationId" in parsed && typeof parsed.applicationId === "string") {
      const owned = await database.application.findFirst({ where: { id: parsed.applicationId, candidateProfile: { userId } }, select: { id: true } });
      return owned === null ? null : `/candidate/applications/${owned.id}`;
    }
    if ("conversationId" in parsed && typeof parsed.conversationId === "string") {
      const owned = await database.conversation.findFirst({ where: { id: parsed.conversationId, participants: { some: { kind: "USER", userId, leftAt: null } } }, select: { id: true } });
      return owned === null ? null : `/candidate/messages/${owned.id}`;
    }
    if ("requestId" in parsed && typeof parsed.requestId === "string") {
      if (kind === "PRIVACY_REQUEST_CHANGED") {
        const owned = await database.privacyRequest.findFirst({ where: { id: parsed.requestId, requesterUserId: userId }, select: { id: true } });
        return owned === null ? null : "/candidate/privacy";
      }
      const owned = await database.employerContactRequest.findFirst({ where: { id: parsed.requestId, candidateProfile: { userId } }, select: { id: true } });
      return owned === null ? null : "/candidate/privacy";
    }
  } catch {
    return null;
  }
  return null;
}
