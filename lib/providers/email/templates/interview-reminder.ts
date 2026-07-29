import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const interviewReminderTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Erinnerung an deinen Interviewtermin",
  body: paragraphs(
    `${text(data, "jobTitle", "Interview")} · ${text(data, "timeLabel", "Termin in SwissTalentHub")}.`,
    "Die aktuelle Terminversion und Kalenderdatei findest du in SwissTalentHub.",
  ),
});
