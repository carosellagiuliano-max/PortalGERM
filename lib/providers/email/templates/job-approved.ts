import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const jobApprovedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Dein Stelleninserat wurde freigegeben",
  body: paragraphs(
    "Guten Tag",
    `Das Stelleninserat «${text(data, "jobTitle", "deine Stelle")}» wurde freigegeben.`,
    "Den Veröffentlichungsstatus und die öffentliche Vorschau findest du im Arbeitgeberbereich.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
