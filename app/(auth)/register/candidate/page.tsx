import type { Metadata } from "next";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { CandidateRegistrationForm } from "@/components/auth/candidate-registration-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { resolveRegistrationLegalGate } from "@/lib/auth/registration-legal-gate";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Kandidatenkonto erstellen",
  description: "Sicheres Kandidatenkonto für SwissTalentHub erstellen.",
};

type CandidateRegistrationSearchParams = Promise<{
  next?: string | string[];
}>;

export default async function CandidateRegistrationPage({
  searchParams,
}: Readonly<{ searchParams: CandidateRegistrationSearchParams }>) {
  const query = await searchParams;
  const next = Array.isArray(query.next) ? query.next[0] : query.next;
  const legalGate = await resolveRegistrationLegalGate(
    getServerEnvironment(),
    getDatabase(),
  );
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
      {legalGate.allowed ? (
        <CandidateRegistrationForm next={next} />
      ) : (
        <Alert>
          <AlertTitle>Registrierung noch nicht freigegeben</AlertTitle>
          <AlertDescription>
            Nutzungsbedingungen und Datenschutzhinweis müssen zuerst fachlich
            geprüft und vollständig veröffentlicht werden. Bis dahin nimmt
            SwissTalentHub keine neuen Kontodaten an.
          </AlertDescription>
        </Alert>
      )}
    </AuthCard>
  );
}
