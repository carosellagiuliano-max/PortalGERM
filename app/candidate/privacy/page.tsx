import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "@/components/shared/app-link";

import {
  updateCandidateAnalyticsConsentAction,
} from "@/app/candidate/privacy/actions";
import {
  PrivacyCorrectionRequestForm,
  PrivacyDeleteRequestForm,
  PrivacyExportRequestForm,
} from "@/components/candidate/privacy-request-forms";
import { RadarVisibilityForm } from "@/components/candidate/RadarVisibilityForm";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveTable,
  ResponsiveTableCell,
} from "@/components/ui/responsive-table";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getCandidatePrivacyDashboard } from "@/lib/candidate/privacy-dashboard";
import { getDatabase } from "@/lib/db/client";
import { getServerEnvironment } from "@/lib/config/env";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Privatsphäre" };

const RADAR_LABELS = {
  VISIBLE: "Anonym sichtbar",
  PAUSED: "Pausiert",
  OFF: "Nicht sichtbar",
  INCOMPLETE: "Profil unvollständig",
} as const;
const CONTACT_LABELS: Readonly<Record<string, string>> = {
  PENDING: "Offen", ACCEPTED: "Akzeptiert", DECLINED: "Abgelehnt",
  EXPIRED: "Abgelaufen", CANCELLED: "Abgebrochen",
};
const REQUEST_LABELS: Readonly<Record<string, string>> = {
  EXPORT: "Datenexport", DELETE: "Konto-Löschung", CORRECT: "Datenkorrektur",
};

export default async function CandidatePrivacyPage() {
  const user = await requireCandidatePage();
  const dashboard = await getCandidatePrivacyDashboard(getDatabase(), user.id);
  if (dashboard === null) return null;
  const [analyticsConsents, analyticsPublication] = await Promise.all([
    getDatabase().analyticsConsentEvent.findMany({
      where: { userId: user.id },
      orderBy: [{ eventFamily: "asc" }, { effectiveAt: "desc" }],
      distinct: ["eventFamily"],
    }),
    getDatabase().legalPublication.findFirst({
      where: {
        status: "CURRENT",
        effectiveAt: { lte: new Date() },
        legalDocument: { type: "ANALYTICS", locale: "de-CH" },
      },
      select: { id: true, publicationHash: true },
    }),
  ]);
  const environment = getServerEnvironment();
  return (
    <section aria-labelledby="privacy-title">
      <p className="eyebrow">Privatsphäre</p>
      <h1 id="privacy-title" className="mt-2 text-3xl font-semibold tracking-tight">Deine Daten, deine Entscheidungen</h1>
      <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">DSG-freundliches MVP — Orientierung, keine Rechtsberatung. Identität bleibt anonym, bis du sie ausdrücklich freigibst.</p>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle as="h2">Talent Radar</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center justify-between gap-3"><span>Aktueller Status</span><Badge>{RADAR_LABELS[dashboard.radarState]}</Badge></div>
            <p className="text-sm leading-6 text-muted-foreground">Sichtbarkeit lässt sich im SwissJobPass oder auf der eigenen Talent-Radar-Seite ändern. Marketing- und AGB-Einwilligungen bleiben davon getrennt.</p>
            <RadarVisibilityForm
              consentGranted={dashboard.currentConsentGranted}
              candidateUserId={user.id}
              stepUpRequired={
                environment.PRIVILEGED_STEP_UP_MODE === "enforce"
              }
            />
            <div className="flex flex-wrap gap-2"><Link href="/candidate/talent-radar" className={buttonVariants()}>Sichtbarkeit verwalten</Link><Link href="/candidate/jobpass" className={buttonVariants({ variant: "outline" })}>SwissJobPass öffnen</Link></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h2">Einwilligungsprotokoll</CardTitle></CardHeader>
          <CardContent>
            {dashboard.consents.length === 0 ? <p className="text-muted-foreground">Noch keine Talent-Radar-Entscheidung protokolliert.</p> : (
              <ResponsiveTable label="Einwilligungsprotokoll"><thead><tr className="border-b"><th className="p-3">Datum</th><th className="p-3">Art</th><th className="p-3">Wert</th><th className="p-3">Version</th></tr></thead><tbody>{dashboard.consents.map((consent) => <tr key={consent.id} className="border-b last:border-0"><ResponsiveTableCell className="p-3" label="Datum" primary>{formatDate(consent.effectiveAt)}</ResponsiveTableCell><ResponsiveTableCell className="p-3" label="Art">Talent Radar</ResponsiveTableCell><ResponsiveTableCell className="p-3" label="Wert">{consent.granted ? "Ein" : "Aus"}</ResponsiveTableCell><ResponsiveTableCell className="p-3" label="Version">{consent.noticeVersion}</ResponsiveTableCell></tr>)}</tbody></ResponsiveTable>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle as="h2">Optionale Produktanalyse</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm leading-6 text-muted-foreground">
            Betriebliche Sicherheits- und Workflow-Evidence bleibt davon
            unberührt. Optionale Navigation und Conversion werden getrennt,
            standardmässig aus und ohne Werbepixel verwaltet. Ein Widerruf
            stoppt neue optionale Events sofort.
          </p>
          {(["NAVIGATION", "CONVERSION"] as const).map((family) => {
            const latest = analyticsConsents.find(
              (consent) => consent.eventFamily === family,
            );
            const enabled =
              family === "NAVIGATION"
                ? environment.OPTIONAL_ANALYTICS_NAVIGATION
                : environment.OPTIONAL_ANALYTICS_CONVERSION;
            const canGrant = enabled && analyticsPublication !== null;
            return (
              <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between" key={family}>
                <div>
                  <p className="font-medium">
                    {family === "NAVIGATION" ? "Navigation & Suche" : "Bewerbungs- und Preisinteresse"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Status: {latest?.granted ? "freiwillig aktiviert" : "aus"}
                    {latest ? ` · Policy ${latest.policyVersion}` : ""}
                  </p>
                </div>
                <form action={updateCandidateAnalyticsConsentAction}>
                  <input type="hidden" name="eventFamily" value={family} />
                  <input
                    type="hidden"
                    name="granted"
                    value={latest?.granted ? "false" : "true"}
                  />
                  <button
                    type="submit"
                    disabled={!latest?.granted && !canGrant}
                    className={buttonVariants({
                      variant: latest?.granted ? "outline" : "default",
                    })}
                  >
                    {latest?.granted
                      ? "Sofort widerrufen"
                      : canGrant
                        ? "Freiwillig aktivieren"
                        : "Noch nicht freigegeben"}
                  </button>
                </form>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader><CardTitle as="h2">Arbeitgeberkontakte</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-sm leading-6 text-muted-foreground">Gezeigt werden protokollierte Kontaktanfragen und separate Identitätsfreigaben. Unmodellierte Profilaufrufe werden nicht behauptet.</p>
          {dashboard.contacts.length === 0 ? <p className="text-muted-foreground">Noch keine Arbeitgeberkontakte.</p> : <div className="grid gap-3">{dashboard.contacts.map((contact) => <div key={contact.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{contact.company.name}</p><p className="text-xs text-muted-foreground">Anfrage {formatDate(contact.createdAt)}{contact.revealedAt === null ? "" : ` · Identität freigegeben ${formatDate(contact.revealedAt)}`}</p><div className="mt-2 flex flex-wrap gap-3 text-sm"><Link href={`/candidate/talent-radar/requests/${contact.id}`} className="font-medium underline underline-offset-4">Kontaktanfrage öffnen</Link><Link href={`/candidate/talent-radar/requests/${contact.id}/report`} className="font-medium underline underline-offset-4">Firma melden</Link></div></div><Badge variant="outline">{CONTACT_LABELS[contact.status] ?? contact.status}</Badge></div>)}</div>}
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <PrivacyRequestCard title="Datenexport anfordern" description="Erstellt einen nachverfolgbaren Export-Fall. Nach Prüfung entsteht ein verschlüsseltes, höchstens 15 Minuten gültiges Einmal-Artefakt." />
        <Card>
          <CardHeader><CardTitle as="h2">Konto-Löschung beantragen</CardTitle></CardHeader>
          <CardContent><p className="mb-4 text-sm leading-6 text-muted-foreground">Die Anfrage startet einen processorweisen Vollzug. Zulässige Daten werden gelöscht oder anonymisiert; eng begrenzte Holds und Aufbewahrung bleiben verständlich sichtbar.</p><PrivacyDeleteRequestForm idempotencyKey={randomUUID()} stepUpRequired={environment.PRIVILEGED_STEP_UP_MODE === "enforce"} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h2">Datenkorrektur</CardTitle></CardHeader>
          <CardContent><PrivacyCorrectionRequestForm idempotencyKey={randomUUID()} stepUpRequired={environment.PRIVILEGED_STEP_UP_MODE === "enforce"} /></CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle as="h2">Deine Datenschutzfälle</CardTitle></CardHeader>
          <CardContent>{dashboard.requests.length === 0 ? <p className="text-muted-foreground">Noch keine Anfrage.</p> : <div className="grid gap-3">{dashboard.requests.map((request) => <Link href={`/candidate/privacy/requests/${request.id}`} key={request.id} className="flex flex-col gap-2 rounded-lg border p-3 hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{REQUEST_LABELS[request.type]}</p><p className="text-xs text-muted-foreground">Erstellt {formatDate(request.createdAt)} · Zieltermin {formatDate(request.dueAt)}</p></div><Badge variant="outline">{request.status}</Badge></Link>)}</div>}</CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader><CardTitle as="h2">Missbrauch melden</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-2xl text-sm leading-6 text-muted-foreground">Verdächtige Arbeitgeber kannst du direkt im Firmenprofil oder im zugehörigen Gespräch melden. Meldungen werden als eigener AbuseReport protokolliert.</p><Link href="/candidate/messages" className={buttonVariants({ variant: "outline" })}>Nachrichten prüfen</Link></CardContent>
      </Card>
    </section>
  );
}

function PrivacyRequestCard({ title, description }: Readonly<{ title: string; description: string }>) {
  return <Card><CardHeader><CardTitle as="h2">{title}</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm leading-6 text-muted-foreground">{description}</p><PrivacyExportRequestForm idempotencyKey={randomUUID()} stepUpRequired={getServerEnvironment().PRIVILEGED_STEP_UP_MODE === "enforce"} /></CardContent></Card>;
}
