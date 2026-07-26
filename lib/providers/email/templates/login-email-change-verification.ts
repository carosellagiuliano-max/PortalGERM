import {
  paragraphs,
  renderAction,
  type EmailTemplateRenderer,
} from "./_shared";

export const loginEmailChangeVerificationTemplate: EmailTemplateRenderer = (
  data,
) => ({
  subject: "Neue Login-E-Mail bei SwissTalentHub bestätigen",
  body: paragraphs(
    "Guten Tag",
    "Für dein Konto wurde eine neue Login-E-Mail-Adresse angefordert. Bis zur Bestätigung bleibt deine bisherige Adresse gültig.",
    "Bestätige die neue Adresse über den einmalig nutzbaren Link:",
    renderAction(
      data,
      "verificationUrl",
      "Der geschützte Bestätigungslink ist nur in der lokalen Test-Mailbox verfügbar.",
    ),
    "Der Link ist 30 Minuten gültig und kann nur in der Sitzung verwendet werden, in der die Änderung gestartet wurde.",
    "Wenn du diese Änderung nicht angefordert hast, verwende den Link nicht und ändere dein Passwort.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
