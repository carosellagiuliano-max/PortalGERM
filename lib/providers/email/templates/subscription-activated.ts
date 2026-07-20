import { paragraphs, text, type EmailTemplateRenderer } from "./_shared";

export const subscriptionActivatedTemplate: EmailTemplateRenderer = (data) => ({
  subject: "Dein SwissTalentHub-Abonnement ist aktiv",
  body: paragraphs(
    "Guten Tag",
    `Das Abonnement «${text(data, "planName", "dein gewählter Plan")}» ist jetzt aktiv.`,
    "Leistungen und Laufzeit siehst du im Arbeitgeberbereich. Dies ist eine lokal protokollierte Mock-E-Mail.",
    "Freundliche Grüsse\nDein SwissTalentHub-Team",
  ),
});
