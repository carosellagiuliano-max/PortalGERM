import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const subscriptionRenewalReminderTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Hinweis zur Verlängerung deines Abonnements",
  body: paragraphs(
    "Guten Tag",
    `Für «${text(data, "planName", "dein Abonnement")}» steht eine Verlängerung bevor.`,
    `Das vorgesehene Datum ist ${text(data, "renewalDate", "im Arbeitgeberbereich ersichtlich")}. Im Mock-MVP erfolgt keine automatische Belastung.`,
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
