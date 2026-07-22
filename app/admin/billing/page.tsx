import type { Metadata } from "next";
import Link from "next/link";

import { AdminActionForm } from "@/components/admin/action-form";
import { MetricCard } from "@/components/admin/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getAdminFinancialMetrics, ADMIN_FINANCIAL_METRICS_V1 } from "@/lib/analytics/admin-metrics";
import { listAdminInvoices, listAdminOrders } from "@/lib/billing/admin-billing";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Billing" };

export default async function AdminBillingPage() {
  const user = await requireAdminPage();
  const dependencies = { actor: { userId: user.id, email: user.email, role: user.role, status: user.status }, correlationId: crypto.randomUUID(), database: getDatabase(), now: new Date() } as const;
  const [metrics, orders, invoices] = await Promise.all([getAdminFinancialMetrics(dependencies), listAdminOrders(dependencies), listAdminInvoices(dependencies)]);
  if (metrics === null || orders === null || invoices === null) return null;
  const overdue = invoices.filter((invoice) => invoice.status === "ISSUED" && invoice.dueAt.getTime() <= dependencies.now.getTime()).length;
  return <div className="grid gap-8">
    <header><div className="flex flex-wrap gap-2"><Badge>Mock Billing</Badge><Badge variant="outline">{metrics.policyVersion}</Badge></div><h1 className="mt-3 text-3xl font-semibold">Billing-Übersicht</h1><p className="mt-2 max-w-3xl text-muted-foreground">Kanonische, unveränderliche Geld- und Vertragsdaten. MRR und bezahltes Monatsvolumen werden getrennt gezeigt und nie addiert.</p></header>
    <section aria-label="Finanzkennzahlen" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="MRR Run-rate" value={formatChfFromRappen(metrics.mrrRappen)} detail="Wirksame bezahlte Subscription-Snapshots" /><MetricCard label={`Mock-netto ${metrics.month.label}`} value={formatChfFromRappen(metrics.monthlyMockPaidNetRappen)} detail="Erstes PAID-Event im Zürcher Monat" /><MetricCard label="Aktive Abonnemente" value={metrics.activeSubscriptions} detail={`${metrics.paidEmployers} bezahlt · ${metrics.freeEmployers} Free`} /><MetricCard label="Überfällige Rechnungen" value={overdue} detail="Abgeleitet aus ISSUED und Fälligkeit" /></section>
    <Card><CardHeader><CardTitle as="h2">Definitionen</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm text-muted-foreground"><p><strong className="text-foreground">MRR:</strong> {ADMIN_FINANCIAL_METRICS_V1.mrrDefinition}</p><p><strong className="text-foreground">Monatsvolumen:</strong> {ADMIN_FINANCIAL_METRICS_V1.revenueDefinition}</p><p>Messzeitpunkt {formatDateTime(metrics.measuredAt)} · Fenster [{formatDateTime(metrics.month.start)}, {formatDateTime(metrics.month.end)})</p></CardContent></Card>
    <AdminActionForm operation="subscription-boundaries-project" label="Fällige Vertragsgrenzen anwenden"><p className="text-sm text-muted-foreground">Wendet fällige Kündigungen, Downgrades und natürliche Vertragsabläufe anhand der aktuellen Serverzeit an. Der wiederholbare Lauf verarbeitet keine bereits abgeschlossenen Übergänge erneut.</p></AdminActionForm>
    <AdminActionForm operation="credit-expiries-project" label="Fällige Credits ausbuchen"><p className="text-sm text-muted-foreground">Schreibt für verbleibende Credits ab ihrer exklusiven Gültigkeitsgrenze unveränderliche EXPIRE-Ledgerzeilen. Wiederholte oder parallele Läufe erzeugen keine Doppelbuchung.</p></AdminActionForm>
    <section className="grid gap-4 xl:grid-cols-2"><Card><CardHeader><CardTitle as="h2">Letzte Bestellungen</CardTitle></CardHeader><CardContent className="grid gap-2">{orders.slice(0, 8).map((order) => <Link key={order.id} href={`/admin/orders/${order.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted"><span className="min-w-0"><span className="block truncate font-medium">{order.company.name}</span><span className="block truncate text-xs text-muted-foreground">{order.lines.map((line) => line.descriptionSnapshot).join(", ")}</span></span><span className="text-right"><Badge variant="outline">{order.status}</Badge><span className="mt-1 block text-sm tabular-nums">{formatChfFromRappen(order.totalRappen)}</span></span></Link>)}<Link href="/admin/orders" className="text-sm font-medium text-primary">Alle Bestellungen ansehen →</Link></CardContent></Card><Card><CardHeader><CardTitle as="h2">Letzte Rechnungen</CardTitle></CardHeader><CardContent className="grid gap-2">{invoices.slice(0, 8).map((invoice) => <Link key={invoice.id} href={`/admin/invoices/${invoice.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted"><span><span className="block font-medium">{invoice.number}</span><span className="text-xs text-muted-foreground">{invoice.company.name}</span></span><span className="text-right"><Badge variant="outline">{invoice.status}</Badge><span className="mt-1 block text-sm tabular-nums">{formatChfFromRappen(invoice.totalRappen)}</span></span></Link>)}<Link href="/admin/invoices" className="text-sm font-medium text-primary">Alle Rechnungen ansehen →</Link></CardContent></Card></section>
  </div>;
}
