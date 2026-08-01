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
      description="Gib deine E-Mail-Adresse ein. Die Anfrage wird für alle Adressen gleich verarbeitet; anschliessend siehst du transparent, ob der E-Mail-Versand in dieser Umgebung aktiv ist."
      footer={<AuthTextLink href="/login">Zurück zur Anmeldung</AuthTextLink>}
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
