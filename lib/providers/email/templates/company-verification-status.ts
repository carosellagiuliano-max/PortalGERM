import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const companyVerificationStatusTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Status deiner Unternehmensprüfung",
  body: paragraphs(
    "Guten Tag",
    `Der Prüfstatus für ${text(data, "companyName", "dein Unternehmen")} lautet: ${text(data, "statusLabel", "wird geprüft")}.`,
    text(data, "reason", "Weitere Hinweise findest du im Arbeitgeberbereich.", 500),
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
