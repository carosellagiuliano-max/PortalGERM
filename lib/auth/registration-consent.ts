import { createHash } from "node:crypto";

import { USER_CONSENT_NOTICES_V1 } from "@/lib/privacy/user-consent";
import type { RegistrationLegalBindingV1 } from "@/lib/auth/registration-legal-gate";

const TERMS_NOTICE_TEXT_V1 =
  "Mit meiner Registrierung akzeptiere ich die Nutzungsbedingungen von SwissTalentHub in der Fassung vom 20. Juli 2026.";
const PUBLISHED_REGISTRATION_NOTICE_TEXT_V1 =
  "Mit meiner Registrierung akzeptiere ich die zum Zeitpunkt der Registrierung veröffentlichten Nutzungsbedingungen von SwissTalentHub und bestätige, den dazugehörigen Datenschutzhinweis gelesen zu haben.";
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
  input: Readonly<{
    userId: string;
    effectiveAt: Date;
    legalBinding?: RegistrationLegalBindingV1 | null;
  }>,
): RegistrationConsentEvent {
  if (input.legalBinding === undefined || input.legalBinding === null) {
    return createRegistrationConsentEvent(input, "TERMS", true);
  }
  const noticeContract = REGISTRATION_CONSENT_NOTICES_V1.TERMS;
  return Object.freeze({
    userId: input.userId,
    actorUserId: input.userId,
    kind: "TERMS",
    granted: true,
    purpose: noticeContract.purpose,
    noticeVersion: input.legalBinding.policyVersion,
    noticeHash: canonicalNoticeHash(
      JSON.stringify({
        noticeText: PUBLISHED_REGISTRATION_NOTICE_TEXT_V1,
        policyVersion: input.legalBinding.policyVersion,
        privacy: input.legalBinding.privacy,
        terms: input.legalBinding.terms,
      }),
    ),
    effectiveAt: new Date(input.effectiveAt),
  });
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
