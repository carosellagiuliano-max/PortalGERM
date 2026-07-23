import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { listAdminInvoices } from "@/lib/billing/admin-billing";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDate, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Rechnungen" };

export default async function AdminInvoicesPage() {
  const user = await requireAdminPage();
  const now = new Date();
  const invoices = await listAdminInvoices({ actor: { userId: user.id, email: user.email, role: user.role, status: user.status }, correlationId: crypto.randomUUID(), database: getDatabase(), now });
  if (invoices === null) return null;
  return <div className="grid gap-6"><header><p className="eyebrow">Billing Operations</p><h1 className="mt-2 text-3xl font-semibold">Rechnungen</h1><p className="mt-2 text-muted-foreground">HTML-Belege aus unveränderlichen Adress-, Steuer- und Positionssnapshots.</p></header>{invoices.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Noch keine Rechnungen vorhanden. Ausgestellte Mock-Rechnungen erscheinen hier mit ihrem unveränderlichen Snapshot.</p> : <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[60rem] text-left text-sm"><thead className="bg-muted/60 text-muted-foreground"><tr><th className="p-3">Nummer</th><th className="p-3">Firma</th><th className="p-3">Ausgestellt</th><th className="p-3">Fällig</th><th className="p-3">Status</th><th className="p-3 text-right">Netto</th><th className="p-3 text-right">Total</th><th className="p-3">Beleg</th></tr></thead><tbody className="divide-y">{invoices.map((invoice) => { const overdue = invoice.status === "ISSUED" && invoice.dueAt.getTime() <= now.getTime(); return <tr key={invoice.id}><td className="p-3 font-medium">{invoice.number}</td><td className="p-3"><Link className="hover:underline" href={`/admin/companies/${invoice.company.id}`}>{invoice.company.name}</Link></td><td className="p-3 whitespace-nowrap">{invoice.issuedAt === null ? formatDateTime(invoice.createdAt) : formatDateTime(invoice.issuedAt)}</td><td className="p-3 whitespace-nowrap">{formatDate(invoice.dueAt)}</td><td className="p-3"><Badge variant={overdue ? "destructive" : "outline"}>{overdue ? "ÜBERFÄLLIG" : invoice.status}</Badge></td><td className="p-3 text-right tabular-nums">{formatChfFromRappen(invoice.netTotalRappen)}</td><td className="p-3 text-right tabular-nums">{formatChfFromRappen(invoice.totalRappen)}</td><td className="p-3"><Link className="font-medium text-primary" href={`/admin/invoices/${invoice.id}`}>Anzeigen</Link></td></tr>; })}</tbody></table></div>}</div>;
}
