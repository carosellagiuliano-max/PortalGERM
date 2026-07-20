import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const employerMessageReceivedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Neue Nachricht zu deiner Bewerbung",
  body: paragraphs(
    "Guten Tag",
    `${text(data, "companyName", "Ein Unternehmen")} hat dir zu «${text(data, "jobTitle", "deiner Bewerbung")}» eine neue Nachricht gesendet.`,
    "Lies die Nachricht geschützt in deinem SwissTalentHub-Konto. Der Nachrichteninhalt wird nicht in dieser E-Mail protokolliert.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
