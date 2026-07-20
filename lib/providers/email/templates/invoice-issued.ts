import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const invoiceIssuedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Neue Rechnung von SwissTalentHub",
  body: paragraphs(
    "Guten Tag",
    `Die Rechnung ${text(data, "invoiceNumber", "für deine Bestellung")} wurde erstellt.`,
    "Rechnungsdetails sind im geschützten Arbeitgeberbereich verfügbar. Es wird kein externer Dateianhang versendet.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
