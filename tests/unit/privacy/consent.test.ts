// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  UserConsentKind,
  type UserConsentKind as UserConsentKindType,
} from "@/lib/generated/prisma/enums";
import {
  hasCurrentRadarConsent,
  RADAR_CONSENT_NOTICE_V1,
  recordRadarConsent,
  type RadarConsentRepository,
} from "@/lib/privacy/radar-consent";
import {
  hasCurrentUserConsent,
  recordUserConsent,
  USER_CONSENT_NOTICES_V1,
  type UserConsentRepository,
} from "@/lib/privacy/user-consent";

const userId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-07-19T10:00:00.000Z");
const noticeHash = "a".repeat(64);

function radarRepository(
  latest: RadarConsentRepository["latest"] = vi.fn(async () => null),
) {
  return {
    append: vi.fn(async () => undefined),
    latest,
  } satisfies RadarConsentRepository;
}

function userRepository(
  latest: UserConsentRepository["latest"] = vi.fn(async () => null),
) {
  return {
    append: vi.fn(async () => undefined),
    latest,
  } satisfies UserConsentRepository;
}

describe("strictly separated consent domains", () => {
  it("records only the fixed Radar visibility kind", async () => {
    const repository = radarRepository();
    await recordRadarConsent({
      candidateProfileId: profileId,
      actorUserId: actorId,
      granted: true,
      noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
      noticeHash,
      effectiveAt: now,
    }, repository);
    expect(repository.append).toHaveBeenCalledWith({
      candidateProfileId: profileId,
      actorUserId: actorId,
      granted: true,
      noticeVersion: "talent-radar-v1",
      noticeHash,
      effectiveAt: now,
      kind: "TALENT_RADAR_VISIBILITY",
    });
  });

  it("rejects kind injection, user-consent fields, stale notices and malformed hashes in Radar", async () => {
    const repository = radarRepository();
    const base = {
      candidateProfileId: profileId,
      actorUserId: actorId,
      granted: true,
      noticeVersion: "talent-radar-v1",
      noticeHash,
      effectiveAt: now,
    };
    await expect(recordRadarConsent({ ...base, kind: "MARKETING" }, repository)).rejects.toThrow();
    await expect(recordRadarConsent({ ...base, purpose: "Marketing communication" }, repository)).rejects.toThrow();
    await expect(recordRadarConsent({ ...base, noticeVersion: "talent-radar-v0" }, repository)).rejects.toThrow();
    await expect(recordRadarConsent({ ...base, noticeHash: "ABC" }, repository)).rejects.toThrow();
    expect(repository.append).not.toHaveBeenCalled();
  });

  it("treats only a current latest Radar grant as effective", async () => {
    expect(await hasCurrentRadarConsent(profileId, now, radarRepository(vi.fn(async () => ({
      granted: true,
      noticeVersion: "talent-radar-v1",
    }))))).toBe(true);
    expect(await hasCurrentRadarConsent(profileId, now, radarRepository(vi.fn(async () => ({
      granted: false,
      noticeVersion: "talent-radar-v1",
    }))))).toBe(false);
    expect(await hasCurrentRadarConsent(profileId, now, radarRepository(vi.fn(async () => ({
      granted: true,
      noticeVersion: "talent-radar-v0",
    }))))).toBe(false);
    const repository = radarRepository();
    expect(await hasCurrentRadarConsent("not-an-id", now, repository)).toBe(false);
    expect(repository.latest).not.toHaveBeenCalled();
  });

  it.each(Object.values(UserConsentKind))(
    "records %s only with its closed purpose and current notice",
    async (kind) => {
      const repository = userRepository();
      const notice = USER_CONSENT_NOTICES_V1[kind];
      await recordUserConsent({
        userId,
        actorUserId: null,
        kind,
        granted: true,
        purpose: notice.purpose,
        noticeVersion: notice.noticeVersion,
        noticeHash,
        effectiveAt: now,
      }, repository);
      expect(repository.append).toHaveBeenCalledOnce();
    },
  );

  it("rejects Radar kinds, unknown properties and cross-purpose user consent", async () => {
    const repository = userRepository();
    const terms = {
      userId,
      actorUserId: actorId,
      kind: "TERMS",
      granted: true,
      purpose: USER_CONSENT_NOTICES_V1.TERMS.purpose,
      noticeVersion: USER_CONSENT_NOTICES_V1.TERMS.noticeVersion,
      noticeHash,
      effectiveAt: now,
    };
    await expect(recordUserConsent({ ...terms, kind: "TALENT_RADAR_VISIBILITY" }, repository)).rejects.toThrow();
    await expect(recordUserConsent({ ...terms, candidateProfileId: profileId }, repository)).rejects.toThrow();
    await expect(recordUserConsent({
      ...terms,
      purpose: USER_CONSENT_NOTICES_V1.MARKETING.purpose,
    }, repository)).rejects.toThrow();
    await expect(recordUserConsent({ ...terms, noticeVersion: "terms-v0" }, repository)).rejects.toThrow();
    expect(repository.append).not.toHaveBeenCalled();
  });

  it("checks the requested user-consent kind independently", async () => {
    const repository = userRepository(vi.fn(async (_id: string, kind: UserConsentKindType) => ({
      granted: kind === UserConsentKind.DATA_USE,
      noticeVersion: USER_CONSENT_NOTICES_V1[kind].noticeVersion,
    })));
    expect(await hasCurrentUserConsent(userId, UserConsentKind.DATA_USE, now, repository)).toBe(true);
    expect(await hasCurrentUserConsent(userId, UserConsentKind.MARKETING, now, repository)).toBe(false);
    expect(await hasCurrentUserConsent(
      userId,
      "TALENT_RADAR_VISIBILITY" as never,
      now,
      repository,
    )).toBe(false);
  });
});
