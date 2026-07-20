import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const privacyRequestChangedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Status deiner Datenschutzanfrage wurde aktualisiert",
  body: paragraphs(
    "Guten Tag",
    `Der Status deiner Datenschutzanfrage lautet jetzt «${text(data, "statusLabel", "aktualisiert")}».`,
    "Weitere Informationen findest du geschützt in deinem Konto. Sensible Export- oder Identitätsdaten werden nicht per Mock-E-Mail protokolliert.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
