import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const jobBoostExpiredTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Job-Boost ist abgelaufen",
  body: paragraphs(
    "Guten Tag",
    `Der Job-Boost für «${text(data, "jobTitle", "deine Stelle")}» ist abgelaufen.`,
    "Die Stelle bleibt entsprechend ihrem eigenen Veröffentlichungsstatus sichtbar.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
