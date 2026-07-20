import type { Metadata } from "next";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { CandidateRegistrationForm } from "@/components/auth/candidate-registration-form";

export const metadata: Metadata = {
  title: "Kandidatenkonto erstellen",
  description: "Sicheres Kandidatenkonto für SwissTalentHub erstellen.",
};

export default function CandidateRegistrationPage() {
  return (
    <AuthCard
      eyebrow="Für Kandidat:innen"
      title="Dein Kandidatenkonto"
      description="Nach der Registrierung startest du direkt mit deinem privaten SwissJobPass. Pflicht- und freiwillige Einwilligungen bleiben klar getrennt."
      footer={
        <>
          Arbeitgeber?{" "}
          <AuthTextLink href="/register/employer">Arbeitgeberkonto erstellen</AuthTextLink>
        </>
      }
    >
      <CandidateRegistrationForm />
    </AuthCard>
  );
}
