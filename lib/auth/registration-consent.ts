import { createHash } from "node:crypto";

import { USER_CONSENT_NOTICES_V1 } from "@/lib/privacy/user-consent";

const TERMS_NOTICE_TEXT_V1 =
  "Mit meiner Registrierung akzeptiere ich die Nutzungsbedingungen von SwissTalentHub in der Fassung vom 20. Juli 2026.";
const MARKETING_NOTICE_TEXT_V1 =
  "Ich möchte freiwillig Produktneuigkeiten und Hinweise von SwissTalentHub per E-Mail erhalten. Diese Einwilligung kann ich jederzeit widerrufen.";

function canonicalNoticeHash(noticeText: string): string {
  return createHash("sha256").update(noticeText.normalize("NFC"), "utf8").digest("hex");
}

function notice<TKind extends "TERMS" | "MARKETING">(
  kind: TKind,
  noticeText: string,
) {
  const base = USER_CONSENT_NOTICES_V1[kind];
  return Object.freeze({
    kind,
    purpose: base.purpose,
    noticeVersion: base.noticeVersion,
    noticeText,
    noticeHash: canonicalNoticeHash(noticeText),
  });
}

export const REGISTRATION_CONSENT_NOTICES_V1 = Object.freeze({
  TERMS: notice("TERMS", TERMS_NOTICE_TEXT_V1),
  MARKETING: notice("MARKETING", MARKETING_NOTICE_TEXT_V1),
});

export type RegistrationConsentEvent = Readonly<{
  userId: string;
  actorUserId: string;
  kind: "TERMS" | "MARKETING";
  granted: boolean;
  purpose: string;
  noticeVersion: string;
  noticeHash: string;
  effectiveAt: Date;
}>;

export function createRegistrationTermsConsent(
  input: Readonly<{ userId: string; effectiveAt: Date }>,
): RegistrationConsentEvent {
  return createRegistrationConsentEvent(input, "TERMS", true);
}

export function createRegistrationMarketingConsent(
  input: Readonly<{
    userId: string;
    effectiveAt: Date;
    granted: boolean;
  }>,
): RegistrationConsentEvent {
  return createRegistrationConsentEvent(input, "MARKETING", input.granted);
}

function createRegistrationConsentEvent(
  input: Readonly<{ userId: string; effectiveAt: Date }>,
  kind: "TERMS" | "MARKETING",
  granted: boolean,
): RegistrationConsentEvent {
  const noticeContract = REGISTRATION_CONSENT_NOTICES_V1[kind];
  return Object.freeze({
    userId: input.userId,
    actorUserId: input.userId,
    kind,
    granted,
    purpose: noticeContract.purpose,
    noticeVersion: noticeContract.noticeVersion,
    noticeHash: noticeContract.noticeHash,
    effectiveAt: new Date(input.effectiveAt),
  });
}
