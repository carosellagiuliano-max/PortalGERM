import type { Metadata } from "next";
import Link from "next/link";

import { SignalCards } from "@/components/admin/BusinessCockpit/SignalCards";
import { MetricCard } from "@/components/admin/MetricCard";
import { Badge } from "@/components/ui/badge";
import { getBusinessCockpit } from "@/lib/admin/cockpit";
import { getAdminFinancialMetrics } from "@/lib/analytics/admin-metrics";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Business Cockpit" };

export default async function BusinessCockpitPage() {
  const admin = await requireAdminPage();
  const now = new Date();
  const dependencies = {
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
    },
    correlationId: "admin-cockpit-read",
    database: getDatabase(),
    now,
  } as const;
  const [cockpit, financial] = await Promise.all([
    getBusinessCockpit(dependencies),
    getAdminFinancialMetrics(dependencies),
  ]);
  if (cockpit === null || financial === null) return null;

  return (
    <div className="grid gap-8">
      <header>
        <div className="flex gap-2">
          <Badge>{cockpit.policyVersion}</Badge>
          <Badge variant="outline">{financial.policyVersion}</Badge>
        </div>
        <h1 className="mt-3 text-3xl font-semibold">Business Cockpit</h1>
        <p className="mt-2 text-muted-foreground">
          Belastbare operative, Sales- und Mock-Finanzsignale. Run-rate und
          bezahltes Monatsvolumen bleiben getrennt.
        </p>
      </header>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Finanzen</h2>
          <Link className="text-sm font-medium text-primary" href="/admin/analytics">
            Definitionen und Details →
          </Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="MRR Run-rate" value={formatChfFromRappen(financial.mrrRappen)} detail="Nicht zum Monatsvolumen addieren" />
          <MetricCard label={`Plan-Netto ${financial.month.label}`} value={formatChfFromRappen(financial.monthlyMockPaidPlanNetRappen)} detail="Mock cash-basis" />
          <MetricCard label={`Produkt-Netto ${financial.month.label}`} value={formatChfFromRappen(financial.monthlyMockPaidProductNetRappen)} detail="Mock cash-basis" />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Strategie · P1</p>
            <h2 className="mt-1 text-xl font-semibold">Aktivierungs- und Conversion-Funnels</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Candidate-, Employer-, Search-, Lead- und Checkout-Funnels werden
              versioniert, kohortenbegrenzt und mit Small-Count-Suppression auf
              der Analytics-Seite ausgewertet.
            </p>
          </div>
          <Link className="rounded-lg border px-4 py-2 text-sm font-medium text-primary" href="/admin/analytics#funnels">
            Funnels öffnen →
          </Link>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Operations</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(cockpit.queues).map(([label, value]) => (
            <MetricCard key={label} label={label} value={value} />
          ))}
          <MetricCard label="Support SLA" value={cockpit.slaBreaches.support} />
          <MetricCard label="Moderation SLA" value={cockpit.slaBreaches.moderation} />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Vorgeschlagene Sales-Aktionen</h2>
        <div className="mt-4"><SignalCards signals={cockpit.signals} /></div>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Leads nach Fälligkeit</h2>
        <div className="mt-4 grid gap-2">
          {cockpit.leads.map((lead) => (
            <div key={lead.id} className="flex justify-between rounded-lg border bg-card p-3">
              <span>{lead.organizationName ?? "Lead"} · {lead.status}</span>
              <span className="text-sm text-muted-foreground">
                {(lead.dueAt ?? lead.nextAt)?.toLocaleString("de-CH") ?? "offen"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Talent-Radar-Aggregate bleiben bis zur Phase-14-Privacy-Projektion leer.
      </section>
    </div>
  );
}
