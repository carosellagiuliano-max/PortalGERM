import {
  greeting,
  paragraphs,
  renderAction,
  type EmailTemplateRenderer,
} from "./_shared";

export const identityVerificationTemplate: EmailTemplateRenderer = (data) => ({
  subject: "E-Mail-Adresse bei SwissTalentHub bestätigen",
  body: paragraphs(
    greeting(data),
    "Bestätige deine E-Mail-Adresse über den einmalig nutzbaren Link:",
    renderAction(
      data,
      "verificationUrl",
      "Der geschützte Bestätigungslink ist nur in der lokalen Test-Mailbox verfügbar.",
    ),
    "Der Link ist 30 Minuten gültig. Eine ältere Bestätigungsnachricht verliert nach erneutem Versand ihre Gültigkeit.",
    "Wenn du dieses Konto nicht erstellt hast, kannst du diese Nachricht ignorieren.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
