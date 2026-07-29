import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const interviewChangedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Interviewtermin wurde aktualisiert",
  body: paragraphs(
    `${text(data, "jobTitle", "Interview")}: ${text(data, "statusLabel", "aktualisiert")}.`,
    `Termin: ${text(data, "timeLabel", "noch offen")}. Bitte öffne SwissTalentHub für RSVP, Verschiebung, Storno und die aktuelle Kalenderdatei.`,
  ),
});
