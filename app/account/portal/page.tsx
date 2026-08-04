import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PersonaContextSwitcher } from "@/components/auth/persona-context-switcher";
import { CandidatePersonaCreation } from "@/components/auth/candidate-persona-creation";
import { SessionRefresh } from "@/components/auth/session-refresh";
import { Badge } from "@/components/ui/badge";
import { getCurrentPersonaContextOverview } from "@/lib/auth/persona-page";
import { requireAuthenticatedPage } from "@/lib/auth/route-guards";
import { DEFAULT_AUTH_PATH_BY_ROLE_V1 } from "@/lib/auth/safe-next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Arbeitsbereich wählen",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function PortalSelectionPage() {
  const user = await requireAuthenticatedPage();
  const overview = await getCurrentPersonaContextOverview();
  if (overview === null) {
    redirect(DEFAULT_AUTH_PATH_BY_ROLE_V1[user.role]);
  }

  return (
    <main className="page-shell py-10 sm:py-16">
      <SessionRefresh
        initialDelayMilliseconds={user.sessionRotationDelayMilliseconds}
      />
      <div className="mx-auto grid max-w-2xl gap-6">
        <header className="grid gap-3">
          <Badge className="w-fit" variant="outline">
            Ein Login · klare Kontexte
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            In welchem Arbeitsbereich möchtest du handeln?
          </h1>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">
            Der Wechsel ändert nur die Oberfläche. Kandidatendaten,
            Firmenmitgliedschaften und Adminrechte werden bei jeder Aktion
            weiterhin getrennt auf dem Server geprüft.
          </p>
        </header>

        <PersonaContextSwitcher
          activePortal={overview.activePortal}
          portals={overview.portals}
          companies={overview.companies}
        />

        {overview.portals.some(
          ({ portal, state }) => portal === "CANDIDATE" && state === "MISSING",
        ) ? (
          <CandidatePersonaCreation
            securityHref={securityHref(user.role)}
            userId={user.id}
          />
        ) : null}

        <p className="text-xs leading-5 text-muted-foreground">
          Angemeldet als {user.name ?? user.email}. Gesperrte oder widerrufene
          Arbeitsbereiche können nicht durch einen Portalwechsel reaktiviert
          werden.
        </p>
      </div>
    </main>
  );
}

function securityHref(role: "CANDIDATE" | "EMPLOYER" | "RECRUITER" | "ADMIN") {
  if (role === "ADMIN") return "/admin/security/authenticators";
  if (role === "CANDIDATE") return "/candidate/settings/security";
  return "/employer/settings/security";
}
