import { integer, paragraphs, type EmailTemplateRenderer } from "./_shared";

export const talentRadarCreditsLowTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Talent-Radar-Guthaben wird knapp",
  body: paragraphs(
    "Guten Tag",
    `Dein verfügbares Talent-Radar-Guthaben beträgt noch ${integer(data, "remainingCredits")} Credits.`,
    "Kontostand und Nutzung sind im Arbeitgeberbereich nachvollziehbar.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
