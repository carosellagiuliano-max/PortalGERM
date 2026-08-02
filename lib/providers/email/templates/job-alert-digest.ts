import {
  integer,
  paragraphs,
  renderAction,
  text,
  type EmailTemplateRenderer,
} from "./_shared";

export const jobAlertDigestTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Neue Stellen aus deinem Jobabo",
  body: paragraphs(
    "Guten Tag",
    `Für «${text(data, "alertName", "dein Jobabo")}» wurden ${integer(data, "jobCount")} neue Stellen gefunden.`,
    `Jobabo mit einem Klick abbestellen: ${renderAction(data, "unsubscribeUrl", "Geschützter Abmeldelink nicht verfügbar")}`,
    "Die Service-Zustellung ist unabhängig von Marketing-Nachrichten. Der geschützte Abmeldelink wird nicht im Versandprotokoll gespeichert.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
