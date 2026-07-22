import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanGate } from "@/components/employer/plan-gate";
import type { UpgradePrompt } from "@/lib/billing/upgrade-prompt";

type EmployerAnalyticsData = NonNullable<
  Awaited<ReturnType<typeof import("@/lib/employer/analytics").getEmployerAnalyticsData>>
>;

export function AnalyticsCards({
  data,
  upgradePrompt,
}: Readonly<{
  data: EmployerAnalyticsData;
  upgradePrompt: UpgradePrompt;
}>) {
  const totals = data.metrics.allowed ? data.metrics.totals : null;
  const visible = totals?.status === "VALUE" ? totals : null;
  return (
    <div className="grid gap-7">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Views" value={visible?.detailViews ?? "—"} />
        <Metric label="Saves" value={visible?.saves ?? "—"} />
        <Metric label="Bewerbungen" value={visible?.applications ?? "—"} />
        <Metric label="Conversion" value={visible === null ? "—" : `${(visible.applyRateBps / 100).toFixed(1)} %`} />
        <Metric label="Ø Antwortzeit" value={averageResponse(data.responseTimes)} />
      </div>
      {totals === null || totals.status === "SUPPRESSED" ? (
        <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          Noch keine veröffentlichbare Evidenz: Kennzahlen werden erst ab der Datenschutz-Mindestmenge angezeigt.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle as="h2">Fair-Job-Score verbessern</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {data.scoreSuggestions.length === 0 ? <p className="text-muted-foreground">Keine priorisierte Verbesserung offen.</p> : data.scoreSuggestions.map((item) => (
              <div key={item.jobId} className="rounded-lg border p-3">
                <p className="font-medium">{item.title} · {item.score}/{item.max}</p>
                <p className="mt-1 text-sm text-muted-foreground">Lohnspanne, Prozessschritte und konkrete Anforderungen anhand der Score-Evidenz prüfen.</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h2">Antwortzeit pro Job</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {data.responseTimes.length === 0 ? <p className="text-muted-foreground">Noch keine veröffentlichbare erste Reaktionszeit (mindestens 20 Fälle pro Job).</p> : data.responseTimes.map((item) => (
              <div key={item.jobId} className="flex justify-between gap-3 border-b pb-2 last:border-0">
                <span>{item.title} <span className="text-xs text-muted-foreground">(n={item.sampleSize})</span></span><span className="tabular-nums text-muted-foreground">{item.averageHours} Std.</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle as="h2">Viele Aufrufe, wenige Bewerbungen</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {data.diagnosticJobs.length === 0 ? (
            <p className="text-muted-foreground">Noch keine datenschutzkonform veröffentlichbare Auffälligkeit pro Job.</p>
          ) : data.diagnosticJobs.map((job) => (
            <div key={job.jobId} className="rounded-lg border p-3">
              <p className="font-medium">{job.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{job.views} Views · {job.applications} Bewerbungen</p>
              <p className="mt-2 text-sm">Prüfe zuerst Jobtext, Anforderungen und Bewerbungsformular. Ein Boost wird hier nicht als Ursache oder erste Lösung behauptet.</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <PlanGate
        allowed={data.advancedAllowed}
        title="Erweiterte Analytics"
        explanation="Vergleichs- und Detailauswertungen benötigen einen Plan mit Advanced Analytics. Die Entscheidung wurde serverseitig aus den wirksamen Entitlements getroffen."
        upgradePrompt={upgradePrompt}
      >
        <Card>
          <CardHeader><CardTitle as="h2">Lohntransparenz und Funnel</CardTitle></CardHeader>
          <CardContent>
            <SalaryFunnelEvidence evidence={data.salaryFunnelEvidence} />
          </CardContent>
        </Card>
      </PlanGate>
    </div>
  );
}

function SalaryFunnelEvidence({ evidence }: Readonly<{ evidence: EmployerAnalyticsData["salaryFunnelEvidence"] }>) {
  if (evidence.status === "VALUE") {
    return (
      <div className="grid gap-3">
        <p>
          Mit Lohnspanne: {evidence.transparent.applyRateBps / 100}% Bewerbungsrate
          ({evidence.transparent.applications} Bewerbungen aus {evidence.transparent.views} betrachtenden Personen über {evidence.transparent.jobs} Jobs).
        </p>
        <p>
          Ohne Lohnspanne: {evidence.opaque.applyRateBps / 100}% Bewerbungsrate
          ({evidence.opaque.applications} Bewerbungen aus {evidence.opaque.views} betrachtenden Personen über {evidence.opaque.jobs} Jobs).
        </p>
        <p className="text-sm text-muted-foreground">
          Beobachtete Korrelation im gewählten Zeitraum; daraus lässt sich keine Wirkung oder Kausalität ableiten.
        </p>
      </div>
    );
  }
  if (evidence.status === "INSUFFICIENT") {
    return (
      <p className="text-muted-foreground">
        Noch keine belastbare Gruppenabdeckung: {evidence.transparentJobs} Jobs mit und {evidence.opaqueJobs} ohne Lohnspanne; benötigt werden mindestens {evidence.requiredJobsPerGroup} je Gruppe.
      </p>
    );
  }
  if (evidence.status === "SUPPRESSED") {
    return (
      <p className="text-muted-foreground">
        Noch keine datenschutzkonforme Evidenz: Jede Vergleichsgruppe benötigt mindestens {evidence.requiredViewedSubjectsPerGroup} unterschiedliche betrachtende Personen.
      </p>
    );
  }
  return <p className="text-muted-foreground">Diese Auswertung ist im aktuellen Plan gesperrt.</p>;
}

function Metric({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return <Card><CardContent><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></CardContent></Card>;
}

function averageResponse(rows: readonly Readonly<{ averageHours: number; sampleSize: number }>[]) {
  if (rows.length === 0) return "—";
  const sampleSize = rows.reduce((sum, row) => sum + row.sampleSize, 0);
  return `${Math.round(rows.reduce((sum, row) => sum + row.averageHours * row.sampleSize, 0) / sampleSize)} Std.`;
}
