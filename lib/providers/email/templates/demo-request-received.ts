import { paragraphs, type EmailTemplateRenderer } from "./_shared";

export const demoRequestReceivedTemplate: EmailTemplateRenderer = () => ({
  subject: "Neue Demo-Anfrage eingegangen",
  body: paragraphs(
    "Guten Tag",
    "Eine neue Demo-Anfrage wurde lokal erfasst.",
    "Kontaktdaten und Einwilligungen sind ausschliesslich im geschützten Adminbereich zu prüfen.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
