import type { Metadata } from "next";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Passwort vergessen",
  description: "Einen sicheren Link zum Zurücksetzen des Passworts anfordern.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      eyebrow="Kontozugang"
      title="Passwort zurücksetzen"
      description="Gib deine E-Mail-Adresse ein. Falls ein berechtigtes Konto existiert, senden wir dir einen zeitlich begrenzten Link. Die Antwort ist aus Sicherheitsgründen immer gleich."
      footer={<AuthTextLink href="/login">Zurück zur Anmeldung</AuthTextLink>}
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
