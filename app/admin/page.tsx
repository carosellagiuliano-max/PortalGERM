import type { Metadata } from "next";
import Link from "next/link";

import { AuditFeed } from "@/components/admin/AuditFeed";
import { MetricCard } from "@/components/admin/MetricCard";
import { ADMIN_NAVIGATION } from "@/components/admin/Sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { getAdminOverview, searchAdmin } from "@/lib/admin/overview";

export const metadata: Metadata = { title: "Admin-Übersicht" };

export default async function AdminPage({ searchParams }: Readonly<{ searchParams: Promise<{ q?: string }> }>) {
  const [user, query] = await Promise.all([requireAdminPage(), searchParams]);
  const dependencies = { actor: { userId: user.id, email: user.email, role: user.role, status: user.status }, correlationId: "admin-overview-read", database: getDatabase(), now: new Date() } as const;
  const [overview, search] = await Promise.all([getAdminOverview(dependencies), query.q ? searchAdmin(dependencies, query.q) : null]);
  if (overview === null) return null;
  const metrics = overview.metrics;
  return <div className="grid gap-8">
    <header><p className="eyebrow">Operations</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Admin-Übersicht</h1><p className="mt-2 text-muted-foreground">Operative Ziele sind interne SLA-Ziele in verstrichenen Stunden – keine rechtliche Zusage.</p></header>
    <section aria-label="Operative Kennzahlen" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Jobs in Prüfung" value={metrics.pendingJobs} detail={`${metrics.ageingJobs} älter als 48 h`} /><MetricCard label="Verifizierungsfälle" value={metrics.verificationCases} /><MetricCard label="Aktive Stellen" value={metrics.activeSupply} /><MetricCard label="Offene Reports" value={metrics.openReports} /><MetricCard label="Importfehler" value={metrics.importFailures} /><MetricCard label="Support SLA überfällig" value={metrics.supportBreaches} /><MetricCard label="Neue Leads fällig" value={metrics.newLeads} /><MetricCard label="Finanzmetriken" value="Phase 12" detail="Keine Phase-11-Duplikate" /></section>
    {search === null ? null : <Card><CardHeader><CardTitle as="h2">Suchergebnisse für „{query.q?.slice(0, 160)}“</CardTitle></CardHeader><CardContent className="grid gap-5 md:grid-cols-3"><SearchGroup title="Jobs" rows={search.jobs.map((row) => ({ href: `/admin/jobs/${row.id}`, label: row.currentRevision?.title ?? row.slug, meta: row.status }))} /><SearchGroup title="Unternehmen" rows={search.companies.map((row) => ({ href: `/admin/companies/${row.id}`, label: row.name, meta: row.status }))} /><SearchGroup title="Benutzer" rows={search.users.map((row) => ({ href: `/admin/users/${row.id}`, label: row.name ?? row.email, meta: `${row.role} · ${row.status}` }))} /></CardContent></Card>}
    <section><h2 className="text-xl font-semibold">Arbeitsbereiche</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{ADMIN_NAVIGATION.filter((item) => item.href !== "/admin").map((item) => <Link key={item.href} href={item.href} className="rounded-lg border bg-card p-4 font-medium hover:bg-muted/30">{item.label}</Link>)}</div></section>
    <Card><CardHeader><CardTitle as="h2">Letzte Admin-Aktionen</CardTitle></CardHeader><CardContent><AuditFeed entries={overview.recentAudit} /></CardContent></Card>
  </div>;
}

function SearchGroup({ title, rows }: Readonly<{ title: string; rows: readonly Readonly<{ href: string; label: string; meta: string }>[] }>) { return <div><h3 className="font-medium">{title}</h3>{rows.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Keine Treffer</p> : <ul className="mt-2 grid gap-2">{rows.map((row) => <li key={row.href}><Link href={row.href} className="text-sm text-primary underline">{row.label}</Link><p className="text-xs text-muted-foreground">{row.meta}</p></li>)}</ul>}</div>; }
