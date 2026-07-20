import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const paymentReceivedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Zahlung im Mock-Checkout bestätigt",
  body: paragraphs(
    "Guten Tag",
    `Die Mock-Zahlung für Bestellung ${text(data, "orderReference", "deiner Bestellung")} wurde lokal bestätigt.`,
    "Es fand keine reale Kartenbelastung oder externe Zahlungsabwicklung statt.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
