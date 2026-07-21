import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { InvitationAcceptance } from "@/components/employer/invitation-acceptance";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  INVITE_RESUME_COOKIE_POLICY_V1,
  INVITE_RESUME_PATH,
  readInviteResumeToken,
} from "@/lib/auth/invite-resume";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { inspectCompanyInvitation } from "@/lib/employer/team";

export const metadata: Metadata = {
  title: "Teameinladung",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default async function InviteResumePage() {
  const [cookieStore, user] = await Promise.all([cookies(), getCurrentUser()]);
  const environment = getServerEnvironment();
  const token = readInviteResumeToken(
    cookieStore.get(INVITE_RESUME_COOKIE_POLICY_V1.cookieName)?.value,
    new Date(),
    environment.secrets.session,
  );
  const invitation =
    token === null
      ? Object.freeze({ state: "INVALID" as const })
      : await inspectCompanyInvitation(token, getDatabase(), user);

  if (invitation.state === "READY") {
    return (
      <AuthCard
        eyebrow="Teameinladung"
        title="Unternehmen beitreten"
        description="Rolle, E-Mail und Sitzplatz werden beim Annehmen erneut atomar geprüft."
      >
        <InvitationAcceptance
          authenticated
          companyName={invitation.companyName}
          intendedRole={invitation.intendedRole}
        />
      </AuthCard>
    );
  }
  if (invitation.state === "AUTH_REQUIRED") {
    return (
      <AuthCard
        eyebrow="Teameinladung"
        title="Sicher beitreten"
        description="Melde dich mit der eingeladenen E-Mail an oder erstelle hier ein separates Arbeitgeberkonto."
        footer={
          <AuthTextLink
            href={`/login?next=${encodeURIComponent(INVITE_RESUME_PATH)}`}
          >
            Mit bestehendem Konto anmelden
          </AuthTextLink>
        }
      >
        <InvitationAcceptance authenticated={false} />
      </AuthCard>
    );
  }
  return (
    <section className="page-shell py-16">
      <div className="mx-auto max-w-xl">
        <Alert>
          <AlertTitle>Einladung nicht verfügbar</AlertTitle>
          <AlertDescription>{stateMessage(invitation.state)}</AlertDescription>
        </Alert>
        <Link
          href="/login"
          className={buttonVariants({ variant: "outline", className: "mt-5" })}
        >
          Zur Anmeldung
        </Link>
      </div>
    </section>
  );
}

function stateMessage(state: string) {
  const messages: Record<string, string> = {
    USED: "Dieser Link wurde bereits verwendet.",
    REVOKED: "Diese Einladung wurde widerrufen.",
    EXPIRED:
      "Diese Einladung ist abgelaufen. Bitte fordere einen neuen Link an.",
    COMPANY_INACTIVE:
      "Das Unternehmen kann aktuell keine Einladung annehmen.",
    EMAIL_MISMATCH:
      "Diese Einladung ist nicht für das angemeldete Konto bestimmt.",
    ACCOUNT_TYPE_UNSUPPORTED:
      "Bitte verwende ein separates Arbeitgeberkonto oder kontaktiere den Support.",
  };
  return messages[state] ?? "Der Link ist ungültig oder nicht mehr verfügbar.";
}
