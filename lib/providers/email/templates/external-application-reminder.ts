import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const externalApplicationReminderTemplate: EmailTemplateRenderer = (
  data,
) => ({
  subject: "Erinnerung zu deinem externen Bewerbungsverlauf",
  body: paragraphs(
    `Du hast eine freiwillige Erinnerung für ${text(data, "jobTitle", "deine externe Bewerbung")} bei ${text(data, "companyName", "dem Unternehmen")} gesetzt.`,
    "SwissTalentHub kennt den Status nicht automatisch. Bitte aktualisiere ihn nur, wenn du ihn selbst bestätigen kannst.",
  ),
});
