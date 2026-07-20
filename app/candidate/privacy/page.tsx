import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import {
  PrivacyCorrectionRequestForm,
  PrivacyDeleteRequestForm,
  PrivacyExportRequestForm,
} from "@/components/candidate/privacy-request-forms";
import { RadarVisibilityForm } from "@/components/candidate/RadarVisibilityForm";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getCandidatePrivacyDashboard } from "@/lib/candidate/privacy-dashboard";
import { getDatabase } from "@/lib/db/client";
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
            <RadarVisibilityForm consentGranted={dashboard.currentConsentGranted} />
            <div className="flex flex-wrap gap-2"><Link href="/candidate/talent-radar" className={buttonVariants()}>Sichtbarkeit verwalten</Link><Link href="/candidate/jobpass" className={buttonVariants({ variant: "outline" })}>SwissJobPass öffnen</Link></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h2">Einwilligungsprotokoll</CardTitle></CardHeader>
          <CardContent>
            {dashboard.consents.length === 0 ? <p className="text-muted-foreground">Noch keine Talent-Radar-Entscheidung protokolliert.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2 pr-4">Datum</th><th className="py-2 pr-4">Art</th><th className="py-2 pr-4">Wert</th><th className="py-2">Version</th></tr></thead><tbody>{dashboard.consents.map((consent) => <tr key={consent.id} className="border-b last:border-0"><td className="py-2 pr-4">{formatDate(consent.effectiveAt)}</td><td className="py-2 pr-4">Talent Radar</td><td className="py-2 pr-4">{consent.granted ? "Ein" : "Aus"}</td><td className="py-2">{consent.noticeVersion}</td></tr>)}</tbody></table></div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle as="h2">Arbeitgeberkontakte</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-sm leading-6 text-muted-foreground">Gezeigt werden protokollierte Kontaktanfragen und separate Identitätsfreigaben. Unmodellierte Profilaufrufe werden nicht behauptet.</p>
          {dashboard.contacts.length === 0 ? <p className="text-muted-foreground">Noch keine Arbeitgeberkontakte.</p> : <div className="grid gap-3">{dashboard.contacts.map((contact) => <div key={contact.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><Link href={`/companies/${contact.company.slug}`} className="font-medium underline-offset-4 hover:underline">{contact.company.name}</Link><p className="text-xs text-muted-foreground">Anfrage {formatDate(contact.createdAt)}{contact.revealedAt === null ? "" : ` · Identität freigegeben ${formatDate(contact.revealedAt)}`}</p></div><Badge variant="outline">{CONTACT_LABELS[contact.status] ?? contact.status}</Badge></div>)}</div>}
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <PrivacyRequestCard title="Datenexport anfordern" description="Erstellt einen nachverfolgbaren Export-Fall. Im MVP entsteht kein sofortiger, unprotokollierter Download." />
        <Card>
          <CardHeader><CardTitle as="h2">Konto-Löschung beantragen</CardTitle></CardHeader>
          <CardContent><p className="mb-4 text-sm leading-6 text-muted-foreground">Die Anfrage startet eine Fallprüfung. Aufbewahrungspflichten und aktive Vorgänge können berücksichtigt werden; das MVP löscht nicht ungeprüft sofort.</p><PrivacyDeleteRequestForm idempotencyKey={randomUUID()} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h2">Datenkorrektur</CardTitle></CardHeader>
          <CardContent><PrivacyCorrectionRequestForm idempotencyKey={randomUUID()} /></CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle as="h2">Deine Datenschutzfälle</CardTitle></CardHeader>
        <CardContent>{dashboard.requests.length === 0 ? <p className="text-muted-foreground">Noch keine Anfrage.</p> : <div className="grid gap-3">{dashboard.requests.map((request) => <div key={request.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{REQUEST_LABELS[request.type]}</p><p className="text-xs text-muted-foreground">Erstellt {formatDate(request.createdAt)} · Zieltermin {formatDate(request.dueAt)}</p></div><Badge variant="outline">{request.status}</Badge></div>)}</div>}</CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader><CardTitle as="h2">Missbrauch melden</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-2xl text-sm leading-6 text-muted-foreground">Verdächtige Arbeitgeber kannst du direkt im Firmenprofil oder im zugehörigen Gespräch melden. Meldungen werden als eigener AbuseReport protokolliert.</p><Link href="/candidate/messages" className={buttonVariants({ variant: "outline" })}>Nachrichten prüfen</Link></CardContent>
      </Card>
    </section>
  );
}

function PrivacyRequestCard({ title, description }: Readonly<{ title: string; description: string }>) {
  return <Card><CardHeader><CardTitle as="h2">{title}</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm leading-6 text-muted-foreground">{description}</p><PrivacyExportRequestForm idempotencyKey={randomUUID()} /></CardContent></Card>;
}
