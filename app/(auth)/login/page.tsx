import type { Metadata } from "next";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Anmelden",
  description: "Sicher bei SwissTalentHub anmelden.",
};

type LoginSearchParams = Promise<{
  next?: string | string[];
  reset?: string | string[];
  loggedOut?: string | string[];
  reason?: string | string[];
}>;

export default async function LoginPage({
  searchParams,
}: Readonly<{ searchParams: LoginSearchParams }>) {
  const query = await searchParams;
  const next = firstValue(query.next);
  const notice = getLoginNotice(query);

  return (
    <AuthCard
      eyebrow="Sicherer Zugang"
      title="Willkommen zurück"
      description="Melde dich mit deiner E-Mail-Adresse und deinem Passwort an. Zugangsdaten werden bei Fehlern immer gleich behandelt."
      footer={
        <>
          Noch kein Konto? <AuthTextLink href="/register">Jetzt registrieren</AuthTextLink>
        </>
      }
    >
      {notice === undefined ? null : (
        <Alert className="mb-5">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <LoginForm next={next} />
    </AuthCard>
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getLoginNotice(query: Awaited<LoginSearchParams>) {
  if (firstValue(query.reset) === "success") {
    return "Dein Passwort wurde geändert. Du kannst dich jetzt mit dem neuen Passwort anmelden.";
  }
  if (firstValue(query.loggedOut) === "1") {
    return "Du wurdest sicher abgemeldet.";
  }
  if (firstValue(query.reason) === "session") {
    return "Deine Sitzung ist nicht mehr gültig. Bitte melde dich erneut an.";
  }
  return undefined;
}
