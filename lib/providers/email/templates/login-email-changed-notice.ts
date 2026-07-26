import { paragraphs, type EmailTemplateRenderer } from "./_shared";

export const loginEmailChangedNoticeTemplate: EmailTemplateRenderer = () => ({
  subject: "Deine Login-E-Mail bei SwissTalentHub wurde geändert",
  body: paragraphs(
    "Guten Tag",
    "Die Login-E-Mail-Adresse deines SwissTalentHub-Kontos wurde erfolgreich geändert.",
    "Alle anderen aktiven Sitzungen wurden aus Sicherheitsgründen beendet.",
    "Falls du diese Änderung nicht vorgenommen hast, setze dein Passwort zurück und kontaktiere den Support.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
