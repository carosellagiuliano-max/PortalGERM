import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const applicationSubmittedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Deine Bewerbung wurde erfasst",
  body: paragraphs(
    "Guten Tag",
    `Deine Bewerbung für «${text(data, "jobTitle", "die ausgewählte Stelle")}» bei ${text(data, "companyName", "dem Unternehmen")} wurde auf SwissTalentHub erfasst.`,
    "Den aktuellen Stand siehst du jederzeit in deinem Kandidatenbereich.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
