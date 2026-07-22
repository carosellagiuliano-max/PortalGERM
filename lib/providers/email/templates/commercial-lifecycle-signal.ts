import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const commercialLifecycleSignalTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Kommerzieller Hinweis zur Prüfung",
  body: paragraphs(
    "Guten Tag",
    `Für «${text(data, "companyName", "ein Unternehmen")}" wurde der Hinweis «${text(data, "signalLabel", "Prüfung erforderlich")}" erzeugt.`,
    `Fällig: ${text(data, "dueDate", "im Business Cockpit ersichtlich")}. Der Hinweis basiert ausschliesslich auf aggregierten Betriebsdaten.`,
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
