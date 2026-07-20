import {
  integer,
  paragraphs,
  renderAction,
  text,
  type EmailTemplateRenderer,
} from "./_shared";

export const jobAlertDigestMockTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Neue Stellen aus deinem Jobabo",
  body: paragraphs(
    "Guten Tag",
    `Für «${text(data, "alertName", "dein Jobabo")}» wurden ${integer(data, "jobCount")} neue Stellen vorgemerkt.`,
    "Dies ist ein lokaler Mock-Eintrag und keine extern zugestellte E-Mail.",
    `Jobabo mit einem Klick pausieren: ${renderAction(data, "unsubscribeUrl", "Geschützter Abmeldelink nicht verfügbar")}`,
    "Der geschützte Abmeldelink wird nicht im E-Mail-Protokoll gespeichert.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
