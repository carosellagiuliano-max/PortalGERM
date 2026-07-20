import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const jobBoostActivatedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Job-Boost wurde aktiviert",
  body: paragraphs(
    "Guten Tag",
    `Der Job-Boost für «${text(data, "jobTitle", "deine Stelle")}» ist aktiv.`,
    "Status und Laufzeit sind im Arbeitgeberbereich ersichtlich. Der Fair-Job-Score bleibt vom Boost unberührt.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
