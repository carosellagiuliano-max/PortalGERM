import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const applicationStatusChangedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Neuer Status deiner Bewerbung",
  body: paragraphs(
    "Guten Tag",
    `Der Status deiner Bewerbung für «${text(data, "jobTitle", "die ausgewählte Stelle")}» wurde auf «${text(data, "statusLabel", "aktualisiert")}» gesetzt.`,
    "Weitere Angaben findest du geschützt in deinem Kandidatenbereich.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
