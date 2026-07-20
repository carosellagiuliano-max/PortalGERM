import { greeting, paragraphs, type EmailTemplateRenderer } from "./_shared";

export const registrationWelcomeTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Willkommen bei SwissTalentHub",
  body: paragraphs(
    greeting(data),
    "Willkommen bei SwissTalentHub. Dein Konto wurde erfolgreich eingerichtet.",
    "Du kannst nun dein Profil vervollständigen und die nächsten Schritte starten.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
