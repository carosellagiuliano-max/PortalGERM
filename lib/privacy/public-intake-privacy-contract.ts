export const PUBLIC_INTAKE_PRIVACY_PURPOSES = Object.freeze([
  "EMPLOYER_DEMO",
  "ABUSE_REPORT",
] as const);

export type PublicIntakePrivacyPurpose =
  (typeof PUBLIC_INTAKE_PRIVACY_PURPOSES)[number];

export const PUBLIC_INTAKE_PRIVACY_FORM_FIELDS = Object.freeze({
  purpose: "privacyPurpose",
  evidenceMode: "privacyEvidenceMode",
  legalPublicationId: "privacyLegalPublicationId",
  publicationHash: "privacyPublicationHash",
  publicationVersion: "privacyPublicationVersion",
  noticeVersion: "privacyNoticeVersion",
  noticeHash: "privacyNoticeHash",
} as const);

export const ABUSE_REPORT_PRIVACY_NOTICE_V1 = Object.freeze({
  version: "abuse-report-privacy-v1",
  text: "Wir verwenden deine Angaben ausschliesslich, um die gemeldete Stelle, Firma, Nachricht oder Person auf Missbrauch zu prüfen. Bitte nenne nur die dafür notwendigen Informationen und keine unnötigen besonders schützenswerten Personendaten.",
  hash: "70db3e2735065e414b44b9f958467c99a0323a79e1099f0ca54b6e7c20788de7",
});

export type PublicIntakePrivacyEvidenceMode =
  | "LOCAL_SYNTHETIC"
  | "PUBLISHED_LEGAL";

export type PublicIntakePrivacyExpectedBinding = Readonly<{
  purpose: PublicIntakePrivacyPurpose;
  evidenceMode: PublicIntakePrivacyEvidenceMode;
  legalPublicationId: string | null;
  publicationHash: string | null;
  publicationVersion: string | null;
  noticeVersion: string;
  noticeHash: string;
}>;

export type PublicIntakePrivacyBinding =
  PublicIntakePrivacyExpectedBinding &
    Readonly<{ noticeText: string }>;

export type PublicIntakePrivacyGateDecision =
  | Readonly<{
      allowed: true;
      binding: PublicIntakePrivacyBinding;
    }>
  | Readonly<{
      allowed: false;
      code:
        | "FEATURE_DISABLED"
        | "PUBLICATION_UNAVAILABLE"
        | "PUBLICATION_INVALID"
        | "STALE_OR_TAMPERED_BINDING"
        | "GATE_UNAVAILABLE";
    }>;
