import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const identityRevealedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Bestätigung deiner Identitätsfreigabe",
  body: paragraphs(
    "Guten Tag",
    `Du hast ausgewählte Kontaktdaten für ${text(data, "companyName", "ein Unternehmen")} freigegeben.`,
    "Die Freigabe gilt nur für die bestätigte Anfrage. Einzelheiten und Widerrufsmöglichkeiten findest du in deinem Konto.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
