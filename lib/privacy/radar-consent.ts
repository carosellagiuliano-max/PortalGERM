import { createHash } from "node:crypto";

import { z } from "zod";

import type { RadarConsentKind } from "@/lib/generated/prisma/enums";

const RADAR_CONSENT_NOTICE_TEXT_V1 =
  "Ich möchte mit meinem anonymisierten SwissJobPass im Talent Radar sichtbar sein. Name, E-Mail, Telefon, exakter Ort und CV bleiben verborgen, bis ich sie später ausdrücklich freigebe. Ich kann diese Sichtbarkeit jederzeit deaktivieren.";

export const RADAR_CONSENT_NOTICE_V1 = Object.freeze({
  kind: "TALENT_RADAR_VISIBILITY" as const,
  purpose: "Anonymous Talent Radar visibility",
  noticeVersion: "talent-radar-v1",
  text: RADAR_CONSENT_NOTICE_TEXT_V1,
  hash: createHash("sha256")
    .update(RADAR_CONSENT_NOTICE_TEXT_V1.normalize("NFC"), "utf8")
    .digest("hex"),
});

export const radarConsentCommandSchema = z
  .object({
    candidateProfileId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    granted: z.boolean(),
    noticeVersion: z.literal(RADAR_CONSENT_NOTICE_V1.noticeVersion),
    noticeHash: z.literal(RADAR_CONSENT_NOTICE_V1.hash),
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
  ): Promise<Readonly<{
    granted: boolean;
    noticeVersion: string;
    noticeHash: string;
  }> | null>;
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
    event.noticeVersion === RADAR_CONSENT_NOTICE_V1.noticeVersion &&
    event.noticeHash === RADAR_CONSENT_NOTICE_V1.hash;
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}
