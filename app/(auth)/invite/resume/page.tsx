import type { Metadata } from "next";
import Link from "@/components/shared/app-link";
import { cookies } from "next/headers";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { SessionRefresh } from "@/components/auth/session-refresh";
import { InvitationAcceptance } from "@/components/employer/invitation-acceptance";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentAuthContext } from "@/lib/auth/current-user";
import {
  INVITE_RESUME_COOKIE_POLICY_V1,
  INVITE_RESUME_PATH,
  readInviteResumeToken,
} from "@/lib/auth/invite-resume";
import { resolveRegistrationLegalGate } from "@/lib/auth/registration-legal-gate";
import { getSessionRotationDueAt } from "@/lib/auth/session";
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
  const [cookieStore, authContext] = await Promise.all([
    cookies(),
    getCurrentAuthContext(),
  ]);
  const user = authContext?.user ?? null;
  const now = new Date();
  const environment = getServerEnvironment();
  const database = getDatabase();
  const token = readInviteResumeToken(
    cookieStore.get(INVITE_RESUME_COOKIE_POLICY_V1.cookieName)?.value,
    now,
    environment.secrets.session,
  );
  const invitation =
    token === null
      ? Object.freeze({ state: "INVALID" as const })
      : await inspectCompanyInvitation(
          token,
          database,
          user,
          now,
          environment.EXISTING_IDENTITY_INVITATION,
        );

  if (invitation.state === "READY") {
    return (
      <>
        {authContext === null ? null : (
          <SessionRefresh
            initialDelayMilliseconds={Math.max(
              0,
              getSessionRotationDueAt(authContext.session).getTime() -
                now.getTime(),
            )}
          />
        )}
        <AuthCard
          eyebrow="Teameinladung"
          title="Unternehmen beitreten"
          description="Rolle, E-Mail und Sitzplatz werden beim Annehmen erneut atomar geprüft."
        >
          <InvitationAcceptance
            authenticated
            companyName={invitation.companyName}
            intendedRole={invitation.intendedRole}
            personaStepUp={
              invitation.requiresPersonaStepUp
                ? {
                    companyId: invitation.companyId,
                    invitationId: invitation.invitationId,
                    securityHref:
                      user === null ? "/login" : securityHrefForRole(user.role),
                  }
                : undefined
            }
          />
        </AuthCard>
      </>
    );
  }
  if (invitation.state === "AUTH_REQUIRED") {
    const legalGate = await resolveRegistrationLegalGate(environment, database);
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
        {legalGate.allowed ? (
          <InvitationAcceptance authenticated={false} />
        ) : (
          <Alert>
            <AlertTitle>Kontoerstellung noch nicht freigegeben</AlertTitle>
            <AlertDescription>
              Die Einladung bleibt gültig. Bitte melde dich mit einem
              bestehenden Konto an oder warte, bis Nutzungsbedingungen und
              Datenschutzhinweis vollständig veröffentlicht sind.
            </AlertDescription>
          </Alert>
        )}
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
    COMPANY_INACTIVE: "Das Unternehmen kann aktuell keine Einladung annehmen.",
    EMAIL_MISMATCH:
      "Diese Einladung ist nicht für das angemeldete Konto bestimmt.",
    ACCOUNT_TYPE_UNSUPPORTED:
      "Bitte verwende ein separates Arbeitgeberkonto oder kontaktiere den Support.",
    PERSONA_SUSPENDED:
      "Der Arbeitgeber-Arbeitsbereich dieses Kontos ist gesperrt. Bitte kontaktiere den Support.",
    PERSONA_REVOKED:
      "Der Arbeitgeber-Arbeitsbereich dieses Kontos wurde widerrufen. Bitte kontaktiere den Support.",
  };
  return messages[state] ?? "Der Link ist ungültig oder nicht mehr verfügbar.";
}

function securityHrefForRole(
  role: "CANDIDATE" | "EMPLOYER" | "RECRUITER" | "ADMIN",
) {
  if (role === "ADMIN") return "/admin/security/authenticators";
  if (role === "CANDIDATE") return "/candidate/settings/security";
  return "/employer/settings/security";
}
