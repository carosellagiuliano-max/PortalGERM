import type { Metadata } from "next";
import Link from "next/link";

import { MetricCard } from "@/components/admin/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ADMIN_FUNNEL_POLICY_V1,
  getAdminFunnelDashboard,
  type AdminFunnelCard,
  type AdminFunnelChannel,
  type AdminFunnelPlan,
  type AdminFunnelRawFilters,
} from "@/lib/analytics/admin-funnels";
import {
  ADMIN_FINANCIAL_METRICS_V1,
  getAdminFinancialMetrics,
} from "@/lib/analytics/admin-metrics";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getPublicEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Billing & Funnel Analytics" };

type AnalyticsSearchParams = Promise<{
  from?: string | string[];
  to?: string | string[];
  channel?: string | string[];
  plan?: string | string[];
  cluster?: string | string[];
}>;

const CHANNEL_LABELS: Readonly<Record<AdminFunnelChannel, string>> = Object.freeze({
  ALL: "Alle erfassten Kanäle",
  JOB_SEARCH: "Jobsuche",
  EMPLOYER_DEMO: "Employer Demo",
  SALES_CONTACT: "Sales Contact",
  ENTERPRISE: "Enterprise",
  IMPORT: "Import",
  CHECKOUT: "Checkout",
});

const PLAN_LABELS: Readonly<Record<AdminFunnelPlan, string>> = Object.freeze({
  ALL: "Alle erfassten Pläne",
  FREE_BASIC: "Free Basic",
  STARTER: "Starter",
  PRO: "Pro",
  BUSINESS: "Business",
  ENTERPRISE_CONTRACT: "Enterprise Contract",
});

export default async function AdminAnalyticsPage({
  searchParams,
}: Readonly<{ searchParams: AnalyticsSearchParams }>) {
  const [user, rawFilters] = await Promise.all([
    requireAdminPage(),
    searchParams,
  ]);
  const now = new Date();
  const dependencies = Object.freeze({
    actor: {
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    correlationId: "admin-analytics-read",
    database: getDatabase(),
    now,
  });
  const demoMode = getPublicEnvironment().appEnvironment === "local";
  const [financial, funnels] = await Promise.all([
    getAdminFinancialMetrics(dependencies),
    getAdminFunnelDashboard(rawFilters as AdminFunnelRawFilters, dependencies, {
      demoMode,
    }),
  ]);
  if (financial === null || funnels === null) return null;

  return (
    <div className="grid gap-10">
      <header>
        <div className="flex flex-wrap gap-2">
          <Badge>{financial.policyVersion}</Badge>
          <Badge>{funnels.policyVersion}</Badge>
          <Badge variant="outline">Europe/Zurich</Badge>
          <Badge variant="outline">
            {funnels.provenanceMode === "LIVE_ONLY" ? "nur LIVE" : "LIVE + DEMO"}
          </Badge>
        </div>
        <h1 className="mt-3 text-3xl font-semibold">Revenue & Funnel Analytics</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Deterministische Mock-Finanzmetriken und die versionierten Phase-03-Funnels.
          Run-rate und bezahltes Monatsvolumen bleiben getrennte Kennzahlen.
        </p>
      </header>

      <section aria-labelledby="revenue-heading" className="grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Billing</p>
            <h2 id="revenue-heading" className="mt-1 text-2xl font-semibold">Revenue Analytics</h2>
          </div>
          <p className="text-sm text-muted-foreground">Messung {formatDateTime(financial.measuredAt)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="MRR Run-rate" value={formatChfFromRappen(financial.mrrRappen)} detail={`${financial.activeSubscriptions} wirksame Subscriptions`} />
          <MetricCard label="Plan-Netto im Monat" value={formatChfFromRappen(financial.monthlyMockPaidPlanNetRappen)} detail={financial.month.label} />
          <MetricCard label="Produkt-Netto im Monat" value={formatChfFromRappen(financial.monthlyMockPaidProductNetRappen)} detail={financial.month.label} />
          <MetricCard label="Mock-netto gesamt" value={formatChfFromRappen(financial.monthlyMockPaidNetRappen)} detail="Plan + einmalige Produkte, ohne MWST" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Bezahlte Arbeitgeber" value={financial.paidEmployers} />
          <MetricCard label="Free Arbeitgeber" value={financial.freeEmployers} />
          <MetricCard label="Contact-Pack-Verkäufe" value={financial.contactPackSales.count} detail={formatChfFromRappen(financial.contactPackSales.netRappen)} />
          <MetricCard label="Boost-Verkäufe" value={financial.boostSales.count} detail={formatChfFromRappen(financial.boostSales.netRappen)} />
        </div>
        <Card>
          <CardHeader><CardTitle as="h3">Rechnungsstatus</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(financial.invoices).map(([status, value]) => (
              <div key={status} className="rounded-lg border p-3">
                <p className="text-sm text-muted-foreground">{status}</p>
                <p className="mt-1 text-2xl font-semibold">{value.count}</p>
                <p className="text-sm tabular-nums">{formatChfFromRappen(value.totalRappen)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h3">Finanz-Messvertrag</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <p>{ADMIN_FINANCIAL_METRICS_V1.mrrDefinition}</p>
            <p>{ADMIN_FINANCIAL_METRICS_V1.revenueDefinition}</p>
            <p>Halb-offenes Monatsfenster [{formatDateTime(financial.month.start)}, {formatDateTime(financial.month.end)})</p>
            {financial.customContractsWithoutValue === 0 ? null : (
              <p>{financial.customContractsWithoutValue} Custom-Vertrag/Verträge ohne aufgezeichneten Monthly-Equivalent-Wert werden separat geführt und nicht geschätzt.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section id="funnels" aria-labelledby="funnels-heading" className="scroll-mt-6 grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Strategie · P1</p>
            <h2 id="funnels-heading" className="mt-1 text-2xl font-semibold">Versionierte Funnels</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Kohorten werden als halb-offene Zürcher Datumsfenster ausgewertet. Werte unter
              {" "}{ADMIN_FUNNEL_POLICY_V1.minimumDenominatorSubjects} unterschiedlichen Denominator-Subjekten
              werden vollständig unterdrückt; aus einer unterdrückten Zelle erscheinen weder Teilstufen noch Nullwerte.
            </p>
          </div>
          <Link href="/admin/business-cockpit" className="text-sm font-medium text-primary">
            Zum Business Cockpit →
          </Link>
        </div>

        <FunnelFilters dashboard={funnels} />

        {funnels.filters.adjusted ? (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Mindestens ein Filter war nicht zulässig oder ausserhalb des maximalen
            {" "}{ADMIN_FUNNEL_POLICY_V1.maximumCohortDays}-Tage-Fensters und wurde sicher auf den Standard zurückgesetzt.
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          {funnels.cards.map((card) => <FunnelCard key={card.key} card={card} dashboard={funnels} />)}
        </div>

        <Card>
          <CardHeader><CardTitle as="h3">Funnel-Messvertrag</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <p>Definition {ADMIN_FUNNEL_POLICY_V1.definitionVersion} · Zeitzone {ADMIN_FUNNEL_POLICY_V1.businessTimezone} · Fenster [{funnels.filters.fromDate}, {funnels.filters.toDate}).</p>
            <p>Clusteroptionen stammen ausschliesslich aus aktuell aktivierten Launch-Assessments. Kanal und Plan akzeptieren nur geschlossene Werte aus dem Eventvertrag.</p>
            <p>TEST wird immer ausgeschlossen. DEMO erscheint nur im lokalen Demo-Modus; ausserhalb davon fliessen ausschliesslich unveränderliche LIVE-Provenienz-Snapshots ein.</p>
            <p>Die Antwort enthält keine Actor-, Session-, Lead-, Order-, Company- oder Job-IDs und keine freien Texte.</p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function FunnelFilters({
  dashboard,
}: Readonly<{ dashboard: NonNullable<Awaited<ReturnType<typeof getAdminFunnelDashboard>>> }>) {
  return (
    <Card>
      <CardHeader><CardTitle as="h3">Kohorte und Dimensionen</CardTitle></CardHeader>
      <CardContent>
        <form action="/admin/analytics#funnels" method="get" className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Von (inklusive)</span>
            <input className="h-10 rounded-lg border bg-background px-3" type="date" name="from" max={dashboard.filters.maximumToDate} defaultValue={dashboard.filters.fromDate} required />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Bis (exklusive)</span>
            <input className="h-10 rounded-lg border bg-background px-3" type="date" name="to" max={dashboard.filters.maximumToDate} defaultValue={dashboard.filters.toDate} required />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Launch-Cluster</span>
            <select className="h-10 rounded-lg border bg-background px-3" name="cluster" defaultValue={dashboard.filters.clusterKey ?? "ALL"}>
              <option value="ALL">Alle aktiven Cluster</option>
              {dashboard.options.clusters.map((cluster) => (
                <option key={cluster.key} value={cluster.key}>{cluster.cantonName} × {cluster.categoryName}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Kanal</span>
            <select className="h-10 rounded-lg border bg-background px-3" name="channel" defaultValue={dashboard.filters.channel}>
              {dashboard.options.channels.map((channel) => <option key={channel} value={channel}>{CHANNEL_LABELS[channel]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Plan</span>
            <select className="h-10 rounded-lg border bg-background px-3" name="plan" defaultValue={dashboard.filters.plan}>
              {dashboard.options.plans.map((plan) => <option key={plan} value={plan}>{PLAN_LABELS[plan]}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-5">
            <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Filter anwenden</button>
            <Link href="/admin/analytics#funnels" className="rounded-lg border px-4 py-2 text-sm font-medium">Zurücksetzen</Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FunnelCard({
  card,
  dashboard,
}: Readonly<{
  card: AdminFunnelCard;
  dashboard: NonNullable<Awaited<ReturnType<typeof getAdminFunnelDashboard>>>;
}>) {
  const suppressed = card.status === "SUPPRESSED";
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap gap-2">
          <Badge>{card.metricKey} · {card.metricVersion}</Badge>
          <Badge variant="outline">Fenster {card.window}</Badge>
          <Badge variant="outline">Denominator {card.denominatorSubject}</Badge>
        </div>
        <CardTitle as="h3" className="mt-2">{card.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {suppressed ? (
          <div className="rounded-lg border border-dashed p-4">
            <p className="font-medium">Unter Mindestmenge · vollständig unterdrückt</p>
            <p className="mt-1 text-sm text-muted-foreground">Erst ab {ADMIN_FUNNEL_POLICY_V1.minimumDenominatorSubjects} unterschiedlichen {card.denominatorSubject.toLocaleLowerCase("de-CH")}-Subjekten wird ein Wert gezeigt.</p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {card.stages.map((stage) => (
              <div key={stage.label} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{stage.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{stage.value}</p>
              </div>
            ))}
          </div>
        )}
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3 border-t pt-3">
            <dt className="text-muted-foreground">Conversion</dt>
            <dd className="font-medium tabular-nums">{suppressed ? "unterdrückt" : formatBasisPoints(card.rateBps as number)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Kohorte</dt>
            <dd className="text-right">[{dashboard.filters.fromDate}, {dashboard.filters.toDate})</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Formel</dt>
            <dd className="max-w-sm text-right">{card.formula}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Angewendete Dimensionen</dt>
            <dd className="text-right">{card.appliedDimensions.join(" · ")}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Nicht im Event erfasst</dt>
            <dd className="text-right">{card.unavailableDimensions.join(" · ") || "–"}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function formatBasisPoints(value: number) {
  return `${new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 100)} %`;
}
