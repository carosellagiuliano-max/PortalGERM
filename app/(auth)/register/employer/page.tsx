import type { Metadata } from "next";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { EmployerRegistrationForm } from "@/components/auth/employer-registration-form";

export const metadata: Metadata = {
  title: "Arbeitgeberkonto erstellen",
  description: "Arbeitgeberkonto und sicheren Firmenzugang bei SwissTalentHub anlegen.",
};

export default function EmployerRegistrationPage() {
  return (
    <AuthCard
      eyebrow="Für Arbeitgeber"
      title="Arbeitgeberkonto erstellen"
      description="Lege deinen persönlichen Zugang an und gib die wichtigsten Unternehmensdaten an. Bestehende Firmenkonten werden nicht automatisch übernommen."
      footer={
        <>
          Auf Stellensuche?{" "}
          <AuthTextLink href="/register/candidate">Kandidatenkonto erstellen</AuthTextLink>
        </>
      }
    >
      <EmployerRegistrationForm />
    </AuthCard>
  );
}
