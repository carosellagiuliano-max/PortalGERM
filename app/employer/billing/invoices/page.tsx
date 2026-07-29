import type { Metadata } from "next";
import Link from "@/components/shared/app-link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveTable,
  ResponsiveTableCell,
} from "@/components/ui/responsive-table";
import { requireEmployerBillingPage } from "@/lib/billing/employer-page-access";
import { listCompanyInvoices } from "@/lib/billing/employer-read-model";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Rechnungen" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EmployerInvoicesPage() {
  const { context } = await requireEmployerBillingPage();
  const invoices = await listCompanyInvoices(getDatabase(), context.companyId, new Date());
  return (
    <section aria-labelledby="invoices-title" className="grid gap-7">
      <header><p className="eyebrow">Billing · Rechnungen</p><h1 id="invoices-title" className="mt-2 text-3xl font-semibold tracking-tight">Rechnungsarchiv</h1><p className="mt-3 max-w-3xl leading-7 text-muted-foreground">HTML-Rechnungen mit unveränderlicher Adresse, Zeilenbeträgen und MWST-Snapshots. PDF-Ausgabe ist im MVP noch nicht enthalten.</p></header>
      <Card><CardHeader><CardTitle as="h2">Alle Rechnungen</CardTitle><CardDescription>Nur Rechnungen der aktuell ausgewählten Firma.</CardDescription></CardHeader><CardContent>{invoices.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Rechnungen.</p> : <ResponsiveTable label="Rechnungsarchiv"><thead className="text-muted-foreground"><tr><th className="p-3">Nummer</th><th className="p-3">Ausgestellt</th><th className="p-3">Fällig</th><th className="p-3">Status</th><th className="p-3 text-right">Total</th><th className="p-3"><span className="sr-only">Aktion</span></th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-t"><ResponsiveTableCell className="p-3 font-medium" label="Nummer" primary>{invoice.number}</ResponsiveTableCell><ResponsiveTableCell className="p-3" label="Ausgestellt">{invoice.issuedAt === null ? "–" : formatDate(invoice.issuedAt)}</ResponsiveTableCell><ResponsiveTableCell className="p-3" label="Fällig">{formatDate(invoice.dueAt)}</ResponsiveTableCell><ResponsiveTableCell className="p-3" label="Status"><Badge variant={invoice.displayStatus === "PAID" ? "default" : invoice.displayStatus === "OVERDUE" ? "destructive" : "outline"}>{invoiceStatusLabel(invoice.displayStatus)}</Badge></ResponsiveTableCell><ResponsiveTableCell className="p-3 text-right tabular-nums" label="Total">{formatChfFromRappen(invoice.totalRappen)}</ResponsiveTableCell><ResponsiveTableCell className="p-3 text-right" label="Aktion" actions><Link href={`/employer/billing/invoices/${encodeURIComponent(invoice.id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Anzeigen</Link></ResponsiveTableCell></tr>)}</tbody></ResponsiveTable>}</CardContent></Card>
    </section>
  );
}
function invoiceStatusLabel(status: string) { return ({ DRAFT: "Entwurf", ISSUED: "Offen", PAID: "Bezahlt", VOID: "Storniert", OVERDUE: "Überfällig" } as Record<string, string>)[status] ?? status; }
