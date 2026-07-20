import { integer, paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const creditsGrantedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Credits wurden gutgeschrieben",
  body: paragraphs(
    "Guten Tag",
    `${integer(data, "creditCount")} ${text(data, "creditTypeLabel", "Credits")} wurden deinem Unternehmen gutgeschrieben.`,
    "Die Buchung und der aktuelle Saldo sind im Arbeitgeberbereich nachvollziehbar.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
