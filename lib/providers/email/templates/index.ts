import type { EmailTemplateKey } from "@/lib/providers/email/email-provider";

import { abuseReportReceivedTemplate } from "./abuse-report-received";
import { applicationStatusChangedTemplate } from "./application-status-changed";
import { applicationSubmittedTemplate } from "./application-submitted";
import { companyInvitationTemplate } from "./company-invitation";
import { companyVerificationStatusTemplate } from "./company-verification-status";
import { creditsExpiringTemplate } from "./credits-expiring";
import { creditsGrantedTemplate } from "./credits-granted";
import { demoRequestReceivedTemplate } from "./demo-request-received";
import { employerMessageReceivedTemplate } from "./employer-message-received";
import { identityRevealedTemplate } from "./identity-revealed";
import { invoiceIssuedTemplate } from "./invoice-issued";
import { jobAlertDigestMockTemplate } from "./job-alert-digest-mock";
import { jobAlertPreviewTemplate } from "./job-alert-preview";
import { jobApprovedTemplate } from "./job-approved";
import { jobBoostActivatedTemplate } from "./job-boost-activated";
import { jobBoostExpiredTemplate } from "./job-boost-expired";
import { jobRejectedTemplate } from "./job-rejected";
import { leadFollowUpReminderTemplate } from "./lead-follow-up-reminder";
import { passwordResetMockTemplate } from "./password-reset-mock";
import { paymentReceivedTemplate } from "./payment-received";
import { planLimitReachedTemplate } from "./plan-limit-reached";
import { privacyRequestChangedTemplate } from "./privacy-request-changed";
import { registrationWelcomeTemplate } from "./registration-welcome";
import { subscriptionActivatedTemplate } from "./subscription-activated";
import { subscriptionRenewalReminderTemplate } from "./subscription-renewal-reminder";
import { talentContactRequestReceivedTemplate } from "./talent-contact-request-received";
import { talentRadarCreditsLowTemplate } from "./talent-radar-credits-low";
import { usageWarningTemplate } from "./usage-warning";
import {
  assertTemplateRegistryComplete,
  type EmailTemplateData,
} from "./_shared";

const TEMPLATE_REGISTRY = assertTemplateRegistryComplete({
  abuse_report_received: abuseReportReceivedTemplate,
  application_status_changed: applicationStatusChangedTemplate,
  application_submitted: applicationSubmittedTemplate,
  company_invitation: companyInvitationTemplate,
  company_verification_status: companyVerificationStatusTemplate,
  credits_expiring: creditsExpiringTemplate,
  credits_granted: creditsGrantedTemplate,
  demo_request_received: demoRequestReceivedTemplate,
  employer_message_received: employerMessageReceivedTemplate,
  identity_revealed: identityRevealedTemplate,
  invoice_issued: invoiceIssuedTemplate,
  job_alert_digest_mock: jobAlertDigestMockTemplate,
  job_alert_preview: jobAlertPreviewTemplate,
  job_approved: jobApprovedTemplate,
  job_boost_activated: jobBoostActivatedTemplate,
  job_boost_expired: jobBoostExpiredTemplate,
  job_rejected: jobRejectedTemplate,
  lead_follow_up_reminder: leadFollowUpReminderTemplate,
  password_reset_mock: passwordResetMockTemplate,
  payment_received: paymentReceivedTemplate,
  plan_limit_reached: planLimitReachedTemplate,
  privacy_request_changed: privacyRequestChangedTemplate,
  registration_welcome: registrationWelcomeTemplate,
  subscription_activated: subscriptionActivatedTemplate,
  subscription_renewal_reminder: subscriptionRenewalReminderTemplate,
  talent_contact_request_received: talentContactRequestReceivedTemplate,
  talent_radar_credits_low: talentRadarCreditsLowTemplate,
  usage_warning: usageWarningTemplate,
});

export function renderEmailTemplate(
  templateKey: EmailTemplateKey,
  data: EmailTemplateData,
) {
  return TEMPLATE_REGISTRY[templateKey](data);
}

export type { EmailTemplateData, RenderedEmail } from "./_shared";
