import { integer, paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const jobAlertPreviewTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Vorschau deines Jobabos",
  body: paragraphs(
    "Guten Tag",
    `Die Vorschau für «${text(data, "alertName", "dein Jobabo")}» enthält ${integer(data, "jobCount")} passende Stellen.`,
    "Dies ist eine Vorschau; es wurde kein Versand ausgelöst.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
