import {
  paragraphs,
  renderAction,
  text,
  type EmailTemplateRenderer,
} from "./_shared";

export const companyInvitationTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Einladung zu einem Unternehmen auf SwissTalentHub",
  body: paragraphs(
    "Guten Tag",
    `${text(data, "inviterName", "Ein Teammitglied")} lädt dich ein, dem Unternehmen ${text(data, "companyName", "auf SwissTalentHub")} beizutreten.`,
    "Nimm die Einladung über den einmalig nutzbaren Link an:",
    renderAction(
      data,
      "invitationUrl",
      "Der geschützte Link ist nur in der lokalen Test-Mailbox verfügbar.",
    ),
    "Wenn du keine Einladung erwartest, kannst du diese Nachricht ignorieren.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
