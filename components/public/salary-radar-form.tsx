"use client";

import { useActionState } from "react";
import { BarChart3Icon, SearchIcon } from "lucide-react";

import { calculatePublicSalaryRadarAction } from "@/app/(public)/salary-radar/actions";
import { JobGrid } from "@/components/public/job-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PublicCatalog } from "@/lib/public/types";
import { INITIAL_PUBLIC_SALARY_RADAR_STATE } from "@/lib/salary/public-radar-state";
import type { PublicSalaryRadarActionState } from "@/lib/salary/public-radar-state";
import { formatChf, formatDate } from "@/lib/utils/format";

const controlClass = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function SalaryRadarForm({ catalog }: Readonly<{ catalog: PublicCatalog }>) {
  const [state, action, pending] = useActionState(
    calculatePublicSalaryRadarAction,
    INITIAL_PUBLIC_SALARY_RADAR_STATE,
  );
  return (
    <>
      <form action={action} className="rounded-xl border bg-card p-5 shadow-sm" noValidate>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1.5 text-sm font-medium">Berufsbezeichnung <Input name="jobTitle" maxLength={120} placeholder="z. B. Softwareentwickler:in" className="h-10" /></label>
          <label className="grid gap-1.5 text-sm font-medium">Kategorie <select name="categorySlug" required defaultValue="" className={controlClass}><option value="" disabled>Kategorie wählen</option>{catalog.categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm font-medium">Kanton <select name="cantonSlug" required defaultValue="" className={controlClass}><option value="" disabled>Kanton wählen</option>{catalog.cantons.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm font-medium">Erfahrungsstufe <select name="seniority" required defaultValue="MID" className={controlClass}><option value="JUNIOR">Junior</option><option value="MID">Professional</option><option value="SENIOR">Senior</option><option value="LEAD">Lead</option></select></label>
          <label className="grid gap-1.5 text-sm font-medium">Pensum <select name="workload" required defaultValue="100" className={controlClass}>{[20,40,50,60,70,80,90,100].map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
        </div>
        <Button type="submit" size="lg" className="mt-5" disabled={pending}><SearchIcon aria-hidden="true" />{pending ? "Berechnung läuft …" : "Lohnband berechnen"}</Button>
      </form>

      {state.status === "error" ? <Alert variant="destructive" className="mt-6"><AlertTitle>Anfrage nicht möglich</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert> : null}
      {state.status === "result" ? <SalaryRadarResultView state={state} /> : null}
    </>
  );
}

function SalaryRadarResultView({ state }: Readonly<{ state: Extract<PublicSalaryRadarActionState, { status: "result" }> }>) {
  const result = state.result;
  if (result.status === "NO_RESULT") {
    return <Alert className="mt-8"><AlertTitle>Noch keine Daten zu dieser Kombination</AlertTitle><AlertDescription>Bitte probiere eine ähnliche Auswahl. Wir verbreitern Daten nie still über eine andere Berufskategorie hinweg.{result.adjacentCategoryGuidance ? " Eine benachbarte Kategorie kann als eigenständige Auswahl Orientierung geben." : ""}</AlertDescription></Alert>;
  }
  return (
    <section className="mt-10" aria-labelledby="salary-result-title">
      <Card className="border-primary/20">
        <CardHeader><div className="flex items-center gap-2 text-primary"><BarChart3Icon className="size-5" aria-hidden="true" /><span className="text-sm font-semibold">Lohnorientierung</span></div><CardTitle as="h2" id="salary-result-title" className="text-2xl">Marktband bei 100% Pensum</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            <SalaryValue label="25. Perzentil" value={result.p25Chf} />
            <SalaryValue label="Median" value={result.medianChf} featured />
            <SalaryValue label="75. Perzentil" value={result.p75Chf} />
          </dl>
          <div className="mt-6 rounded-xl bg-secondary/50 p-5"><h3 className="font-semibold">Auf dein Pensum angepasst</h3><p className="mt-2 text-2xl font-semibold tabular-nums">{formatChf(result.adjustedP25Chf)}–{formatChf(result.adjustedP75Chf)}</p><p className="mt-1 text-sm text-muted-foreground">Median {formatChf(result.adjustedMedianChf)}</p></div>
          <dl className="mt-6 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2"><Meta label="Quelle" value={result.source} /><Meta label="Datenstand" value={formatDate(result.asOf)} /><Meta label="Datensatz" value={result.datasetVersion} /><Meta label="Stichprobe" value={result.sampleBucket} /><Meta label="Fallback-Ebene" value={fallbackLabel(result.fallbackScope)} /><Meta label="Methode" value={result.method} /></dl>
          <p className="mt-6 rounded-lg border bg-background p-3 text-sm leading-6"><strong>Hinweis:</strong> Dieser Lohnbereich ist eine Orientierung und keine Rechts-, Finanz- oder Lohnberatung.</p>
        </CardContent>
      </Card>
      {state.jobs.length > 0 ? <div className="mt-10"><h2 className="text-2xl font-semibold">Aktuelle Stellen in diesem Lohnband</h2><div className="mt-6"><JobGrid jobs={state.jobs} /></div></div> : null}
    </section>
  );
}

function SalaryValue({ label, value, featured = false }: Readonly<{ label: string; value: number; featured?: boolean }>) { return <div className={featured ? "rounded-xl bg-primary p-4 text-primary-foreground" : "rounded-xl bg-muted/45 p-4"}><dt className={featured ? "text-sm opacity-80" : "text-sm text-muted-foreground"}>{label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{formatChf(value)}</dd><p className={featured ? "mt-1 text-xs opacity-75" : "mt-1 text-xs text-muted-foreground"}>pro Jahr · FTE</p></div>; }
function Meta({ label, value }: Readonly<{ label: string; value: string }>) { return <div><dt className="font-medium text-foreground">{label}</dt><dd className="mt-1 leading-6">{value}</dd></div>; }
function fallbackLabel(value: string) { const labels: Record<string, string> = { CATEGORY_CANTON_SENIORITY: "Kategorie · Kanton · Seniorität", CATEGORY_CANTON_ALL_SENIORITIES: "Kategorie · Kanton · alle Senioritäten", CATEGORY_SWITZERLAND_SENIORITY: "Kategorie · Schweiz · Seniorität", CATEGORY_SWITZERLAND_ALL: "Kategorie · Schweiz · alle Senioritäten" }; return labels[value] ?? value; }
