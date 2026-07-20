import { describe, expect, it } from "vitest";

import {
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from "@/lib/providers/email/email-provider";
import { renderEmailTemplate } from "@/lib/providers/email/templates";

const EXPECTED_SUBJECTS = {
  abuse_report_received: "Neue Missbrauchsmeldung eingegangen",
  application_status_changed: "Neuer Status deiner Bewerbung",
  application_submitted: "Deine Bewerbung wurde erfasst",
  company_invitation: "Einladung zu einem Unternehmen auf SwissTalentHub",
  company_verification_status: "Status deiner Unternehmensprüfung",
  credits_expiring: "Hinweis zu ablaufenden Credits",
  credits_granted: "Credits wurden gutgeschrieben",
  demo_request_received: "Neue Demo-Anfrage eingegangen",
  employer_message_received: "Neue Nachricht zu deiner Bewerbung",
  identity_revealed: "Bestätigung deiner Identitätsfreigabe",
  invoice_issued: "Neue Rechnung von SwissTalentHub",
  job_alert_digest_mock: "Neue Stellen aus deinem Jobabo",
  job_alert_preview: "Vorschau deines Jobabos",
  job_approved: "Dein Stelleninserat wurde freigegeben",
  job_boost_activated: "Job-Boost wurde aktiviert",
  job_boost_expired: "Job-Boost ist abgelaufen",
  job_rejected: "Dein Stelleninserat benötigt Anpassungen",
  lead_follow_up_reminder: "Erinnerung an eine offene Demo-Anfrage",
  password_reset_mock: "Passwort für SwissTalentHub zurücksetzen",
  payment_received: "Zahlung im Mock-Checkout bestätigt",
  plan_limit_reached: "Nutzungslimit deines Plans erreicht",
  privacy_request_changed:
    "Status deiner Datenschutzanfrage wurde aktualisiert",
  registration_welcome: "Willkommen bei SwissTalentHub",
  subscription_activated: "Dein SwissTalentHub-Abonnement ist aktiv",
  subscription_renewal_reminder:
    "Hinweis zur Verlängerung deines Abonnements",
  talent_contact_request_received:
    "Neue Kontaktanfrage über Talent Radar",
  talent_radar_credits_low: "Talent-Radar-Guthaben wird knapp",
  usage_warning: "Hinweis zu deiner aktuellen Nutzung",
} satisfies Record<EmailTemplateKey, string>;

const TEMPLATE_DATA = Object.freeze({
  alertName: "Software Zürich",
  categoryLabel: "Unzulässiger Inhalt",
  companyName: "Beispiel AG",
  creditCount: 3,
  creditTypeLabel: "Kontakt-Credits",
  expiryDate: "31.12.2026",
  expiresInMinutes: 15,
  featureName: "aktive Stellen",
  firstName: "Mara",
  invitationUrl: "http://127.0.0.1:3000/invitations/secret",
  inviterName: "Lina Muster",
  invoiceNumber: "STH-2026-0001",
  jobCount: 4,
  jobTitle: "Software Engineer",
  limit: 5,
  orderReference: "ORDER-001",
  planName: "Starter",
  reason: "Bitte ergänze die Angaben.",
  remainingCredits: 2,
  renewalDate: "01.08.2026",
  resetUrl: "http://127.0.0.1:3000/reset-password?token=secret",
  statusLabel: "freigegeben",
  used: 4,
});

describe("German email template registry", () => {
  it("renders every declared key with its authoritative German subject", () => {
    expect(EMAIL_TEMPLATE_KEYS).toHaveLength(28);
    expect(Object.keys(EXPECTED_SUBJECTS).sort()).toEqual(
      [...EMAIL_TEMPLATE_KEYS].sort(),
    );

    for (const templateKey of EMAIL_TEMPLATE_KEYS) {
      const rendered = renderEmailTemplate(templateKey, TEMPLATE_DATA);
      expect(rendered.subject).toBe(EXPECTED_SUBJECTS[templateKey]);
      expect(rendered.body.length).toBeGreaterThan(40);
      expect(rendered.body).toContain("SwissTalentHub");
      expect(rendered.subject).not.toMatch(/[\r\n]/);
      expect(rendered.body).not.toContain("[object Object]");
    }
  });

  it("normalizes control characters in caller-provided display text", () => {
    const rendered = renderEmailTemplate("registration_welcome", {
      firstName: "Mara\r\nBcc: private@example.test",
    });

    expect(rendered.body).toContain("Mara Bcc: private@example.test");
    expect(rendered.body).not.toContain("\r");
  });
});
