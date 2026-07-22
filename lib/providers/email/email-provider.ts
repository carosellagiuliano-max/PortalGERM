export const EMAIL_TEMPLATE_KEYS = [
  "registration_welcome",
  "password_reset_mock",
  "company_invitation",
  "company_verification_status",
  "application_submitted",
  "application_status_changed",
  "employer_message_received",
  "talent_contact_request_received",
  "identity_revealed",
  "job_alert_preview",
  "job_alert_digest_mock",
  "subscription_activated",
  "subscription_renewal_reminder",
  "invoice_issued",
  "payment_received",
  "plan_limit_reached",
  "job_boost_activated",
  "job_boost_expired",
  "talent_radar_credits_low",
  "credits_expiring",
  "usage_warning",
  "demo_request_received",
  "lead_follow_up_reminder",
  "job_approved",
  "job_rejected",
  "abuse_report_received",
  "credits_granted",
  "commercial_lifecycle_signal",
  "privacy_request_changed",
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export interface EmailProvider {
  send(input: {
    to: string;
    templateKey: EmailTemplateKey;
    data: Record<string, unknown>;
    subject: string;
  }): Promise<{ logId: string; created?: boolean }>;
}
