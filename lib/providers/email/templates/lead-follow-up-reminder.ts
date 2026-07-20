import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const leadFollowUpReminderTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Erinnerung an eine offene Demo-Anfrage",
  body: paragraphs(
    "Guten Tag",
    `Für ${text(data, "companyName", "eine Demo-Anfrage")} ist eine Nachverfolgung vorgesehen.`,
    "Öffne den Adminbereich, um Status und zulässige Kontaktdaten einzusehen.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
