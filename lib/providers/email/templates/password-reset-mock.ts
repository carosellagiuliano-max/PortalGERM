import {
  greeting,
  integer,
  paragraphs,
  renderAction,
  type EmailTemplateRenderer,
} from "./_shared";

export const passwordResetMockTemplate: EmailTemplateRenderer = (data) => {
  const minutes = Math.min(integer(data, "expiresInMinutes", 15), 15);
  return {
    subject: "Passwort für SwissTalentHub zurücksetzen",
    body: paragraphs(
      greeting(data),
      "Für dein SwissTalentHub-Konto wurde eine Passwortänderung angefordert.",
      `Der einmalige Link ist höchstens ${minutes || 15} Minuten gültig:`,
      renderAction(
        data,
        "resetUrl",
        "Der geschützte Link ist nur in der lokalen Test-Mailbox verfügbar.",
      ),
      "Falls du die Änderung nicht angefordert hast, kannst du diese Nachricht ignorieren.",
      "Freundliche Grüsse\nDein SwissTalentHub-Team",
    ),
  };
};
