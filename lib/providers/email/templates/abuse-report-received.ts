import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const abuseReportReceivedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Neue Missbrauchsmeldung eingegangen",
  body: paragraphs(
    "Guten Tag",
    `Eine neue Meldung der Kategorie «${text(data, "categoryLabel", "zu prüfen")}» wurde erfasst.`,
    "Personenbezogene Einzelheiten und der Meldungstext werden nicht in diesem E-Mail-Protokoll wiedergegeben. Prüfe den Fall im Adminbereich.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
