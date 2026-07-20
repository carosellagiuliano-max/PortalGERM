import { integer, paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const usageWarningTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Hinweis zu deiner aktuellen Nutzung",
  body: paragraphs(
    "Guten Tag",
    `Für «${text(data, "featureName", "eine Funktion")} sind ${integer(data, "used")} von ${integer(data, "limit")} Einheiten genutzt.`,
    "Im Arbeitgeberbereich findest du die aktuelle, verbindliche Übersicht.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
