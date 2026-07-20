import type { Metadata } from "next";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { EmployerRegistrationForm } from "@/components/auth/employer-registration-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getEmployerRegistrationClaimDefaults } from "@/lib/auth/server-actions";

export const metadata: Metadata = {
  title: "Arbeitgeberkonto erstellen",
  description: "Arbeitgeberkonto und sicheren Firmenzugang bei SwissTalentHub anlegen.",
};

type EmployerRegistrationSearchParams = Promise<{
  claim?: string | string[];
  intent?: string | string[];
  next?: string | string[];
}>;

export default async function EmployerRegistrationPage({
  searchParams,
}: Readonly<{ searchParams: EmployerRegistrationSearchParams }>) {
  const query = await searchParams;
  const hasClaimParameters = query.claim !== undefined || query.intent !== undefined;
  const hasStrictClaimPair =
    typeof query.claim === "string" && typeof query.intent === "string";
  const claimDefaults = hasStrictClaimPair
    ? await getEmployerRegistrationClaimDefaults(query.claim, query.intent)
    : null;

  if (hasClaimParameters && claimDefaults === null) {
    return (
      <AuthCard
        eyebrow="Firmenübernahme"
        title="Link nicht verwendbar"
        description="Der Firmenübernahme-Link konnte nicht sicher bestätigt werden. Aus diesem Link wird kein Firmenanspruch übernommen."
        footer={
          <AuthTextLink href="/register/employer">
            Ohne Firmenübernahme registrieren
          </AuthTextLink>
        }
      >
        <Alert variant="destructive">
          <AlertDescription>
            Der Link ist ungültig oder abgelaufen. Bitte öffne die öffentliche
            Firmenseite erneut und starte dort einen neuen Prüfauftrag.
          </AlertDescription>
        </Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Für Arbeitgeber"
      title="Arbeitgeberkonto erstellen"
      description={
        claimDefaults === null
          ? "Lege deinen persönlichen Zugang an und gib die wichtigsten Unternehmensdaten an. Bestehende Firmenkonten werden nicht automatisch übernommen."
          : `Lege deinen persönlichen Zugang an, um einen Prüfauftrag für ${claimDefaults.companyName} einzureichen. Der Zugang wird erst nach einer separaten Prüfung vergeben.`
      }
      footer={
        <>
          Auf Stellensuche?{" "}
          <AuthTextLink href="/register/candidate">Kandidatenkonto erstellen</AuthTextLink>
        </>
      }
    >
      <EmployerRegistrationForm
        claimContext={
          claimDefaults === null
            ? undefined
            : {
                claim: query.claim as string,
                intent: query.intent as string,
                companyName: claimDefaults.companyName,
                cantonCode: claimDefaults.cantonCode,
              }
        }
      />
    </AuthCard>
  );
}
