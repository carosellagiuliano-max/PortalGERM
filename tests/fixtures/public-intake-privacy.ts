import {
  ABUSE_REPORT_PRIVACY_NOTICE_V1,
  type PublicIntakePrivacyExpectedBinding,
  type PublicIntakePrivacyPurpose,
} from "@/lib/privacy/public-intake-privacy-contract";
import {
  SALES_LEAD_INTAKE_POLICY_V1,
  SALES_LEAD_NOTICE_HASH_V1,
} from "@/lib/sales/lead-policy";

export function localPublicIntakePrivacyBinding(
  purpose: PublicIntakePrivacyPurpose,
): PublicIntakePrivacyExpectedBinding {
  const notice =
    purpose === "EMPLOYER_DEMO"
      ? {
          version: SALES_LEAD_INTAKE_POLICY_V1.notice.version,
          hash: SALES_LEAD_NOTICE_HASH_V1,
        }
      : ABUSE_REPORT_PRIVACY_NOTICE_V1;

  return Object.freeze({
    purpose,
    evidenceMode: "LOCAL_SYNTHETIC",
    legalPublicationId: null,
    publicationHash: null,
    publicationVersion: null,
    noticeVersion: notice.version,
    noticeHash: notice.hash,
  });
}

export function appendLocalPublicIntakePrivacyBinding(
  formData: FormData,
  purpose: PublicIntakePrivacyPurpose,
): FormData {
  const binding = localPublicIntakePrivacyBinding(purpose);
  formData.set("privacyPurpose", binding.purpose);
  formData.set("privacyEvidenceMode", binding.evidenceMode);
  formData.set("privacyLegalPublicationId", "");
  formData.set("privacyPublicationHash", "");
  formData.set("privacyPublicationVersion", "");
  formData.set("privacyNoticeVersion", binding.noticeVersion);
  formData.set("privacyNoticeHash", binding.noticeHash);
  return formData;
}
