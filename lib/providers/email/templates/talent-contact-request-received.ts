import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const talentContactRequestReceivedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Neue Kontaktanfrage über Talent Radar",
  body: paragraphs(
    "Guten Tag",
    `${text(data, "companyName", "Ein geprüftes Unternehmen")} möchte über Talent Radar mit dir Kontakt aufnehmen.`,
    "Du entscheidest in deinem Kandidatenbereich, ob du die Anfrage annimmst oder ablehnst. Deine Identität bleibt bis zu deiner ausdrücklichen Freigabe geschützt.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
