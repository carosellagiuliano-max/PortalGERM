import "server-only";

import { z } from "zod";

import type { DatabaseClient } from "@/lib/db/factory";
import { RADAR_CONSENT_NOTICE_V1 } from "@/lib/privacy/radar-consent";

export async function getCandidatePrivacyDashboard(
  database: DatabaseClient,
  userId: string,
  now = new Date(),
) {
  if (
    !z.string().uuid().safeParse(userId).success ||
    !Number.isFinite(now.getTime())
  ) return null;
  const profile = await database.candidateProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      onboardingStatus: true,
      radarConsents: {
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: {
          id: true,
          kind: true,
          granted: true,
          noticeVersion: true,
          noticeHash: true,
          effectiveAt: true,
        },
      },
      radarProfile: {
        select: { publishedAt: true, withdrawnAt: true, projectionVersion: true },
      },
      contactRequests: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          id: true,
          status: true,
          createdAt: true,
          terminalAt: true,
          company: { select: { name: true, slug: true } },
          events: {
            where: { kind: "REVEAL_GRANTED" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { createdAt: true },
          },
        },
      },
    },
  });
  if (profile === null) return null;
  const requests = await database.privacyRequest.findMany({
    where: { requesterUserId: userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 30,
    select: {
      id: true,
      type: true,
      status: true,
      dueAt: true,
      createdAt: true,
      safeOutcomeNote: true,
      correctionFields: { select: { fieldCode: true } },
    },
  });
  const latestConsent = profile.radarConsents.find(
    ({ effectiveAt }) => effectiveAt.getTime() <= now.getTime(),
  ) ?? null;
  const currentConsentGranted = latestConsent?.granted === true &&
    latestConsent.noticeVersion === RADAR_CONSENT_NOTICE_V1.noticeVersion &&
    latestConsent.noticeHash === RADAR_CONSENT_NOTICE_V1.hash;
  const radarState = profile.onboardingStatus !== "COMPLETE"
    ? "INCOMPLETE"
    : !currentConsentGranted
      ? "OFF"
      : profile.radarProfile?.publishedAt !== null && profile.radarProfile?.withdrawnAt === null
        ? "VISIBLE"
        : "PAUSED";
  return Object.freeze({
    profileId: profile.id,
    radarState,
    currentConsentGranted,
    consents: Object.freeze(profile.radarConsents),
    contacts: Object.freeze(profile.contactRequests.map((request) => Object.freeze({
      ...request,
      revealedAt: request.events[0]?.createdAt ?? null,
    }))),
    requests: Object.freeze(requests),
  });
}
