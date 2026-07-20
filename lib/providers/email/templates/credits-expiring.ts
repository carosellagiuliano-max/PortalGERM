import { integer, paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const creditsExpiringTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Hinweis zu ablaufenden Credits",
  body: paragraphs(
    "Guten Tag",
    `${integer(data, "creditCount")} Credits laufen am ${text(data, "expiryDate", "angezeigten Datum")} ab.`,
    "Die verbindlichen Details findest du in deinem Arbeitgeberbereich.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
