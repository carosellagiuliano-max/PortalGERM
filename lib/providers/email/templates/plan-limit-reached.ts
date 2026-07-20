import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const planLimitReachedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Nutzungslimit deines Plans erreicht",
  body: paragraphs(
    "Guten Tag",
    `Das Nutzungslimit für «${text(data, "featureName", "diese Funktion")}» ist erreicht.`,
    "Im Arbeitgeberbereich siehst du deine aktuelle Nutzung und mögliche nächste Schritte.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
