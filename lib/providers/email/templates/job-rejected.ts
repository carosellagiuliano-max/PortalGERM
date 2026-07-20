import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const jobRejectedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Dein Stelleninserat benötigt Anpassungen",
  body: paragraphs(
    "Guten Tag",
    `Das Stelleninserat «${text(data, "jobTitle", "deine Stelle")}» wurde noch nicht freigegeben.`,
    text(data, "reason", "Die Hinweise zur Überarbeitung findest du im Arbeitgeberbereich.", 500),
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
