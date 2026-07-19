import { z } from "zod";

import type { RadarConsentKind } from "@/lib/generated/prisma/enums";

export const RADAR_CONSENT_NOTICE_V1 = Object.freeze({
  kind: "TALENT_RADAR_VISIBILITY" as const,
  purpose: "Anonymous Talent Radar visibility",
  noticeVersion: "talent-radar-v1",
});

export const radarConsentCommandSchema = z
  .object({
    candidateProfileId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    granted: z.boolean(),
    noticeVersion: z.literal(RADAR_CONSENT_NOTICE_V1.noticeVersion),
    noticeHash: z.string().regex(/^[a-f0-9]{64}$/),
    effectiveAt: z.date(),
  })
  .strict();

export type RadarConsentCommand = z.infer<typeof radarConsentCommandSchema>;

export type RadarConsentEventInput = Readonly<RadarConsentCommand & {
  kind: RadarConsentKind;
}>;

export interface RadarConsentRepository {
  append(input: RadarConsentEventInput): Promise<void>;
  latest(
    candidateProfileId: string,
    kind: "TALENT_RADAR_VISIBILITY",
    at: Date,
  ): Promise<Readonly<{ granted: boolean; noticeVersion: string }> | null>;
}

export async function recordRadarConsent(
  input: unknown,
  repository: RadarConsentRepository,
): Promise<void> {
  const command = radarConsentCommandSchema.parse(input);
  await repository.append({
    ...command,
    kind: RADAR_CONSENT_NOTICE_V1.kind,
  });
}

export async function hasCurrentRadarConsent(
  candidateProfileId: string,
  at: Date,
  repository: RadarConsentRepository,
): Promise<boolean> {
  if (!z.string().uuid().safeParse(candidateProfileId).success || !isValidDate(at)) {
    return false;
  }
  const event = await repository.latest(
    candidateProfileId,
    RADAR_CONSENT_NOTICE_V1.kind,
    at,
  );
  return event?.granted === true &&
    event.noticeVersion === RADAR_CONSENT_NOTICE_V1.noticeVersion;
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}
