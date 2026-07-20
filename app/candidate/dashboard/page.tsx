import type { Metadata } from "next";
import Link from "next/link";

import { JobCard } from "@/components/public/job-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getCandidateDashboard } from "@/lib/candidate/dashboard";
import { getDatabase } from "@/lib/db/client";
import { formatDate } from "@/lib/utils/format";
import { markCandidateNotificationReadAction } from "./actions";

export const metadata: Metadata = { title: "Kandidatenübersicht" };

const STATUS_LABELS: Readonly<Record<string, string>> = {
  SUBMITTED: "Eingereicht", IN_REVIEW: "In Prüfung", SHORTLISTED: "Vorauswahl",
  INTERVIEW: "Interview", OFFER: "Angebot", HIRED: "Eingestellt",
  REJECTED: "Abgelehnt", WITHDRAWN: "Zurückgezogen",
};

export default async function CandidateDashboardPage() {
  const user = await requireCandidatePage();
  const dashboard = await getCandidateDashboard(getDatabase(), user.id);
  if (dashboard === null) return null;
  return (
    <section aria-labelledby="candidate-dashboard-title">
      <p className="eyebrow">Übersicht</p>
      <h1 id="candidate-dashboard-title" className="mt-2 text-3xl font-semibold tracking-tight">Dein Kandidaten-Cockpit</h1>
      <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">Profil pflegen, passende Stellen entdecken, Bewerbungen verfolgen und deine Sichtbarkeit kontrollieren.</p>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader><CardTitle as="h2">SwissJobPass · {dashboard.profileCompletion}%</CardTitle></CardHeader><CardContent className="grid gap-4"><Progress value={dashboard.profileCompletion} aria-label={`Profil zu ${dashboard.profileCompletion} Prozent ausgefüllt`} /><p className="text-sm text-muted-foreground">Status: {dashboard.profileStatus === "COMPLETE" ? "Vollständig" : "Entwurf"}. Der Prozentwert informiert; nur die exakte Vollständigkeitsprüfung ändert den Onboardingstatus.</p><Link href="/candidate/jobpass" className={buttonVariants({ className: "w-fit" })}>SwissJobPass bearbeiten</Link></CardContent></Card>
        <Card><CardHeader><CardTitle as="h2">Talent Radar</CardTitle></CardHeader><CardContent className="grid gap-4"><Badge className="w-fit" variant={dashboard.radarVisible ? "default" : "outline"}>{dashboard.radarVisible ? "Anonym sichtbar im Talent Radar" : "Nicht im Talent Radar"}</Badge><Link href="/candidate/talent-radar" className={buttonVariants({ variant: "outline", className: "w-fit" })}>{dashboard.radarVisible ? "Sichtbarkeit prüfen" : "Jetzt aktivieren"}</Link></CardContent></Card>
      </div>

      <div className="mt-5 flex flex-wrap gap-2"><Link href="/jobs" className={buttonVariants()}>Jobs suchen</Link><Link href="/candidate/alerts" className={buttonVariants({ variant: "outline" })}>Jobabo erstellen</Link><Link href="/candidate/applications" className={buttonVariants({ variant: "outline" })}>Bewerbungen ansehen</Link><Link href="/salary-radar" className={buttonVariants({ variant: "ghost" })}>Lohn-Radar öffnen</Link></div>

      <section className="mt-10" aria-labelledby="recommended-title"><div className="flex items-end justify-between gap-4"><div><p className="eyebrow">Passend zu deinem Profil</p><h2 id="recommended-title" className="mt-2 text-2xl font-semibold">Empfohlene Stellen</h2></div><Link href="/jobs" className={buttonVariants({ variant: "ghost" })}>Alle Jobs</Link></div>{dashboard.recommendations.length === 0 ? <p className="mt-5 text-muted-foreground">Aktuell gibt es keine öffentlich geeignete Empfehlung.</p> : <div className="mt-5 grid gap-5 xl:grid-cols-2">{dashboard.recommendations.map(({ job, match }) => <div key={job.id} className="relative"><div className="absolute right-3 top-3 z-10"><Badge>{match.score ?? "–"}% Match</Badge></div><JobCard job={job} /></div>)}</div>}</section>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle as="h2">Gespeicherte Jobs</CardTitle></CardHeader><CardContent>{dashboard.savedJobs.length === 0 ? <p className="text-muted-foreground">Noch keine gespeicherten Jobs.</p> : <div className="grid gap-3">{dashboard.savedJobs.map((saved) => <div key={saved.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{saved.job.publishedRevision?.title ?? "Stelle"}</p><p className="text-xs text-muted-foreground">{saved.job.company.name} · gespeichert {formatDate(saved.createdAt)}</p></div><Link href={`/jobs/${saved.job.slug}`} className={buttonVariants({ variant: "ghost" })}>Öffnen</Link></div>)}</div>}<Link href="/candidate/saved-jobs" className={buttonVariants({ variant: "outline", className: "mt-4" })}>Alle gespeicherten Jobs</Link></CardContent></Card>
        <Card>
          <CardHeader><CardTitle as="h2">Bewerbungsstatus</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(dashboard.applicationCounts).map(([status, count]) => (
                <Badge key={status} variant="outline">
                  {STATUS_LABELS[status] ?? status}: {count}
                </Badge>
              ))}
            </div>
            {dashboard.recentApplications.length === 0 ? (
              <p className="mt-4 text-muted-foreground">Noch keine Bewerbungen.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {dashboard.recentApplications.map((application) => (
                  <Link
                    key={application.id}
                    href={`/candidate/applications/${application.id}`}
                    className="rounded-lg border p-3 hover:bg-muted"
                  >
                    <p className="font-medium">{application.submittedJobRevision.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {application.job.company.name} · {STATUS_LABELS[application.status]}
                    </p>
                    <ol className="mt-2 grid gap-1 border-l pl-3 text-xs text-muted-foreground">
                      {application.events.map((event) => (
                        <li key={event.id}>
                          {event.toStatus === null
                            ? "Bewerbung aktualisiert"
                            : STATUS_LABELS[event.toStatus] ?? event.toStatus}
                          {" · "}{formatDate(event.createdAt)}
                        </li>
                      ))}
                    </ol>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle as="h2">Aktive Jobabos</CardTitle></CardHeader><CardContent>{dashboard.alerts.length === 0 ? <p className="text-muted-foreground">Kein aktives Jobabo.</p> : <div className="grid gap-3">{dashboard.alerts.map((alert) => <div key={alert.id} className="rounded-lg border p-3"><p className="font-medium">{alert.frequency === "DAILY" ? "Täglich" : "Wöchentlich"}</p><p className="text-xs text-muted-foreground">Nächster lokaler Mock-Lauf {formatDate(alert.nextDueAt)}</p></div>)}</div>}<Link href="/candidate/alerts" className={buttonVariants({ variant: "outline", className: "mt-4" })}>Jobabos verwalten</Link></CardContent></Card>
        <Card><CardHeader><CardTitle as="h2">Nachrichten</CardTitle></CardHeader><CardContent className="grid gap-4"><p className="text-3xl font-semibold">{dashboard.unreadMessages}</p><p className="text-muted-foreground">ungelesene Nachrichten in echten Gesprächen</p><Link href="/candidate/messages" className={buttonVariants({ variant: "outline", className: "w-fit" })}>Nachrichten öffnen</Link></CardContent></Card>
      </div>

      <Card className="mt-5"><CardHeader><CardTitle as="h2">Benachrichtigungen</CardTitle></CardHeader><CardContent>{dashboard.notifications.length === 0 ? <p className="text-muted-foreground">Keine neuen Benachrichtigungen.</p> : <div className="grid gap-3">{dashboard.notifications.map((notification) => <div key={notification.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{notificationLabel(notification.kind)}</p><p className="text-xs text-muted-foreground">{formatDate(notification.createdAt)} · {notification.readAt === null ? "Ungelesen" : "Gelesen"}</p></div><div className="flex gap-2"><Link href={notification.link} className={buttonVariants({ variant: "ghost" })}>Öffnen</Link>{notification.readAt === null ? <form action={markCandidateNotificationReadAction}><input type="hidden" name="notificationId" value={notification.id} /><Button type="submit" variant="outline">Gelesen</Button></form> : null}</div></div>)}</div>}</CardContent></Card>
    </section>
  );
}

function notificationLabel(kind: string) {
  if (kind === "APPLICATION_SUBMITTED") return "Bewerbung eingereicht";
  if (kind === "APPLICATION_STATUS_CHANGED") return "Bewerbungsstatus geändert";
  if (kind === "MESSAGE_RECEIVED") return "Neue Nachricht";
  if (kind.startsWith("CONTACT_REQUEST")) return "Talent-Radar-Kontakt aktualisiert";
  if (kind === "PRIVACY_REQUEST_CHANGED") return "Datenschutzfall aktualisiert";
  return "Benachrichtigung";
}
