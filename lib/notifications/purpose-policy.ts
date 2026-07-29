import type {
  NotificationPurpose,
  NotificationPurposeClass,
} from "@/lib/generated/prisma/client";
import {
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from "@/lib/providers/email/email-provider";

export type NotificationPurposePolicy = Readonly<{
  purpose: NotificationPurpose;
  classification: NotificationPurposeClass;
  preferenceMutable: boolean;
}>;

/**
 * Closed, reviewable taxonomy. Adding an e-mail template without classifying it
 * is a compile-time error; callers may not supply their own classification.
 */
export const EMAIL_NOTIFICATION_POLICY = Object.freeze({
  identity_verification: mandatory("IDENTITY_VERIFICATION"),
  login_email_change_verification: mandatory(
    "LOGIN_EMAIL_CHANGE_VERIFICATION",
  ),
  login_email_changed_notice: mandatory("LOGIN_EMAIL_CHANGED_NOTICE"),
  registration_welcome: mandatory("IDENTITY_VERIFICATION"),
  password_reset_mock: mandatory("PASSWORD_RESET"),
  company_invitation: mandatory("COMPANY_INVITATION"),
  company_verification_status: mandatory("COMPANY_VERIFICATION"),
  application_submitted: mandatory("APPLICATION_SUBMITTED"),
  application_status_changed: mandatory("APPLICATION_STATUS_CHANGED"),
  employer_message_received: mandatory("EMPLOYER_MESSAGE"),
  talent_contact_request_received: mandatory("TALENT_CONTACT_REQUEST"),
  identity_revealed: mandatory("IDENTITY_REVEAL"),
  job_alert_preview: optional("JOB_ALERT"),
  job_alert_digest_mock: optional("JOB_ALERT"),
  subscription_activated: mandatory("SUBSCRIPTION_TRANSACTIONAL"),
  subscription_renewal_reminder: mandatory("SUBSCRIPTION_TRANSACTIONAL"),
  invoice_issued: mandatory("BILLING_TRANSACTIONAL"),
  payment_received: mandatory("BILLING_TRANSACTIONAL"),
  plan_limit_reached: mandatory("USAGE_OPERATIONAL"),
  job_boost_activated: mandatory("JOB_MODERATION"),
  job_boost_expired: mandatory("JOB_MODERATION"),
  talent_radar_credits_low: mandatory("USAGE_OPERATIONAL"),
  credits_expiring: mandatory("USAGE_OPERATIONAL"),
  usage_warning: mandatory("USAGE_OPERATIONAL"),
  demo_request_received: mandatory("USAGE_OPERATIONAL"),
  lead_follow_up_reminder: mandatory("USAGE_OPERATIONAL"),
  job_approved: mandatory("JOB_MODERATION"),
  job_rejected: mandatory("JOB_MODERATION"),
  abuse_report_received: mandatory("ABUSE_REPORT"),
  credits_granted: mandatory("USAGE_OPERATIONAL"),
  commercial_lifecycle_signal: optional("COMMERCIAL_OPTIONAL"),
  privacy_request_changed: mandatory("PRIVACY_REQUEST"),
  external_application_reminder: optional(
    "EXTERNAL_APPLICATION_REMINDER",
  ),
  interview_changed: mandatory("INTERVIEW_SCHEDULING"),
  interview_reminder: mandatory("INTERVIEW_SCHEDULING"),
} satisfies Record<EmailTemplateKey, NotificationPurposePolicy>);

export const MUTABLE_NOTIFICATION_PURPOSES = Object.freeze(
  [...new Set(
    EMAIL_TEMPLATE_KEYS.flatMap((templateKey) => {
      const policy = EMAIL_NOTIFICATION_POLICY[templateKey];
      return policy.preferenceMutable ? [policy.purpose] : [];
    }),
  )] as readonly NotificationPurpose[],
);

export function policyForTemplate(
  templateKey: EmailTemplateKey,
): NotificationPurposePolicy {
  return EMAIL_NOTIFICATION_POLICY[templateKey];
}

export function classifyPurpose(
  purpose: NotificationPurpose,
): NotificationPurposeClass | undefined {
  const classifications = EMAIL_TEMPLATE_KEYS.flatMap((templateKey) => {
    const policy = EMAIL_NOTIFICATION_POLICY[templateKey];
    return policy.purpose === purpose ? [policy.classification] : [];
  });
  if (classifications.length === 0) return undefined;
  return classifications.every((entry) => entry === classifications[0])
    ? classifications[0]
    : undefined;
}

export function mayUserDisablePurpose(purpose: NotificationPurpose) {
  return MUTABLE_NOTIFICATION_PURPOSES.includes(purpose);
}

export function resolveNotificationSendDecision(input: Readonly<{
  purpose: NotificationPurpose;
  preferenceEnabled: boolean | undefined;
  optionalEmailEnabled: boolean;
}>): "SEND" | "SUPPRESS" | "REJECT_UNKNOWN" {
  const classification = classifyPurpose(input.purpose);
  if (classification === undefined) return "REJECT_UNKNOWN";
  if (classification === "MANDATORY") return "SEND";
  return input.optionalEmailEnabled && input.preferenceEnabled === true
    ? "SEND"
    : "SUPPRESS";
}

function mandatory(
  purpose: NotificationPurpose,
): NotificationPurposePolicy {
  return Object.freeze({
    purpose,
    classification: "MANDATORY",
    preferenceMutable: false,
  });
}

function optional(purpose: NotificationPurpose): NotificationPurposePolicy {
  return Object.freeze({
    purpose,
    classification: "OPTIONAL",
    preferenceMutable: true,
  });
}
