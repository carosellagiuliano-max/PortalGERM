import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const demoRequestReceivedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Neue Demo-Anfrage eingegangen",
  body: paragraphs(
    "Guten Tag",
    `Eine Demo-Anfrage von ${text(data, "companyName", "einem interessierten Unternehmen")} wurde lokal erfasst.`,
    "Kontaktdaten und Einwilligungen sind ausschliesslich im geschützten Adminbereich zu prüfen.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
