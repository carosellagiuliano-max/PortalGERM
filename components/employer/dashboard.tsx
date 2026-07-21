import Link from "next/link";
import {
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  Clock3Icon,
  GaugeIcon,
  RadarIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { EmployerDashboardData } from "@/lib/employer/dashboard";

export function Dashboard({ data }: Readonly<{ data: EmployerDashboardData }>) {
  const usagePercent = data.activeJobLimit === null || data.activeJobLimit === 0
    ? 0
    : Math.min(100, Math.round((data.activeJobs / data.activeJobLimit) * 100));
  return (
    <div className="grid gap-7">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Guten Tag bei {data.companyName}
          </h1>
          <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
            Aktuelle Nutzung, Bewerbungen und die nächsten sinnvollen Schritte — aus echten Firmendaten.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/employer/jobs/new" className={buttonVariants()}>
            Inserat erfassen <ArrowRightIcon aria-hidden="true" />
          </Link>
          <Link href="/pricing" className={buttonVariants({ variant: "outline" })}>
            Pläne vergleichen
          </Link>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={BriefcaseBusinessIcon} label="Aktive Jobs" value={
          data.activeJobLimit === null ? String(data.activeJobs) : `${data.activeJobs} / ${data.activeJobLimit}`
        }>
          {data.activeJobLimit === null ? null : (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Plan-Nutzung</span>
                <span>{usagePercent}%</span>
              </div>
              <Progress value={usagePercent} aria-label="Nutzung des aktiven Joblimits" />
            </div>
          )}
        </MetricCard>
        <MetricCard icon={UsersIcon} label="Bewerbungen diese Woche" value={String(data.applicationsThisWeek)} />
        <MetricCard
          icon={Clock3Icon}
          label="Ø erste Antwort"
          value={data.averageResponseHours === null ? "Noch keine Evidenz" : `${data.averageResponseHours} Std.`}
        />
        <MetricCard icon={ZapIcon} label="Boost-Credits" value={String(data.boostCredits)}>
          <p className="text-xs text-muted-foreground">Aktivierung folgt in Phase 13.</p>
        </MetricCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <GaugeIcon className="size-5 text-primary" aria-hidden="true" /> Fair-Job-Score
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.lowScoreJobs.length === 0 ? (
              <p className="text-muted-foreground">Keine aktuellen Inserate unter der 70-%-Orientierung.</p>
            ) : data.lowScoreJobs.map((job) => (
              <Link key={job.id} href={`/employer/jobs/${job.id}`} className="rounded-lg border p-3 hover:bg-muted/50">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{job.title}</span>
                  <Badge variant="outline">{job.points}/{job.maxPoints}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Lohntransparenz, Prozess und konkrete Aufgaben prüfen.</p>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Plan-Status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Aktueller Plan</span>
              <Badge>{data.plan.label}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {data.plan.periodEnd === null
                ? "Kein bezahlter Abrechnungszeitraum aktiv. Es wird keine automatische Verlängerung behauptet."
                : `Aktueller Zeitraum endet exklusiv am ${new Intl.DateTimeFormat("de-CH").format(data.plan.periodEnd)}.`}
            </p>
            <p className="text-sm text-muted-foreground">
              {data.plan.schedule ?? "Keine vorgemerkte Planänderung im Mock-Abrechnungsstand."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <RadarIcon className="size-5 text-primary" aria-hidden="true" /> Talent Radar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {data.radarEnabled
                ? `${data.radarContacts} Kontakt-Credits verfügbar. Die private Suche wird in Phase 14 freigeschaltet.`
                : "In diesem Plan nicht enthalten. Die Vorschau erklärt die sichere Funktionsweise."}
            </p>
            <Link href="/employer/talent-radar" className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
              Vorschau ansehen
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h2">Funnel-Diagnostik</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {data.diagnosticJobs.length === 0 ? (
              <p className="text-muted-foreground">Noch keine belastbare Auffälligkeit bei Views und Bewerbungen.</p>
            ) : data.diagnosticJobs.map((job) => (
              <div key={job.id} className="rounded-lg border p-3">
                <p className="font-medium">{job.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{job.views} Views · {job.applications} Bewerbungen</p>
                <p className="mt-2 text-sm">Zuerst Jobtext, Anforderungen und Bewerbungsformular prüfen.</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, children }: Readonly<{
  icon: typeof BriefcaseBusinessIcon;
  label: string;
  value: string;
  children?: React.ReactNode;
}>) {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <Icon className="size-5 text-primary" aria-hidden="true" />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
